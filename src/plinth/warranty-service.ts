import type {Bindings} from '../auth.server'
import {authorize,requireJobManager} from './auth'
import {clientAccess} from './job-customers'
import {decisionFiles,decisionDownload} from './decision-files'
import {active,find,need,object,recordApproval,stamp,text,type Actor,type Input,type Job} from './model'
import {portalEnabled,requirePortalFeature} from './portal-policy'
import {scopeContact} from './scope-contacts'
import {jobOf,jobs,readClock,saveJob} from './store'
import {prepareSchedule} from './operations'
import {requireResources} from './schedule-resources'
import {closeReviewedWarrantyCase} from './warranties'
import {warrantyState,officeAuthority} from './warranty-store'
import {wallClock} from './time-zone'
import type {WarrantyCase} from './warranty-model'
const json=(v:unknown)=>Response.json(v,{headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
const serviceCases=(job:Job)=>(job.warranties?.cases??[]).filter(c=>c.service)
async function tradeAllowed(db:D1Database,job:Job,actor:Actor,item:WarrantyCase){const a=item.service?.assignment;return portalEnabled(job,'subcontractor','warranty')&&a?.email===actor.email.toLowerCase()&&!!await scopeContact(db,job,actor.email,a.subcontract_id)}
function shownCase(job:Job,item:WarrantyCase,office:boolean){
 if(office)return item
 // External service records never contain office costs, signed terms, internal coverage source references or other cases.
 return {id:item.id,component_id:item.component_id,description:item.description,reported_on:item.reported_on,status:item.status,service:{...item.service,visits:item.service!.visits.map(v=>({...v,appointment:(()=>{const task=job.schedules.find(t=>t.id===v.task_id);return task?{start:task.start,end:task.end,status:task.status}:undefined})()}))},reviews:item.reviews.map(r=>({id:r.id,decision:r.decision,reason:r.reason,reviewed_by:{name:r.reviewed_by.name,at:r.reviewed_by.at}})),closure:item.closure?{reason:item.closure.reason,closed_by:{name:item.closure.closed_by.name,at:item.closure.closed_by.at}}:undefined}
}
async function projection(db:D1Database,job:Job,actor:Actor,portal:boolean){
 const office=actor.role!=='member',items=portal?await Promise.all(serviceCases(job).map(async c=>await tradeAllowed(db,job,actor,c)?c:null)):serviceCases(job)
 return {id:job.id,version:job.version,name:job.name,address:job.address,components:(job.warranties?.components??[]).filter(c=>!portal||items.some(i=>i?.component_id===c.id)).map(c=>({id:c.id,name:c.name})),cases:items.filter((c):c is WarrantyCase=>!!c).map(c=>shownCase(job,c,office))}
}
async function input(request:Request){need(request.headers.get('content-type')?.split(';')[0]==='application/json','Send application/json',415,'content_type');const raw=await request.text();need(raw.length<=15_000_000,'Request too large',413,'body_size');try{return object(JSON.parse(raw))}catch{need(false,'Invalid JSON');throw new Error()}}
/** Client job door and separate company-scoped trade inbox; all reads, actions and originals recheck current grants. */
export async function warrantyServiceResponse(request:Request,env:Bindings):Promise<Response|null>{
 const parts=new URL(request.url).pathname.split('/').filter(Boolean),portal=parts[2]==='warranty-service',jobRoute=parts[2]==='jobs'&&parts[4]==='service'
 if(!portal&&!jobRoute)return null
 const actor=await authorize(request,env);need(actor.role!=='agent','A person uses the warranty service workflow',403,'human_required')
 const db=env.DB,clock=await readClock(db),id=parts[3],tail=parts.slice(portal?4:5)
 let previous:Job
 if(portal){
  need(actor.role==='member','Use the job service workspace for office work',403,'forbidden')
  const permitted=[];for(const job of await jobs(db))if((await Promise.all(serviceCases(job).map(c=>tradeAllowed(db,job,actor,c)))).some(Boolean))permitted.push(job)
  if(!id){need(request.method==='GET'&&parts.length===3,'Unknown service route',404,'not_found');return json({jobs:await Promise.all(permitted.map(j=>projection(db,j,actor,true)))})}
  previous=find(permitted,id)
 }else {previous=await jobOf(db,actor,id);if(actor.role==='member')requirePortalFeature(previous,'client','warranty');else requireJobManager(actor)}
 const view=await projection(db,previous,actor,portal)
 if(request.method==='GET'){
  if(tail.length===0)return json(view)
  if(tail.length===2&&tail[0]==='files'){
   const allowed=portal?serviceCases(previous).filter(c=>view.cases.some(v=>v.id===c.id)):serviceCases(previous)
   return decisionDownload(db,previous,allowed.flatMap(c=>[...c.service!.attachments,...c.service!.visits.flatMap(v=>v.submission?.attachments??[])]),tail[1])
  }
  need(false,'Unknown service route',404,'not_found')
 }
 need(request.method==='POST'&&(tail.length===0||tail.length===2),'Unknown service action',404,'not_found')
 const value=await input(request);need(value.expected_version===previous.version,'Service records changed; reload before acting',409,'stale_version')
 const job=structuredClone(previous);active(job);let item:WarrantyCase,writes:D1PreparedStatement[]=[]
 if(!tail.length){
  need(!portal&&actor.role==='member'&&await clientAccess(db,job,actor.email),'Only an assigned client submits a warranty request',403,'client_required')
  const state=warrantyState(job);need(state.cases.length<500,'Warranty case limit reached')
  const component=find(state.components,text(value.component_id,'Component',100)),by=stamp(actor),caseId=crypto.randomUUID(),files=await decisionFiles(db,job,caseId,value.attachments)
  need(files.attachments.length>0&&files.attachments.every(a=>a.mime==='image/png'||a.mime==='image/jpeg'),'Include at least one original request photo')
  const service={requested_by:by,availability:text(value.availability,'Visit availability',2000),attachments:files.attachments,visits:[],history:[{kind:'requested',by,reason:'Client submitted a warranty request; coverage not determined'}]}
  item={id:caseId,component_id:component.id,defect_key:'service-request',description:text(value.description,'Warranty request',4000),reported_on:wallClock(Date.now(),job.time_zone??'UTC').date,reviewer_email:'',reviewer_id:'',repeated:false,earlier_case_ids:[],status:'open',recorded_by:by,costs:[],reviews:[],service}
  state.cases.push(item);writes=files.writes
 }else{
  item=find(serviceCases(job),tail[0]);need(!portal||view.cases.some(c=>c.id===item.id),'Service request not found',404,'not_found');need(item.status==='open','The closed repair history is immutable',409,'immutable')
  const service=item.service!,action=tail[1],by=stamp(actor),reason=text(value.reason,'Action statement or reason',4000)
  if(action==='acknowledge-owner'){
   requireJobManager(actor);need(!service.ownership,'Ownership already acknowledged',409,'immutable');const reviewer=await officeAuthority(db,job,actor.id,true);need(reviewer,'Current office authority required',403,'forbidden')
   item.reviewer_id=actor.id;item.reviewer_email=actor.email.toLowerCase();service.ownership={by,statement:reason}
  }else if(action==='assign'){
   requireJobManager(actor);need(service.ownership,'Acknowledge office ownership first',409,'ownership_required')
   need(!service.visits.at(-1)||service.visits.at(-1)?.review?.accepted===false,'Review the current visit before reassignment',409,'visit_pending')
   const email=text(value.email,'Repair contact email',254).toLowerCase(),scope=await scopeContact(db,job,email,text(value.subcontract_id,'Released company scope',100));need(scope,'Choose a current contact of its own released company scope',403,'scope_required')
   need(await db.prepare("SELECT 1 FROM oa_operators WHERE lower(email)=? AND role='member' AND status='active'").bind(email).first(),'Invite this contact first',409,'contact_required');service.assignment={email,subcontract_id:scope.id,by,reason}
  }else if(action==='book'){
   requireJobManager(actor);const assignment=service.assignment;need(assignment&&await scopeContact(db,job,assignment.email,assignment.subcontract_id),'Choose a currently released repair contact',409,'scope_required')
   need(!service.visits.at(-1)||service.visits.at(-1)?.review?.accepted===false,'Review the prior fix before booking another visit',409,'visit_pending');need(service.visits.length<100,'Visit history limit reached')
   const scope=find(job.subcontracts??[],assignment.subcontract_id),all=await jobs(db),task=prepareSchedule(job,actor,{trade:scope.trade,description:'Warranty visit: '+item.description,start:value.start,end:value.end,travel_minutes:value.travel_minutes??0},all)
   await requireResources(db,job,all,actor);service.visits.push({id:crypto.randomUUID(),task_id:task.id,start:task.start,end:task.end,booked_by:by,assignment:{email:assignment.email,subcontract_id:assignment.subcontract_id}})
  }else if(action==='submit'){
   need(portal&&await tradeAllowed(db,job,actor,item),'Only the assigned current trade contact submits repairs',403,'scope_required')
   const visit=find(service.visits,text(value.visit_id,'Exact visit',100));need(visit===service.visits.at(-1)&&!visit.submission,'Submit the latest unfinished visit',409,'visit_state');need(visit.assignment.email===actor.email.toLowerCase()&&visit.assignment.subcontract_id===service.assignment?.subcontract_id,'The visit assignment changed',409,'visit_state')
   const files=await decisionFiles(db,job,item.id,value.attachments);need(files.attachments.length>0,'Supply original repair evidence');visit.submission={by,statement:reason,attachments:files.attachments};writes=files.writes
  }else if(action==='review'){
   requireJobManager(actor);const visit=find(service.visits,text(value.visit_id,'Exact visit',100));need(visit===service.visits.at(-1)&&visit.submission&&!visit.review,'Review the latest submitted fix once',409,'visit_state');need(typeof value.accepted==='boolean','Choose accept or reject');visit.review={by,accepted:value.accepted,reason}
  }else if(action==='acknowledge-client'){
   need(!portal&&actor.role==='member'&&await clientAccess(db,job,actor.email),'Only an assigned client acknowledges closure',403,'client_required')
   const visit=find(service.visits,text(value.visit_id,'Exact accepted visit',100));need(visit===service.visits.at(-1)&&visit.review?.accepted===true,'The builder must accept the current repair first',409,'builder_acceptance')
   service.client_acknowledgment={by,visit_id:visit.id,statement:reason};closeReviewedWarrantyCase(job,actor,item,{reason,evidence_reference:'Accepted service visit '+visit.id})
  }else need(false,'Unknown service action',404,'not_found')
  service.history.push({kind:action,by,reason})
 }
 recordApproval(job,actor,'warranty.service',{id:item.id,prepared_by:item.recorded_by},{action:tail[1]??'request',status:item.status,service:item.service})
 await saveJob(db,actor,previous,job,writes,clock)
 return json({...await projection(db,job,actor,portal),record:shownCase(job,item,actor.role!=='member')})
}
