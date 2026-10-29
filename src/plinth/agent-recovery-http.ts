import { requireOwner } from './auth'
import { compareRecovery, recoveryAccess, recoveryFresh, recoveryInstallation, recoverySources } from './agent-recovery'
import { jobs, transaction } from './store'
import { jobRef } from './audit'
import { costLedger } from './cost-ledger'
import { localDate } from './remittances'
import { active, find, need, stamp, text, usdOnly, type Actor, type Input, type Job } from './model'
import type { RecoveryRequest } from './agent-recovery-model'

const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
/** Proposal review is a recorded preference only. It supplies no approval at any execution door. */
export async function recoveryResponse(request:Request,db:D1Database,previous:Job,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>,clock:number):Promise<Response|null>{
 if(parts[2]!=='recovery')return null
 const origin=new URL(request.url).origin,all=await jobs(db)
 const fresh=(row:RecoveryRequest)=>recoveryFresh(db,previous,all,row,origin)
 if(parts.length===4&&parts[3]==='sources'&&request.method==='GET'){requireOwner(actor);return json(await recoverySources(db,previous,all))}
 need(actor.role==='owner'||actor.role==='agent'&&actor.agent_native_role==='owner'&&actor.agent_door?.sponsor_role==='owner','Only the reviewing owner may use private recovery packets',403,'forbidden')
 need(parts[3]==='requests'&&parts.length>=4&&parts.length<=7,'Recovery route not found',404,'not_found')
 if(parts.length===4&&request.method==='GET'){
  need(actor.role==='owner'||actor.agent_door?.sponsor_role==='owner','Only the owner reads recovery requests',403,'forbidden')
  const requests=[]
  for(const row of previous.recovery_requests??[]){
   const current=await fresh(row)
   if(actor.role!=='owner'&&(!current||!row.share_with_owner_agents||row.prepared_by.id!==actor.id))continue
   requests.push({id:row.id,purpose:row.purpose,source_digest:row.sources.digest,stale:!current,revoked:!!row.revoked_by})
  }
  return json({version:previous.version,requests})
 }
 const existing=parts[4]?find(previous.recovery_requests??[],parts[4]):undefined
 if(request.method==='GET'&&parts.length===5){
  recoveryAccess(actor,existing)
  const current=await fresh(existing!)
  if(actor.role!=='owner')need(current,'Owner source review is stale or revoked; request fresh review',409,'recovery_stale')
  return json({version:previous.version,record:existing,stale:!current})
 }
 need(request.method==='POST','Method not allowed',405,'method_not_allowed')
 const input=await body(request);need(input.expected_version===previous.version,'Job changed; reload before recording recovery work',409,'stale_version')
 active(previous);usdOnly(previous)
 const job=structuredClone(previous);let record:unknown
 if(parts.length===4){
  requireOwner(actor)
  need((job.recovery_requests??[]).length<50,'Recovery request history is full')
  const sources=await recoverySources(db,previous,all)
  need(input.confirm===true&&input.source_digest===sources.digest,'Review and confirm these exact native sources',409,'recovery_review')
  const order=find(job.orders,text(input.package_order_id,'Delayed package order',100)),task=find(job.schedules,text(input.package_task_id,'Package dependency task',100)),ledger=costLedger(job)
  need(order.status==='issued'&&order.promised_on,'Choose an issued package with a recorded promised date')
  need(task.status==='booked'&&task.milestone,'Choose the recorded delivery milestone used by dependent work')
  const package_cost_code=text(input.package_cost_code,'Package cost code',80),labor_cost_code=text(input.labor_cost_code,'Labor overrun cost code',80)
  need(order.lines?.some(l=>l.cost_code===package_cost_code)&&ledger.rows.some(r=>r.cost_code===labor_cost_code),'Choose exact native package and labor codes')
  const labor_task_id=text(input.labor_task_id,'Labor overrun task',100),laborTask=find(job.schedules,labor_task_id),linked=new Set([task.id])
  let changed=true;while(changed){changed=false;for(const t of job.schedules)if(!linked.has(t.id)&&t.predecessors?.some(p=>linked.has(p.id))){linked.add(t.id);changed=true}}
  need(laborTask.status==='booked'&&!laborTask.milestone&&laborTask.id!==task.id&&linked.has(laborTask.id),'Review the labor task recorded downstream of the package milestone',409,'recovery_dependency')
  need(typeof input.share_with_owner_agents==='boolean','Explicitly choose whether current owner-sponsored draft agents may read this exact packet')
  const row:RecoveryRequest={id:crypto.randomUUID(),purpose:text(input.purpose,'Recovery request and assumptions',4000),as_of:localDate(input.as_of,'Recovery as of'),prepared_by:stamp(actor),owner_version:actor.version,installation:await recoveryInstallation(db,origin),sources,package_order_id:order.id,package_task_id:task.id,package_cost_code,labor_cost_code,labor_task_id,share_with_owner_agents:input.share_with_owner_agents,proposals:[]}
  ;(job.recovery_requests??=[]).push(row);record=row
 }else{
  const row=find(job.recovery_requests??[],parts[4]!)
  recoveryAccess(actor,row)
  if(parts.length===6&&parts[5]==='revoke'){
   requireOwner(actor);need(input.confirm===true,'Confirm packet consent revocation')
   row.revoked_by??=stamp(actor);record={id:row.id,revoked:true}
  }else{
   need(await fresh(row),'Owner source review is stale, revoked or from another installation; request fresh review',409,'recovery_stale')
   if(parts.length===6&&parts[5]==='compare'){
    const before=row.proposals.length
    record=await compareRecovery(db,job,all,actor,row,input)
    if(row.proposals.length===before)return json({version:previous.version,record})
   }else{
    requireOwner(actor)
    need(parts.length===7&&parts[5]==='review','Recovery action not found',404,'not_found')
    const proposal=find(row.proposals,parts[6]!),alternative=find(proposal.alternatives,text(input.alternative_id,'Alternative',80))
    need(input.digest===proposal.digest,'Review the exact immutable comparison',409,'recovery_review')
    need(input.decision==='retain'||input.decision==='reject','Retain for further human decisions or reject')
    need(input.decision!=='retain'||alternative.native_feasible,'This alternative has unresolved native capacity, dependency or work holds',409,'recovery_infeasible')
    proposal.reviews.push({alternative_id:alternative.id,decision:input.decision,reason:text(input.reason,'Review reason',2000),by:stamp(actor)});record=proposal
   }
  }
 }
 job.version=previous.version+1
 const data=JSON.stringify(job);need(data.length<=8_000_000,'Job history is too large')
 // Private proposal work emits no connector or notice event.
 await transaction(db,actor,previous,[db.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(job.version,data,job.id,previous.version)],clock,{job_id:job.id,version_before:previous.version,version_after:job.version,before_ref:await jobRef(JSON.stringify(previous)),after_ref:await jobRef(data)})
 return json({version:job.version,record})
}
