import { scopeContact } from './scope-contacts'
import { requireManager, requireJobManager } from './auth'
import { decisionFiles, decisionDownload } from './decision-files'
import { active, cents, find, need, object, recordApproval, stamp, text, type Actor, type Input, type Job, type Variation } from './model'
import { day } from './purchase-order-model'
import type { Rfi, RfiGrant, RfiResponse } from './rfi-model'

export function rfiGrant(job:Job,email:string){return job.rfi_access?.findLast(g=>g.email===email.toLowerCase())}
export async function rfiCurrent(db:D1Database,job:Job,email:string){const grant=rfiGrant(job,email);if(!grant||grant.revoked_by)return false;return grant.role!=='trade'||!!await scopeContact(db,job,email,grant.subcontract_id)}
export function rfiPermitted(job:Job,actor:Actor){const grant=rfiGrant(job,actor.email);return actor.role!=='member'||!!grant&&!grant.revoked_by}
export function rfiVisible(job:Job,actor:Actor,rfi:Rfi){if(actor.role!=='member')return true;const grant=rfiGrant(job,actor.email);return !!grant&&!grant.revoked_by&&(rfi.assignee_email===actor.email.toLowerCase()||rfi.recipient_emails.includes(actor.email.toLowerCase())||rfi.by.id===actor.id)}
export function rfiProjection(job:Job,actor:Actor){return (job.rfis??[]).filter(r=>rfiVisible(job,actor,r)).map(r=>({...r,responses:r.responses.filter(a=>actor.role!=='member'||a.published_by||a.by.id===actor.id).map(a=>actor.role==='member'?{...a,acknowledgments:a.acknowledgments.filter(ack=>ack.email===actor.email.toLowerCase())}:a).map(a=>actor.role==='member'&&rfiGrant(job,actor.email)?.role!=='designer'?{...a,cost_impact_cents:undefined,variation_id:undefined,change_pending:!!a.variation_id&&job.variations.find(v=>v.id===a.variation_id)?.status!=='approved'}:a),...(actor.role==='member'?{recipient_emails:r.recipient_emails.filter(e=>e===actor.email.toLowerCase()),history:r.history.filter(h=>h.kind!=='routed')}:{})}))}
function currentResponse(row:Rfi){return [...row.responses].reverse().find(r=>r.published_by)}
/** Native RFI changes are exact, attributed pending client decisions. They never execute a schedule or order. */
export function assertRfiChange(job:Job,variation:Variation){const c=variation.rfi_change;if(!c)return;const rfi=find(job.rfis??[],c.rfi_id),response=currentResponse(rfi);need(response?.id===c.response_id,'A newer RFI response needs a fresh client change decision',409,'rfi_stale');const prior=job.variations.filter(v=>v.status==='approved'&&v.rfi_change?.rfi_id===rfi.id).at(-1)?.rfi_change?.proposed_total_cents??0;need(prior===c.prior_total_cents&&variation.amount_cents===response.cost_impact_cents-prior,'The RFI change baseline changed; prepare a new response',409,'rfi_stale')}
export function rfiWorkHolds(job:Job){return (job.rfis??[]).flatMap(r=>{const response=currentResponse(r);if(!response?.variation_id)return [];const change=job.variations.find(v=>v.id===response.variation_id);return change?.status!=='approved'?[{rfi:r,response,task_ids:r.task_ids}]:[]})}
function emails(value:unknown){need(Array.isArray(value)&&value.length<=30,'Supply up to 30 affected contact emails');return [...new Set(value.map(v=>text(v,'Contact email',254).toLowerCase()))]}
function contact(job:Job,email:string,designer=false){const grant=rfiGrant(job,email);need(grant&&!grant.revoked_by&&(!designer||grant.role==='designer'),'Choose a currently granted RFI contact',409,'rfi_contact');return grant}

export async function rfiAccess(db:D1Database,job:Job,actor:Actor,input:Input){requireManager(actor);const email=text(input.email,'Contact email',254).toLowerCase(),previous=rfiGrant(job,email)
 if(input.revoke===true){need(previous&&!previous.revoked_by,'Active RFI grant not found',404,'not_found');previous.revoked_by=stamp(actor);return previous}
 need(await db.prepare("SELECT 1 FROM oa_operators WHERE lower(email)=? AND status='active' AND role='member'").bind(email).first(),'Invite this person through People & access first',409,'contact_required')
 need(['field','designer','trade'].includes(String(input.role)),'Choose field, designer or trade');const sheets=input.sheet_ids??[];need(Array.isArray(sheets)&&sheets.length<=100&&sheets.every(id=>job.takeoff?.some(s=>s.id===id)),'Choose existing drawing sheets')
 if(previous&&!previous.revoked_by)previous.revoked_by=stamp(actor)
 const scope=input.role==='trade'?await scopeContact(db,job,email,text(input.subcontract_id,'Released subcontract scope',100)):undefined;need(input.role!=='trade'||scope,'The trade contact must belong to its own released company scope',403,'scope_required')
 const grant:RfiGrant={...(scope?{subcontract_id:scope.id}:{}),email,role:input.role as RfiGrant['role'],sheet_ids:[...new Set(sheets as string[])],by:stamp(actor)};(job.rfi_access??=[]).push(grant);return grant
}
export async function rfiAction(db:D1Database,job:Job,actor:Actor,input:Input,id?:string,action?:string){
 active(job);need(actor.role!=='agent','RFI questions, responses and distribution require a person',403,'human_required');need(rfiPermitted(job,actor)&&(actor.role!=='member'||await rfiCurrent(db,job,actor.email)),'RFI access not found',404,'not_found')
 const writes:D1PreparedStatement[]=[],grant=actor.role==='member'?rfiGrant(job,actor.email):undefined
 if(!id){
  if(grant)need(grant.role==='field'||grant.role==='trade','Only field staff and trades raise an RFI',403,'rfi_role');else requireJobManager(actor)
  need((job.rfis?.length??0)<200,'A job supports up to 200 RFIs')
  const assignee=text(input.assignee_email,'Designer assignee email',254).toLowerCase();contact(job,assignee,true)
  const recipients=emails(input.recipient_emails??[]);need(!grant||!recipients.length,'An office person must choose additional affected recipients',403,'rfi_distribution');recipients.forEach(e=>contact(job,e))
  const ids=input.task_ids??[];need(Array.isArray(ids)&&ids.length<=200&&ids.every(id=>job.schedules.some(t=>t.id===id)),'Choose existing affected tasks')
  if(grant?.role==='trade'){const scope=await scopeContact(db,job,actor.email,grant.subcontract_id);need(scope&&ids.every(id=>job.schedules.find(t=>t.id===id)?.trade.toLowerCase()===scope.trade.toLowerCase()),'Choose tasks in your awarded trade scope',403,'scope_required')}
  const row:Rfi={id:crypto.randomUUID(),number:(job.rfis?.length??0)+1,title:text(input.title,'RFI title',300),question:text(input.question,'Question',8000),task_ids:[...new Set(ids as string[])],assignee_email:assignee,due_on:day(input.due_on,'RFI due date'),recipient_emails:recipients,attachments:[],by:stamp(actor),responses:[],history:[{kind:'raised',reason:'RFI raised for an explicit response',by:stamp(actor)}]}
  if(input.sheet!==undefined){const source=object(input.sheet),sheet=find(job.takeoff??[],text(source.sheet_id,'Sheet id',100));need(!grant||grant.sheet_ids.includes(sheet.id),'Drawing access not granted',404,'not_found');const revision=find(sheet.revisions,text(source.revision_id,'Sheet revision',100));row.sheet={sheet_id:sheet.id,revision_id:revision.id,name:sheet.name,revision:revision.revision,page:revision.page,document:structuredClone(revision.document)}}
  if(input.cost_code){const code=text(input.cost_code,'Cost code',40);need(job.quotes.find(q=>q.status==='accepted')?.lines.some(l=>l.cost_code===code),'Choose an accepted job cost code');row.cost_code=code}
  const files=await decisionFiles(db,job,row.id,input.attachments);row.attachments=files.attachments;writes.push(...files.writes);(job.rfis??=[]).push(row);return {record:row,writes}
 }
 const row=find(job.rfis??[],id);need(rfiVisible(job,actor,row),'RFI not found',404,'not_found')
 if(action==='route'){requireManager(actor);const assignee=text(input.assignee_email,'Designer assignee email',254).toLowerCase();contact(job,assignee,true);row.assignee_email=assignee;row.recipient_emails=emails(input.recipient_emails);row.recipient_emails.forEach(e=>contact(job,e));row.history.push({kind:'routed',reason:text(input.reason,'Routing reason',2000),by:stamp(actor)});return {record:row,writes}}
 if(action==='respond'){
  need(!row.resolved,'Reopen this RFI before responding',409,'rfi_resolved')
  if(grant)need(grant.role==='designer'&&row.assignee_email===actor.email.toLowerCase(),'Only the currently assigned designer responds',403,'rfi_role');else requireManager(actor)
  const days=input.date_impact_days;need(Number.isSafeInteger(days)&&Math.abs(Number(days))<=3650,'Date impact is whole calendar days within 3650')
  const response:RfiResponse={id:crypto.randomUUID(),revision:row.responses.length+1,text:text(input.text,'Design response',8000),attachments:[],cost_impact_cents:cents(input.cost_impact_cents,'Proposed total client price impact',true),date_impact_days:Number(days),by:stamp(actor),acknowledgments:[]}
  const files=await decisionFiles(db,job,response.id,input.attachments);response.attachments=files.attachments;writes.push(...files.writes);row.responses.push(response);return {record:row,writes}
 }
 if(action==='publish'){
  requireManager(actor);need(!row.resolved,'Reopen this RFI before publication',409,'rfi_resolved');const response=find(row.responses,text(input.response_id,'Response revision',100));need(response===row.responses.at(-1)&&!response.published_by,'Review the latest unpublished exact response',409,'rfi_revision')
  need(input.confirm===true,'Explicitly approve this exact response and its distribution');need(input.cost_impact_cents===response.cost_impact_cents&&input.date_impact_days===response.date_impact_days,'Restate the reviewed price and date impacts',409,'rfi_review')
  row.recipient_emails.forEach(e=>contact(job,e));contact(job,row.assignee_email,true)
  response.published_by=stamp(actor)
  const prior=job.variations.filter(v=>v.status==='approved'&&v.rfi_change?.rfi_id===row.id).at(-1)?.rfi_change?.proposed_total_cents??0,delta=response.cost_impact_cents-prior
  if(delta!==0||response.date_impact_days!==0){const variation:Variation={id:crypto.randomUUID(),revision:1,description:`RFI ${row.number}: ${row.title}. ${response.text}`,amount_cents:delta,status:'draft',prepared_by:stamp(actor),rfi_change:{rfi_id:row.id,response_id:response.id,proposed_total_cents:response.cost_impact_cents,prior_total_cents:prior,date_impact_days:response.date_impact_days,task_ids:row.task_ids,response_text:response.text}};job.variations.push(variation);response.variation_id=variation.id}
  row.history.push({kind:'published',reason:'Exact reviewed response distributed in the granted RFI inbox; no email delivery claimed',by:stamp(actor)});recordApproval(job,actor,'rfi.publish',{id:row.id,prepared_by:row.by,revision:response.revision},response);return {record:row,writes}
 }
 if(action==='acknowledge'){need(actor.role==='member'&&row.recipient_emails.includes(actor.email.toLowerCase()),'Only an affected recipient acknowledges',403,'rfi_role');const response=find(row.responses,text(input.response_id,'Response revision',100));need(response.published_by,'Response not found',404,'not_found');need(!response.acknowledgments.some(a=>a.email===actor.email.toLowerCase()),'Already acknowledged',409,'immutable');response.acknowledgments.push({email:actor.email.toLowerCase(),by:stamp(actor)});return {record:row,writes}}
 need(action==='resolve'||action==='reopen','Unknown RFI action',404,'not_found');requireManager(actor);const reason=text(input.reason,'Resolution reason',2000)
 if(action==='resolve'){const response=currentResponse(row);need(response,'Publish a response before resolution',409,'rfi_open');need(!rfiWorkHolds(job).some(h=>h.rfi.id===row.id),'The client change decision still holds affected work',409,'rfi_change_pending');need(row.recipient_emails.every(e=>response.acknowledgments.some(a=>a.email===e)),'Affected trades must acknowledge the exact response',409,'rfi_ack_pending');row.resolved={reason,by:stamp(actor)}}else {need(row.resolved,'RFI is already open',409,'rfi_open');delete row.resolved}
 row.history.push({kind:action==='resolve'?'resolved':'reopened',reason,by:stamp(actor)});return {record:row,writes}
}
export async function rfiFile(db:D1Database,job:Job,actor:Actor,id:string){need(actor.role!=='agent','A person downloads RFI originals',403,'human_required');need(rfiPermitted(job,actor)&&(actor.role!=='member'||await rfiCurrent(db,job,actor.email)),'RFI access not found',404,'not_found');const files=rfiProjection(job,actor).flatMap(r=>[...r.attachments,...(r.sheet?[r.sheet.document]:[]),...r.responses.flatMap(a=>a.attachments)]);return decisionDownload(db,job,files,id)}
