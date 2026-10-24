import { cents, find, need, object, sum, text, type Actor, type Input, type Job } from './model'
import { costs, type CostEntry } from './cost-model'
import { decimal } from './estimate-math'
import type { PricingSnapshot } from './pricing-model'
import { invoiceRows, type Invoice, type InvoiceTaxLine } from './invoice-model'
export interface CostBilling {
 contract_reference:string; fee_bps:number; fee_categories?:{name:string;cost_codes:string[];fee_bps:number}[]; tax?:PricingSnapshot['tax']; tax_cents?:number; priced_lines?:InvoiceTaxLine[]; cap_cents:number; excluded_entry_ids:string[]
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
 const fee_categories=input.fee_categories===undefined?undefined:(()=>{need(Array.isArray(input.fee_categories)&&input.fee_categories.length>0&&input.fee_categories.length<=201,'Provide up to 201 fee categories');const seen=new Set<string>();return input.fee_categories.map(raw=>{const r=object(raw),name=text(r.name,'Fee category',120),cost_codes=ids(r.cost_codes,'category cost codes'),rate=cents(r.fee_bps,'Category fee');need(cost_codes.length>0&&rate<=100000,'Choose cost codes and a fee of at most 1000 percent');for(const code of cost_codes){need(!seen.has(code),'Fee categories cannot overlap');seen.add(code)}return {name,cost_codes,fee_bps:rate}})})()
 need(!fee_categories||entries.every(e=>fee_categories.some(c=>c.cost_codes.includes(e.cost_code))),'Every selected cost needs a contractual fee category')
 const prior=issued.filter(i=>i.kind==='cost_plus')
 need(prior.every(i=>i.sources.cost_billing?.contract_reference===contract_reference&&i.sources.cost_billing.fee_bps===fee_bps&&i.sources.cost_billing.cap_cents===cap_cents&&JSON.stringify(i.sources.cost_billing.fee_categories)===JSON.stringify(fee_categories)),'Issued cost billing terms are fixed; use the original contract reference, fee and cap',409,'cost_billing_terms')
 const pricing=job.quotes.find(q=>q.status==='accepted')?.pricing
 need(pricing?.approved_by&&pricing.tax.provider==='manual'&&pricing.tax.rate.human_reviewed,'Accepted human-reviewed tax is required',409,'cost_billing_tax')
 const tax=structuredClone(pricing.tax),p=decimal(tax.rate.percent,'Tax percent',false)
 const taxOn=(amount:number)=>{const sign=amount<0?-1:1;return sign*Number((2n*BigInt(Math.abs(amount))*p.numerator+100n*p.denominator)/(200n*p.denominator))}
 const taxable=(code:string)=>pricing.base_lines.some(l=>l.cost_code===code&&tax.taxable_line_ids.includes(l.id!))
 const line=(id:string,description:string,amount:number,isTaxable:boolean):InvoiceTaxLine=>{const tax_cents=isTaxable?cents(taxOn(amount),'Cost billing tax',true):0;return {id,description,source_id:id,source_revision:1,subtotal_cents:amount,tax_cents,gross_cents:sum([amount,tax_cents]),reviewed_source_gross_cents:sum([amount,tax_cents]),reviewed_source_tax_cents:tax_cents}}
 const priced_lines=entries.map(e=>line(e.id,`${e.source_kind} · ${e.cost_code} · ${e.dated_on}`,e.amount_cents,taxable(e.cost_code)))
 const groups=fee_categories??[{name:'Contractual cost billing fee',cost_codes:[...new Set(entries.map(e=>e.cost_code))],fee_bps}]
 // Fees round once per category and tax treatment, preserving the accepted tax code mapping.
 let fee_cents=0
 for(const [index,group] of groups.entries())for(const isTaxable of (fee_categories===undefined&&p.numerator===0n?[false]:[false,true])){const selected=entries.filter(e=>group.cost_codes.includes(e.cost_code)&&(fee_categories===undefined&&p.numerator===0n||taxable(e.cost_code)===isTaxable));if(!selected.length)continue;const fee=round(sum(selected.map(e=>e.amount_cents)),group.fee_bps);fee_cents=sum([fee_cents,fee]);priced_lines.push(line(`contract-fee-${index}-${isTaxable}`,group.name,fee,isTaxable))}
 const cost_cents=sum(entries.map(e=>e.amount_cents)),uncapped_cents=sum(priced_lines.map(l=>l.gross_cents)),billed=sum(prior.map(i=>i.issued!.gross_cents))
 const total_cents=uncapped_cents<0?uncapped_cents:Math.min(uncapped_cents,Math.max(0,cap_cents-billed)),cap_reduction_cents=sum([uncapped_cents,-total_cents])
 need(total_cents!==0&&billed+total_cents>=0,'The issue must have a nonzero value and credits cannot exceed earlier billed value',409,'cost_billing_balance')
 if(total_cents<0)need(entries.filter(e=>e.amount_cents<0).every(e=>{const bill=state.bills.find(b=>b.id===e.source_id);return bill?.credit_of&&prior.some(i=>i.sources.cost_billing?.entries.some(old=>old.source_id===bill.credit_of))}),'A net credit must link an originally billed vendor source',409,'cost_billing_credit')
 if(cap_reduction_cents){const allTax=sum(priced_lines.map(l=>l.tax_cents)),reductionTax=Math.sign(allTax)*Number((2n*BigInt(cap_reduction_cents)*BigInt(Math.abs(allTax))+BigInt(uncapped_cents))/(2n*BigInt(uncapped_cents)));const cap=line('contract-cap','Contractual cap adjustment',-cap_reduction_cents+reductionTax,false);cap.tax_cents=-reductionTax;cap.gross_cents=-cap_reduction_cents;cap.reviewed_source_gross_cents=cap.gross_cents;cap.reviewed_source_tax_cents=cap.tax_cents;priced_lines.push(cap)}
 const tax_cents=sum(priced_lines.map(l=>l.tax_cents))
 const supporting_sources=entries.map(e=>{const bill=state.bills.find(b=>b.id===e.source_id),source=state.sources.find(s=>s.id===e.source_id);need(bill?.status==='posted'||source?.approved_by,'The selected cost requires retained approved supporting evidence',409,'cost_billing_evidence');return {entry_id:e.id,source_id:e.source_id,...(bill?.credit_of?{detail:{credit_of:bill.credit_of}}:{}),reference:bill?.reference??source!.reference,...((bill?.document??source?.document)?{document_checksum:(bill?.document??source?.document)!.checksum}:{}),...(source?{detail:structuredClone(source.detail)}:{})}})
 // Every later batch explicitly links the prior issues; it never mutates their source snapshots.
 return structuredClone({contract_reference,fee_bps,...(fee_categories?{fee_categories}:{}),tax,tax_cents,priced_lines,cap_cents,excluded_entry_ids,entries,supporting_sources,prior_invoice_ids:prior.map(i=>i.id),cost_cents,fee_cents,uncapped_cents,cap_reduction_cents,total_cents})
}
export function costBillingLines(b:CostBilling):InvoiceTaxLine[]{
 if(b.priced_lines)return structuredClone(b.priced_lines)
 const line=(id:string,description:string,amount:number):InvoiceTaxLine=>({id,description,source_id:id,source_revision:1,gross_cents:amount,subtotal_cents:amount,tax_cents:0,reviewed_source_gross_cents:amount,reviewed_source_tax_cents:0})
 return [...b.entries.map(e=>line(e.id,`${e.source_kind} · ${e.cost_code} · ${e.dated_on}`,e.amount_cents)),line('contract-fee','Contractual cost billing fee',b.fee_cents),...(b.cap_reduction_cents?[line('contract-cap','Contractual cap adjustment',-b.cap_reduction_cents)]:[])]
}
export function refreshCostBilling(job:Job,row:Invoice){const b=row.sources.cost_billing!;return costBilling(job,{...b,entry_ids:b.entries.map(e=>e.id)},row.id)}
