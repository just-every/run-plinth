import { active, cents, find, need, recordApproval, stamp, sum, text, type Actor, type Input, type Job, type Quote } from './model'
import { requireManager } from './auth'
import { estimateLines } from './estimate-input'
/** Adapted from Glove quote revisions/accept and Locket immutable version custody. */
export function prepareQuote(job:Job,actor:Actor,input:Input):Quote {
 requireManager(actor,true);need(job.status==='quoting','An accepted quote is frozen; use a change order',409,'quote_frozen')
 const quote:Quote={id:crypto.randomUUID(),revision:job.quotes.length+1,...estimateLines(input),notes:text(input.notes,'notes',4000,true),status:'draft',prepared_by:stamp(actor)}
 for(const previous of job.quotes)if(previous.status==='draft')previous.status='superseded'
 job.quotes.push(quote);return quote
}
export function acceptQuote(job:Job,actor:Actor,id:string,input:Input) {
 requireManager(actor);need(job.status==='quoting','The quote is already accepted',409,'quote_frozen');const quote=find(job.quotes,id)
 need(quote.status==='draft'&&quote===job.quotes[job.quotes.length-1],'Accept the current draft revision',409,'revision')
 const method=text(input.method,'method',30);need(['signed','email','phone','in person'].includes(method),'Acceptance method must be signed, email, phone, or in person')
 const acceptance={method,evidence:text(input.evidence,'Client acceptance evidence',2000),client_email:job.client_email,recorded_by:stamp(actor)}
 recordApproval(job,actor,'quote',quote,{...quote,acceptance})
 quote.status='accepted';quote.acceptance=acceptance;job.status='active';return quote
}
/** A proposed term never changes the contract until the actual client confirms it. */
export function prepareVariation(job:Job,actor:Actor,input:Input){requireManager(actor,true);active(job);const row={id:crypto.randomUUID(),revision:1,description:text(input.description,'description',4000),amount_cents:cents(input.amount_cents,'amount_cents',true),status:'draft' as const,prepared_by:stamp(actor)};need(row.amount_cents!==0,'A change order must change the contract amount');job.variations.push(row);return row}
/** carried_over names where and when the client signed a change order that moved in from another system. */
export function approveVariation(job:Job,actor:Actor,id:string,carried_over?:string) {
 need(actor.role==='member'&&(actor.email.toLowerCase()===job.client_email||actor.client_job_id===job.id),'The client assigned to this job must approve this change order',403,'client_required');active(job);const row=find(job.variations,id);need(row.status==='draft','Change order already approved and immutable',409,'immutable')
 const base=find(job.quotes,job.quotes.find(q=>q.status==='accepted')!.id).total_cents
 need(sum([base,...job.variations.filter(v=>v.status==='approved').map(v=>v.amount_cents),row.amount_cents])>=Math.max(0,...job.claims.filter(c=>c.status!=='draft').map(c=>c.cumulative_cents)),'This change order would reduce the contract below billed pay apps',409,'contract_balance')
 const carried=carried_over===undefined?undefined:text(carried_over,'carried_over',500)
 recordApproval(job,actor,'variation',row,{description:row.description,amount_cents:row.amount_cents,client_email:job.client_email,...(carried?{carried_over:carried}:{})});row.status='approved';row.approved_by=stamp(actor);if(carried)row.carried_over=carried;return row
}
