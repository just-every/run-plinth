import { wallClock } from './time-zone'
import { activeHolds } from './holds'
import { costLedger } from './cost-ledger'
import { costs, digest } from './cost-model'
import { previewCostForecast } from './cost-forecast'
import { cashReport } from './cost-periods'
import { previewSchedule } from './schedule-plan'
import { resourceConflicts, resources } from './schedule-resources'
import { cents, find, need, object, stamp, sum, text, type Actor, type Input, type Job } from './model'
import { localDate } from './remittances'
import type { RecoveryAlternative, RecoveryProposal, RecoveryRequest, RecoverySources } from './agent-recovery-model'

/** Owner review exposes native calculations and revision references, never bill originals or individual pay. */
export async function recoverySources(db:D1Database,job:Job,all:Job[]):Promise<RecoverySources>{
 const catalog=await resources(db)
 const bookings=all.filter(j=>j.id!==job.id).flatMap(j=>j.schedules.filter(t=>t.status==='booked').map(t=>({job_id:j.id,task:t})))
 const ledger=costLedger(job),state=costs(job)
 const facts={
  currency:job.currency??'USD',time_zone:job.time_zone??'UTC',status:job.status,schedules:job.schedules,calendar:job.schedule_calendar??null,actuals:job.schedule_actuals??[],
  constraints:job.schedule_constraints??[],rfis:job.rfis??[],bids:job.bids??[],
  resources:catalog,bookings,holds:await activeHolds(db,'job',job.id),
  budget:job.budgets?.at(-1)??null,
  orders:job.orders,variations:job.variations,subcontracts:job.subcontracts??[],trade_confirmations:job.trade_invitations??[],
  selections:job.selections??[],invoices:job.invoices??[],claims:job.claims,remittances:job.remittances??[],
  ledger:ledger.rows.map(r=>({cost_code:r.cost_code,approved_budget_cents:r.approved_budget_cents,posted_actual_cents:r.posted_actual_cents,open_commitment_cents:r.open_commitment_cents})),
  entries:ledger.rows.flatMap(r=>r.sources.actual).map(e=>({id:e.id,source_id:e.source_id,source_line_id:e.source_line_id,cost_code:e.cost_code,amount_cents:e.amount_cents,dated_on:e.dated_on,period:e.period,matches:e.matches,reversal_of:e.reversal_of})),
  bills:state.bills.map(b=>({id:b.id,status:b.status,kind:b.kind,credit_of:b.credit_of,amount_cents:b.amount_cents,due_on:b.due_on,lines:b.lines,checksum:b.document.checksum})),
  cost_sources:state.sources.map(s=>({id:s.id,kind:s.kind,cost_code:s.cost_code,amount_cents:s.amount_cents,dated_on:s.dated_on,approved_by:s.approved_by,reimbursed:s.reimbursed,payroll_replaced_cents:s.payroll_replaced_cents})),
  cash_dates:state.cash_dates??[],forecasts:state.forecasts,reconciliations:state.reconciliations,
  accounting:'Native recorded costs only; external accounting reconciliation and bank balances remain unverified',
 }
 return {job_id:job.id,source_version:job.version,digest:await digest(facts),facts}
}
export async function recoveryInstallation(db:D1Database,origin:string){return digest({origin,bootstrap:await db.prepare('SELECT claim_id FROM oa_bootstrap WHERE singleton=1').first(),authority:await db.prepare('SELECT generation FROM oa_auth_settings WHERE singleton=1').first()})}
export async function recoveryFresh(db:D1Database,job:Job,all:Job[],row:RecoveryRequest,origin:string){
 const owner=await db.prepare("SELECT version FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(row.prepared_by.id).first<{version:number}>()
 return !row.revoked_by&&!!owner&&owner.version===row.owner_version&&row.installation===await recoveryInstallation(db,origin)&&(await recoverySources(db,job,all)).digest===row.sources.digest
}
export function recoveryAccess(actor:Actor,row?:RecoveryRequest){
 if(actor.role==='owner')return
 need(actor.role==='agent'&&actor.agent_native_role==='owner'&&actor.agent_door?.sponsor_role==='owner'&&!!row&&row.share_with_owner_agents&&row.prepared_by.id===actor.id,'Only the reviewing owner and their explicitly consented draft agent may access this packet',403,'forbidden')
}
function preserveDependencies(job:Job,raw:Input){
 need(Array.isArray(raw.tasks)&&raw.tasks.length===job.schedules.length,'Recovery keeps every recorded task and dependency')
 for(const old of job.schedules){
  const candidate=raw.tasks.map(object).find(t=>t.id===old.id)
  need(candidate&&candidate.status!== 'cancelled' || old.status==='cancelled'&&candidate?.status==='cancelled','Recovery cannot cancel recorded work',409,'recovery_dependency')
  need(!!old.milestone===!!candidate!.milestone,'Recovery preserves recorded milestone semantics',409,'recovery_dependency')
  need(old.status!=='cancelled'||candidate?.status==='cancelled','Cancelled work remains cancelled',409,'recovery_dependency')
  need((old.predecessors??[]).every(p=>Array.isArray(candidate!.predecessors)&&candidate!.predecessors.map(object).some(d=>d.id===p.id&&Number(d.lag_minutes)>=p.lag_minutes)),'Recovery retains every recorded dependency and lag',409,'recovery_dependency')
 }
}
/** All scenario mutations stay on a disposable clone; native approvals and dates never change. */
export async function recoveryAlternative(db:D1Database,job:Job,all:Job[],actor:Actor,request:RecoveryRequest,value:unknown):Promise<RecoveryAlternative>{
 const raw=object(value),id=text(raw.id,'Alternative identity',80),name=text(raw.name,'Alternative name',200),assumptions=text(raw.assumptions,'Dated assumptions and uncertainty',4000),plan=object(raw.schedule)
 preserveDependencies(job,plan)
 const schedule=await previewSchedule(structuredClone(job),actor,plan,all)
 schedule.conflicts.push(...resourceConflicts(await resources(db),all,{...job,schedules:schedule.tasks}))
 const amendment=object(raw.amendment),extra=cents(amendment.extra_cents,'Amendment extra cents'),promised_on=localDate(amendment.promised_on,'Proposed delivery date'),order=find(job.orders,request.package_order_id)
 const delivery=find(schedule.tasks,request.package_task_id)
 need(wallClock(Date.parse(delivery.start),job.time_zone??'UTC').date>=promised_on,'Dependent work cannot precede the assumed package arrival',409,'recovery_delivery')
 const forecastInput=object(raw.forecast)
 need(forecastInput.scenario===undefined||forecastInput.scenario==='approved','Client decisions stay unapproved; use explicit native cost assumptions')
 need(Array.isArray(forecastInput.codes),'Provide reviewed native cost assumptions')
 const codes:Input[]=forecastInput.codes.map(value=>{const code=object(value);need(!Number(code.pending_change_cents??0),'Pending changes cannot become approved recovery economics');return {...code,...(code.cost_code===request.package_cost_code?{unbought_cents:sum([cents(code.unbought_cents,'Unbought cost'),extra])}:{})}})
 const labor=codes.find(c=>c.cost_code===request.labor_cost_code)
 need(labor&&Number(labor.remaining_quantity)>0&&Number(labor.minutes_per_unit)>0,'Review positive remaining labor and productivity for the overrun code')
 const candidate=structuredClone(job),forecast=await previewCostForecast(candidate,actor,{...forecastInput,as_of:request.as_of,codes})
 forecast.id='recovery-'+id;forecast.source_version=request.sources.source_version
 costs(candidate).forecasts=[forecast];candidate.version=request.sources.source_version
 const cashInput=object(raw.cash),dates=cashInput.remaining_dates
 need(Array.isArray(dates)&&dates.length===codes.length,'Phase expected remaining cash for every cost code')
 const dated=new Set<string>()
 for(const value of dates){const d=object(value),code=text(d.cost_code,'Cash cost code',80);need(codes.some(c=>c.cost_code===code)&&!dated.has(code),'Phase each reviewed code once');dated.add(code);(costs(candidate).cash_dates??=[]).push({id:crypto.randomUUID(),kind:'forecast',source_id:forecast.id+':'+code,expected_on:localDate(d.expected_on,'Expected remaining cash date'),reference:text(d.reference,'Expected cash assumption',2000),by:stamp(actor)})}
 ;(costs(candidate).cash_dates??=[]).push({id:crypto.randomUUID(),kind:'order',source_id:order.id,expected_on:promised_on,reference:'Assumed package payment timing; no supplier acceptance or payment',by:stamp(actor)})
 const invoiceDates=cashInput.invoice_dates??[];need(Array.isArray(invoiceDates)&&invoiceDates.length<=100,'Expected collection changes must name issued invoices')
 const invoiceIds=new Set<string>()
 for(const value of invoiceDates){const d=object(value),invoice=find(candidate.invoices??[],String(d.invoice_id));need(invoice.issued&&!invoiceIds.has(invoice.id),'Choose each issued invoice once');invoiceIds.add(invoice.id);(costs(candidate).cash_dates??=[]).push({id:crypto.randomUUID(),kind:'invoice',source_id:invoice.id,expected_on:localDate(d.expected_on,'Expected collection date'),reference:text(d.reference,'Expected collection assumption',2000),by:stamp(actor)})}
 const cash=cashReport(candidate,cashInput),decision=object(raw.client_decision)
 return {id,name,assumptions,schedule,native_feasible:!schedule.conflicts.length&&!schedule.blockers.length,forecast,cash,
  amendment:{order_id:order.id,original_amount_cents:order.amount_cents,proposed_amount_cents:sum([order.amount_cents,extra]),extra_cents:extra,promised_on,reason:text(amendment.reason,'Proposed supplier amendment reason',2000),state:'unsent'},
  client_decision:{description:text(decision.description,'Proposed client decision',2000),proposed_price_delta_cents:cents(decision.proposed_price_delta_cents,'Proposed client price',true),state:'unapproved'},
  outstanding_decisions:['Builder commitment and baseline approval at the native human doors','Actual subcontractor attendance confirmation for these exact proposed dates','Supplier acceptance and delivery of the proposed purchase amendment','Client scope, price and promised-date decision','Actual receipt and external accounting reconciliation remain unverified'],
 }
}
export async function compareRecovery(db:D1Database,job:Job,all:Job[],actor:Actor,row:RecoveryRequest,input:Input):Promise<RecoveryProposal>{
 const key=text(input.key,'Once-only proposal key',100),input_digest=await digest(input.alternatives),existing=row.proposals.find(p=>p.key===key)
 if(existing){need(existing.input_digest===input_digest,'This proposal key already binds different alternatives',409,'recovery_replay');return existing}
 need(row.proposals.length<50,'Recovery proposal history is full')
 need(Array.isArray(input.alternatives)&&input.alternatives.length===2,'Compare exactly two alternatives')
 const alternatives=[]
 for(const value of input.alternatives)alternatives.push(await recoveryAlternative(db,job,all,actor,row,value))
 const [a,b]=alternatives as [RecoveryAlternative,RecoveryAlternative]
 need(a.id!==b.id,'Alternatives need distinct identities');need(a.cash.rows.map(r=>r.period).join()===b.cash.rows.map(r=>r.period).join()&&a.cash.rows[0]!.opening_cents===b.cash.rows[0]!.opening_cents,'Compare cash over the same horizon and opening assumption')
 need(a.schedule.completion_after&&b.schedule.completion_after,'Recovery requires a native completion date')
 const difference={finish_minutes:(Date.parse(b.schedule.completion_after)-Date.parse(a.schedule.completion_after))/60000,remaining_cents:sum([b.forecast.remaining_cents,-a.forecast.remaining_cents]),margin_cents:sum([b.forecast.margin_cents,-a.forecast.margin_cents]),expected_cash_closing_cents:a.cash.rows.map((r,i)=>sum([b.cash.rows[i]!.closing_cents,-r.closing_cents])),expected_cash_trough_cents:sum([b.cash.trough_cents,-a.cash.trough_cents])}
 const result={id:crypto.randomUUID(),key,input_digest,digest:await digest({source:row.sources.digest,alternatives}),prepared_by:stamp(actor),alternatives,difference,reviews:[]}
 row.proposals.push(result);return result
}
