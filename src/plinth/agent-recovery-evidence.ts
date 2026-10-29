import { active, cents, find, need, object, stamp, sum, text, type Actor, type Input, type Job, type Stamp } from './model'
import { requireOwner } from './auth'
import { actualEntries, costLedger } from './cost-ledger'
import { costs, digest } from './cost-model'
import { discrepancies } from './cost-exceptions'
import { forecastSourceDigest } from './cost-forecast'
import { latestActual } from './schedule-baseline-model'
import { invitationSnapshot } from './schedule-resource-model'
import { fulfillment } from './purchase-order-model'
import { readClock, saveJob } from './store'

interface Criteria {
 schedule_approval_id:string; budget_id:string; promised_finish:string; minimum_margin_cents:number
 tasks:{task_id:string;quantity:string;unit:string;cost_code:string}[]; order_ids:string[]
}
type Evidence = Awaited<ReturnType<typeof evidence>>
interface Packet { id:string; digest:string; evidence:Evidence; reviewed_by:Stamp }
interface Risk { description:string; owner_id:string; due_on:string }
interface Assessment {
 id:string; packet_id:string; observation_id:string; observed_on:string; by:Stamp; observation:string; risks:Risk[]
 comparison:ReturnType<typeof compare>; reopened:boolean
}
export interface RecoveryEvidenceCase {
 id:string; title:string; criteria:Criteria; requested_by:Stamp; packets:Packet[]; assessments:Assessment[]; revoked_by?:Stamp
}
const date=(value:unknown,name:string)=>{const s=text(value,name,10);need(/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s,'Use a calendar date');return s}
const instant=(value:unknown)=>{const s=text(value,'Promised finish',40);need(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s)),'Promised finish needs an explicit UTC offset');return new Date(s).toISOString()}
const quantity=(value:unknown)=>{const s=text(value,'Required installed quantity',30);need(/^\d{1,12}(?:\.\d{1,4})?$/.test(s)&&Number(s)>0,'Use a positive quantity with up to four decimals');return s}
function criteria(job:Job,input:Input):Criteria {
 const c=object(input.criteria);need(Array.isArray(c.tasks)&&c.tasks.length>0&&c.tasks.length<=100,'Select one to 100 required tasks')
 const tasks=c.tasks.map(raw=>{const t=object(raw);return {task_id:text(t.task_id,'Task',100),quantity:quantity(t.quantity),unit:text(t.unit,'Unit',20),cost_code:text(t.cost_code,'Cost code',80)}})
 need(new Set(tasks.map(t=>t.task_id)).size===tasks.length,'Select each task once')
 need(Array.isArray(c.order_ids)&&c.order_ids.length>0&&c.order_ids.length<=100,'Select required issued orders')
 const order_ids=c.order_ids.map(id=>text(id,'Order',100));need(new Set(order_ids).size===order_ids.length,'Select each order once')
 const result={schedule_approval_id:text(c.schedule_approval_id,'Native schedule approval',100),budget_id:text(c.budget_id,'Native budget revision',100),promised_finish:instant(c.promised_finish),minimum_margin_cents:cents(c.minimum_margin_cents,'Minimum native margin',true),tasks,order_ids}
 nativeApproval(job,result);return result
}
function nativeApproval(job:Job,c:Criteria){
 const approval=find(job.approvals,c.schedule_approval_id)
 need(approval.kind==='schedule.publish'&&!approval.approved_by.agent&&approval.approved_by.role!=='agent','Select an actual human schedule publication',409,'recovery_approval')
 const published=object(object(approval.snapshot).after).tasks as Job['schedules']
 need(Array.isArray(published)&&c.tasks.every(t=>published.some(p=>p.id===t.task_id&&p.status==='booked')),'Required tasks must belong to the reviewed native publication',409,'recovery_approval')
 const budget=find(job.budgets??[],c.budget_id)
 need(!budget.recorded_by.agent&&job.approvals.some(a=>a.subject_id===budget.source.id&&a.revision===budget.source.revision&&a.kind===(budget.source.kind==='quote'?'quote':'variation')&&!a.approved_by.agent),'Select a budget backed by an existing human approval',409,'recovery_approval')
 need(c.tasks.every(t=>budget.codes.some(code=>code.cost_code===t.cost_code)),'Required quantities must use the reviewed budget codes')
 return {approval,budget}
}
/** Only the owner collects native facts. No narrative can stand in for an approval or a receipt. */
async function evidence(job:Job,c:Criteria){
 const {approval,budget}=nativeApproval(job,c),ledger=costLedger(job),state=costs(job)
 const tasks=c.tasks.map(required=>{
  const task=find(job.schedules,required.task_id),actual=latestActual(job,task.id)
  return {required,task,actual:actual??null,confirmations:(job.trade_invitations??[]).filter(i=>i.task_id===task.id).map(i=>({id:i.id,subcontract_id:i.subcontract_id,snapshot:i.snapshot,current:i.snapshot===invitationSnapshot(task)&&task.status==='booked',responses:i.responses}))}
 })
 const orders=c.order_ids.map(id=>{const order=find(job.orders,id);need(order.issued_by&&order.status!=='draft','Select issued native commitments',409,'recovery_order');return {order,fulfillment:fulfillment(order)}})
 const forecast=state.forecasts.at(-1),forecastCurrent=!!forecast&&forecast.source_digest===await forecastSourceDigest(job)
 return structuredClone({job_id:job.id,currency:ledger.currency,approval,budget,current_budget:job.budgets!.at(-1)!,tasks,orders,
  accounting:{entries:actualEntries(job).map(({matches,...entry})=>entry),reconciliation:state.reconciliations.at(-1)??null,issues:discrepancies(job),posted_actual_cents:ledger.totals.posted_actual_cents!,open_commitment_cents:ledger.totals.open_commitment_cents!,forecast:forecast?{id:forecast.id,source_digest:forecast.source_digest,current:forecastCurrent,as_of:forecast.as_of,final_cents:forecast.final_cents,remaining_cents:forecast.remaining_cents,margin_cents:forecast.margin_cents}:null},
  boundary:'Native human-recorded evidence only. Accounting source declarations are not independently reconciled external actuals. Assessment never certifies physical completion or final recovery.'})
}
function compare(e:Evidence,c:Criteria){
 const tasks=e.tasks.map(({required,task,actual,confirmations})=>{
  const installed=actual?.installed,compatible=installed?.unit===required.unit&&installed?.cost_code===required.cost_code
  const date_state=task.status!=='booked'?'contradicted':actual?.actual_finish?(actual.actual_finish<=c.promised_finish?'supported':'contradicted'):'unknown'
  const quantity_state=!compatible?'unknown':Number(installed!.quantity)>=Number(required.quantity)?'supported':'contradicted'
  return {task_id:task.id,confirmed:confirmations.some(i=>i.current&&i.responses.at(-1)?.kind==='confirm'),forecast_finish:task.end,observed_finish:actual?.actual_finish??null,installed:installed??null,date_state,quantity_state}
 })
 const deliveries=e.orders.map(({order,fulfillment:f})=>({order_id:order.id,acknowledged:!!order.acknowledgment,received_cents:f.received_cents,outstanding_cents:f.outstanding_cents,state:order.status==='cancelled'?'contradicted':!order.lines?.length||!f.lines.length?'unknown':f.lines.every(l=>Number(l.outstanding)===0)?'supported':'unknown'}))
 const a=e.accounting,observed_margin_cents=sum([e.current_budget.contract_cents,-a.posted_actual_cents]),forecast_margin_cents=a.forecast?.current?a.forecast.margin_cents:null
 const margin_state=observed_margin_cents<c.minimum_margin_cents||forecast_margin_cents!==null&&forecast_margin_cents<c.minimum_margin_cents?'contradicted':forecast_margin_cents!==null?'supported':'unknown'
 const missing=[...tasks.flatMap(t=>[...(t.date_state==='unknown'?['Task finish '+t.task_id]:[]),...(t.quantity_state==='unknown'?['Installed quantity '+t.task_id]:[]),...(!t.confirmed?['Trade confirmation '+t.task_id]:[])]),...deliveries.filter(d=>d.state==='unknown').map(d=>'Delivery '+d.order_id),...(!a.reconciliation||a.issues.some(i=>['stale','ledger','unapproved','unmatched'].includes(i.kind))?['Complete current native accounting evidence']:[]),...(forecast_margin_cents===null?['Current native cost forecast']:[]),'Independently reconciled external accounting actuals and final human recovery decision']
 const contradicted=tasks.some(t=>t.date_state==='contradicted'||t.quantity_state==='contradicted')||deliveries.some(d=>d.state==='contradicted')||margin_state==='contradicted'
 return {tasks,deliveries,posted_actual_cents:a.posted_actual_cents,observed_margin_cents,forecast_margin_cents,margin_state,native_status:contradicted?'contradicted':missing.length===1?'supported':'unverified',missing,overall_restoration:'unverified' as const}
}
const owner=(actor:Actor)=>{requireOwner(actor);need(!actor.agent_door,'A signed-in owner reviews evidence',403,'human_required')}
async function packet(job:Job,c:Criteria,actor:Actor,input:Input){
 need(input.confirm===true,'Explicitly consent to this exact private evidence packet')
 const source=await evidence(job,c),hash=await digest(source)
 need(input.digest===hash,'Native evidence changed; review the exact current packet',409,'recovery_stale')
 return {id:crypto.randomUUID(),digest:hash,evidence:source,reviewed_by:stamp(actor)}
}
async function grant(db:D1Database,row:RecoveryEvidenceCase,p:Packet,actor:Actor){return db.prepare('INSERT OR REPLACE INTO pl_recovery_evidence_grants(case_id,packet_id,sponsor_id,sponsor_version) VALUES(?,?,?,?)').bind(row.id,p.id,actor.id,actor.version)}
async function current(db:D1Database,job:Job,row:RecoveryEvidenceCase,actor:Actor){
 need(!row.revoked_by,'Owner revoked this recovery case',403,'recovery_revoked')
 const p=row.packets.at(-1)!,g=await db.prepare('SELECT packet_id,sponsor_id,sponsor_version FROM pl_recovery_evidence_grants WHERE case_id=?').bind(row.id).first<{packet_id:string;sponsor_id:string;sponsor_version:number}>()
 need(g&&g.packet_id===p.id&&g.sponsor_id===actor.id&&g.sponsor_version===actor.version,'Fresh owner review is required on this installation',403,'recovery_review_required')
 need(await digest(await evidence(job,row.criteria))===p.digest,'Native evidence changed; owner must review a new packet',409,'recovery_stale')
 return p
}
/** Native HTTP and MCP share this door. Agents can only consume and assess a current owner-reviewed packet. */
export async function recoveryEvidenceResponse(db:D1Database,job:Job,actor:Actor,parts:string[],method:string,input?:Input){
 const id=parts[3],action=parts[4],rows=job.recovery_evidence??[]
 const draftAgent=actor.role==='agent'&&actor.agent_door?.sponsor_role==='owner'
 need(actor.role==='owner'||draftAgent,'Owner private recovery evidence required',403,'forbidden')
 if(method==='GET'){
  if(!id){owner(actor);return {version:job.version,cases:rows}}
  const row=find(rows,id)
  if(draftAgent){await current(db,job,row,actor);return {record:{id:row.id,title:row.title,criteria:row.criteria,packet:row.packets.at(-1),assessments:row.assessments},version:job.version}}
  return {case:row,version:job.version,stale:await digest(await evidence(job,row.criteria))!==row.packets.at(-1)!.digest}
 }
 need(method==='POST'&&input,'Unknown recovery evidence door',404,'not_found');active(job)
 need(input.expected_version===job.version,'Job changed; reload before preparing evidence',409,'stale_version')
 if(id==='preview'&&!action){owner(actor);const c=input.case_id?find(rows,text(input.case_id,'Case',100)).criteria:criteria(job,input),source=await evidence(job,c);return {evidence:source,digest:await digest(source),version:job.version}}
 const clock=await readClock(db),next=structuredClone(job);let record:unknown,writes:D1PreparedStatement[]=[]
 if(!id){owner(actor);const c=criteria(job,input),p=await packet(job,c,actor,input),row:RecoveryEvidenceCase={id:crypto.randomUUID(),title:text(input.title,'Case title',200),criteria:c,requested_by:stamp(actor),packets:[p],assessments:[]};(next.recovery_evidence??=[]).push(row);writes=[await grant(db,row,p,actor)];record=row}
 else {
  const row=find(next.recovery_evidence??[],id)
  if(action==='review'){owner(actor);need(!row.revoked_by,'Revoked cases remain revoked',403,'recovery_revoked');const p=await packet(job,row.criteria,actor,input);need(p.digest!==row.packets.at(-1)!.digest||!(await db.prepare('SELECT 1 FROM pl_recovery_evidence_grants WHERE case_id=? AND sponsor_id=? AND sponsor_version=?').bind(row.id,actor.id,actor.version).first()),'This exact evidence is already reviewed',409,'immutable');row.packets.push(p);writes=[await grant(db,row,p,actor)];record=p}
  else if(action==='revoke'){owner(actor);need(!row.revoked_by,'Case already revoked',409,'immutable');row.revoked_by=stamp(actor);writes=[db.prepare('DELETE FROM pl_recovery_evidence_grants WHERE case_id=?').bind(row.id)];record={revoked:true,id:row.id}}
  else if(action==='assess'){
   const p=await current(db,job,row,actor);need(input.packet_id===p.id,'Assess only the current reviewed packet',409,'recovery_stale')
   const observation_id=text(input.observation_id,'Observation identity',100),existing=row.assessments.find(a=>a.observation_id===observation_id)
   if(existing){need(existing.packet_id===p.id&&existing.observation===input.observation&&existing.observed_on===input.observed_on&&JSON.stringify(existing.risks)===JSON.stringify(input.risks),'Observation identity already belongs to different evidence',409,'immutable');return {record:existing,version:job.version}}
   const observed_on=date(input.observed_on,'Observation date');need(observed_on>=p.reviewed_by.at.slice(0,10)&&(!row.assessments.length||observed_on>=row.assessments.at(-1)!.observed_on),'Observations must follow the review and earlier assessments')
   need(Array.isArray(input.risks)&&input.risks.length>0&&input.risks.length<=50,'Assign at least one residual risk')
   const risks=await Promise.all(input.risks.map(async raw=>{const r=object(raw),owner_id=text(r.owner_id,'Risk owner',100),due_on=date(r.due_on,'Risk due date');need(due_on>=observed_on,'Risk due date precedes observation');need(await db.prepare("SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(owner_id).first(),'Residual risks remain assigned to an active owner',403,'forbidden');return {description:text(r.description,'Residual risk',2000),owner_id,due_on}}))
   const comparison=compare(p.evidence,row.criteria),assessment:Assessment={id:crypto.randomUUID(),packet_id:p.id,observation_id,observed_on,by:stamp(actor),observation:text(input.observation,'Observation',4000),risks,comparison,reopened:comparison.native_status==='contradicted'&&row.assessments.at(-1)?.comparison.native_status==='supported'}
   row.assessments.push(assessment);record=assessment
  } else need(false,'Unknown recovery evidence action',404,'not_found')
 }
 await saveJob(db,actor,job,next,writes,clock)
 return {record,version:next.version}
}
