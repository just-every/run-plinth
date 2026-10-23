import { cents, find, need, object, recordApproval, stamp, sum, text, type Actor, type Input, type Job } from './model'
import { calculatePricing, pricingPercent } from './pricing-model'
import { costs, costCode, costDate, document, positive, type CostBill, type CostLine, type CostMatch } from './cost-model'
import { procurement } from './cost-ledger'
import { localDate } from './remittances'
import { lienPacket } from './lien-waiver-model'

function validateMatches(job:Job,bill:CostBill){
 const state=costs(job),sources=procurement(job),sign=bill.kind==='credit'?-1:1
 const used=(predicate:(m:CostMatch)=>boolean)=>sum(state.entries.flatMap(e=>e.matches.filter(predicate).map(m=>m.amount_cents)))
 const proposed=bill.lines.flatMap(l=>l.matches)
 for(const m of proposed){
  const receipt=sources.filter(r=>r.kind==='receipt'&&r.order_id===m.order_id&&r.receipt_id===m.receipt_id&&r.cost_code===m.cost_code)
  need(receipt.length,'Matching receipt/code not found',409,'cost_receipt')
  const same=(other:CostMatch)=>other.order_id===m.order_id&&other.receipt_id===m.receipt_id&&other.cost_code===m.cost_code
  const after=sum([used(same),sign*sum(proposed.filter(same).map(r=>r.amount_cents))])
  need(after>=0&&after<=sum(receipt.map(r=>r.amount_cents)),'Bill exceeds the unmatched receipt amount',409,'cost_overbill')
  const codeSame=(other:CostMatch)=>other.order_id===m.order_id&&other.cost_code===m.cost_code
  need(sum([used(codeSame),sign*sum(proposed.filter(codeSame).map(r=>r.amount_cents))])<=sum(sources.filter(r=>r.kind==='receipt'&&r.order_id===m.order_id&&r.cost_code===m.cost_code).map(r=>r.amount_cents)),'Net receipts no longer support this bill',409,'cost_overbill')
  const order=find(job.orders,m.order_id)
  need(order.status==='issued','Match an issued, uncancelled order',409,'cost_order')
  need(order.supplier.trim().toLowerCase()===bill.vendor.trim().toLowerCase(),'Invoice vendor differs from the order supplier',409,'cost_scope')
  if(order.source?.kind==='award'){
   const sub=find(job.subcontracts??[],order.source.subcontract_id)
   need(sub.status==='released','Subcontract progress is not released',409,'cost_scope')
   const draw=find(sub.draws??[],text(m.draw_id,'Approved progress draw_id',100))
   const sameDraw=(other:CostMatch)=>other.draw_id===draw.id
   const progress=sum([used(sameDraw),sign*sum(proposed.filter(sameDraw).map(p=>p.amount_cents))])
   need(progress>=0&&progress<=draw.amount_cents,'Bill exceeds recorded approved subcontract progress',409,'cost_progress')
   need(sub.lien,'Record the subcontract lien parties before matching a bill',409,'cost_waiver')
   const packet=lienPacket([sub],bill.dated_on)
   need(!packet.unresolved.some(w=>w.draw_id===draw.id&&!draw.exception),'Resolve the matched draw’s required waivers or record the existing owner exception before posting its bill',409,'cost_waiver')
  }
 }
 if(bill.kind==='credit'){
  const original=find(state.bills,bill.credit_of!)
  need(original.status==='posted'&&original.kind==='bill'&&original.vendor===bill.vendor,'A credit names a posted bill from the same vendor',409,'cost_credit')
  const credits=state.bills.filter(b=>b.status==='posted'&&b.credit_of===original.id)
  need(sum([bill.amount_cents,...credits.map(b=>b.amount_cents)])<=original.amount_cents,'Credits cannot exceed their original bill',409,'cost_credit')
  for(const code of new Set(bill.lines.map(l=>l.cost_code)))need(sum([...bill.lines.filter(l=>l.cost_code===code).map(l=>l.amount_cents),...credits.flatMap(b=>b.lines.filter(l=>l.cost_code===code).map(l=>l.amount_cents))])<=sum(original.lines.filter(l=>l.cost_code===code).map(l=>l.amount_cents)),'Credit code exceeds the original billed code',409,'cost_credit')
  for(const m of proposed){const same=(x:CostMatch)=>x.order_id===m.order_id&&x.receipt_id===m.receipt_id&&x.cost_code===m.cost_code;need(sum([...proposed.filter(same).map(x=>x.amount_cents),...credits.flatMap(c=>c.lines.flatMap(l=>l.matches.filter(same).map(x=>x.amount_cents)))])<=sum(original.lines.flatMap(l=>l.matches.filter(same).map(x=>x.amount_cents))),'Credit receipt must belong to the original bill',409,'cost_credit')}
 }
}
export async function billAction(job:Job,actor:Actor,input:Input,id?:string,action?:string):Promise<CostBill>{
 const state=costs(job)
 if(!id){
  need(input.kind===undefined||input.kind==='bill'||input.kind==='credit','Choose bill or credit');const kind=input.kind==='credit'?'credit':'bill'
  const vendor=text(input.vendor,'vendor',200),reference=text(input.reference,'invoice reference',200)
  need(!state.bills.some(b=>b.vendor.toLowerCase()===vendor.toLowerCase()&&b.reference.toLowerCase()===reference.toLowerCase()),'Vendor invoice reference is already captured',409,'cost_duplicate')
  need(Array.isArray(input.lines)&&input.lines.length>0&&input.lines.length<=100,'Send one to 100 coded lines')
  const taxInput=object(input.tax),percent=pricingPercent(taxInput.percent,'Reviewed tax percent',100),taxReference=text(taxInput.reference,'Reviewed rate source',1000),exemption_reference=text(taxInput.exemption_reference,'Exemption evidence',1000,true)
  need(taxInput.human_reviewed===true,'A person must confirm the reviewed rate and taxable/exempt split')
  const raw=input.lines.map((value,i)=>{const l=object(value);need(typeof l.taxable==='boolean','Each line explicitly chooses taxable or exempt');return {id:String(i+1),cost_code:costCode(job,l.cost_code),description:text(l.description,'description',500),quantity:1,unit_cents:positive(l.subtotal_cents,'subtotal_cents'),total_cents:positive(l.subtotal_cents,'subtotal_cents'),taxable:l.taxable,matches:l.matches??[]}})
  need(raw.every(l=>l.taxable)||exemption_reference,'Exempt lines require evidence')
  const pricing=calculatePricing(raw,'sell',[],percent,raw.filter(l=>l.taxable).map(l=>l.id))
  const lines:CostLine[]=raw.map((l,i)=>{need(Array.isArray(l.matches)&&l.matches.length<=50,'Send up to 50 receipt matches per line');const matches=l.matches.map(value=>{const m=object(value);return {order_id:text(m.order_id,'order_id',100),receipt_id:text(m.receipt_id,'receipt_id',100),cost_code:text(m.cost_code??l.cost_code,'Receipt cost_code',80),amount_cents:positive(m.amount_cents),...(m.draw_id?{draw_id:text(m.draw_id,'draw_id',100)}:{})}});need(sum(matches.map(m=>m.amount_cents))<=l.total_cents,'Receipt matches cannot exceed line subtotal');return {id:l.id,cost_code:l.cost_code,description:l.description,subtotal_cents:l.total_cents,amount_cents:pricing.lines[i]!.total_cents,tax_cents:pricing.lines[i]!.total_cents-l.total_cents,matches}})
  const dated=costDate(input),due_on=localDate(input.due_on,'due_on');need(due_on>=dated.dated_on,'Due date cannot precede invoice date')
  const row:CostBill={id:crypto.randomUUID(),reviewer_id:text(input.reviewer_id??state.policy?.owner_id??actor.id,'Designated reviewer',100),kind,vendor,reference,...dated,due_on,status:'draft',lines,amount_cents:sum(lines.map(l=>l.amount_cents)),document:await document(input.document),prepared_by:stamp(actor),reviews:[],tax:{as_of:dated.dated_on,reviewed_by:stamp(actor),taxable_cents:pricing.taxable_cents,exempt_cents:pricing.exempt_cents,tax_cents:pricing.tax_cents,stages:pricing.stages,percent,reference:taxReference,exemption_reference,verification:'Human reviewed; no provider verification',taxable_line_ids:raw.filter(l=>l.taxable).map(l=>l.id)},flags:[],...(kind==='credit'?{credit_of:text(input.credit_of,'credit_of',100)}:{})}
  row.flags=lines.flatMap(l=>[...(sum(l.matches.map(m=>m.amount_cents))<l.subtotal_cents?['Missing receipt: line '+l.id]:[]),...(l.matches.some(m=>m.cost_code!==l.cost_code)?['Scope/code discrepancy: line '+l.id]:[])])
  validateMatches(job,row);state.bills.push(row);return row
 }
 const row=find(state.bills,id);need(row.status==='draft','Posted originals and coding are immutable; enter a credit or explicit transfer',409,'cost_posted')
 if(action==='route'){row.reviewer_id=text(input.reviewer_id,'Designated reviewer',100);row.reviews.push({reason:text(input.reason,'Approval routing reason',2000),by:stamp(actor)});return row}
 if(action==='review'){row.reviews.push({reason:text(input.reason,'Approval routing evidence',2000),by:stamp(actor)});return row}
 if(action==='recode'){
  const line=find(row.lines,text(input.line_id,'line_id',100)),before=line.cost_code;line.cost_code=costCode(job,input.cost_code);row.flags=row.lines.flatMap(l=>[...(sum(l.matches.map(m=>m.amount_cents))<l.subtotal_cents?['Missing receipt: line '+l.id]:[]),...(l.matches.some(m=>m.cost_code!==l.cost_code)?['Scope/code discrepancy: line '+l.id]:[])]);row.reviews=[];recordApproval(job,actor,'cost.bill.recode',row,{bill_id:row.id,line_id:line.id,before,after:line.cost_code,reason:text(input.reason,'Recode reason',2000)});return row
 }
 need(action==='post','Unknown bill action',404,'not_found')
 validateMatches(job,row)
 need(!row.flags.length||row.reviews.length,'Review every missing-receipt or scope discrepancy before posting',409,'cost_review')
 const policy=state.policy
 need(row.reviewer_id===actor.id,'Only the designated current office reviewer approves this bill',403,'cost_reviewer')
 need(!(policy?.separate_approval??true)||row.prepared_by.id!==actor.id,'A different authorized person must approve this bill',403,'cost_separation')
 need(!policy||row.amount_cents<=policy.bill_limit_cents||actor.role==='owner','Only the owner approves a bill over its limit',403,'cost_limit')
 const sign=row.kind==='credit'?-1:1
 for(const line of row.lines)state.entries.push({id:crypto.randomUUID(),source_id:row.id,source_line_id:line.id,source_kind:row.kind,cost_code:line.cost_code,amount_cents:sign*line.amount_cents,dated_on:row.dated_on,period:row.period,matches:line.matches.map(m=>({...m,amount_cents:sign*m.amount_cents})),by:stamp(actor)})
 row.status='posted';row.posted_by=stamp(actor)
 recordApproval(job,actor,'cost.bill.post',row,{bill_id:row.id,reference:row.reference,amount_cents:sign*row.amount_cents,period:row.period,lines:row.lines,tax:row.tax,document_checksum:row.document.checksum,label:'Posted once to Plinth ledger; QBO/Xero sync held under INT-001/INT-002/INT-003; no funds moved'})
 return row
}
