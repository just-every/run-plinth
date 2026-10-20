import test from 'node:test'
import assert from 'node:assert/strict'
import {createFixture} from './helpers.mjs'

test('BILL-002 — numbered deposit and milestone invoices retain reviewed source tax, bank evidence, unearned liability, partial allocations and independent client/delivery history',async()=>{
 const f=await createFixture()
 try {
  const client=await f.invite('invoice-client@example.com'),foreign=await f.invite('invoice-other@example.com'),agent=await f.agent()
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{...(body===undefined?{}:{method:'POST',body}),cookie,token})
  let job=(await api('/jobs',{name:'Maple Street deposit and framing milestone',client_email:'invoice-client@example.com',address:'2480 Maple Street, Burlington, VT 05401',time_zone:'America/New_York'})).value.job
  const act=async(path,body={},cookie=f.owner,token)=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie,token);if(r.value.job&&cookie===f.owner&&!token)job=r.value.job;return r}
  const read=async()=>job=(await api(`/jobs/${job.id}`)).value.job
  assert.equal((await act('/quotes',{lines:[{id:'material',description:'Framing material',cost_code:'06-100',phase:'Framing',category:'material',quantity:'1',unit:'job',unit_cents:1000000,cost_unit_cents:750000},{id:'labor',description:'Framing labor',cost_code:'06-200',phase:'Framing',category:'labor',quantity:'1',unit:'job',unit_cents:1000000,cost_unit_cents:600000}]})).status,200)
  const rate=(await api('/pricing-rates',{jurisdiction:'Human-reviewed fixture jurisdiction',kind:'sales',percent:'10',effective_on:'2026-01-01',reference:'Reviewed fixture taxable materials and labor exemption',human_reviewed:true})).value.rate
  const price={basis:'sell',as_of:'2026-10-21',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['material'],exemption_reference:'Reviewed labor exemption'}}
  let r=await act('/pricing/preview',price);assert.equal(r.status,200);assert.equal((await act('/pricing/apply',{...price,digest:r.value.preview.digest})).status,200)
  assert.equal((await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Externally signed contract with fixed deposit and framing milestone',schedule_choice:{kind:'none',reason:'Construction dates planned separately'}})).status,200)
  await act('/sov',{})
  const terms={recipient_email:'invoice-client@example.com',due_on:'2026-11-01',terms:'Bank/check within 14 calendar days of invoice; client retainage per signed agreement'}
  const depositInput={...terms,kind:'deposit',description:'Signed contract deposit',amount_cents:200000}
  assert.equal((await act('/invoices',{...depositInput,recipient_email:'unassigned@example.com'})).status,403)
  r=await act('/invoices',depositInput);assert.equal(r.status,200);const depositId=r.value.record.id
  for(const auth of [{cookie:client},{cookie:undefined,token:agent}])assert.equal((await act(`/invoices/${depositId}/issue`,{},auth.cookie,auth.token)).status,403)
  assert.equal((await act(`/invoices/${depositId}/issue`)).status,200)
  const issuedDeposit=structuredClone(job.invoices.find(i=>i.id===depositId).issued);assert.equal(issuedDeposit.earned_revenue_cents,0);assert.equal(issuedDeposit.gross_cents,200000);assert.equal(job.invoice_deposit_liability_cents,0)
  assert.equal((await act(`/invoices/${depositId}/issue`)).status,409)
  assert.equal((await act(`/invoices/${depositId}/send`,{confirm:true})).status,200);assert.equal(job.invoices.find(i=>i.id===depositId).delivery.status,'accepted');assert.equal(f.messages.at(-1).to[0],'invoice-client@example.com');assert.equal(job.invoice_deposit_liability_cents,0,'BILL-002 mail acceptance is not funds')
  assert.equal((await act(`/invoices/${depositId}/send`,{confirm:true})).status,409,'BILL-002 one durable mail attempt cannot silently resend')
  const acknowledgment=await act(`/invoices/${depositId}/accept`,{confirm:true,statement:'I acknowledge this exact deposit invoice'},client);assert.equal(acknowledgment.status,200);assert.ok(!JSON.stringify(acknowledgment.value.record).includes('cost_unit_cents'));assert.ok(!JSON.stringify(acknowledgment.value.record).includes('Reviewed fixture taxable materials')); await read();assert.equal(job.invoice_deposit_liability_cents,0,'BILL-002 client acknowledgment is not payment')
  const receipt={amount_cents:200000,received_on:'2026-10-22',reference:'Bank statement reference BS-104, human checked',method:'bank',confirm:true}
  for(const auth of [{cookie:client},{cookie:undefined,token:agent}])assert.equal((await act(`/invoices/${depositId}/receipt`,receipt,auth.cookie,auth.token)).status,403)
  assert.equal((await act(`/invoices/${depositId}/receipt`,{...receipt,confirm:false})).status,400)
  assert.equal((await act(`/invoices/${depositId}/receipt`,receipt)).status,200);assert.equal(job.invoice_deposit_liability_cents,200000);assert.equal(job.invoices.find(i=>i.id===depositId).balance.due_cents,0)
  assert.equal((await act(`/invoices/${depositId}/receipt`,receipt)).status,409,'BILL-002 replayed bank receipt creates no second liability')
  const milestoneConfig={contract_reference:'Signed contract client retainage section 9',rules:[{line_id:'quote:material',work_bps:500,stored_bps:500},{line_id:'quote:labor',work_bps:500,stored_bps:500}],milestones:[{id:'substantial',name:'Framing substantial completion',completion_requirements:['Framing inspection'],waiver_requirements:[]}]}
  assert.equal((await act('/retainage',milestoneConfig)).status,200)
  r=await act('/claims',{description:'Framing 50% progress application',lines:[{line_id:'quote:material',completed_cents:550000,stored_cents:0,evidence:'Framing materials installed and inspected'},{line_id:'quote:labor',completed_cents:500000,stored_cents:0,evidence:'Superintendent reviewed half-complete labor scope'}]});assert.equal(r.status,200);const appId=r.value.record.id
  assert.equal((await act(`/claims/${appId}/approve`)).status,200);assert.equal((await act(`/claims/${appId}/issue`)).status,200)
  r=await act('/invoices',{...terms,kind:'milestone',description:'Fixed framing milestone',source_application_id:appId});assert.equal(r.status,200);const milestoneId=r.value.record.id
  assert.equal((await act(`/invoices/${milestoneId}/issue`)).status,200)
  const milestone=job.invoices.find(i=>i.id===milestoneId),original=structuredClone(milestone.issued)
  assert.equal(Number(milestone.number.split('-').at(-1)),Number(issuedDeposit.number.split('-').at(-1))+1,'BILL-002 install-wide issued invoice numbers are sequential')
  assert.equal(original.gross_cents,1050000);assert.equal(original.tax_cents,50000);assert.equal(original.subtotal_cents,1000000);assert.equal(original.withheld_cents,52500);assert.equal(original.payable_cents,997500);assert.equal(original.earned_revenue_cents,1000000)
  assert.equal(original.sources.original_budget.revision,1);assert.equal(original.sources.contract.quote.pricing.tax.rate.reference,rate.revisions[0].reference)
  const allocation={deposit_invoice_id:depositId,amount_cents:100000}
  assert.equal((await act(`/invoices/${milestoneId}/apply-deposit`,{...allocation,amount_cents:200001})).status,409)
  assert.equal((await act(`/invoices/${milestoneId}/apply-deposit`,allocation)).status,200)
  assert.equal(job.invoice_deposit_liability_cents,100000);assert.equal(job.invoices.find(i=>i.id===milestoneId).balance.due_cents,897500)
  assert.equal((await act(`/invoices/${milestoneId}/apply-deposit`,allocation)).status,409,'BILL-002 replayed allocation cannot spend a deposit twice')
  assert.equal((await act(`/invoices/${milestoneId}/receipt`,{amount_cents:97500,received_on:'2026-10-25',reference:'Check 1047 entered against framing invoice',method:'check',confirm:true})).status,200)
  assert.equal(job.invoices.find(i=>i.id===milestoneId).balance.due_cents,800000);assert.deepEqual(job.invoices.find(i=>i.id===milestoneId).issued,original,'BILL-002 settlements never rewrite the original issued invoice')
  assert.equal((await act('/retainage/release',{claim_id:appId,milestone_id:'substantial',lines:[{line_id:'quote:material',amount_cents:10000}],completion_references:[{requirement:'Framing inspection',reference:'Signed framing inspection FI-104'}],waiver_references:[]})).status,200)
  assert.equal(job.invoices.find(i=>i.id===milestoneId).balance.released_retainage_cents,10000);assert.equal(job.invoices.find(i=>i.id===milestoneId).balance.due_cents,810000);assert.deepEqual(job.invoices.find(i=>i.id===milestoneId).issued,original)
  assert.equal((await act('/invoices',{...terms,kind:'milestone',description:'Duplicate framing',source_application_id:appId})).status,409)
  const added={description:'Signed added mudroom scope',direction:'charge',basis:'sell',as_of:'2026-10-21',lines:[{id:'mudroom',description:'Added mudroom finish',cost_code:'09-100',phase:'Added scope',category:'material',quantity:'1',unit:'job',unit_cents:300000,cost_unit_cents:200000}],rules:[],tax:{rate_id:rate.id,taxable_line_ids:['mudroom']}}
  r=await act('/variation-pricing/preview',added);assert.equal(r.status,200);assert.equal((await act('/variation-pricing/apply',{...added,digest:r.value.preview.digest})).status,200)
  assert.equal((await act(`/variations/${job.variations.at(-1).id}/approve`,{},client)).status,200);await read()
  r=await act('/invoices',{...depositInput,description:'Approved added-scope deposit',amount_cents:2000000});assert.equal(r.status,200,'BILL-002 later deposits use the current approved contract, including changes')
  assert.equal((await act(`/invoices/${r.value.record.id}/issue`)).status,200)
  assert.equal(job.invoices.at(-1).issued.sources.current_budget.contract_cents,2430000);assert.equal(job.invoices.at(-1).issued.sources.contract.variations.length,1)
  const visible=(await api(`/jobs/${job.id}`,undefined,client)).value.job
  assert.equal(visible.invoices.length,3);assert.equal(visible.invoices.find(i=>i.id===milestoneId).balance.due_cents,810000)
  for(const secret of ['cost_unit_cents','source_digest','Reviewed fixture taxable materials','Framing materials installed and inspected'])assert.ok(!JSON.stringify(visible).includes(secret),'BILL-002 client invoice projections exclude office costs and source evidence')
  for(const ext of ['json','html','csv']){const path=`/api/plinth/jobs/${job.id}/invoices/${milestoneId}/document.${ext}`;assert.equal((await f.request(path,{cookie:client})).status,200);assert.equal((await f.request(path,{cookie:foreign})).status,404);assert.equal((await f.request(path,{token:agent})).status,403)}
  assert.ok(job.approvals.some(a=>a.kind==='invoice.issue')&&job.approvals.some(a=>a.kind==='invoice.receipt')&&job.approvals.some(a=>a.kind==='invoice.apply_deposit')&&job.approvals.some(a=>a.kind==='invoice.accept'))
 } finally {await f.close()}
})
