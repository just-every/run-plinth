import type { Bindings } from '../auth.server'
import { requireOwner } from './auth'
import { need, stamp, text, usdOnly, type Actor, type Input } from './model'
import { jobOf, readClock, transaction } from './store'
import { jobRef } from './audit'
import { warrantyGeneration } from './warranty-store'
import { followupPreview } from './followup-rules'
import { collectionBalances, collectionBoundary, collectionSources, type CollectionReview } from './collection-reviews'
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
/** A private diagnostic commits without producing connector events or acquiring sending authority. */
export async function collectionReviewResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>):Promise<Response|null>{
 if(parts[0]!=='jobs'||parts[2]!=='collection-reviews')return null
 requireOwner(actor);need(!actor.agent_door,'Use the signed-in owner door',403,'forbidden')
 need(parts.length===3||parts.length===4||parts.length===5&&['preview','revoke'].includes(parts[4]!),'Unknown collection review route',404,'not_found')
 const clock=await readClock(env.DB),job=await jobOf(env.DB,actor,parts[1]!)
 usdOnly(job)
 const current=await collectionSources(job),generation=await warrantyGeneration(env.DB),state=job.collection_reviews??{reviews:[],revocations:[]}
 const status=(r:CollectionReview)=>({stale:r.source_digest!==current.source_digest,revoked:state.revocations.some(v=>v.review_id===r.id),authority_current:r.reviewed_by.id===actor.id&&r.owner_version===actor.version&&r.generation===generation})
 const usable=(r:CollectionReview)=>{const s=status(r);need(!s.revoked,'Owner revoked this collection review',409,'collection_revoked');need(s.authority_current,'Fresh owner review is required on this installation',409,'collection_authority');need(!s.stale,'Collection sources changed; request a new review',409,'collection_stale')}
 const record=parts[3]?state.reviews.find(r=>r.id===parts[3]):undefined
 if(parts[3])need(record,'Collection review not found in this job',404,'not_found')
 if(request.method==='GET'){
  need(!parts[4]||parts[4]==='preview','Method not allowed',405,'method_not_allowed')
  if(parts[4]==='preview'){
   usable(record!)
   const at=new URL(request.url).searchParams.get('as_of')
   need(at&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(at)&&Number.isFinite(Date.parse(at)),'Choose a dated preview with a time zone')
   const preview=await followupPreview(env.DB,job,Date.parse(at)),balances=collectionBalances(job)
   const invoices=balances.invoices.map(i=>({...i,actions:preview.actions.filter(a=>a.source_id===i.invoice_id&&job.followup?.rules.some(r=>r.id===a.rule_id&&r.kind==='collection')).map(a=>({...a,amount_cents:i.collectible_cents,monetary_state:i.monetary_state,monetary_reason:i.reason}))}))
   return json({review_id:record!.id,source_digest:current.source_digest,as_of:preview.as_of,...balances,invoices,boundary:collectionBoundary,case_status:'unresolved'})
  }
  if(record)return json({record,...status(record),version:job.version})
  return json({version:job.version,review_generation:generation,owner_version:actor.version,source_digest:current.source_digest,current:collectionBalances(job),reviews:state.reviews.map(r=>({...r,...status(r)})),revocations:state.revocations,boundary:collectionBoundary})
 }
 need(request.method==='POST'&&(!parts[3]||parts[4]==='revoke'),'Method not allowed',405,'method_not_allowed')
 const input=await body(request)
 need(input.review_generation===generation&&input.owner_version===actor.version,'Fresh owner review is required on this installation',409,'collection_authority')
 need(input.confirm===true,'Explicitly review these private native sources; no sending or financial action is authorized')
 need(input.source_digest===current.source_digest,'Collection sources changed; reload before reviewing',409,'collection_stale')
 const next=structuredClone(job);next.collection_reviews??={reviews:[],revocations:[]}
 let result:CollectionReview
 if(!record){
  // Identical requests retain one identity. Replays still recheck erasure, source and current authority.
  const earlier=state.reviews.find(r=>r.source_digest===current.source_digest&&r.reviewed_by.id===actor.id&&r.owner_version===actor.version&&r.generation===generation)
  if(earlier){usable(earlier);return json({record:earlier,version:job.version})}
  need(input.expected_version===job.version,'Job changed; reload before reviewing',409,'stale_version')
  need(state.reviews.length<200,'This job has two hundred retained collection reviews')
  result={id:crypto.randomUUID(),job_id:job.id,...structuredClone(current),balances:collectionBalances(job),reviewed_by:stamp(actor),owner_version:actor.version,generation,boundary:collectionBoundary,case_status:'unresolved'}
  next.collection_reviews.reviews.push(result)
 }else{
  need(input.expected_version===job.version,'Job changed; reload before revoking',409,'stale_version')
  need(!status(record).revoked,'This review is already revoked',409,'collection_revoked')
  next.collection_reviews.revocations.push({review_id:record.id,by:stamp(actor),reason:text(input.reason,'Revocation reason',2000)})
  result=record
 }
 next.version=job.version+1;const data=JSON.stringify(next);need(data.length<=8_000_000,'Job history is too large')
 await transaction(env.DB,actor,job,[env.DB.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_auth_settings WHERE singleton=1 AND generation=?) THEN 1 ELSE 0 END').bind(generation),env.DB.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(next.version,data,job.id,job.version)],clock,{job_id:job.id,version_before:job.version,version_after:next.version,before_ref:await jobRef(JSON.stringify(job)),after_ref:await jobRef(data)})
 return json({record:result,version:next.version})
}
