import { supplierRetainageBalance } from './supplier-retainage-model'
import { bidCostBudget } from './bid-comparison-budget'
import { currencyOf, sum, type Job } from './model'
import { allocate, costs, type CostEntry } from './cost-model'
/** Source receipts keep their own dates; pre-existing undated sources expose null periods. */
export function procurement(job:Job){
 const rows:{order_id:string;receipt_id?:string;cost_code:string;amount_cents:number;kind:'commitment'|'receipt';dated_on:string|null;period:string|null;reference:string}[]=[]
 for(const o of job.orders.filter(o=>o.status!=='draft')){
  const lines=o.lines?.length?o.lines.map(l=>({code:l.cost_code,amount:l.total_cents,id:l.id,rate:l.unit_cents})):[{code:o.source?.kind==='budget'?o.source.cost_code:'Unassigned',amount:o.amount_cents,id:'legacy',rate:0}]
  const stamp=o.issued_by?.at.slice(0,10)??null
  for(const l of lines)rows.push({order_id:o.id,cost_code:l.code,amount_cents:o.status==='cancelled'?0:l.amount,kind:'commitment',dated_on:stamp,period:stamp?.slice(0,7)??null,reference:o.description})
  for(const r of [...o.receipts,...(o.returns??[]).map(r=>({...r,amount_cents:-r.amount_cents}))]){
   const weights=lines.map(l=>r.lines?.length?(()=>{const [n,f='']=String(r.lines.find(q=>q.line_id===l.id)?.quantity??'0').split('.');return (BigInt(n!)*1000n+BigInt(f.padEnd(3,'0')))*BigInt(l.rate)})():l.amount),amounts=allocate(r.amount_cents,weights)
   const date=('received_on' in r?r.received_on:undefined)??r.recorded_by.at.slice(0,10)
   lines.forEach((l,i)=>{if(amounts[i])rows.push({order_id:o.id,receipt_id:r.id,cost_code:l.code,amount_cents:amounts[i]!,kind:'receipt',dated_on:date,period:costs(job).finance_periods?.[r.id]??date.slice(0,7),reference:r.reference})})
  }
 }
 // An award already represented by a PO is represented only once. Uncoded legacy scopes stay explicit.
 for(const s of (job.subcontracts??[]).filter(s=>s.status==='released'||s.status==='on_hold')){const ordered=sum(job.orders.filter(o=>o.status!=='draft'&&o.status!=='cancelled'&&o.source?.kind==='award'&&o.source.subcontract_id===s.id).map(o=>o.amount_cents));const amount=Math.max(0,(s.amount_cents??0)-ordered);if(amount)rows.push({order_id:s.id,cost_code:'Unassigned',amount_cents:amount,kind:'commitment',dated_on:s.awarded_on,period:s.awarded_on.slice(0,7),reference:s.scope})}
 return rows
}
export function billingSources(job:Job){
 const rows:{id:string;cost_code:string;kind:'billed'|'collected'|'deposit_correction'|'written_off';amount_cents:number;dated_on:string|null;period:string|null;reference:string}[]=[]
 for(const claim of job.claims.filter(c=>c.status!=='draft')){const date=claim.approved_by?.at.slice(0,10)??null;const lines=claim.sov?.lines.map(l=>({code:l.cost_code,amount:l.current_cents}))??[{code:'Unassigned',amount:claim.reconciliation.current_cents}];for(const l of lines)rows.push({id:claim.id,cost_code:l.code,kind:'billed',amount_cents:l.amount,dated_on:date,period:date?.slice(0,7)??null,reference:claim.description})}
 for(const invoice of (job.invoices??[]).filter(i=>i.issued)){
  const amounts=invoice.lines.map(l=>l.gross_cents),codes=invoice.lines.map(l=>invoice.sources.application?.lines.find(a=>a.id===l.id)?.cost_code??invoice.sources.current_budget.billing_lines.find(a=>a.id===l.id)?.cost_code??'Unassigned')
  if(invoice.kind==='milestone'&&!job.claims.some(c=>c.status!=='draft'&&c.id===invoice.source_application_id)){invoice.lines.forEach((l,i)=>rows.push({id:invoice.id,cost_code:codes[i]!,kind:'billed',amount_cents:l.gross_cents,dated_on:invoice.issued!.issued_by.at.slice(0,10),period:invoice.issued!.issued_by.at.slice(0,7),reference:invoice.number!}))}
  for(const correction of invoice.corrections??[]){const date=correction.document.issued_by.at.slice(0,10);for(const line of correction.document.lines){const original=invoice.lines.findIndex(l=>l.id===line.invoice_line_id);rows.push({id:correction.id,cost_code:codes[original]??'Unassigned',kind:invoice.kind==='deposit'?'deposit_correction':'billed',amount_cents:line.gross_cents,dated_on:date,period:date.slice(0,7),reference:correction.document.number})}}
  for(const writeOff of invoice.write_offs??[]){const date=writeOff.recorded_by.at.slice(0,10),shares=allocate(writeOff.amount_cents,amounts.map(amount=>Math.max(0,amount)));codes.forEach((code,i)=>rows.push({id:writeOff.id,cost_code:code,kind:'written_off',amount_cents:shares[i]!,dated_on:date,period:date.slice(0,7),reference:writeOff.invoice_number}))}
  const events=[...invoice.receipts.map(r=>({id:r.id,amount:r.amount_cents,date:r.received_on,ref:r.reference,at:r.recorded_by.at})),...invoice.deposit_applications.map(a=>({id:a.id,amount:a.amount_cents,date:a.recorded_by.at.slice(0,10),ref:'Deposit application '+a.deposit_invoice_id,at:a.recorded_by.at}))]
  let collected=0
  for(const e of events.sort((a,b)=>a.at.localeCompare(b.at))){const before=allocate(collected,amounts);collected=sum([collected,e.amount]);const after=allocate(collected,amounts);const allocated=invoice.kind==='deposit'?[e.amount]:after.map((n,i)=>n-before[i]!);const groups=invoice.kind==='deposit'?['Unassigned']:codes;groups.forEach((code,i)=>rows.push({id:e.id,cost_code:code,kind:'collected',amount_cents:allocated[i]!,dated_on:e.date,period:e.date.slice(0,7),reference:e.ref}))}
  if(invoice.kind==='deposit')for(const a of (job.invoices??[]).flatMap(i=>i.deposit_applications.filter(a=>a.deposit_invoice_id===invoice.id)))rows.push({id:a.id,cost_code:'Unassigned',kind:'collected',amount_cents:-a.amount_cents,dated_on:a.recorded_by.at.slice(0,10),period:a.recorded_by.at.slice(0,7),reference:'Deposit applied to earned billing'})
 }
 for(const r of (job.remittances??[]).filter(r=>!r.returned)){const remaining=sum([r.amount_cents,-sum(r.allocations.map(a=>a.amount_cents))]);if(remaining)rows.push({id:r.id,cost_code:'Unassigned',kind:'collected',amount_cents:remaining,dated_on:r.received_on,period:r.received_on.slice(0,7),reference:r.reference+' (unapplied)'})}
 return rows.map(r=>({...r,period:costs(job).finance_periods?.[r.id]??r.period}))
}
export function actualEntries(job:Job):CostEntry[]{return [...costs(job).entries,...(job.warranties?.cases??[]).flatMap(c=>c.costs.map(w=>({id:w.id,source_id:w.id,source_line_id:w.id,source_kind:'warranty',cost_code:w.cost_code,amount_cents:w.amount_cents,dated_on:w.recorded_by.at.slice(0,10),period:costs(job).callback_periods?.[w.id]??w.recorded_by.at.slice(0,7),matches:[],by:w.recorded_by})))]}
export function supplierCostHolds(job:Job){
 const entries=costs(job).entries,result:{cost_code:string;subcontract_id:string;draw_id:string;amount_cents:number}[]=[]
 for(const sub of job.subcontracts??[])for(const draw of supplierRetainageBalance(sub)?.draws??[]){
  const codes=[...new Set(entries.filter(e=>e.matches.some(m=>m.draw_id===draw.draw_id)).map(e=>e.cost_code))]
  const weights=codes.map(code=>sum(entries.filter(e=>e.cost_code===code).flatMap(e=>e.matches.filter(m=>m.draw_id===draw.draw_id).map(m=>m.amount_cents))))
  const matched=sum(weights);if(matched<=0||!draw.held_cents)continue
  const hold=Number((BigInt(draw.held_cents)*BigInt(matched)*2n+BigInt(draw.gross_cents))/(2n*BigInt(draw.gross_cents))),shares=allocate(hold,weights)
  codes.forEach((cost_code,i)=>result.push({cost_code,subcontract_id:sub.id,draw_id:draw.draw_id,amount_cents:shares[i]!}))
 }
 return result
}
export function supplierSettlements(job:Job){const state=costs(job),result:{cost_code:string;draw_id:string;payment_reference:string;amount_cents:number}[]=[];for(const sub of job.subcontracts??[])for(const draw of sub.draws??[])if(draw.payment){for(const code of new Set(state.entries.map(e=>e.cost_code))){const amount=sum(state.entries.filter(e=>e.cost_code===code).flatMap(e=>e.matches.filter(m=>m.draw_id===draw.id).map(m=>m.amount_cents)));if(amount)result.push({cost_code:code,draw_id:draw.id,payment_reference:draw.payment.reference,amount_cents:amount})}}return result}
export function costLedger(job:Job){
 const state=costs(job),actuals=actualEntries(job),p=procurement(job),holds=supplierCostHolds(job),settled=supplierSettlements(job),billing=billingSources(job),budget=job.budgets?.at(-1),original=job.budgets?.[0],adjusted=bidCostBudget(job)
 const codes=[...new Set([...(budget?.codes.map(c=>c.cost_code)??[]),...p.map(r=>r.cost_code),...actuals.map(e=>e.cost_code),...billing.map(r=>r.cost_code),...job.variations.filter(v=>v.status==='draft').flatMap(v=>v.pricing?v.pricing.base_lines.map(l=>l.cost_code??'Unassigned'):['Unassigned'])])]
 const rows=codes.map(cost_code=>{
  const current=budget?.codes.find(c=>c.cost_code===cost_code),first=original?.codes.find(c=>c.cost_code===cost_code),entries=actuals.filter(e=>e.cost_code===cost_code)
  const consumed=sum(state.entries.flatMap(e=>e.matches.filter(m=>m.cost_code===cost_code).map(m=>m.amount_cents)))
  const commitment=sum(p.filter(r=>r.cost_code===cost_code&&r.kind==='commitment').map(r=>r.amount_cents)),received=sum(p.filter(r=>r.cost_code===cost_code&&r.kind==='receipt').map(r=>r.amount_cents))
  const actual=sum(entries.map(e=>e.amount_cents)),approved=adjusted.codes.find(c=>c.cost_code===cost_code)?.current_cost_cents??null,open=sum([commitment,-consumed])
  const pending=job.variations.filter(v=>v.status==='draft').flatMap(v=>v.pricing?v.pricing.base_lines.filter(l=>(l.cost_code??'Unassigned')===cost_code).map(l=>l.cost_total_cents===undefined?null:(v.pricing_direction==='credit'?-1:1)*l.cost_total_cents):cost_code==='Unassigned'?[null]:[])
  const forecast=state.forecasts.at(-1)?.codes.find(c=>c.cost_code===cost_code)
  return {cost_code,original_estimate_cents:first?.cost_cents??null,revised_estimate_cents:current?.cost_cents??null,approved_budget_cents:approved,approved_change_cents:first?.cost_cents!==null&&first?.cost_cents!==undefined&&current?.cost_cents!==null&&current?.cost_cents!==undefined?current.cost_cents-first.cost_cents:null,pending_change_cents:pending.some(p=>p===null)?null:sum(pending as number[]),commitment_cents:commitment,consumed_commitment_cents:consumed,open_commitment_cents:open,received_cents:received,received_not_billed_cents:sum([received,-consumed]),posted_actual_cents:actual,supplier_retained_cents:sum(holds.filter(h=>h.cost_code===cost_code).map(h=>h.amount_cents)),recorded_supplier_payment_cents:sum(settled.filter(p=>p.cost_code===cost_code).map(p=>p.amount_cents)),payable_cents:sum([sum(state.bills.filter(b=>b.status==='posted').flatMap(b=>b.lines.filter(l=>l.cost_code===cost_code).map(l=>(b.kind==='credit'?-1:1)*l.amount_cents))),-sum(holds.filter(h=>h.cost_code===cost_code).map(h=>h.amount_cents)),-sum(settled.filter(p=>p.cost_code===cost_code).map(p=>p.amount_cents))]),client_billed_cents:sum(billing.filter(r=>r.cost_code===cost_code&&r.kind==='billed').map(r=>r.amount_cents)),client_collected_cents:sum(billing.filter(r=>r.cost_code===cost_code&&r.kind==='collected').map(r=>r.amount_cents)),uncommitted_forecast_cents:forecast?Math.max(0,forecast.remaining_cents-open):approved===null?null:Math.max(0,approved-actual-open),sources:{supplier_settlements:settled.filter(p=>p.cost_code===cost_code),supplier_retention:holds.filter(h=>h.cost_code===cost_code),budgets:(job.budgets??[]).filter(b=>b.codes.some(c=>c.cost_code===cost_code)).map(b=>({id:b.id,revision:b.revision,source:b.source,period:b.recorded_by.at.slice(0,7),code:b.codes.find(c=>c.cost_code===cost_code)})),procurement:p.filter(r=>r.cost_code===cost_code),actual:entries,billing:billing.filter(r=>r.cost_code===cost_code)}}
 })
 const keys=['commitment_cents','consumed_commitment_cents','open_commitment_cents','received_cents','received_not_billed_cents','posted_actual_cents','supplier_retained_cents','recorded_supplier_payment_cents','payable_cents','client_billed_cents','client_collected_cents'] as const
 return {format:'plinth-cost-ledger-v1',job_id:job.id,version:job.version,currency:currencyOf(job),budget_revision:budget?.revision??null,rows,totals:Object.fromEntries(keys.map(key=>[key,sum(rows.map(r=>r[key]))])),forecast:state.forecasts.at(-1)?{...state.forecasts.at(-1),stale:state.forecasts.at(-1)!.source_version!==job.version}:null,label:'Recorded sources; no provider sync, payment or independent verification. Unknown budgets remain null; periods on older undated sources remain null.'}
}

export function ledgerSnapshot(job:Job){const {format,rows,totals,currency,budget_revision,label}=costLedger(job);return {format,rows,totals,currency,budget_revision,label}}
