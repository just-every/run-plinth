import { cents, find, need, object, recordApproval, stamp, sum, text, type Actor, type Input, type Job } from './model'
import { appendEntry, costCode, costDate, costs, digest, document, positive, type CostSource } from './cost-model'
import { localDate } from './remittances'
const rounded=(n:bigint,d:bigint)=>cents(Number((2n*n+d)/(2n*d)))
export async function sourceAction(job:Job,actor:Actor,input:Input,id?:string,action?:string):Promise<CostSource>{
 const state=costs(job)
 if(!id){
  need(input.kind==='time'||input.kind==='expense'||input.kind==='equipment','Choose time, expense or equipment')
  const kind=input.kind,reference=text(input.reference,'Source reference',200)
  need(!state.sources.some(s=>s.reference.toLowerCase()===reference.toLowerCase()),'Source reference already recorded',409,'cost_duplicate')
  const detail:Input={reference:kind==='equipment'?text(input.equipment_reference,'Equipment reference',200):text(input.employee_reference,'Employee reference',200)}
  let amount_cents:number
  if(kind==='expense')amount_cents=positive(input.amount_cents)
  else{
   const minutes=positive(input.minutes,'minutes'),hour_cents=cents(input.hour_cents,'hour_cents'),burden_bps=cents(input.burden_bps??0,'burden_bps')
   need(minutes<=525600&&burden_bps<=100000,'Minutes or burden rate exceeds the supported range')
   const base=rounded(BigInt(minutes)*BigInt(hour_cents),60n),burden=rounded(BigInt(base)*BigInt(burden_bps),10000n)
   amount_cents=sum([base,burden]);Object.assign(detail,{minutes,hour_cents,burden_bps,base_cents:base,burden_cents:burden})
  }
  if(input.warranty_cost_id!==undefined){need(kind==='expense','Only an expense can match an existing callback cost');const existing=(job.warranties?.cases??[]).flatMap(c=>c.costs).find(c=>c.id===input.warranty_cost_id);need(existing&&existing.amount_cents===amount_cents&&existing.cost_code===input.cost_code,'Callback cost amount and code must match exactly',409,'cost_callback');need(!state.sources.some(s=>s.detail.warranty_cost_id===existing.id),'Callback cost is already matched',409,'cost_duplicate');detail.warranty_cost_id=existing.id}
  const row:CostSource={id:crypto.randomUUID(),kind,reference,...costDate(input),cost_code:costCode(job,input.cost_code),amount_cents,prepared_by:stamp(actor),detail,...(kind==='expense'?{document:await document(input.document)}:{})}
  state.sources.push(row);return row
 }
 const row=find(state.sources,id)
 if(action==='reimburse'){
  need(row.kind==='expense'&&row.approved_by,'Approve the employee expense first',409,'cost_source');need(!row.reimbursed,'Reimbursement already recorded',409,'cost_duplicate');need(input.confirm===true,'Confirm externally reimbursed; Plinth did not send or verify funds')
  row.reimbursed={reference:text(input.reference,'Reimbursement evidence',1000),by:stamp(actor)};recordApproval(job,actor,'cost.expense.reimburse',{id:row.id,prepared_by:row.prepared_by},{id:row.id,reimbursed:row.reimbursed,label:'Reimbursement recorded; no second job-cost posting and no funds moved'});return row
 }
 need(action==='approve','Unknown cost source action',404,'not_found');need(!row.approved_by,'This source is already approved',409,'cost_duplicate')
 need(!(state.policy?.separate_approval??true)||actor.id!==row.prepared_by.id,'A different authorized person must approve this source',403,'cost_separation')
 if(!row.detail.warranty_cost_id)appendEntry(job,actor,{source_id:row.id,source_line_id:row.id,source_kind:row.kind,cost_code:row.cost_code,amount_cents:row.amount_cents,dated_on:row.dated_on,period:row.period,matches:[]})
 row.approved_by=stamp(actor);recordApproval(job,actor,'cost.source.approve',{id:row.id,prepared_by:row.prepared_by},{id:row.id,kind:row.kind,cost_code:row.cost_code,amount_cents:row.amount_cents,period:row.period,detail:row.detail,document_checksum:row.document?.checksum});return row
}
/** Deliberately narrow documented CSV, not a provider export claim. Whole-file review is atomic. */
export async function payrollAction(job:Job,actor:Actor,input:Input){
 text(input.csv,'Payroll allocation CSV',262144);const csv=input.csv as string,rows=csv.replace(/^\uFEFF/,'').split(/\r?\n/);if(rows.at(-1)==='')rows.pop()
 need(rows.shift()==='external_id,time_source_id,gross_cents,burden_cents','Expected external_id,time_source_id,gross_cents,burden_cents CSV header');need(rows.length>0&&rows.length<=100,'Payroll import requires one to 100 rows')
 const state=costs(job),dated=costDate(input),reference=text(input.reference,'Payroll source evidence',1000)
 const parsed=rows.map(line=>{const cells=line.split(',');need(cells.length===4&&cells.every(c=>/^[A-Za-z0-9_.:-]+$/.test(c)),'Payroll CSV fields are unquoted identifiers and integer cents');const [external_id,time_source_id,gross,burden]=cells;need(/^\d+$/.test(gross!)&&/^\d+$/.test(burden!),'Payroll amounts must be nonnegative integer cents');const gross_cents=cents(Number(gross)),burden_cents=cents(Number(burden));return {external_id:external_id!,time_source_id:time_source_id!,gross_cents,burden_cents}})
 need(new Set(parsed.map(r=>r.external_id)).size===parsed.length&&new Set(parsed.map(r=>r.time_source_id)).size===parsed.length,'Each payroll id and timesheet appears once per file')
 need(!state.sources.some(s=>s.kind==='payroll'&&parsed.some(r=>s.reference===r.external_id||s.detail.time_source_id===r.time_source_id)),'Payroll id or timesheet was already allocated; repeat import cannot post',409,'cost_duplicate')
 const checksum=await digest(new TextEncoder().encode(csv)),import_id=crypto.randomUUID(),original=await document({name:'payroll.csv',mime:'text/csv',base64:btoa(Array.from(new TextEncoder().encode(csv),b=>String.fromCharCode(b)).join(''))})
 const records=parsed.map(p=>{
  const time=find(state.sources,p.time_source_id);need(!(state.policy?.separate_approval??true)||time.prepared_by.id!==actor.id,'Payroll reconciliation requires a reviewer distinct from the time preparer',403,'cost_separation');need(time.kind==='time'&&time.approved_by,'Payroll allocation requires approved time',409,'cost_time');need(!time.payroll_replaced_cents,'Time has already been reconciled to payroll',409,'cost_duplicate')
  const amount_cents=sum([p.gross_cents,p.burden_cents]),row:CostSource={id:crypto.randomUUID(),kind:'payroll',reference:p.external_id,...dated,cost_code:time.cost_code,amount_cents,prepared_by:stamp(actor),approved_by:stamp(actor),detail:{...p,import_id,checksum,source_reference:reference}}
  need(!state.entries.some(e=>e.source_kind==='transfer.out'&&e.source_id===state.entries.find(e=>e.source_id===time.id)?.id),'Corrected time must be reconciled before payroll import',409,'cost_time_transferred')
  const delta=sum([amount_cents,-time.amount_cents]);appendEntry(job,actor,{source_id:row.id,source_line_id:row.id,source_kind:'payroll',cost_code:row.cost_code,amount_cents:delta,dated_on:row.dated_on,period:row.period,matches:[]});time.payroll_replaced_cents=time.amount_cents;state.sources.push(row);return row
 })
 ;(state.payroll_imports??=[]).push({id:import_id,document:original,reference,by:stamp(actor)})
 recordApproval(job,actor,'cost.payroll.import',{id:import_id,prepared_by:stamp(actor)},{import_id,checksum,reference,source_totals_cents:sum(records.map(r=>r.amount_cents)),rows:records.map(r=>({id:r.id,amount_cents:r.amount_cents,time_source_id:r.detail.time_source_id})),label:'CSV ledger allocation only; no Gusto sync or payroll execution'})
 return {id:import_id,records,source_totals_cents:sum(records.map(r=>r.amount_cents))}
}
