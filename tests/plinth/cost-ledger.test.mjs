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
  assert.equal(claim.reconciliation.cost_ledger.totals.posted_actual_cents,43000,'Existing application reconciliation retains the code ledger snapshot')
  await c.ok(`/claims/${claim.id}/approve`);await c.ok(`/claims/${claim.id}/issue`)
  r=await c.ok('/invoices',{kind:'milestone',description:'Framing invoice',source_application_id:claim.id,recipient_email:'synthetic-plinth-client@example.com',due_on:'2026-11-23',terms:'Net 30'});const invoice=r.record
  await c.ok(`/invoices/${invoice.id}/issue`);await c.ok(`/invoices/${invoice.id}/receipt`,{confirm:true,method:'check',received_on:'2026-10-24',reference:'synthetic-plinth-payment-1',amount_cents:35000})
  r=await c.ledger();assert.equal(r.totals.client_billed_cents,70000,'Invoice never duplicates its application');assert.equal(r.totals.client_collected_cents,35000);assert.equal(row(r,'06-100').client_collected_cents,25000);assert.equal(row(r,'01-100').client_collected_cents,10000)
  for(const n of [1,2])await c.ok(`/invoices/${invoice.id}/receipt`,{confirm:true,method:'check',received_on:'2026-10-24',reference:'synthetic-plinth-penny-'+n,amount_cents:1})
  r=await c.ledger();assert.equal(r.totals.client_collected_cents,35002);assert.equal(row(r,'06-100').client_collected_cents,25001);assert.equal(row(r,'01-100').client_collected_cents,10001,'Cumulative allocation closes partial-receipt pennies across codes')
  await c.ok('/remittances',{confirm:true,method:'check',reference:'synthetic-plinth-unapplied-1',amount_cents:123,received_on:'2026-10-24',evidence:'Staff reviewed unallocated check',allocations:[]})
  r=await c.ledger();assert.equal(row(r,'Unassigned').client_collected_cents,123);assert.equal(r.totals.client_collected_cents,35125,'Unapplied remittance money is collected once, visibly Unassigned')
  const file=await f.request(`/api/plinth/jobs/${c.job.id}/costs/bills/${id}/original`,{cookie:f.owner});assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),costOriginal);assert.equal(file.headers.get('x-content-sha256').length,64)
  const audit=(await c.api(`/audit?job_id=${c.job.id}&q=cost.bill.original`)).value;assert.ok(audit.events.some(e=>e.action==='cost.bill.original'&&e.subject_id===id))
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

test('COST-002 — subcontract invoices bind exact released progress, preserve waiver gates and split gross actual from separately released supplier retainage',async()=>{
 const f=await createFixture();try{
  const c=await costFixture(f)
  let vendor=(await c.api('/vendors',{kind:'subcontractor',name:'Synthetic Framing Sub',trades:['Framing'],contacts:[]})).value.vendor
  assert.equal((await c.api(`/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Framing',status:'qualified',evidence:'synthetic-plinth-reviewed-sub'})).status,200)
  let r=await c.ok('/subcontracts',{vendor_id:vendor.id,trade:'Framing',scope:'Framing labor',contact_ids:[],awarded_on:'2026-10-23',amount_cents:80000});const sub=r.record
  await c.ok(`/subcontracts/${sub.id}/release`);await c.ok(`/subcontracts/${sub.id}/lien`,{state:'VT'})
  await c.ok(`/subcontracts/${sub.id}/retainage`,{contract_reference:'synthetic-plinth-supplier-retainage',rate_bps:1000,milestones:[{id:'frame',name:'Framing complete',completion_requirements:['Framing inspection'],waiver_requirements:[]}]})
  r=await c.ok(`/subcontracts/${sub.id}/draws`,{through_date:'2026-10-23',amount_cents:40000});const draw=r.record
  r=await c.ok('/orders',{supplier:vendor.name,description:'Framing subcontract progress',source:{kind:'award',subcontract_id:sub.id},lines:[{id:'work',cost_code:'06-100',description:'Framing scope',quantity:'10',unit:'lot',unit_cents:5000}]});const po=r.record
  await c.ok(`/orders/${po.id}/issue`);await c.ok(`/orders/${po.id}/receive`,{lines:[{line_id:'work',quantity:'10'}],reference:'synthetic-plinth-progress-receipt'});await c.read();const receipt=c.job.orders.find(o=>o.id===po.id).receipts[0]
  const bill={...c.bill('synthetic-plinth-sub-bill'),vendor:vendor.name,lines:[{cost_code:'06-100',description:'Reviewed progress',subtotal_cents:30000,taxable:false,matches:[{order_id:po.id,receipt_id:receipt.id,cost_code:'06-100',draw_id:draw.id,amount_cents:30000}]}]}
  assert.equal((await c.act('/costs/bills',bill)).value.error,'cost_waiver','Unresolved conditional waivers cannot be bypassed by matching a bill')
  await c.ok(`/subcontracts/${sub.id}/draws/${draw.id}/exception`,{reason:'Owner reviewed signed waiver exception for this exact progress draw'})
  r=await c.ok('/costs/bills',bill);const id=r.record.id;await c.ok(`/costs/bills/${id}/post`)
  let ledger=await c.ledger();assert.equal(ledger.totals.posted_actual_cents,30000);assert.equal(ledger.totals.supplier_retained_cents,3000);assert.equal(ledger.totals.payable_cents,27000)
  const over={...bill,reference:'synthetic-plinth-sub-over-progress',lines:[{...bill.lines[0],subtotal_cents:15000,matches:[{...bill.lines[0].matches[0],amount_cents:15000}]}]};assert.equal((await c.act('/costs/bills',over)).value.error,'cost_progress')
  await c.ok(`/subcontracts/${sub.id}/retainage/release`,{draw_id:draw.id,milestone_id:'frame',lines:[{draw_id:draw.id,amount_cents:4000}],completion_references:[{requirement:'Framing inspection',reference:'synthetic-plinth-frame-inspection'}],waiver_references:[]})
  ledger=await c.ledger();assert.equal(ledger.totals.supplier_retained_cents,0);assert.equal(ledger.totals.payable_cents,30000);assert.equal(ledger.totals.posted_actual_cents,30000,'Supplier release never posts another job cost')
  await c.ok(`/subcontracts/${sub.id}/draws/${draw.id}/payment`,{paid_on:'2026-10-24',amount_cents:40000,reference:'synthetic-plinth-recorded-sub-check'})
  ledger=await c.ledger();assert.equal(ledger.totals.recorded_supplier_payment_cents,30000);assert.equal(ledger.totals.payable_cents,0);assert.equal(ledger.totals.posted_actual_cents,30000,'Recorded supplier funds do not post another cost')
  assert.ok((await c.api(`/jobs/${c.job.id}/costs/exceptions`)).value.items.some(e=>e.kind==='unmatched_payment'&&e.amount_cents===10000))
 }finally{await f.close()}
})

test('Owner pre-draw reconciliation cites duplicate originals and unposted labor; reviewed MCP suggestions preserve every human financial gate',async()=>{
 const {reconciliationRequest,reviewReconciliation,mcp,nativeAgentPolicy}=await import('./reconciliation-support.mjs')
 const f=await createFixture({now:Date.parse('2026-10-23T12:00:00Z')});try{
  const c=await costFixture(f),ids=[]
  for(const reference of ['synthetic-plinth-reconcile-1','synthetic-plinth-reconcile-2'])ids.push((await c.ok('/costs/bills',c.bill(reference))).record.id)
  const source=(await c.ok('/costs/sources',{kind:'time',reference:'synthetic-plinth-unposted-crew-day',employee_reference:'synthetic-plinth-private-worker',cost_code:'01-100',dated_on:'2026-10-23',period:'2026-10',minutes:480,hour_cents:3000,burden_bps:2000})).record
  const before=await c.ledger(),exceptions=(await c.api(`/jobs/${c.job.id}/costs/exceptions`)).value,packet=await reconciliationRequest(c)
  const duplicate=packet.findings.find(f=>f.kind==='suspected_duplicate'),labor=packet.findings.find(f=>f.kind==='unposted_labor'),coding=packet.findings.filter(f=>f.kind==='coding'),receipts=packet.findings.filter(f=>f.kind==='unmatched_receipt')
  assert.equal(duplicate.amount_cents,43000);assert.deepEqual(duplicate.evidence.map(e=>e.id),ids);assert.equal(new Set(duplicate.evidence.map(e=>e.checksum)).size,1)
  assert.equal(labor.amount_cents,28800,'Eight hours at 3000 cents plus 20 percent burden is a candidate, never actual');assert.equal(labor.evidence[0].id,source.id)
  assert.equal(receipts.reduce((n,r)=>n+r.amount_cents,0),50000,'Draft duplicate matches never consume receipts');assert.deepEqual(receipts.flatMap(r=>r.evidence.filter(e=>e.kind==='receipt_quantity').map(e=>e.quantity)),['3','2'])
  assert.equal(coding.length,2);assert.ok(packet.uncertainties.some(s=>s.includes('overlap')))
  assert.ok(!JSON.stringify(packet).includes('synthetic-plinth-private-worker'));assert.ok(!JSON.stringify(packet).includes('hour_cents'))
  const token=await f.agent();await nativeAgentPolicy(f)
  const args={job_id:c.job.id,packet_id:packet.id,digest:packet.digest,idempotency_key:'synthetic-plinth-reconcile-request'}
  let response=await mcp(f,token,'plinth.costs.reconcile',args);assert.equal(response.value.result.isError,true,'Unreviewed native facts cannot be consumed')
  await reviewReconciliation(c,packet,[duplicate,labor])
  response=await mcp(f,token,'plinth.costs.reconcile',args);assert.equal(response.value.result.isError,false,JSON.stringify(response.value));const proposed=response.value.result.structuredContent.record;await c.read()
  assert.deepEqual(proposed.findings.map(f=>f.kind),['suspected_duplicate','unposted_labor'],'Withheld coding and receipt findings never enter the adapter')
  const version=c.job.version,replay=await mcp(f,token,'plinth.costs.reconcile',args);assert.deepEqual(replay.value.result.structuredContent,response.value.result.structuredContent);await c.read();assert.equal(c.job.version,version,'Replay cannot append or post again')
  await c.ok(`/cost-reconciliation/${packet.id}/decide`,{digest:packet.digest,proposal_id:proposed.id,finding_id:duplicate.id,decision:'rejected',reason:'Identical scan was an intentional split; staff must retain both originals'})
  await c.ok(`/cost-reconciliation/${packet.id}/decide`,{digest:packet.digest,proposal_id:proposed.id,finding_id:labor.id,decision:'accepted',reason:'Valid time source needs independent human approval'})
  assert.equal((await c.ledger()).totals.posted_actual_cents,0,'Accepting a suggestion grants no posting authority')
  assert.deepEqual((await c.api(`/jobs/${c.job.id}/costs/exceptions`)).value.items,exceptions.items,'Diagnostic and suggestion review clear no exception')
  for(const [name,input] of [['plinth.costs.post',{bill_id:ids[0]}],['plinth.payments.send',{amount_cents:43000}]])assert.equal((await mcp(f,token,name,{job_id:c.job.id,...input,idempotency_key:name})).value.result?.isError??true,true)
  assert.equal((await c.act(`/costs/bills/${ids[0]}/post`,{},undefined,token)).status,403)
  assert.equal((await c.act(`/costs/sources/${source.id}/approve`,{},undefined,token)).status,403)
  const client=await f.invite(['synthetic-plinth-client','example.com'].join('@')),admin=await f.invite(['synthetic-plinth-reconcile-admin','example.com'].join('@'),'Office','admin')
  for(const credentials of [{cookie:client},{cookie:admin},{token},{}])assert.ok([401,403].includes((await f.request(`/api/plinth/jobs/${c.job.id}/cost-reconciliation`,credentials)).status))
  const other=(await c.api('/jobs',{name:'Other private job',client_email:['synthetic-plinth-other','example.com'].join('@'),address:'Other site'})).value.job
  assert.equal((await mcp(f,token,'plinth.costs.reconcile',{...args,job_id:other.id,idempotency_key:'synthetic-plinth-cross-job'})).value.result.isError,true)
  assert.equal((await c.ledger()).totals.posted_actual_cents,before.totals.posted_actual_cents)
  const current=(await c.api(`/jobs/${c.job.id}/cost-reconciliation`)).value.packets[0];assert.equal(current.decisions.length,2);assert.equal(current.decisions[0].decision,'rejected');assert.equal(current.proposals.length,1)
  await c.ok(`/cost-reconciliation/${packet.id}/revoke`,{digest:packet.digest,reason:'Owner withdraws packet access'})
  assert.equal((await mcp(f,token,'plinth.costs.reconcile',{...args,idempotency_key:'synthetic-plinth-after-revoke'})).value.result.isError,true)
  assert.equal((await mcp(f,token,'plinth.costs.reconcile',args)).value.result.isError,true,'Packet revocation also fences cached replay')
  const fresh=await reconciliationRequest(c);await reviewReconciliation(c,fresh)
  await c.ok(`/costs/sources/${source.id}/approve`)
  assert.equal((await mcp(f,token,'plinth.costs.reconcile',{...args,packet_id:fresh.id,digest:fresh.digest,idempotency_key:'synthetic-plinth-stale-source'})).value.result.isError,true)
  const regenerated=await reconciliationRequest(c);assert.equal(regenerated.findings.filter(f=>f.kind==='unposted_labor').length,0);assert.equal(regenerated.ledger.posted_actual_cents,28800)
  const credential=(await c.api('/agent-credentials')).value.credentials[0]
  assert.equal((await c.api('/agent-credentials/'+credential.id+'/revoke',{})).status,200)
  assert.equal((await mcp(f,token,'plinth.costs.reconcile',args)).status,401,'Revoked credentials cannot replay a prior result')
  const bills=(await c.api(`/jobs/${c.job.id}/costs/bills`)).value.bills;assert.ok(bills.every(b=>b.status==='draft'));for(const id of ids){const r=await f.request(`/api/plinth/jobs/${c.job.id}/costs/bills/${id}/original`,{cookie:f.owner});assert.deepEqual(Buffer.from(await r.arrayBuffer()),costOriginal)}
 }finally{await f.close()}
})
