import { runtimeBindings, type Bindings } from '../auth.server'
import { authorize } from './auth'
import { find, need, object, stamp, type Actor, type Input, type Job } from './model'
import { publicProductSources } from './product-source'
import { jobOf, jobs, readClock, saveJob } from './store'
import { signSelectionRevision } from './selections'
import { delegationChoices, selectionDelegationAction } from './selection-delegation-actions'
import { delegationGuards, delegationInvalid, voidSelectionDelegations } from './selection-delegation-access'
import type { Selection } from './selection-model'
import { delegationProof, type SelectionDelegation } from './selection-delegation-model'

const root='/api/plinth/'
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}})
async function body(request:Request):Promise<Input> {
 need(request.headers.get('content-type')?.split(';')[0]==='application/json','Send application/json',415,'content_type')
 const raw=await request.text();need(raw.length<=16000,'Request too large',413,'body_size')
 try{return object(JSON.parse(raw))}catch{need(false,'Invalid JSON');throw new Error()}
}
function narrow(job:Job,selection:Selection,grant:SelectionDelegation) {
 const revision=find(selection.revisions,grant.revision_id)
 return {version:job.version,selection_id:selection.id,delegation:delegationProof(grant),revision:publicProductSources({id:revision.id,revision:revision.revision,room:revision.room,category:revision.category,allowance_cents:revision.allowance_cents,decision_on:revision.decision_on,lead_days:revision.lead_days,options:revision.options,substitution:revision.substitution,status:revision.status}),signature:grant.status==='used'?revision.signature:undefined}
}
async function delegatedRecord(db:D1Database,actor:Actor,jobId:string,grantId:string) {
 const clock=await readClock(db),row=await db.prepare('SELECT data FROM pl_jobs WHERE id=?').bind(jobId).first<{data:string}>()
 if(!row)return null
 const previous=JSON.parse(row.data) as Job,job=structuredClone(previous),selection=job.selections?.find(s=>s.delegations?.some(d=>d.id===grantId&&d.delegate.id===actor.id))
 if(!selection)return null
 const grant=find(selection.delegations??[],grantId)
 if(!['active','used'].includes(grant.status))return null
 const reason=await delegationInvalid(db,job,selection,grant)
 if(reason){if(grant.status==='active'){grant.status='void';grant.voided={at:new Date().toISOString(),reason};await saveJob(db,actor,previous,job,[],clock)}return null}
 return {previous,job,selection,grant,clock}
}
/** A separate HTTP door never sets client_job_id or returns a job projection. */
export async function selectionDelegationsResponse(request:Request,original:Bindings):Promise<Response|null> {
 const parts=new URL(request.url).pathname.slice(root.length).split('/').filter(Boolean)
 const client=parts[0]==='jobs'&&parts[2]==='selections'&&parts[4]==='delegations',delegate=parts[0]==='selection-delegations'
 if(!client&&!delegate)return null
 const env=runtimeBindings(original),db=env.DB,actor=await authorize(request,env)
 need(actor.role==='member','Only a signed-in client or named delegate uses this door',403,'client_required')
 if(client){
  const clock=await readClock(db),previous=await jobOf(db,actor,parts[1]),job=structuredClone(previous),selection=find(job.selections??[],parts[3])
  const voided=await voidSelectionDelegations(db,job,selection)
  if(voided)await saveJob(db,actor,previous,job,[],clock)
  if(request.method==='GET'){
   need(parts.length===5,'Unknown delegation route',404,'not_found')
   const {changed,...view}=await delegationChoices(db,job,actor,selection)
   if(changed)await saveJob(db,actor,previous,job,[],clock)
   return json({version:job.version,...view})
  }
  need(request.method==='POST'&&(parts.length===5||parts.length===7&&parts[6]==='revoke'),'Unknown delegation action',404,'not_found')
  const input=await body(request);need(!voided&&input.expected_version===previous.version,'Job changed; reload before delegating',409,'stale_version')
  const {grant,writes}=await selectionDelegationAction(db,job,actor,input,selection,parts[5])
  await saveJob(db,actor,previous,job,writes,clock)
  return json({version:job.version,delegation:delegationProof(grant)})
 }
 need(request.method==='GET'&&(parts.length===1||parts.length===3)||request.method==='POST'&&parts.length===4&&parts[3]==='sign','Delegates may only read and sign their own exact revision',403,'delegation_scope')
 if(parts.length===1){
  const records=[]
  for(const job of await jobs(db))for(const selection of job.selections??[])for(const grant of selection.delegations??[])if(grant.delegate.id===actor.id){const current=await delegatedRecord(db,actor,job.id,grant.id);if(current)records.push({job_id:job.id,...narrow(current.job,current.selection,current.grant)})}
  return json({delegations:records})
 }
 need(parts.length===3||parts.length===4,'Unknown delegated revision',404,'not_found')
 const current=await delegatedRecord(db,actor,parts[1],parts[2]);need(current,'Delegated revision not found',404,'not_found')
 const {previous,job,selection,grant,clock}=current
 if(request.method==='GET')return json(narrow(job,selection,grant))
 const input=await body(request);need(input.expected_version===previous.version,'Job changed; reload this exact revision',409,'stale_version');need(grant.status==='active','A delegation can be used once',409,'delegation_used')
 need(input.revision_id===grant.revision_id,'This delegation covers only its exact revision',409,'revision')
 const revision=find(selection.revisions,grant.revision_id)
 signSelectionRevision(job,actor,input,selection,revision,{delegation_id:grant.id,revision_id:revision.id,delegated_by:grant.delegated_by,delegate:stamp(actor)});grant.status='used'
 await saveJob(db,actor,previous,job,delegationGuards(db,grant),clock)
 return json(narrow(job,selection,grant))
}
