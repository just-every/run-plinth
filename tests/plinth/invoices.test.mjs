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

test('BILL-006 — one recorded bank remittance pays multiple milestones, retains unapplied cash and reverses a return without rewriting issued history',async()=>{
 const f=await createFixture()
 try {
  const client=await f.invite('remittance-client@example.com'),other=await f.invite('remittance-other@example.com'),agent=await f.agent()
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{...(body===undefined?{}:{method:'POST',body}),cookie,token})
  let job=(await api('/jobs',{name:'Maple Street $480,000 remodel with staged ACH remittance',client_email:'remittance-client@example.com',address:'2480 Maple Street, Burlington, VT 05401',time_zone:'America/New_York'})).value.job
  const act=async(path,body={})=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});assert.equal(r.status,200,JSON.stringify(r.value));job=r.value.job;return r.value.record}
  const attempt=(path,body={},cookie=f.owner,token)=>api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie,token)
  await act('/quotes',{lines:[{id:'remodel',description:'Contracted whole-home remodel',cost_code:'01-100',category:'labor',phase:'Remodel',quantity:'1',unit:'job',unit_cents:48000000,cost_unit_cents:32000000}]})
  const rate=(await api('/pricing-rates',{jurisdiction:'Staff-reviewed fixture jurisdiction',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'Reviewed fixture exemption schedule',human_reviewed:true})).value.rate
  const price={basis:'sell',as_of:'2026-10-21',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['remodel']}}
  const preview=await attempt('/pricing/preview',price);assert.equal(preview.status,200)
  await act('/pricing/apply',{...price,digest:preview.value.preview.digest})
  await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Externally signed $480,000 remodel agreement',schedule_choice:{kind:'none',reason:'Schedule planned separately'}})
  await act('/sov',{})
  await act('/retainage',{contract_reference:'Signed agreement five percent withholding',rules:[{line_id:'quote:remodel',work_bps:500,stored_bps:500}],milestones:[{id:'completion',name:'Substantial completion',completion_requirements:['Final inspection'],waiver_requirements:[]}]})
  const ids=[]
  for(const [n,due_on] of ['2026-11-01','2026-12-01','2027-01-01'].entries()){
   const claim=await act('/claims',{description:'Progress draw '+(n+1),lines:[{line_id:'quote:remodel',completed_cents:12000000*(n+1),stored_cents:0,evidence:'Superintendent recorded completed work stage '+(n+1)}]})
   await act(`/claims/${claim.id}/approve`);await act(`/claims/${claim.id}/issue`)
   const invoice=await act('/invoices',{kind:'milestone',source_application_id:claim.id,description:'Milestone '+(n+1),recipient_email:'remittance-client@example.com',due_on,terms:'Bank/check per signed agreement'})
   await act(`/invoices/${invoice.id}/issue`);ids.push(invoice.id)
  }
  const originals=job.invoices.map(i=>structuredClone(i.issued))
  const deposit=await act('/invoices',{kind:'deposit',description:'Separate unearned deposit request',recipient_email:'remittance-client@example.com',due_on:'2026-12-01',terms:'Deposit request only',amount_cents:10000})
  await act(`/invoices/${deposit.id}/issue`)
  const draft=await act('/invoices',{kind:'deposit',description:'Unissued draft stays out of aging',recipient_email:'remittance-client@example.com',due_on:'2026-12-01',terms:'Draft only',amount_cents:10000})
  const input={amount_cents:24000000,received_on:'2026-11-02',reference:'Bank statement ACH trace BS-104',evidence:'Staff compared bank posting with client remittance covering two draws; overpayment retained',method:'bank',confirm:true,allocations:ids.slice(0,2).map(invoice_id=>({invoice_id,amount_cents:11400000}))}
  const unchanged=async(path,body,status)=>{const before=structuredClone(job),r=await attempt(path,body);assert.equal(r.status,status,JSON.stringify(r.value));assert.deepEqual((await api(`/jobs/${job.id}`)).value.job,before,'Refusal leaves every ledger and approval unchanged')}
  await unchanged('/remittances',{...input,confirm:false},400)
  await unchanged('/remittances',{...input,amount_cents:1.5},400)
  await unchanged('/remittances',{...input,received_on:'2026-02-30'},400)
  await unchanged('/remittances',{...input,allocations:[input.allocations[0],input.allocations[0]]},400)
  await unchanged('/remittances',{...input,allocations:[{invoice_id:ids[0],amount_cents:11400001}]},409)
  await unchanged('/remittances',{...input,allocations:[{invoice_id:ids[0],amount_cents:1},{invoice_id:ids[1],amount_cents:11400001}]},409)
  await unchanged('/remittances',{...input,allocations:[{invoice_id:deposit.id,amount_cents:1}]},409)
  await unchanged('/remittances',{...input,allocations:[{invoice_id:draft.id,amount_cents:1}]},409)
  await unchanged('/remittances',{...input,allocations:[{invoice_id:crypto.randomUUID(),amount_cents:1}]},404)
  for(const auth of [{cookie:client},{cookie:other},{cookie:undefined,token:agent}])assert.equal((await attempt('/remittances',input,auth.cookie,auth.token)).status,auth.cookie===other?404:403)
  const schema=await api('/reports/fields',{expected_version:0,record_scope:'financial',name:'Bank reconciliation reference',type:'text',required_at_stages:['recorded','returned']});assert.equal(schema.status,201)
  const fieldId=schema.value.fields[0].id
  await unchanged('/remittances',input,409)
  input.custom_fields={[fieldId]:'Staff reconciled statement BS-104'}
  const recorded=await act('/remittances',input),remittanceId=recorded.id
  const financialPath=`/reports/values/financial/${job.id}:remittance:${remittanceId}`
  const custom=(await api(financialPath)).value.record;assert.equal(custom.values[fieldId],'Staff reconciled statement BS-104')
  assert.equal(recorded.amount_cents,24000000);assert.equal(recorded.allocations.length,2)
  assert.deepEqual(job.invoices.slice(0,3).map(i=>i.balance.due_cents),[0,0,11400000])
  assert.equal(job.invoice_deposit_liability_cents,0,'Unapplied remittance is separate from unearned deposit liability')
  assert.deepEqual(job.invoices.slice(0,3).map(i=>i.issued),originals)
  await unchanged('/remittances',{...input,reference:input.reference.toLowerCase()},409)
  await unchanged(`/invoices/${ids[2]}/receipt`,{amount_cents:1,received_on:'2026-11-03',reference:input.reference,method:'bank',confirm:true},409)
  const report=async(as_of='2026-12-01')=>{const r=await api(`/jobs/${job.id}/receivables?as_of=${as_of}`);assert.equal(r.status,200);return r.value}
  let ledger=await report();assert.equal(ledger.unapplied_cents,1200000);assert.equal(ledger.received_cents,22800000);assert.equal(ledger.due_cents,11400000);assert.equal(ledger.held_retainage_cents,1800000)
  assert.equal(ledger.invoices.length,4,'Draft invoice excluded; deposit request identified separately')
  assert.equal(ledger.invoices.find(i=>i.invoice_id===ids[0]).days_overdue,30)
  assert.equal(ledger.invoices.find(i=>i.invoice_id===ids[0]).bucket,'1-30');assert.equal(ledger.invoices.find(i=>i.invoice_id===ids[1]).bucket,'current','Due date is inclusive')
  await unchanged(`/remittances/${remittanceId}/allocate`,{confirm:true,applied_on:'2026-11-01',allocations:[{invoice_id:ids[2],amount_cents:1200000}]},400)
  await unchanged(`/remittances/${remittanceId}/allocate`,{confirm:true,applied_on:'2026-11-03',allocations:[{invoice_id:ids[2],amount_cents:1200001}]},409)
  await act(`/remittances/${remittanceId}/allocate`,{confirm:true,applied_on:'2026-11-03',allocations:[{invoice_id:ids[2],amount_cents:1200000}]})
  ledger=await report();assert.equal(ledger.unapplied_cents,0);assert.equal(ledger.due_cents,10200000);assert.equal(ledger.received_cents,24000000)
  await unchanged(`/remittances/${remittanceId}/allocate`,{confirm:true,applied_on:'2026-11-03',allocations:[{invoice_id:ids[2],amount_cents:1}]},409)
  const originalAllocations=structuredClone(job.remittances[0].allocations)
  await unchanged(`/remittances/${remittanceId}/return`,{confirm:true,returned_on:'2026-11-02',reference:'Return BS-105',reason:'ACH returned by bank'},400)
  const returned=await act(`/remittances/${remittanceId}/return`,{confirm:true,returned_on:'2026-11-04',reference:'Bank return trace BS-105',reason:'Staff recorded bank notice: ACH returned'})
  assert.equal((await api(financialPath)).value.record.stage,'returned');assert.equal((await api(financialPath)).value.record.values[fieldId],'Staff reconciled statement BS-104');
  assert.equal(returned.returned.amount_cents,24000000);assert.deepEqual(returned.allocations,originalAllocations)
  ledger=await report();assert.equal(ledger.unapplied_cents,0);assert.equal(ledger.received_cents,0);assert.equal(ledger.due_cents,34200000);assert.equal(ledger.held_retainage_cents,1800000)
  assert.deepEqual(ledger.aging,{'current':22800000,'1-30':11400000,'31-60':0,'61-90':0,'91+':0})
  assert.equal((await report('2026-12-02')).aging['31-60'],11400000,'Thirty-one days starts next bucket')
  assert.equal((await report('2026-12-31')).aging['31-60'],11400000,'Sixty days stays in second overdue bucket')
  assert.equal((await report('2027-01-01')).aging['61-90'],11400000)
  assert.equal((await report('2027-01-30')).aging['61-90'],11400000,'Ninety days stays in third bucket')
  assert.equal((await report('2027-01-31')).aging['91+'],11400000)
  for(const invoice of job.invoices.slice(0,3)){assert.equal(invoice.receipts.length,2);assert.equal(invoice.receipts[1].reversal_of,invoice.receipts[0].id);assert.equal(invoice.receipts[1].amount_cents,-invoice.receipts[0].amount_cents);assert.match(invoice.receipts[1].label,/Return recorded by staff/)}
  assert.deepEqual(job.invoices.slice(0,3).map(i=>i.issued),originals)
  await unchanged(`/remittances/${remittanceId}/return`,{confirm:true,returned_on:'2026-11-04',reference:'Duplicate return',reason:'Retry'},409)
  await unchanged(`/remittances/${remittanceId}/allocate`,{confirm:true,applied_on:'2026-11-05',allocations:[{invoice_id:ids[2],amount_cents:1}]},409)
  for(const auth of [{cookie:client},{cookie:other},{cookie:undefined,token:agent}])assert.equal((await api(`/jobs/${job.id}/receivables`,undefined,auth.cookie,auth.token)).status,auth.cookie===other?404:403)
  assert.equal((await f.json(`/api/plinth/jobs/${job.id}/receivables`)).status,401)
  assert.equal((await api(`/jobs/${job.id}/receivables?as_of=2026-02-30`)).status,400)
  for(const path of [`/jobs/${job.id}`,'/jobs']){const value=(await api(path,undefined,client)).value,shown=value.job??value.jobs.find(j=>j.id===job.id);assert.equal(shown.remittances,undefined);assert.equal(JSON.stringify(shown).includes(input.evidence),false);assert.equal(shown.invoices[0].balance.received_cents,0)}
  const path=`/api/plinth/jobs/${job.id}/remittances`,version=job.version,second={...input,amount_cents:10000,reference:'Second remittance held as unapplied cash',allocations:[]}
  const races=await Promise.all([1,2].map(()=>f.json(path,{method:'POST',cookie:f.owner,body:{expected_version:version,...second}})))
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);job=(await api(`/jobs/${job.id}`)).value.job
  assert.equal(job.remittances.length,2);assert.equal((await report()).unapplied_cents,10000)
  const receipt=job.remittances.at(-1)
  await act(`/remittances/${receipt.id}/return`,{confirm:true,returned_on:'2026-11-05',reference:'Unapplied bank return',reason:'Bank returned the entirely unapplied amount'})
  assert.equal((await report()).unapplied_cents,0)
  // Direct invoice receipts predate cross-invoice remittances and need their own return door.
  const milestonePath=`/invoices/${ids[0]}`,depositPath=`/invoices/${deposit.id}`
  const beforeReturnHtml=await (await f.request(`/api/plinth/jobs/${job.id}${milestonePath}/document.html`,{cookie:f.owner})).text()
  await act(`${milestonePath}/receipt`,{amount_cents:10000,received_on:'2026-11-06',reference:'Legacy single-invoice check 1204',method:'check',confirm:true})
  const originalReceipt=structuredClone(job.invoices[0].receipts.at(-1))
  const returnInput={receipt_id:originalReceipt.id,returned_on:'2026-11-07',reference:'Bank returned check 1204',reason:'Staff reviewed returned-check notice; private bank correspondence',confirm:true}
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,confirm:false},400)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,returned_on:'2026-02-30'},400)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,returned_on:'2026-11-05'},400)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,reason:''},400)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,amount_cents:5000},400)
  await unchanged(`${depositPath}/return-receipt`,returnInput,404)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,receipt_id:job.invoices[0].receipts[0].id},409)
  for(const auth of [{cookie:client},{cookie:other},{cookie:undefined,token:agent}])assert.equal((await attempt(`${milestonePath}/return-receipt`,returnInput,auth.cookie,auth.token)).status,auth.cookie===other?404:403)
  assert.equal((await f.json(`/api/plinth/jobs/${job.id}${milestonePath}/return-receipt`,{method:'POST',body:{expected_version:job.version,...returnInput}})).status,401)
  assert.equal((await f.json(`/api/plinth/jobs/${job.id}${milestonePath}/return-receipt`,{method:'POST',cookie:f.owner,headers:{origin:'https://foreign.example'},body:{expected_version:job.version,...returnInput}})).status,403)
  const raceVersion=job.version
  const returns=await Promise.all([1,2].map(()=>attempt(`${milestonePath}/return-receipt`,{...returnInput,expected_version:raceVersion})))
  assert.deepEqual(returns.map(r=>r.status).sort(),[200,409],'Concurrent returns append only one reversal')
  job=(await api(`/jobs/${job.id}`)).value.job
  const reversed=job.invoices[0].receipts.at(-1)
  assert.deepEqual(job.invoices[0].receipts.at(-2),originalReceipt,'The positive original remains immutable')
  assert.equal(reversed.reversal_of,originalReceipt.id);assert.equal(reversed.amount_cents,-10000);assert.equal(reversed.method,'check')
  assert.equal(reversed.recorded_by.id,job.created_by.id);assert.match(reversed.label,/Return recorded by staff/)
  const returnApproval=job.approvals.at(-1)
  assert.equal(returnApproval.kind,'invoice.receipt_return');assert.equal(returnApproval.snapshot.reason,returnInput.reason)
  assert.equal(returnApproval.snapshot.receipt.id,originalReceipt.id);assert.equal(returnApproval.snapshot.reversal.id,reversed.id)
  assert.ok(returnApproval.approved_by.at)
  assert.equal((await report()).received_cents,0);assert.equal((await report()).due_cents,34200000)
  await unchanged(`${milestonePath}/return-receipt`,returnInput,409)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,receipt_id:reversed.id},409)
  assert.deepEqual(job.invoices.slice(0,3).map(i=>i.issued),originals)
  assert.equal(await (await f.request(`/api/plinth/jobs/${job.id}${milestonePath}/document.html`,{cookie:f.owner})).text(),beforeReturnHtml)

  // Return an unallocated deposit receipt without spending the liability already applied to a draw.
  await act(`${depositPath}/receipt`,{amount_cents:4000,received_on:'2026-11-06',reference:'Deposit bank posting DP-1',method:'bank',confirm:true})
  const retainedDepositReceipt=job.invoices.find(i=>i.id===deposit.id).receipts.at(-1)
  await act(`${depositPath}/receipt`,{amount_cents:6000,received_on:'2026-11-06',reference:'Deposit bank posting DP-2',method:'bank',confirm:true})
  const freeDepositReceipt=structuredClone(job.invoices.find(i=>i.id===deposit.id).receipts.at(-1))
  await act(`${milestonePath}/apply-deposit`,{deposit_invoice_id:deposit.id,amount_cents:4000})
  const depositApplications=structuredClone(job.invoices[0].deposit_applications),depositIssue=structuredClone(job.invoices.find(i=>i.id===deposit.id).issued)
  await act(`${depositPath}/return-receipt`,{...returnInput,receipt_id:freeDepositReceipt.id,reference:'Bank returned deposit DP-2'})
  assert.equal(job.invoice_deposit_liability_cents,0)
  assert.equal(job.invoices.find(i=>i.id===deposit.id).balance.received_cents,4000)
  assert.equal(job.invoices.find(i=>i.id===deposit.id).balance.due_cents,6000)
  assert.deepEqual(job.invoices[0].deposit_applications,depositApplications)
  assert.deepEqual(job.invoices.find(i=>i.id===deposit.id).issued,depositIssue)
  await unchanged(`${depositPath}/return-receipt`,{...returnInput,receipt_id:retainedDepositReceipt.id,reference:'Bank returned allocated deposit DP-1'},409)
  await unchanged(`${depositPath}/return-receipt`,{...returnInput,receipt_id:freeDepositReceipt.id},409)
  assert.equal((await report()).due_cents,34196000,'A deposit return never undoes a funded draw allocation')
  for(const path of [`/jobs/${job.id}`,'/jobs']){
   const value=(await api(path,undefined,client)).value,shown=value.job??value.jobs.find(j=>j.id===job.id)
   assert.equal(JSON.stringify(shown).includes(returnInput.reason),false,'Private return reason remains outside client projections')
   assert.equal(shown.invoices.find(i=>i.id===ids[0]).receipts.at(-1).amount_cents,-10000)
  }
  assert.equal(f.messages.filter(m=>m.subject?.includes('Receipt')).length,0,'Recording or returning funds never sends a receipt or contacts the client')
 } finally {await f.close()}
})
