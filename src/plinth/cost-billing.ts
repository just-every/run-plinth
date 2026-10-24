import { cents, find, need, object, sum, text, type Actor, type Input, type Job } from './model'
import { costs, type CostEntry } from './cost-model'
import { invoiceRows, type Invoice, type InvoiceTaxLine } from './invoice-model'
export interface CostBilling {
 contract_reference:string; fee_bps:number; cap_cents:number; excluded_entry_ids:string[]
 supporting_sources:{entry_id:string;source_id:string;reference:string;document_checksum?:string;detail?:Input}[]
 entries:CostEntry[]; prior_invoice_ids:string[]; cost_cents:number; fee_cents:number; uncapped_cents:number; cap_reduction_cents:number; total_cents:number
}
export function costBillingAccess(actor:Actor){need(!actor.permissions&&(actor.role==='owner'||actor.role==='admin'),'Cost billing requires an office administrator with cost access',403,'forbidden')}
const round=(n:number,bps:number)=>{const sign=n<0?-1:1;return sign*Number((BigInt(Math.abs(n))*BigInt(bps)+5000n)/10000n)}
/** Posted entries are immutable source units; credits and payroll deltas keep their signed value. */
export function costBilling(job:Job,value:unknown,ownId?:string):CostBilling{
 const input=object(value),contract_reference=text(input.contract_reference,'Cost billing contract reference',2000),fee_bps=cents(input.fee_bps,'fee_bps'),cap_cents=cents(input.cap_cents,'cap_cents')
 need(fee_bps<=100000&&cap_cents>0,'Use a fee of at most 1000 percent and a positive contract cap')
 const ids=(value:unknown,name:string)=>{need(Array.isArray(value)&&value.length<=500&&value.every(x=>typeof x==='string'),`Choose up to 500 ${name}`);need(new Set(value).size===value.length,`${name} must be unique`);return value as string[]}
 const selected=ids(input.entry_ids,'entry ids'),excluded_entry_ids=ids(input.excluded_entry_ids??[],'excluded entry ids')
 need(selected.length>0&&!selected.some(id=>excluded_entry_ids.includes(id)),'Select sources and keep exclusions separate')
 const state=costs(job),issued=invoiceRows(job).filter(i=>i.id!==ownId&&i.issued)
 need(!job.claims.some(c=>c.status!=='draft')&&!issued.some(i=>i.kind==='milestone'),'Cost billing cannot share earned sources with progress applications',409,'cost_billing_mode')
 for(const id of excluded_entry_ids)find(state.entries,id)
 const entries=selected.map(id=>find(state.entries,id))
 need(!state.entries.some(e=>e.source_kind==='transfer.out'&&selected.includes(e.source_id)),'A selected cost has been reassigned; reconcile its assignment before billing',409,'cost_billing_source')
 need(entries.every(e=>['bill','credit','time','expense','equipment','payroll'].includes(e.source_kind)),'Transferred costs require assignment reconciliation before billing',409,'cost_billing_source')
 need(!issued.some(i=>i.sources.cost_billing?.entries.some(e=>selected.includes(e.id))||i.sources.cost_billing?.excluded_entry_ids.some(id=>selected.includes(id))),'A selected source was already billed',409,'cost_billing_duplicate')
 const prior=issued.filter(i=>i.kind==='cost_plus')
 need(prior.every(i=>i.sources.cost_billing?.contract_reference===contract_reference&&i.sources.cost_billing.fee_bps===fee_bps&&i.sources.cost_billing.cap_cents===cap_cents),'Issued cost billing terms are fixed; use the original contract reference, fee and cap',409,'cost_billing_terms')
 const cost_cents=sum(entries.map(e=>e.amount_cents)),fee_cents=round(cost_cents,fee_bps),uncapped_cents=sum([cost_cents,fee_cents]),billed=sum(prior.map(i=>i.issued!.gross_cents))
 const total_cents=Math.min(uncapped_cents,Math.max(0,cap_cents-billed)),cap_reduction_cents=sum([uncapped_cents,-total_cents])
 need(total_cents>0,'The batch must have a positive net invoice value; standalone credits require the invoice correction workflow',409,'cost_billing_balance')
 const supporting_sources=entries.map(e=>{const bill=state.bills.find(b=>b.id===e.source_id),source=state.sources.find(s=>s.id===e.source_id);need(bill?.status==='posted'||source?.approved_by,'The selected cost requires retained approved supporting evidence',409,'cost_billing_evidence');return {entry_id:e.id,source_id:e.source_id,reference:bill?.reference??source!.reference,...((bill?.document??source?.document)?{document_checksum:(bill?.document??source?.document)!.checksum}:{}),...(source?{detail:structuredClone(source.detail)}:{})}})
 // Every later batch explicitly links the prior issues; it never mutates their source snapshots.
 return structuredClone({contract_reference,fee_bps,cap_cents,excluded_entry_ids,entries,supporting_sources,prior_invoice_ids:prior.map(i=>i.id),cost_cents,fee_cents,uncapped_cents,cap_reduction_cents,total_cents})
}
export function costBillingLines(b:CostBilling):InvoiceTaxLine[]{
 const line=(id:string,description:string,amount:number):InvoiceTaxLine=>({id,description,source_id:id,source_revision:1,gross_cents:amount,subtotal_cents:amount,tax_cents:0,reviewed_source_gross_cents:amount,reviewed_source_tax_cents:0})
 return [...b.entries.map(e=>line(e.id,`${e.source_kind} · ${e.cost_code} · ${e.dated_on}`,e.amount_cents)),line('contract-fee','Contractual cost billing fee',b.fee_cents),...(b.cap_reduction_cents?[line('contract-cap','Contractual cap adjustment',-b.cap_reduction_cents)]:[])]
}
export function refreshCostBilling(job:Job,row:Invoice){const b=row.sources.cost_billing!;return costBilling(job,{...b,entry_ids:b.entries.map(e=>e.id)},row.id)}
