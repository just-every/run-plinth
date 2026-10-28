import { requireManager } from './auth'
import { auditStatement, automation, jobRef } from './audit'
import { bidContact } from './bid-access'
import { day } from './purchase-order-model'
import { active, find, need, object, recordApproval, stamp, text, type Actor, type Input, type Schedule } from './model'
import { scheduleTime } from './operations'
import { jobs, readClock } from './store'
import { authorityGuards, officeAuthority, warrantyGeneration } from './warranty-store'
import type { BidFollowUp, BidInvitation, BidJob, BidPackage } from './bid-model'

export const bidAnswered = (bid:BidPackage, invite:BidInvitation) => !!invite.decline || invite.responses.some(r=>r.revision_id===bid.revisions.at(-1)!.id)
export async function bidEstimators(db:D1Database, job:BidJob) {
 const rows=await db.prepare("SELECT o.id,o.display_name AS name,t.data FROM oa_operators o JOIN pl_team t ON t.operator_id=o.id WHERE o.status='active' AND o.role='admin'").all<{id:string;name:string;data:string}>()
 return rows.results.filter(row=>{const grant=JSON.parse(row.data);return grant.role==='estimator'&&grant.job_ids.includes(job.id)}).map(({id,name})=>({id,name}))
}
export async function bidFollowUpAction(db:D1Database,job:BidJob,bid:BidPackage,actor:Actor,input:Input,action:string) {
 if(action==='review-follow-up') {
  const plan=bid.follow_up
  need(plan&&!plan.paused&&plan.revision_id===bid.revisions.at(-1)!.id&&plan.escalation,'No current procurement escalation',409,'bid_escalation')
  need(actor.role==='estimator'&&actor.id===plan.estimator_id,'Only the assigned estimator reviews this gap',403,'forbidden')
  need((await bidEstimators(db,job)).some(e=>e.id===actor.id),'Estimator assignment changed',403,'forbidden')
  need(!plan.escalation.review,'This escalation was already reviewed',409,'immutable')
  plan.escalation.review={by:stamp(actor),reason:text(input.reason,'Procurement decision and remaining risk',4000)}
  recordApproval(job,actor,'bid.follow-up-review',{id:plan.id,prepared_by:plan.approved_by},plan.escalation)
  return
 }
 requireManager(actor)
 if(action==='pause-follow-up') {need(bid.follow_up,'No approved follow-up',409,'bid_follow_up');bid.follow_up.paused=true;return}
 if(action==='run-follow-up') {await advanceBidFollowUp(db,job,bid,Date.now());return}
 need(action==='follow-up','Unknown follow-up action',404,'not_found')
 need(bid.published_by&&input.confirm===true,'Approve reminders for this exact published package',400,'consent')
 const revision=bid.revisions.at(-1)!
 need(input.revision_id===revision.id,'Review the current exact bid revision',409,'bid_revision')
 let task:Schedule
 if(input.draft_task) {
  active(job);need(job.schedules.length<200,'The job task limit is reached')
  const raw=object(input.draft_task),start=scheduleTime(raw,'start'),end=scheduleTime(raw,'end')
  need(end>start,'Draft task must finish after it starts')
  task={id:crypto.randomUUID(),description:text(raw.description,'Draft task name',1000),trade:bid.trade,start,end,status:'draft',prepared_by:stamp(actor)}
  job.schedules.push(task)
 }else task=find(job.schedules,text(input.task_id,'Linked schedule task',100))
 need(task.status==='draft','Link an unpromised draft task before approving procurement',409,'bid_task')
 const required_on_site=day(input.required_on_site,'Required on site'),remind_on=day(input.remind_on,'First reminder date')
 need(Number.isSafeInteger(input.lead_days)&&Number(input.lead_days)>0&&Number(input.lead_days)<=3650,'Lead time must be positive whole calendar days')
 const lead_days=Number(input.lead_days),order_by=new Date(Date.parse(required_on_site+'T00:00:00Z')-lead_days*86400000).toISOString().slice(0,10)
 need(remind_on<=revision.due_on&&revision.due_on<=order_by&&required_on_site<=task.start.slice(0,10),'Reminders and bid deadline must precede the order-by date; material must arrive by the linked task',400,'bid_dates')
 const estimator=find(await bidEstimators(db,job),text(input.estimator_id,'Assigned estimator',100))
 const authority=await officeAuthority(db,job,actor.id,true)
 need(authority&&authority.version===actor.version,'Current owner or administrator approval required',403,'forbidden')
 const plan:BidFollowUp={id:crypto.randomUUID(),revision_id:revision.id,task_id:task.id,required_on_site,lead_days,order_by,remind_on,estimator_id:estimator.id,estimator_name:estimator.name,approved_by:stamp(actor),authority_version:actor.version,generation:await warrantyGeneration(db)}
 bid.follow_up=plan
 recordApproval(job,actor,'bid.follow-up',{id:plan.id,prepared_by:bid.prepared_by},plan)
}
async function approvalGuards(db:D1Database,job:BidJob,plan:BidFollowUp) {
 const authority=await officeAuthority(db,job,plan.approved_by.id,true)
 if(plan.paused||!authority||authority.version!==plan.authority_version||await warrantyGeneration(db)!==plan.generation)return null
 if(!(await bidEstimators(db,job)).some(e=>e.id===plan.estimator_id))return null
 return [...authorityGuards(db,authority),db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_auth_settings WHERE singleton=1 AND generation=?) THEN 1 ELSE 0 END').bind(plan.generation)]
}
/** Native inbox reminders have no external send, award or automatic date publication. */
export async function advanceBidFollowUp(db:D1Database,job:BidJob,bid:BidPackage,now:number) {
 const plan=bid.follow_up,revision=bid.revisions.at(-1)!,today=new Date(now).toISOString().slice(0,10)
 if(!plan||plan.revision_id!==revision.id||!await approvalGuards(db,job,plan))return false
 const task=job.schedules.find(t=>t.id===plan.task_id)
 if(!task||task.status==='cancelled')return false
 let changed=false
 const unresolved=bid.invitations.filter(i=>!i.revoked_by&&!bidAnswered(bid,i))
 for(const invite of unresolved) {
  if(!await bidContact(db,job,bid,invite))continue
  const kinds:('acknowledgment'|'price')[]=[]
  if(today>=plan.remind_on&&!invite.acknowledgments.some(a=>a.revision_id===revision.id))kinds.push('acknowledgment')
  if(today>=revision.due_on)kinds.push('price')
  for(const kind of kinds)if(!invite.reminders?.some(r=>r.approval_id===plan.id&&r.kind===kind)) {
   ;(invite.reminders??=[]).push({id:crypto.randomUUID(),approval_id:plan.id,revision_id:revision.id,kind,at:new Date(now).toISOString()});changed=true
  }
 }
 if(today>=plan.order_by&&!plan.escalation&&(unresolved.length||!bid.invitations.some(i=>!i.revoked_by&&i.responses.some(r=>r.revision_id===revision.id)))) {
  plan.escalation={at:new Date(now).toISOString(),invitation_ids:unresolved.map(i=>i.id)};changed=true
 }
 if(plan.escalation&&JSON.stringify(plan.escalation.invitation_ids)!==JSON.stringify(unresolved.map(i=>i.id))) {
  plan.escalation.invitation_ids=unresolved.map(i=>i.id);changed=true
 }
 return changed
}
/** Every existing schedule publication door calls the shared clearance rule. */
export function bidProcurementBlockers(job:BidJob,tasks:Schedule[]) {
 return (job.bids??[]).flatMap(bid=>{
  const plan=bid.follow_up
  if(!plan)return []
  const task=tasks.find(t=>t.id===plan.task_id&&t.status!=='cancelled')
  if(!task)return []
  const unresolved=bid.invitations.some(i=>!i.revoked_by&&!bidAnswered(bid,i)),priced=bid.invitations.some(i=>!i.revoked_by&&i.responses.some(r=>r.revision_id===bid.revisions.at(-1)!.id))
  const reviewed=plan.revision_id===bid.revisions.at(-1)!.id&&plan.escalation?.review
  const reason=plan.paused||plan.revision_id!==bid.revisions.at(-1)!.id?'Procurement approval needs renewal':task.start.slice(0,10)<plan.required_on_site?'Material would arrive after this task starts':(unresolved||!priced)&&!reviewed?'Estimator must review unresolved bid prices before promising this start':null
  return reason?[{constraint_id:plan.id,title:bid.title+': '+reason,task_id:task.id,task:task.description,status:'procurement_pending',accountable:plan.estimator_name}]:[]
 })
}
export async function dispatchBidFollowUps(db:D1Database,now:number) {
 // Bounded hourly sweep; no captured record can recreate an erased job.
 let changed=0
 for(const initial of await jobs(db) as BidJob[]) {
  if(changed>=20)break
  const clock=await readClock(db),row=await db.prepare('SELECT data FROM pl_jobs WHERE id=?').bind(initial.id).first<{data:string}>()
  if(!row)continue
  const previous=JSON.parse(row.data) as BidJob,next=structuredClone(previous),guards:D1PreparedStatement[]=[]
  let dirty=false
  for(const bid of next.bids??[])if(await advanceBidFollowUp(db,next,bid,now)) {const checks=await approvalGuards(db,next,bid.follow_up!);if(checks){guards.push(...checks);dirty=true}}
  if(!dirty)continue
  next.version=previous.version+1
  const data=JSON.stringify(next);need(data.length<=8_000_000,'Bid history is too large')
  try {
   await db.batch([
    db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_clock WHERE id=1 AND version=?) AND EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(clock,next.id,previous.version),...guards,
    db.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(next.version,data,next.id,previous.version),
    auditStatement(db,automation('bid-follow-up','Bid follow-up scheduler'),{kind:'automation',action:'bid.follow-up',job_id:next.id,version_before:previous.version,version_after:next.version,before_ref:await jobRef(JSON.stringify(previous)),after_ref:await jobRef(data)}),
    db.prepare('UPDATE pl_clock SET version=version+1 WHERE id=1'),db.prepare('DELETE FROM pl_guard'),
   ]);changed++
  }catch(error){if(!/CHECK constraint|UNIQUE constraint/.test(String(error)))throw error}
 }
}
