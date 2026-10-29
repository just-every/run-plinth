import { requireNoHold } from './holds'
import { jobs } from './store'
import type { Actor } from './model'
import type { D1Sql } from '../modules/import-kit/src/d1/index.ts'

/** Remove whole immutable packets: redacting only their sources would leave
 * derived proposals and copied approval results with an invalid provenance. */
export async function recoveryErasure(db:D1Database,actor:Actor,erasedId:string):Promise<D1Sql[]>{
 const writes:D1Sql[]=[]
 for(const job of await jobs(db)){
  const removed=(job.recovery_requests??[]).filter(row=>job.id===erasedId||(row.sources.facts.bookings as {job_id:string}[]).some(booking=>booking.job_id===erasedId))
  if(!removed.length&&job.id!==erasedId)continue
  const sources=new Set([job.id,...removed.flatMap(row=>(row.sources.facts.bookings as {job_id:string}[]).map(booking=>booking.job_id))])
  for(const source of sources)if(source!==erasedId)await requireNoHold(db,actor,'job',source)
  const ids=JSON.stringify(removed.map(row=>row.id)),selected="SELECT value FROM json_each(?)"
  const approval="(json_extract(saved,'$.args.job_id')=? AND json_extract(saved,'$.tool') LIKE 'plinth.recovery.%')"
  writes.push(
   {sql:`DELETE FROM agent_door_calls WHERE decision_id IN (SELECT json_extract(saved,'$.decision_id') FROM agent_door_approvals WHERE ${approval}) OR json_extract(outcome,'$.result.record.request_id') IN (${selected}) OR json_extract(outcome,'$.result.record.id') IN (${selected})`,params:[job.id,ids,ids]},
   {sql:`DELETE FROM agent_door_approvals WHERE ${approval}`,params:[job.id]},
   {sql:`DELETE FROM agent_door_reviews WHERE json_extract(saved,'$.tool') LIKE 'plinth.recovery.%' AND json_extract(saved,'$.summary.target.id') IN (${selected})`,params:[ids]},
  )
  if(job.id===erasedId)continue
  // eraseJob guards the installation clock, so neither a new packet nor a hold
  // can arrive between this read and the atomic deletion batch.
  const before=job.version
  job.recovery_requests=job.recovery_requests!.filter(row=>!removed.includes(row));job.version++
  writes.push({sql:'UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?',params:[job.version,JSON.stringify(job),job.id,before]})
 }
 return writes
}
