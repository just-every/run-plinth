import { invoiceBalance, depositLiability } from './invoices'
import { invoiceRows, type Invoice } from './invoice-model'
import { unapplied } from './remittances'
import { sum, type Job, type Stamp } from './model'
import { digest } from './cost-model'
import { canonical } from './sov'

export interface CollectionReview {
 id:string; job_id:string; source_digest:string; sources:Awaited<ReturnType<typeof collectionSources>>['sources']
 balances:ReturnType<typeof collectionBalances>; reviewed_by:Stamp; owner_version:number; generation:number
 boundary:string; case_status:'unresolved'
}
export interface CollectionReviewState {
 reviews:CollectionReview[]; revocations:{review_id:string; by:Stamp; reason:string}[]
}
export const collectionBoundary='Private native balance review only. Bank and check evidence is staff-recorded, not verified funds. No collection case is closed, receipt delivered, message sent, funds moved or assignment authorized. Processor reconciliation, disputes and receipt delivery remain unresolved.'
/** Recorded coverage concerns only the monetary leg, never the whole collection case. */
export function collectionInvoice(job:Job,invoice:Invoice){
 const balance=invoiceBalance(job,invoice),receipts=invoice.receipts
 const native=receipts.filter(r=>r.method!=='stripe'&&!r.processor)
 const recorded_native_cents=sum(native.map(r=>r.amount_cents)),native_returned_cents=-sum(native.filter(r=>r.reversal_of).map(r=>r.amount_cents))
 const processor_evidence=receipts.some(r=>r.method==='stripe'||r.processor)
 const collectible_cents=Math.max(0,balance.due_cents),held_retainage_cents=Math.max(0,balance.withheld_cents-balance.released_retainage_cents)
 const monetary_state=processor_evidence?'processor_unresolved':collectible_cents>0?(native_returned_cents>0?'reopened_after_recorded_return':'outstanding'):balance.written_off_cents>0?'written_off_unresolved':balance.correction_cents<0?'adjusted_no_recorded_due':balance.payable_cents>0&&balance.received_cents+balance.deposit_applied_cents>=balance.payable_cents?'covered_by_recorded_receipts':'no_recorded_due'
 const reason=monetary_state==='processor_unresolved'?'Processor or dispute evidence requires its existing reconciliation door':monetary_state==='reopened_after_recorded_return'?'A native bank or check return reversed recorded coverage; the residual is outstanding':monetary_state==='outstanding'?'Current recorded receipts and allocations leave a collectible residual':monetary_state==='covered_by_recorded_receipts'?'Recorded receipts or deposit allocations cover this monetary leg; funds and receipt delivery are not verified':monetary_state==='written_off_unresolved'?'A recorded write-off reduces due without establishing funds or collection closure':'No recorded due after adjustments or holds; collection closure remains unresolved'
 return {invoice_id:invoice.id,number:invoice.number!,kind:invoice.kind,due_on:invoice.issued!.due_on,...balance,collectible_cents,held_retainage_cents,recorded_native_cents,native_returned_cents,processor_evidence,monetary_state,reason,case_status:'unresolved' as const,receipt_delivery:'unresolved' as const}
}
export function collectionBalances(job:Job){
 const invoices=invoiceRows(job).filter(i=>i.issued).map(i=>collectionInvoice(job,i))
 return {currency:'USD' as const,invoices,collectible_cents:sum(invoices.filter(i=>i.kind!=='deposit').map(i=>i.collectible_cents)),deposit_request_due_cents:sum(invoices.filter(i=>i.kind==='deposit').map(i=>i.collectible_cents)),held_retainage_cents:sum(invoices.map(i=>i.held_retainage_cents)),unapplied_remittance_cents:sum((job.remittances??[]).map(unapplied)),unapplied_deposit_liability_cents:depositLiability(job)}
}
/** Bind every native balance input and sequence revision; review history never fingerprints itself. */
export async function collectionSources(job:Job){
 const invoices=await Promise.all(invoiceRows(job).filter(i=>i.issued).map(async i=>{
  const s=i.issued!
  // Keep the exact original digest and native money evidence, without copying unrelated estimate costs.
  return {id:i.id,number:i.number!,kind:i.kind,description:s.description,source_application_id:i.source_application_id,
   original_digest:await digest(canonical(s)),issued:{number:s.number,gross_cents:s.gross_cents,subtotal_cents:s.subtotal_cents,tax_cents:s.tax_cents,withheld_cents:s.withheld_cents,payable_cents:s.payable_cents,due_on:s.due_on,currency:s.currency,issued_by:s.issued_by},
   receipts:structuredClone(i.receipts),deposit_applications:structuredClone(i.deposit_applications),corrections:structuredClone(i.corrections??[]),write_offs:structuredClone(i.write_offs??[])}
 }))
 const sources={job_id:job.id,time_zone:job.time_zone??'UTC',currency:job.currency??'USD',invoices,retainage:job.retainage??null,remittances:job.remittances??[],followup:job.followup??null}
 return {sources,source_digest:await digest(canonical(sources))}
}
