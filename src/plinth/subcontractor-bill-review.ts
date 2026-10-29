import type {Bindings} from '../auth.server'
import {requireOwner} from './auth'
import {billAction} from './cost-bills'
import {costs,digest,type CostBill} from './cost-model'
import {decisionDownload,decisionFiles} from './decision-files'
import {jobRequest} from './job-request'
import {active,find,need,object,recordApproval,stamp,sum,text,usdOnly,type Actor,type Attachment,type Input,type Job,type Stamp} from './model'
import type {PortalSubmission} from './subcontractor-portal'
import {jobOf,jobs,readClock,saveJob} from './store'

export interface BillReviewLine {order_id:string;line_id:string;cost_code:string;description:string;subtotal_cents:number;taxable:boolean}
export interface BillReviewCycle {id:string;reference:string;note:string;amount_cents:number;attachments:Attachment[];by:Stamp;received_submission_id?:string;replacement_reason?:string;reopened_from?:string;decision?:{id:string;outcome:'accepted'|'rejected';reason:string;by:Stamp;commitment_digest:string;commitments:unknown;lines:BillReviewLine[];draft?:Input};handoff?:{bill_id:string;by:Stamp}}
export interface SubcontractorBillReview {id:string;subcontract_id:string;vendor_id:string;cycles:BillReviewCycle[]}
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json=(value:unknown)=>Response.json(value,{headers})
const initial=(s:PortalSubmission):BillReviewCycle=>({id:s.id,reference:s.reference,note:s.note,amount_cents:s.amount_cents!,attachments:structuredClone(s.attachments),by:s.by,received_submission_id:s.id})
function register(job:Job){
 const linked=new Set((job.subcontractor_bill_reviews??[]).flatMap(r=>r.cycles.slice(1).map(c=>c.received_submission_id).filter(Boolean)))
 return (job.portal_submissions??[]).filter(s=>s.kind==='bill'&&!linked.has(s.id)).map(s=>job.subcontractor_bill_reviews?.find(r=>r.id===s.id)??{id:s.id,subcontract_id:s.subcontract_id,vendor_id:s.vendor_id,cycles:[initial(s)]})
}
function commitment(job:Job,row:SubcontractorBillReview){
 const award=find(job.subcontracts??[],row.subcontract_id)
 return {award:{id:award.id,vendor_id:award.vendor_id,vendor_name:award.vendor_name,scope:award.scope,amount_cents:award.amount_cents,status:award.status,awarded_on:award.awarded_on,awarded_by:award.awarded_by},orders:job.orders.filter(o=>o.source?.kind==='award'&&o.source.subcontract_id===award.id&&o.status==='issued').map(o=>({id:o.id,description:o.description,supplier:o.supplier,amount_cents:o.amount_cents,lines:o.lines??[],issued_by:o.issued_by,amendment_ids:o.amendments?.filter(a=>a.status==='approved').map(a=>a.id)??[]}))}
}
async function view(job:Job){
 const rows=await Promise.all(register(job).map(async row=>{const terms=commitment(job,row),latest=row.cycles.at(-1)!,fingerprint=await digest(terms),source_changed=!!latest.decision&&latest.decision.commitment_digest!==fingerprint
  return {...row,commitments:terms,commitment_digest:fingerprint,source_changed,status:latest.handoff?'Draft prepared':source_changed&&latest.decision?.outcome==='accepted'?'Commitment changed; fresh review required':latest.decision?.outcome==='accepted'?'Accepted, draft not prepared':latest.decision?.outcome==='rejected'?'Revision required':'Awaiting review'}
 }))
 return {version:job.version,register:rows,unresolved:rows.filter(r=>{const c=r.cycles.at(-1)!;return !c.decision||c.decision.outcome==='rejected'||!c.handoff&&r.source_changed}).length}
}
async function original(db:D1Database,job:Job,cycle:BillReviewCycle,id:string){
 const file=find(cycle.attachments,id),response=await decisionDownload(db,job,cycle.attachments,id),bytes=new Uint8Array(await response.arrayBuffer())
 // The native COST-002 draft retains the selected exact received original, not caller-supplied replacement bytes.
 let binary='';for(const b of bytes)binary+=String.fromCharCode(b)
 return {name:file.name,mime:file.mime,base64:btoa(binary)}
}
function itemization(job:Job,row:SubcontractorBillReview,input:Input):BillReviewLine[]{
 need(Array.isArray(input.lines)&&input.lines.length>0&&input.lines.length<=100,'Itemize one to 100 commitment lines')
 const terms=commitment(job,row),seen=new Set<string>()
 need(terms.award.status==='released','The awarded scope must still be released',409,'review_source')
 const lines=input.lines.map(value=>{const l=object(value),order=find(terms.orders,text(l.order_id,'Exact awarded order',100)),source=find(order.lines,text(l.line_id,'Exact commitment line',100)),key=order.id+':'+source.id
  need(!seen.has(key),'Itemize each commitment line once');seen.add(key)
  need(typeof l.subtotal_cents==='number'&&Number.isSafeInteger(l.subtotal_cents)&&l.subtotal_cents>0,'Itemized subtotal must be positive integer cents')
  need(typeof l.taxable==='boolean','Review the taxable or exempt choice for every item')
  const reserved=sum((job.subcontractor_bill_reviews??[]).filter(r=>r.id!==row.id).flatMap(r=>r.cycles.flatMap(c=>c===r.cycles.at(-1)&&c.decision?.outcome==='accepted'?c.decision.lines.filter(x=>x.order_id===order.id&&x.line_id===source.id).map(x=>x.subtotal_cents):[])))
  need(sum([reserved,l.subtotal_cents])<=source.total_cents,'Accepted itemization exceeds this exact commitment line',409,'review_overbill')
  return {order_id:order.id,line_id:source.id,cost_code:source.cost_code,description:source.description,subtotal_cents:l.subtotal_cents,taxable:l.taxable}
 })
 return lines
}
/** This office register adds no external projection or grant. Every read, original and mutation requires a current signed-in owner. */
export async function subcontractorBillReviewResponse(request:Request,env:Bindings,actor:Actor,parts:string[]):Promise<Response|null>{
 if(parts[0]!=='jobs'||parts[2]!=='subcontractor-bill-review')return null
 requireOwner(actor);need(!actor.agent_door&&!actor.credential_id,'A personally signed-in owner is required',403,'human_required')
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,parts[1]!),tail=parts.slice(3)
 if(request.method==='GET'){
  if(tail.length===2&&tail[0]==='files')return decisionDownload(env.DB,previous,register(previous).flatMap(r=>r.cycles.flatMap(c=>c.attachments)),tail[1]!)
  need(!tail.length,'Unknown review route',404,'not_found');return json(await view(previous))
 }
 need(request.method==='POST'&&tail.length===2&&['review','replace','prepare-draft','reopen'].includes(tail[1]!),'Unknown review action',404,'not_found');active(previous);usdOnly(previous)
 const input=await jobRequest(request,15_000_000);need(input.expected_version===previous.version,'Job changed; reload the review register',409,'stale_version')
 const job=structuredClone(previous),root=find(register(job),tail[0]!),row=job.subcontractor_bill_reviews?.find(r=>r.id===root.id)??structuredClone(root)
 if(!job.subcontractor_bill_reviews?.some(r=>r.id===root.id))(job.subcontractor_bill_reviews??=[]).push(row)
 const cycle=row.cycles.at(-1)!;need(input.cycle_id===cycle.id,'Review the current submission revision',409,'review_revision')
 const writes:D1PreparedStatement[]=[];let record:unknown
 if(tail[1]==='reopen'){
  need(cycle.decision?.outcome==='accepted'&&!cycle.handoff,'Only an accepted submission without a draft can reopen',409,'review_state')
  need(await digest(commitment(job,row))!==cycle.decision.commitment_digest,'Reopen only after the awarded commitment changes',409,'review_source')
  need(input.confirm===true,'Confirm a fresh review of the retained original');need(row.cycles.length<50,'At most 50 retained submission revisions')
  const replacement:BillReviewCycle={id:crypto.randomUUID(),reference:cycle.reference,note:cycle.note,amount_cents:cycle.amount_cents,attachments:structuredClone(cycle.attachments),by:stamp(actor),reopened_from:cycle.id,replacement_reason:text(input.reason,'Fresh review reason',2000)}
  row.cycles.push(replacement);record=replacement
 }else if(tail[1]==='replace'){
  need(cycle.decision?.outcome==='rejected','Only a rejected submission receives a linked replacement',409,'review_state');need(row.cycles.length<50,'At most 50 retained submission revisions')
  const reason=text(input.reason,'Reason for linking this replacement',2000);let replacement:BillReviewCycle
  if(input.received_submission_id){
   const source=find(job.portal_submissions??[],text(input.received_submission_id,'Received replacement',100))
   need(source.kind==='bill'&&source.vendor_id===row.vendor_id&&source.subcontract_id===row.subcontract_id,'Replacement must belong to the same awarded company scope',409,'review_scope')
   need(!register(job).some(r=>r.id===source.id&&r.cycles.some(c=>c.decision))&&!(job.subcontractor_bill_reviews??[]).some(r=>r.cycles.some(c=>c.id===source.id)),'This submission already belongs to a review',409,'review_duplicate')
   replacement={...initial(source),replacement_reason:reason}
  }else{
   const id=crypto.randomUUID(),files=await decisionFiles(env.DB,job,id,input.attachments);need(files.attachments.length,'Retain the corrected submission original');writes.push(...files.writes)
   const amount=input.amount_cents;need(typeof amount==='number'&&Number.isSafeInteger(amount)&&amount>0,'Replacement amount must be positive integer cents')
   replacement={id,reference:text(input.reference,'Corrected bill reference',200),note:text(input.note,'Owner receipt note',4000),amount_cents:amount,attachments:files.attachments,by:stamp(actor),replacement_reason:reason}
  }
  need(!row.cycles.some(c=>c.reference.toLowerCase()===replacement.reference.toLowerCase()),'Use a distinct corrected submission reference',409,'review_duplicate');row.cycles.push(replacement);record=replacement
 }else if(tail[1]==='review'){
  need(!cycle.decision,'A recorded decision is immutable; link a replacement after rejection',409,'review_immutable')
  need(input.confirm===true,'Explicitly confirm this review');need(input.outcome==='accepted'||input.outcome==='rejected','Choose accept or reject')
  const terms=commitment(job,row),fingerprint=await digest(terms);need(input.commitment_digest===fingerprint,'Awarded commitment changed; reload before reviewing',409,'review_source')
  const decision:NonNullable<BillReviewCycle['decision']>={id:crypto.randomUUID(),outcome:input.outcome,reason:text(input.reason,'Review reason',2000),by:stamp(actor),commitment_digest:fingerprint,commitments:terms,lines:[]}
  if(input.outcome==='accepted'){
   decision.lines=itemization(job,row,input)
   const draft={vendor:terms.award.vendor_name,reference:cycle.reference,dated_on:input.dated_on,due_on:input.due_on,period:input.period,tax:input.tax,lines:decision.lines.map(l=>({...l,matches:[]})),reviewer_id:actor.id,document_id:text(input.document_id,'Reviewed original',100)}
   const checked=await billAction(structuredClone(job),actor,{...draft,document:await original(env.DB,job,cycle,draft.document_id)})
   need(checked.amount_cents===cycle.amount_cents,'Itemized subtotal and reviewed tax must equal the received bill amount',409,'review_total')
   decision.draft=draft
  }
  cycle.decision=decision;record=decision
 }else{
  need(cycle.decision?.outcome==='accepted'&&cycle.decision.draft,'Accept the current itemized submission before preparing a draft',409,'review_state')
  need(!cycle.handoff,'A native bill draft was already prepared',409,'review_handoff');need(input.confirm===true&&input.decision_id===cycle.decision.id,'Explicitly review the exact accepted decision')
  need(await digest(commitment(job,row))===cycle.decision.commitment_digest,'Awarded commitment changed; accepted terms cannot prepare a draft',409,'review_source')
  const draft=cycle.decision.draft
  need(!(await jobs(env.DB)).some(j=>costs(j).bills.some(b=>b.vendor.toLowerCase()===String(draft.vendor).toLowerCase()&&b.reference.toLowerCase()===cycle.reference.toLowerCase())),'Vendor invoice reference already exists in this installation',409,'cost_duplicate')
  const bill:CostBill=await billAction(job,actor,{...draft,document:await original(env.DB,job,cycle,String(draft.document_id))})
  bill.subcontractor_review={submission_id:row.id,cycle_id:cycle.id,decision_id:cycle.decision.id};cycle.handoff={bill_id:bill.id,by:stamp(actor)};record={bill_id:bill.id,status:bill.status,label:'Draft prepared; no cost posted or payment approved'}
 }
 recordApproval(job,actor,'subcontractor-bill.'+tail[1],{id:cycle.id,prepared_by:cycle.by},{submission_id:row.id,cycle_id:cycle.id,record})
 await saveJob(env.DB,actor,previous,job,writes,clock)
 return json({...await view(job),record})
}
export type BillReviewSource=Awaited<ReturnType<typeof view>>
