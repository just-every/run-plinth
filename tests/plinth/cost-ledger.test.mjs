import test from 'node:test'
import assert from 'node:assert/strict'
import {createFixture} from './helpers.mjs'
import {costFixture,costOriginal,original} from './cost-support.mjs'

test('COST-001 — coded budgets, receipt-matched actuals and client draws reconcile without double consumption through native HTTP',async()=>{
 const f=await createFixture()
 try{
  const c=await costFixture(f),before=await c.ledger(),row=(r,code)=>r.rows.find(r=>r.cost_code===code)
  assert.equal(row(before,'06-100').original_estimate_cents,100000);assert.equal(before.totals.open_commitment_cents,100000);assert.equal(before.totals.received_not_billed_cents,50000);assert.equal(before.totals.posted_actual_cents,0)
  let r=await c.ok('/costs/bills',c.bill()),id=r.record.id
  assert.equal(r.record.document.base64,undefined);assert.equal(r.record.lines[0].tax_cents,3000);assert.equal(r.record.lines[1].tax_cents,0)
  assert.equal((await c.act(`/costs/bills/${id}/post`)).status,409)
  await c.ok(`/costs/bills/${id}/review`,{reason:'Original matches both deliveries; office confirms allocation to labor code'})
  await c.ok(`/costs/bills/${id}/post`)
  const posted=await c.ledger();assert.equal(posted.totals.posted_actual_cents,43000);assert.equal(posted.totals.consumed_commitment_cents,40000);assert.equal(posted.totals.open_commitment_cents,60000);assert.equal(posted.totals.received_not_billed_cents,10000);assert.equal(row(posted,'01-100').posted_actual_cents,10000)
  assert.equal(row(posted,'06-100').sources.actual[0].period,'2026-10');assert.equal(row(posted,'06-100').sources.procurement.filter(p=>p.kind==='receipt').length,2);assert.equal(row(posted,'06-100').sources.budgets[0].code.cost_cents,100000)
  assert.equal((await c.act(`/costs/bills/${id}/post`)).status,409);assert.equal((await c.act('/costs/bills',c.bill())).status,409)
  const over=c.bill('synthetic-plinth-overbill');over.lines[0].matches[0].amount_cents=26000;over.lines[0].subtotal_cents=31000
  assert.equal((await c.act('/costs/bills',over)).status,409)
  await c.ok('/sov',{});await c.read()
  r=await c.ok('/claims',{description:'Framing draw',lines:c.job.sov.at(-1).lines.map(l=>({line_id:l.id,completed_cents:l.cost_code==='06-100'?50000:20000,stored_cents:0,evidence:'synthetic-plinth-progress-1'}))});const claim=r.record
  await c.ok(`/claims/${claim.id}/approve`);await c.ok(`/claims/${claim.id}/issue`)
  r=await c.ok('/invoices',{kind:'milestone',description:'Framing invoice',source_application_id:claim.id,recipient_email:'synthetic-plinth-client@example.com',due_on:'2026-11-23',terms:'Net 30'});const invoice=r.record
  await c.ok(`/invoices/${invoice.id}/issue`);await c.ok(`/invoices/${invoice.id}/receipt`,{confirm:true,method:'check',received_on:'2026-10-24',reference:'synthetic-plinth-payment-1',amount_cents:35000})
  r=await c.ledger();assert.equal(r.totals.client_billed_cents,70000,'Invoice never duplicates its application');assert.equal(r.totals.client_collected_cents,35000);assert.equal(row(r,'06-100').client_collected_cents,25000);assert.equal(row(r,'01-100').client_collected_cents,10000)
  const file=await f.request(`/api/plinth/jobs/${c.job.id}/costs/bills/${id}/original`,{cookie:f.owner});assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),costOriginal);assert.equal(file.headers.get('x-content-sha256').length,64)
  const client=await f.invite('synthetic-plinth-client@example.com'),agent=await f.agent()
  for(const auth of [{},{cookie:client},{token:agent}]){for(const path of ['',`/bills/${id}/original`])assert.ok([401,403].includes((await f.request(`/api/plinth/jobs/${c.job.id}/costs${path}`,auth)).status))}
  const clientJob=(await c.api(`/jobs/${c.job.id}`,undefined,client)).value.job;assert.equal(clientJob.cost_records,undefined);assert.ok(!JSON.stringify(clientJob).includes('synthetic-plinth-invoice-1'))
  const rate=(await c.api('/pricing-rates',{jurisdiction:'Synthetic change jurisdiction',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'synthetic-plinth-change-tax',human_reviewed:true})).value.rate
  const change={description:'Extra framing',direction:'charge',basis:'sell',as_of:'2026-10-23',lines:[{id:'extra',description:'Extra framing',cost_code:'06-100',phase:'Framing',category:'material',quantity:'1',unit:'lot',cost_unit_cents:5000,unit_cents:10000}],rules:[],tax:{rate_id:rate.id,taxable_line_ids:['extra']}}
  r=await c.ok('/variation-pricing/preview',change);await c.ok('/variation-pricing/apply',{...change,digest:r.preview.digest});await c.read()
  assert.equal(row(await c.ledger(),'06-100').pending_change_cents,5000)
  assert.equal((await c.act(`/variations/${c.job.variations.at(-1).id}/approve`,{},client)).status,200);await c.read()
  const changed=row(await c.ledger(),'06-100');assert.equal(changed.original_estimate_cents,100000);assert.equal(changed.revised_estimate_cents,105000);assert.equal(changed.approved_budget_cents,105000);assert.equal(changed.approved_change_cents,5000);assert.equal(changed.pending_change_cents,0);assert.equal(changed.uncommitted_forecast_cents,12000)
  const current=await c.read();assert.equal(current.cost_records,undefined,'Raw originals and new costs are absent from generic job doors')
 }finally{await f.close()}
})

test('COST-002 — originals, duplicate and overbill refusal, draft recoding, immutable reviewed tax, credits and stale posting preserve the payable ledger',async()=>{
 const f=await createFixture()
 try{
  const c=await costFixture(f);let r=await c.ok('/costs/bills',c.bill()),id=r.record.id
  await c.ok(`/costs/bills/${id}/recode`,{line_id:'2',cost_code:'06-100',reason:'Correct job cost coding before approval'})
  await c.ok(`/costs/bills/${id}/review`,{reason:'Reviewed original and scope discrepancy'})
  const version=c.job.version
  const attempts=await Promise.all([1,2].map(()=>c.api(`/jobs/${c.job.id}/costs/bills/${id}/post`,{expected_version:version})))
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);await c.read()
  assert.equal((await c.act(`/costs/bills/${id}/recode`,{line_id:'1',cost_code:'01-100',reason:'Cannot rewrite posted costs'})).status,409)
  const credit={...c.bill('synthetic-plinth-credit-1'),kind:'credit',credit_of:id,lines:[{cost_code:'06-100',description:'Supplier credit',subtotal_cents:10000,taxable:true,matches:[{order_id:c.order.id,receipt_id:c.receipts[0].id,cost_code:'06-100',amount_cents:10000}]}]}
  r=await c.ok('/costs/bills',credit);await c.ok(`/costs/bills/${r.record.id}/post`)
  r=await c.ledger();assert.equal(r.totals.posted_actual_cents,32000);assert.equal(r.totals.payable_cents,32000);assert.equal(r.totals.open_commitment_cents,70000);assert.equal(r.totals.received_not_billed_cents,20000)
  const bills=(await c.api(`/jobs/${c.job.id}/costs/bills`)).value.bills;assert.equal(bills.length,2);assert.equal(bills[0].lines[0].tax_cents,3000);assert.equal(bills[0].tax.verification,'Human reviewed; no provider verification');assert.equal(bills[0].document.checksum,bills[1].document.checksum)
  assert.equal((await c.act('/costs/bills',{...credit,reference:'synthetic-plinth-invalid-credit',lines:[{...credit.lines[0],subtotal_cents:50000,matches:[]}]})).status,409)
  assert.equal((await c.act('/costs/bills',{...c.bill('synthetic-plinth-invalid-document'),document:{...original,base64:Buffer.from('not a PDF').toString('base64')}})).status,400)
 }finally{await f.close()}
})
