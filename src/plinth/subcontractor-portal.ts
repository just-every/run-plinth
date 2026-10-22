import type {Bindings} from '../auth.server'
import {requireJobManager} from './auth'
import {decisionFiles,decisionDownload} from './decision-files'
import {complianceRecord,evaluate,rules,today} from './compliance'
import {getVendor,save as saveVendor} from './vendors'
import {currentQualification,type Vendor} from './vendor-model'
import {find,need,stamp,text,cents,type Actor,type Attachment,type Job,type Stamp} from './model'
import {jobRequest} from './job-request'
import {jobOf,jobs,readClock,saveJob} from './store'
import {portalEnabled,requirePortalFeature} from './portal-policy'

export interface PortalSubmission {id:string;subcontract_id:string;vendor_id:string;kind:'bill'|'compliance';reference:string;note:string;amount_cents?:number;compliance_id?:string;attachments:Attachment[];by:Stamp}
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json=(v:unknown)=>Response.json(v,{headers})
/** Contact identities come only from the current directory and this company's explicit award. A bid invitation is never sufficient. */
async function ownScopes(db:D1Database,job:Job,actor:Actor){
 const result: {scope:NonNullable<Job['subcontracts']>[number];vendor:Vendor}[]=[]
 for(const scope of job.subcontracts??[]){
  if(scope.status==='cancelled')continue
  const row=await db.prepare('SELECT data FROM pl_vendors WHERE id=?').bind(scope.vendor_id).first<{data:string}>();if(!row)continue
  const vendor=JSON.parse(row.data) as Vendor
  if(vendor.kind==='subcontractor'&&currentQualification(vendor,scope.trade)?.status==='qualified'&&vendor.contacts.some(c=>scope.contact_ids.includes(c.id)&&c.email.toLowerCase()===actor.email.toLowerCase()))result.push({scope,vendor})
 }
 return result
}
async function source(db:D1Database,job:Job,actor:Actor){
 const office=actor.role!=='member',owned=office?(job.subcontracts??[]).filter(s=>s.status!=='cancelled').map(scope=>({scope})):await ownScopes(db,job,actor),scopeIds=new Set(owned.map(r=>r.scope.id))
 const submissions=(job.portal_submissions??[]).filter(r=>office||scopeIds.has(r.subcontract_id)&&portalEnabled(job,'subcontractor',r.kind==='bill'?'bills':'compliance'))
 const requirements=await rules(db),on=await today(db)
 const scopes=[]
 for(const {scope} of owned){const vendor=await getVendor(db,scope.vendor_id);scopes.push({id:scope.id,company:scope.vendor_name,trade:scope.trade,scope:scope.scope,status:scope.status??'awarded',...(office||portalEnabled(job,'subcontractor','compliance')?{compliance:evaluate(vendor,scope.trade,requirements,on),requests:(vendor.renewal_requests??[]).filter(r=>r.job_id===job.id).map(r=>({id:r.id,kind:r.kind,problem:r.problem,prepared_at:r.prepared_at}))}:{})})}
 return {id:job.id,version:job.version,name:job.name,scopes,submissions}
}
/** Public JSON portal, search, export and original-file doors share exactly the same projection and live grant. No directory, W-9, rates, other company contacts or general job data are returned. */
export async function subcontractorPortalResponse(request:Request,env:Bindings,actor:Actor,parts:string[]):Promise<Response|null>{
 const portal=parts[0]==='subcontractor-portal',office=parts[0]==='jobs'&&parts[2]==='subcontractor-portal'
 if(!portal&&!office)return null
 need(actor.role!=='agent','A personally signed-in person is required',403,'human_required')
 if(portal)need(actor.role==='member','Use the job workspace for office records',403,'forbidden')
 const clock=await readClock(env.DB),id=parts[1],tail=parts.slice(portal?2:3),url=new URL(request.url)
 if(portal&&!id){need(request.method==='GET'&&parts.length===1,'Unknown portal route',404,'not_found');const sources=[];for(const job of await jobs(env.DB))if((await ownScopes(env.DB,job,actor)).length)sources.push(await source(env.DB,job,actor));return json({sources})}
 need(id,'Job not found',404,'not_found')
 const job=office?await jobOf(env.DB,actor,id):find(await jobs(env.DB),id)
 if(office)requireJobManager(actor)
 else need((await ownScopes(env.DB,job,actor)).length,'Job not found',404,'not_found')
 const projected=await source(env.DB,job,actor)
 if(request.method==='GET'){
  if(tail.length===2&&tail[0]==='files')return decisionDownload(env.DB,job,projected.submissions.flatMap(s=>s.attachments),tail[1])
  need(!tail.length||tail.length===1&&tail[0]==='export.json','Unknown portal route',404,'not_found')
  const q=(url.searchParams.get('q')??'').toLowerCase();need(q.length<=500,'Search is too long')
  const shown={...projected,submissions:projected.submissions.filter(s=>!q||[s.reference,s.note,...s.attachments.map(a=>a.name)].join(' ').toLowerCase().includes(q))}
  return tail.length?new Response(JSON.stringify(shown),{headers:{...headers,'content-type':'application/json','content-disposition':'attachment; filename=subcontractor-records.json'}}):json({source:shown})
 }
 need(portal&&request.method==='POST'&&tail.length===1&&['bills','compliance'].includes(tail[0]),'Unknown portal action',404,'not_found')
 const feature=tail[0] as 'bills'|'compliance';requirePortalFeature(job,'subcontractor',feature)
 const input=await jobRequest(request,15_000_000);need(input.expected_version===job.version,'Job changed; reload before submitting',409,'stale_version')
 const owned=await ownScopes(env.DB,job,actor),scopeId=text(input.subcontract_id,'Awarded company scope',100),grant=owned.find(r=>r.scope.id===scopeId);need(grant,'Scope not found',404,'not_found')
 need(feature==='compliance'||grant.scope.status==='released','Release the company scope before submitting a bill',409,'scope_unreleased')
 need((job.portal_submissions?.length??0)<200,'At most 200 portal submissions per job')
 const idNew=crypto.randomUUID(),files=await decisionFiles(env.DB,job,idNew,input.attachments);need(files.attachments.length,'Upload original evidence')
 const row:PortalSubmission={id:idNew,subcontract_id:scopeId,vendor_id:grant.vendor.id,kind:feature==='bills'?'bill':'compliance',reference:text(input.reference,'Reference',240),note:text(input.note,'Submission note',4000),attachments:files.attachments,by:stamp(actor)}
 if(feature==='bills'){
  need(!job.portal_submissions?.some(r=>r.kind==='bill'&&r.vendor_id===row.vendor_id&&r.reference.toLowerCase()===row.reference.toLowerCase()),'This company bill reference was already received',409,'bill_duplicate')
  row.amount_cents=cents(input.amount_cents,'Bill amount');need(row.amount_cents>0,'Bill amount must be positive')
 }else{
  need(files.attachments.length===1,'Each compliance record has one original')
  const vendor=structuredClone(grant.vendor),document=files.attachments[0],record=complianceRecord(input,actor,document)
  ;(vendor.compliance??=[]).push(record);vendor.history.push({action:`compliance.${record.kind}.received`,at:record.received_by.at,by:record.received_by});row.compliance_id=record.id
  files.writes.push(...saveVendor(env.DB,vendor,grant.vendor))
  // Share the exact original with the existing owner/designated-reviewer compliance door. Upload is never verification.
  files.writes.push(env.DB.prepare('INSERT INTO pl_vendor_documents(id,vendor_id,name,mime,checksum,size,bytes) SELECT id,?,name,mime,checksum,size,bytes FROM pl_attachments WHERE id=? AND job_id=?').bind(vendor.id,document.id,job.id))
 }
 const next=structuredClone(job);(next.portal_submissions??=[]).push(row);await saveJob(env.DB,actor,job,next,files.writes,clock)
 return json({source:await source(env.DB,next,actor),record_id:row.id,label:feature==='bills'?'Bill received, not approved or paid':'Evidence received, not verified'})
}
