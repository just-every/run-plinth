import assert from 'node:assert/strict'
import { followupFixture } from './followup-support.mjs'
/** Exercise real native receipt doors; expected cents below are independently stated. */
export async function collectionFixture(f){
 const c=await followupFixture(f,{clientNumber:41}),j=c.active
 await j.act('/sov',{})
 await j.act('/retainage',{contract_reference:'Synthetic ten percent withholding',rules:[{line_id:'quote:synthetic-plinth-line-1',work_bps:1000,stored_bps:1000}],milestones:[{id:'synthetic-plinth-completion',name:'Substantial completion',completion_requirements:['Final inspection'],waiver_requirements:[]}]})
 const ids=[]
 for(const [index,completed_cents] of [50000,100000].entries()){
  const claim=(await j.act('/claims',{description:'Synthetic progress '+(index+1),lines:[{line_id:'quote:synthetic-plinth-line-1',completed_cents,stored_cents:0,evidence:'Human recorded installed stage '+(index+1)}]})).record
  await j.act('/claims/'+claim.id+'/approve');await j.act('/claims/'+claim.id+'/issue')
  const invoice=(await j.act('/invoices',{kind:'milestone',source_application_id:claim.id,description:'Synthetic collection milestone '+(index+1),recipient_email:j.job.client_email,due_on:'2026-10-28',terms:'Recorded bank or check evidence only'})).record
  await j.act('/invoices/'+invoice.id+'/issue');ids.push(invoice.id)
 }
 await j.act('/remittances',{amount_cents:2000,received_on:'2026-10-29',reference:'synthetic-plinth-unapplied-1',evidence:'Staff recorded unallocated cash',method:'bank',confirm:true,allocations:[]})
 await j.act('/followup-rules',{...c.config,kind:'collection'})
 const root='/jobs/'+j.job.id+'/collection-reviews'
 const read=async()=>{const r=await c.api(root);assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
 const save=async()=>{const source=await read(),r=await c.api(root,{expected_version:source.version,review_generation:source.review_generation,owner_version:source.owner_version,source_digest:source.source_digest,confirm:true});assert.equal(r.status,200,JSON.stringify(r.value));await j.read();return r.value.record}
 const preview=async(review,at='2026-10-30T15:00:00Z')=>{const r=await c.api(root+'/'+review.id+'/preview?as_of='+encodeURIComponent(at));assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
 const receipt=async(amount_cents,reference)=>j.act('/invoices/'+ids[0]+'/receipt',{amount_cents,reference,received_on:'2026-10-29',method:'bank',confirm:true})
 return {...c,j,ids,root,readReviews:read,saveReview:save,previewReview:preview,receipt}
}
export async function collectionMoneyProof(f){
 const c=await collectionFixture(f),j=c.j,calls=f.messages.length
 const financial=()=>structuredClone({invoices:j.job.invoices,remittances:j.job.remittances,retainage:j.job.retainage,budgets:j.job.budgets,approvals:j.job.approvals})
 const original=financial(),r1=await c.saveReview()
 assert.deepEqual(financial(),original,'A collection review cannot mutate any financial source or approval')
 assert.deepEqual((await c.saveReview()),r1,'Repeated identical review retains exactly one identity')
 let p=await c.previewReview(r1),first=p.invoices.find(i=>i.invoice_id===c.ids[0]),other=p.invoices.find(i=>i.invoice_id===c.ids[1])
 assert.equal(p.collectible_cents,90000);assert.equal(p.held_retainage_cents,10000);assert.equal(p.unapplied_remittance_cents,2000);assert.equal(p.unapplied_deposit_liability_cents,0);assert.equal(p.deposit_request_due_cents,10000)
 assert.equal(first.collectible_cents,45000);assert.equal(first.held_retainage_cents,5000);assert.equal(first.monetary_state,'outstanding');assert.equal(first.actions.length,2);assert.ok(first.actions.every(a=>a.status==='eligible'&&a.amount_cents===45000))
 const unchanged=structuredClone(other),keys=first.actions.map(a=>a.key),initial=structuredClone(r1)
 await c.receipt(10000,'synthetic-plinth-partial-1')
 assert.equal((await c.api(c.root+'/'+r1.id+'/preview?as_of=2026-10-30T15:00:00Z')).status,409)
 assert.equal((await c.api(c.root,{expected_version:j.job.version,review_generation:(await c.readReviews()).review_generation,owner_version:(await c.readReviews()).owner_version,source_digest:r1.source_digest,confirm:true})).status,409,'Captured old review cannot bypass changed receipts')
 const afterPartial=financial(),r2=await c.saveReview();assert.notEqual(r2.id,r1.id);assert.deepEqual(financial(),afterPartial)
 p=await c.previewReview(r2);first=p.invoices.find(i=>i.invoice_id===c.ids[0]);assert.equal(first.collectible_cents,35000);assert.equal(first.recorded_native_cents,10000);assert.ok(first.actions.every(a=>a.amount_cents===35000));assert.notDeepEqual(first.actions.map(a=>a.key),keys)
 assert.deepEqual(p.invoices.find(i=>i.invoice_id===c.ids[1]),unchanged)
 await c.receipt(35000,'synthetic-plinth-covered-1')
 const r3=await c.saveReview();p=await c.previewReview(r3);first=p.invoices.find(i=>i.invoice_id===c.ids[0])
 assert.equal(first.collectible_cents,0);assert.equal(first.monetary_state,'covered_by_recorded_receipts');assert.equal(first.case_status,'unresolved');assert.equal(first.receipt_delivery,'unresolved');assert.ok(first.actions.every(a=>a.status==='withheld'&&a.amount_cents===0))
 assert.equal(p.case_status,'unresolved');assert.deepEqual(p.invoices.find(i=>i.invoice_id===c.ids[1]),unchanged)
 const paid=structuredClone(j.job.invoices.find(i=>i.id===c.ids[0])),receipt=paid.receipts.at(-1)
 await j.act('/invoices/'+c.ids[0]+'/return-receipt',{receipt_id:receipt.id,amount_cents:7500,returned_on:'2026-10-30',reference:'synthetic-plinth-return-1',reason:'Staff recorded partial bank return',confirm:true})
 const afterReturn=financial(),r4=await c.saveReview();p=await c.previewReview(r4);first=p.invoices.find(i=>i.invoice_id===c.ids[0])
 assert.equal(first.collectible_cents,7500);assert.equal(first.native_returned_cents,7500);assert.equal(first.recorded_native_cents,37500);assert.equal(first.monetary_state,'reopened_after_recorded_return');assert.ok(first.actions.every(a=>a.status==='eligible'&&a.amount_cents===7500));assert.equal(p.collectible_cents,52500)
 assert.deepEqual(p.invoices.find(i=>i.invoice_id===c.ids[1]),unchanged);assert.deepEqual(financial(),afterReturn)
 assert.deepEqual(j.job.invoices.find(i=>i.id===c.ids[0]).issued,paid.issued);assert.deepEqual(j.job.invoices.find(i=>i.id===c.ids[0]).receipts.slice(0,2),paid.receipts)
 assert.deepEqual((await c.api(c.root+'/'+r1.id)).value.record,initial,'Original private review history is immutable after receipts and returns')
 await j.act('/invoices/'+c.ids[0]+'/write-off',{amount_cents:7500,operation_id:'synthetic-plinth-writeoff-1',reason:'Owner recorded disputed residual',dispute_reference:'synthetic-plinth-dispute-1',confirm:true})
 const r5=await c.saveReview();p=await c.previewReview(r5);first=p.invoices.find(i=>i.invoice_id===c.ids[0]);assert.equal(first.collectible_cents,0);assert.equal(first.monetary_state,'written_off_unresolved');assert.equal(first.case_status,'unresolved');assert.equal(first.written_off_cents,7500)
 assert.equal((await c.readReviews()).reviews.length,5);assert.equal(f.messages.length,calls,'Reviews and previews cause zero outbound mail or provider calls')
 // The unchanged second invoice remains outstanding while current sequence fences change.
 await c.consent(j,'collection',false,c.client)
 const consentReview=await c.saveReview();let fenced=await c.previewReview(consentReview)
 assert.ok(fenced.invoices.find(i=>i.invoice_id===c.ids[1]).actions.every(a=>a.reason==='Recipient opted out; sequence stopped'))
 await c.consent(j,'collection',true,c.client)
 await j.act('/followup-rules',{...c.config,kind:'collection',paused:true})
 const pausedReview=await c.saveReview();fenced=await c.previewReview(pausedReview)
 assert.ok(fenced.invoices.find(i=>i.invoice_id===c.ids[1]).actions.every(a=>a.reason==='Rule paused'))
 await j.act('/followup-rules',{...c.config,kind:'collection'})
 const resumedReview=await c.saveReview()
 await j.act('/portal-policy',{disabled:{client:['billing'],subcontractor:[]},reason:'Owner withdrew current client billing access'})
 fenced=await c.previewReview(resumedReview)
 assert.equal(fenced.invoices.find(i=>i.invoice_id===c.ids[1]).actions.find(a=>!a.escalation).reason,'Recipient has no current access')
 assert.equal(fenced.invoices.find(i=>i.invoice_id===c.ids[1]).actions.find(a=>a.escalation).status,'eligible','Existing configuring-owner escalation concerns only the outstanding monetary leg')
 assert.equal((await c.previewReview(resumedReview,'2026-10-31T02:00:00Z')).invoices.find(i=>i.invoice_id===c.ids[1]).actions.find(a=>a.escalation).reason,'Recipient quiet hours')
 assert.equal(f.messages.length,calls,'Consent, pause and grant fences never send or move funds')

 return {c,review:r5}
}
