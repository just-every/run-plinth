import { actualEntries, procurement } from './cost-ledger'
import { currencyOf, sum, type Job } from './model'

/** Recorded native evidence is not a claim of complete procurement or lifetime callback capture. */
export function learningEvidence(job:Job){
 const quote=job.quotes.find(q=>q.status==='accepted')!,lines=quote.lines.filter(l=>l.included!==false&&l.category!=='labor'),p=procurement(job),actual=actualEntries(job)
 const codes=[...new Set([...lines.map(l=>l.cost_code??'Unassigned'),...p.map(r=>r.cost_code)])]
 return {
  procurement:{codes:codes.map(cost_code=>{
   const selected=lines.filter(l=>l.cost_code===cost_code),sources=p.filter(r=>r.cost_code===cost_code),committed=sum(sources.filter(r=>r.kind==='commitment').map(r=>r.amount_cents)),received=sum(sources.filter(r=>r.kind==='receipt').map(r=>r.amount_cents)),estimated=selected.length&&selected.every(l=>l.cost_total_cents!==undefined)?sum(selected.map(l=>l.cost_total_cents!)):null
   return {cost_code,estimated_cost_cents:estimated,recorded_commitment_cents:committed,recorded_received_cents:received,commitment_variance_cents:estimated===null?null:sum([committed,-estimated]),sources:sources.map(s=>({...s,order_revision:job.orders.find(o=>o.id===s.order_id)?.amendments?.filter(a=>a.status==='approved').length??0})),posted_entries:actual.filter(e=>e.cost_code===cost_code&&e.source_kind==='bill').map(e=>({id:e.id,source_id:e.source_id,amount_cents:e.amount_cents,dated_on:e.dated_on}))}
  }),coverage:'Recorded native commitments and receipts only. Unordered scope and unposted supplier costs remain unknown.'},
  warranty:{currency:currencyOf(job),components:(job.warranties?.components??[]).map(c=>({id:c.id,starts_on:c.starts_on,ends_on:c.ends_on,signed_terms_reference:c.signed_terms_reference})),cases:(job.warranties?.cases??[]).map(c=>({id:c.id,component_id:c.component_id,status:c.status,repeated:c.repeated,earlier_case_ids:c.earlier_case_ids,reported_on:c.reported_on,review_ids:c.reviews.map(r=>r.id),costs:c.costs.map(w=>({id:w.id,cost_code:w.cost_code,amount_cents:w.amount_cents,reference:w.reference}))})),recorded_cost_cents:sum((job.warranties?.cases??[]).flatMap(c=>c.costs.map(w=>w.amount_cents))),callback_probability:null,coverage:'Recorded callback costs only. No lifetime callback denominator, coverage interpretation or professional certification.'}
 }
}
