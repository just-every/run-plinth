import { cents, find, need, object, recordApproval, stamp, sum, text, type Actor, type Input, type Job } from './model'
import { costs, costCode, period, type CostException } from './cost-model'
import { actualEntries, costLedger } from './cost-ledger'
import { localDate } from './remittances'
const sourceKey=(job:Job)=>JSON.stringify({entries:actualEntries(job).map(e=>[e.id,e.amount_cents,e.cost_code,e.period]),orders:job.orders.map(o=>[o.id,o.status,o.amount_cents,o.receipts.map(r=>[r.id,r.amount_cents]),o.returns])})
export function discrepancies(job:Job){
 const state=costs(job),ledger=costLedger(job),policy=state.policy,items:{key:string;kind:string;amount_cents:number;evidence:string}[]=[]
 for(const r of ledger.rows){
  const actual=r.posted_actual_cents,budget=r.approved_budget_cents
  if(budget!==null&&actual-budget>(policy?.budget_limit_cents??0))items.push({key:'budget:'+r.cost_code,kind:'budget',amount_cents:actual-budget,evidence:`${r.cost_code}: actual ${actual}, budget ${budget}`})
  if(budget!==null&&r.commitment_cents-budget>(policy?.commitment_limit_cents??0))items.push({key:'commitment:'+r.cost_code,kind:'commitment',amount_cents:r.commitment_cents-budget,evidence:`${r.cost_code}: commitments exceed approved budget`})
  if(r.received_not_billed_cents<0||r.open_commitment_cents<0)items.push({key:'receipt:'+r.cost_code,kind:'receipt',amount_cents:Math.min(r.received_not_billed_cents,r.open_commitment_cents),evidence:`${r.cost_code}: matched bills exceed current source receipts or commitment`})
 }
 for(const sub of job.subcontracts??[])for(const d of sub.draws??[])if(d.payment){const matched=sum(state.entries.flatMap(e=>e.matches.filter(m=>m.draw_id===d.id).map(m=>m.amount_cents))),unmatched=d.payment.amount_cents-matched;if(unmatched>0)items.push({key:'payment:'+d.id,kind:'unmatched_payment',amount_cents:unmatched,evidence:'Recorded supplier payment '+d.payment.reference+' has unmatched job cost'})}
 const rec=state.reconciliations.at(-1)
 if(actualEntries(job).length&&!rec)items.push({key:'ledger:missing',kind:'stale',amount_cents:sum(actualEntries(job).map(e=>e.amount_cents)),evidence:'No reviewed accounting reconciliation is recorded'})
 if(rec&&rec.source_key!==sourceKey(job))items.push({key:'ledger:stale',kind:'stale',amount_cents:0,evidence:'Cost/procurement sources changed since the latest accounting reconciliation'})
 for(const s of state.sources.filter(s=>!s.approved_by))items.push({key:'source:'+s.id,kind:'unapproved',amount_cents:s.amount_cents,evidence:'Unapproved '+s.kind+' source '+s.reference})
 if(rec){const entries=actualEntries(job).filter(e=>e.period===rec.period);for(const code of new Set([...rec.balances.map(r=>r.cost_code),...entries.map(e=>e.cost_code)])){const local=sum(entries.filter(e=>e.cost_code===code).map(e=>e.amount_cents)),external=rec.balances.find(r=>r.cost_code===code)?.amount_cents??0;if(local!==external)items.push({key:'ledger:'+rec.period+':'+code,kind:'ledger',amount_cents:local-external,evidence:`${code} ${rec.period}: Plinth ${local}, reviewed accounting source ${external}; ${rec.reference}`})}}
 for(const b of state.bills.filter(b=>b.status==='draft'))items.push({key:'unposted:'+b.id,kind:'unmatched',amount_cents:b.amount_cents,evidence:`Unposted original ${b.reference}: ${b.flags.join('; ')||'approval pending'}`})
 return items
}
export function exceptionView(job:Job){const pending=discrepancies(job),state=costs(job);return {items:state.exceptions.map(e=>({...e,status:e.resolutions.length?'cleared':pending.some(p=>p.key===e.key)?'open':'awaiting_review',current:pending.find(p=>p.key===e.key)??null})),unassigned:pending.filter(p=>!state.exceptions.some(e=>e.key===p.key)),source_version:job.version,healthy:!pending.length&&state.exceptions.every(e=>e.resolutions.length>0)}}
export function refreshExceptions(job:Job){const state=job.cost_records;if(!state?.policy)return;for(const issue of discrepancies(job))if(!state.exceptions.some(e=>e.key===issue.key&&!e.resolutions.length))state.exceptions.push({...issue,id:crypto.randomUUID(),owner_id:state.policy.owner_id,due_on:state.policy.due_on,resolutions:[]})}
export function exceptionAction(job:Job,actor:Actor,input:Input,category:string,id?:string){
 const state=costs(job)
 if(category==='policy'){
  need(actor.role==='owner','Only the owner defines limits and approval separation',403,'forbidden');need(typeof input.separate_approval==='boolean','Explicitly choose separation')
  const row={budget_limit_cents:cents(input.budget_limit_cents,'budget_limit_cents'),commitment_limit_cents:cents(input.commitment_limit_cents,'commitment_limit_cents'),bill_limit_cents:cents(input.bill_limit_cents,'bill_limit_cents'),separate_approval:input.separate_approval,owner_id:text(input.owner_id,'Exception owner',100),due_on:localDate(input.due_on,'due_on'),by:stamp(actor)};state.policy=row;recordApproval(job,actor,'cost.policy',{id:job.id,prepared_by:row.by},row);return row
 }
 if(category==='reconcile'){
  need(Array.isArray(input.balances)&&input.balances.length<=100,'Provide up to 100 reviewed accounting balances; an empty ledger remains explicit')
  const balances=input.balances.map(value=>{const b=object(value);return {cost_code:costCode(job,b.cost_code),amount_cents:cents(b.amount_cents,'amount_cents',true)}});need(new Set(balances.map(b=>b.cost_code)).size===balances.length,'Reconcile each code once')
  const row={id:crypto.randomUUID(),period:period(input.period),balances,source_key:sourceKey(job),reference:text(input.reference,'Accounting source evidence',2000),by:stamp(actor)};state.reconciliations.push(row);recordApproval(job,actor,'cost.reconcile',{id:row.id,prepared_by:row.by},row);return row
 }
 need(category==='exceptions'&&id,'Unknown exception action',404,'not_found');const row=find(state.exceptions,id)
 need(!discrepancies(job).some(p=>p.key===row.key),'Source amounts still disagree; record an approved correction and reconcile first',409,'cost_unresolved')
 need(!row.resolutions.length,'The exception was already resolved',409,'immutable');row.resolutions.push({reason:text(input.reason,'Resolution evidence',2000),by:stamp(actor)});recordApproval(job,actor,'cost.exception.resolve',{id:row.id,prepared_by:actor.role==='owner'?job.created_by:row.resolutions[0]!.by},row);return row
}
