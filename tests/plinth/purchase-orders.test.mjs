import { submittalFixture } from './submittal-support.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from './helpers.mjs'

test('SUB-005 — itemized cost-coded vendor PO from the budget: acknowledgment, changed promise, shipment, partial receipt, damage return, reviewed amendment, cancellation and reconciliation', async () => {
 const f = await createFixture()
 try {
  const agent = await f.agent(), client = await f.invite('po-client@example.com')
  const api = (path, body, { method = 'POST', cookie = f.owner, token } = {}) => f.json('/api/plinth' + path, { method, ...(token ? { token } : { cookie }), ...(body ? { body } : {}) })
  let r = await api('/jobs', { name: 'Stowe kitchen cabinets', client_email: 'po-client@example.com', address: '9 Mountain Road, Stowe, VT' }); let job = r.value.job
  const act = async (path, body = {}, credentials) => { const result = await api(`/jobs/${job.id}${path}`, { expected_version: job.version, ...body }, credentials); if (result.status === 200) job = result.value.job; return result }
  const quoteLine = (id, cost_code, cost, sell) => ({ id, description: `${cost_code} scope`, cost_code, phase: 'Finishes', category: 'material', quantity: 1, unit: 'each', rate_unit: 'each', cost_unit_cents: cost, unit_cents: sell })
  r = await act('/quotes', { lines: [quoteLine('cab', '12-350', 600_000, 900_000), quoteLine('elec', '26-100', 200_000, 300_000)] }); assert.equal(r.status, 200, JSON.stringify(r.value))
  r = await act(`/quotes/${job.quotes[0].id}/accept`, { method: 'signed',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'}, evidence: 'Signed proposal' }); assert.equal(r.status, 200)

  // An itemized, cost-coded PO prepared against the accepted budget.
  const lines = [{ id: 'base', description: 'Base cabinets', cost_code: '12-350', quantity: '10', unit: 'each', unit_cents: 30_000 }, { id: 'pulls', description: 'Cabinet pulls', cost_code: '12-350', quantity: '40', unit: 'each', unit_cents: 1_250 }]
  const po = { supplier: 'Green Mountain Cabinet Co', description: 'Kitchen cabinets and hardware', vendor_email: 'orders@gmcabinet.example', source: { kind: 'budget', cost_code: '12-350' }, lines }
  assert.equal((await act('/orders', { ...po, source: { kind: 'selection', selection_id: 'x' } })).status, 400, 'An incomplete selection source is refused')
  assert.equal((await act('/orders', { ...po, source: { kind: 'budget', cost_code: '99-999' } })).value.error, 'budget_code')
  assert.equal((await act('/orders', { ...po, lines: [{ ...lines[0], cost_code: '26-100' }] })).status, 400, 'Budget PO lines carry its cost code')
  r = await act('/orders', po, { token: agent }); assert.equal(r.status, 200, JSON.stringify(r.value)); const order = r.value.record
  assert.equal(order.amount_cents, 350_000); assert.deepEqual(order.lines.map(l => l.total_cents), [300_000, 50_000])
  const step = (action, body, credentials) => act(`/orders/${order.id}/${action}`, body, credentials)
  assert.equal((await step('issue', {}, { token: agent })).status, 403)
  r = await step('issue'); assert.equal(r.status, 200); assert.deepEqual([r.value.record.delivery.status, r.value.record.delivery.label], ['prepared', 'Approved, not sent yet'])
  // Delivery to the vendor through the installation's mail provider: one claimed send per approved revision, never "delivered".
  assert.equal((await step('send', {}, { token: agent })).status, 403, 'Agents never send POs')
  assert.equal((await step('send', {}, { cookie: client })).status, 403)
  r = await step('send'); assert.equal(r.status, 200, JSON.stringify(r.value)); assert.equal(r.value.record.delivery.status, 'accepted')
  assert.equal(r.value.record.delivery.label, 'Accepted by the mail provider for orders@gmcabinet.example; delivery not confirmed')
  const sent = () => f.messages.filter(m => m.to.includes('orders@gmcabinet.example'))
  assert.equal(sent().length, 1); assert.match(sent()[0].text, /12-350 Base cabinets: 10 each at \$300\.00 = \$3,000\.00/); assert.match(sent()[0].text, /Total: \$3,500\.00/)
  assert.equal((await step('send')).value.error, 'already_sent'); assert.equal(sent().length, 1, 'A revision is sent once')
  assert.ok(job.approvals.some(a => a.kind === 'purchase_order.send' && a.snapshot.status === 'accepted'))
  const read = (path, credentials = { cookie: f.owner }) => api(`/jobs/${job.id}/orders/${order.id}${path}`, undefined, { method: 'GET', ...credentials })
  r = await read('/document'); assert.equal(r.status, 200); assert.equal(r.value.format, 'plinth-purchase-order-v1'); assert.equal(r.value.order.lines.length, 2); assert.equal(r.value.approved_by.role, 'owner')
  assert.equal((await read('/document', { cookie: client })).status, 403, 'Clients never receive vendor POs')

  // Acknowledgment with a promised date, then the vendor changes the promise and ships.
  assert.equal((await step('acknowledge', { acknowledged_on: '2026-10-22', by_name: 'Robin Hale', reference: 'Vendor email 22 Oct', promised_on: '2026-11-10' }, { token: agent })).status, 403, 'Agents never record vendor responses')
  r = await step('acknowledge', { acknowledged_on: '2026-10-22', by_name: 'Robin Hale', reference: 'Vendor email 22 Oct', promised_on: '2026-11-10' }); assert.equal(r.status, 200)
  assert.equal((await read('')).value.fulfillment.delivery_status, 'acknowledged')
  r = await step('promise', { promised_on: '2026-11-17', reason: 'Factory backorder on base cabinets' }); assert.equal(r.status, 200)
  assert.deepEqual(r.value.record.promise_history.map(p => [p.from, p.to]), [[undefined, '2026-11-10'], ['2026-11-10', '2026-11-17']])
  r = await step('ship', { carrier: 'Estes Freight', tracking: 'EST-55120', freight_cents: 12_500, shipped_on: '2026-11-14' }); assert.equal(r.status, 200)
  assert.equal((await read('')).value.fulfillment.delivery_status, 'shipped')

  // Partial receipt by line, an over-receipt refused without a write, and a damaged unit returned.
  assert.equal((await step('receive', { amount_cents: 100_000, reference: 'Ticket 1' })).status, 400, 'Itemized POs receive by line quantity')
  const held = job.version
  r = await step('receive', { lines: [{ line_id: 'pulls', quantity: '41' }], reference: 'Ticket 1' }); assert.equal(r.value.error, 'over_receipt'); assert.equal(job.version, held)
  r = await step('receive', { lines: [{ line_id: 'base', quantity: '6' }, { line_id: 'pulls', quantity: '40' }], reference: 'Delivery ticket 7781', received_on: '2026-11-17' }); assert.equal(r.status, 200)
  assert.equal(r.value.record.receipts[0].amount_cents, 230_000)
  assert.equal((await step('return', { lines: [{ line_id: 'base', quantity: '7' }], reason: 'Damaged in transit', reference: 'RMA 31' })).value.error, 'over_return')
  r = await step('return', { lines: [{ line_id: 'base', quantity: '1' }], reason: 'Damaged in transit: cracked face frame', reference: 'RMA 31' }); assert.equal(r.status, 200); assert.equal(r.value.record.returns[0].amount_cents, 30_000)

  // Amendment: prior commitment retained; approval needs the reviewed budget and date impact.
  const amended = [lines[0], { ...lines[1], quantity: '50' }]
  r = await step('amend', { lines: amended, promised_on: '2026-11-24', reason: 'Client added pantry pulls' }, { token: agent }); assert.equal(r.status, 200, 'Agents may prepare an amendment')
  const pending = r.value.record.amendments[0]; assert.deepEqual([pending.budget_impact_cents, pending.date_impact_days, pending.previous.amount_cents], [12_500, 7, 350_000])
  assert.equal((await step('approve-amendment', { budget_impact_cents: 12_500, date_impact_days: 7 }, { token: agent })).status, 403)
  r = await step('approve-amendment', { budget_impact_cents: 0, date_impact_days: 7 }); assert.equal(r.value.error, 'impact_unreviewed')
  r = await step('approve-amendment', { budget_impact_cents: 12_500, date_impact_days: 7 }); assert.equal(r.status, 200, JSON.stringify(r.value))
  assert.equal(r.value.record.amount_cents, 362_500); assert.equal(r.value.record.promised_on, '2026-11-24'); assert.equal(r.value.record.amendments[0].previous.lines[1].quantity, '40', 'The prior commitment is kept')
  assert.ok(job.approvals.some(a => a.kind === 'purchase_order.amendment' && a.approved_by.role === 'owner'))
  r = await step('send'); assert.equal(r.status, 200); assert.equal(r.value.record.delivery.revision, 2); assert.equal(sent().length, 2, 'The approved amendment goes to the vendor as revision 2'); assert.match(sent()[1].subject, /revision 2/)

  // Reconcile commitment, quantities and delivery status, and the pay app commitments.
  r = await read(''); const state = r.value.fulfillment
  assert.deepEqual([state.delivery_status, state.commitment_cents, state.received_cents, state.returned_cents, state.outstanding_cents, state.freight_cents], ['partially_received', 362_500, 200_000, 30_000, 162_500, 12_500])
  assert.deepEqual(state.lines.map(l => [l.line_id, l.ordered, l.received, l.returned, l.outstanding]), [['base', '10', '5', '1', '5'], ['pulls', '50', '40', '0', '10']])
  r = await act('/claims', { cumulative_cents: 400_000, description: 'Cabinet delivery draw' }); assert.equal(r.status, 200)
  assert.deepEqual([r.value.record.reconciliation.commitments_cents, r.value.record.reconciliation.received_cents], [362_500, 200_000])

  // Cancellation releases the unreceived commitment and keeps what arrived.
  r = await act('/orders', { supplier: 'Lake Electric Supply', description: 'Under-cabinet lighting', source: { kind: 'budget', cost_code: '26-100' }, lines: [{ id: 'led', description: 'LED strip kit', cost_code: '26-100', quantity: '4', unit: 'kit', unit_cents: 8_000 }] }); const light = r.value.record.id
  assert.equal((await act(`/orders/${light}/issue`)).status, 200)
  assert.equal((await act(`/orders/${light}/send`)).value.error, 'vendor_email')
  assert.equal((await act(`/orders/${light}/receive`, { lines: [{ line_id: 'led', quantity: '1' }], reference: 'Counter pickup' })).status, 200)
  r = await act(`/orders/${light}/cancel`, { reason: 'Client chose a different fixture' }); assert.equal(r.status, 200)
  assert.deepEqual([r.value.record.status, r.value.record.amount_cents, r.value.record.cancelled.released_cents], ['cancelled', 8_000, 24_000])
  assert.equal((await act(`/orders/${light}/receive`, { lines: [{ line_id: 'led', quantity: '1' }], reference: 'Late' })).value.error, 'order_state')

  // A registered vendor package is also enforced by the ordinary issue, amendment and send doors.
  const submittal=await submittalFixture(f,job);job=submittal.job
  const gatedOrder=submittal.order.id,gatedRow=submittal.row,currentCycle=gatedRow.cycles.at(-1)
  assert.equal((await act('/orders/'+gatedOrder+'/issue')).status,200)
  const windowSent=()=>f.messages.filter(m=>m.to.includes(['synthetic-plinth-vendor','example.test'].join('@')))
  r=await act('/orders/'+gatedOrder+'/send');assert.equal(r.status,200,JSON.stringify(r.value));assert.equal(r.value.record.delivery.status,'accepted');assert.equal(windowSent().length,1);assert.ok(windowSent()[0].text.includes('Approved vendor product: Window W1 version two'))
  const approvedDocument=await api('/jobs/'+job.id+'/orders/'+gatedOrder+'/document',undefined,{method:'GET'})
  assert.equal(approvedDocument.status,200);assert.equal(approvedDocument.value.order.submittal.cycle_id,currentCycle.id);assert.equal(approvedDocument.value.order.submittal.product_reference,'Window W1 version two')
  assert.equal(job.approvals.find(a=>a.subject_id===gatedOrder&&a.kind==='purchase_order').snapshot.submittal_release.cycle_id,currentCycle.id)

  r=await act('/orders/'+gatedOrder+'/amend',{reason:'Revised window dimensions',lines:[{id:'windows',description:'Revised W1 windows',cost_code:'12-350',quantity:'1',unit:'package',unit_cents:125000}],budget_impact_cents:5000,date_impact_days:0})
  assert.equal(r.status,200,JSON.stringify(r.value))
  const beforeGate=structuredClone(job)
  r=await act('/orders/'+gatedOrder+'/approve-amendment',{budget_impact_cents:5000,date_impact_days:0})
  assert.equal(r.value.error,'submittal_mismatch');assert.deepEqual(job,beforeGate,'A mismatched approved package changes no commitment terms')
  r=await act('/submittals/'+gatedRow.id+'/resubmit',{cycle_id:currentCycle.id,...submittal.submission('Window W1 version three',submittal.revised)})
  assert.equal(r.status,200,JSON.stringify(r.value));const amendedCycle=r.value.record.cycles.at(-1)
  r=await act('/submittals/'+gatedRow.id+'/review',{cycle_id:amendedCycle.id,disposition:'approved',comment:'Reviewed the revised dimensions and exact commitment',confirm:true});assert.equal(r.status,200)
  r=await act('/submittals/'+gatedRow.id+'/release',{cycle_id:amendedCycle.id,order_id:gatedOrder,product_reference:amendedCycle.product_reference,confirm:true});assert.equal(r.status,200)
  r=await act('/orders/'+gatedOrder+'/approve-amendment',{budget_impact_cents:5000,date_impact_days:0});assert.equal(r.status,200,JSON.stringify(r.value));assert.equal(r.value.record.amount_cents,125000)
  assert.equal(r.value.record.amendments[0].previous.amount_cents,120000)
  r=await act('/submittals/'+gatedRow.id+'/resubmit',{cycle_id:amendedCycle.id,...submittal.submission('Window W1 version four',submittal.revised)});assert.equal(r.status,200)
  const sendCount=windowSent().length
  r=await act('/orders/'+gatedOrder+'/send');assert.equal(r.value.error,'submittal_unapproved');assert.equal(windowSent().length,sendCount,'A new unapproved cycle never reaches the supplier')
  const heldDocument=await api('/jobs/'+job.id+'/orders/'+gatedOrder+'/document',undefined,{method:'GET'});assert.equal(heldDocument.value.error,'submittal_unapproved')
  r = await f.json(`/api/plinth/jobs/${job.id}`, { cookie: client }); assert.equal(r.status, 200)
  assert.deepEqual(r.value.job.orders, []); assert.ok(!JSON.stringify(r.value).includes('Green Mountain Cabinet'), 'Clients never see vendor POs')
 } finally { await f.close() }
})

test('BID-002 — source-backed bid leveling retains original units/exclusions, human normalization, one commitment and cost delta with explicit cancellation/replacement', async()=>{
 const f=await createFixture()
 try{
  const {handoverDocument}=await import('../fixtures/handover-document.mjs')
  const client=await f.invite('synthetic-plinth-1@example.com'),bidders=await Promise.all([2,3].map(n=>f.invite(`synthetic-plinth-${n}@example.com`,`Synthetic contact ${n}`))),pm=await f.invite('synthetic-plinth-4@example.com','Synthetic PM','admin'),agent=await f.agent()
  const api=(path,body,cookie=f.owner)=>f.json('/api/plinth'+path,{method:body===undefined?'GET':'POST',cookie,body})
  let job=(await api('/jobs',{name:'synthetic-plinth-1',client_email:'synthetic-plinth-1@example.com',address:'Synthetic comparison site'})).value.job
  const jobAct=async(path,body={})=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});assert.equal(r.status,200,JSON.stringify(r.value));job=r.value.job;return r.value.record}
  const codes=['06-100','06-200'];await jobAct('/quotes',{lines:codes.map((cost_code,n)=>({id:`synthetic-plinth-${n+1}`,description:`Synthetic scope ${n+1}`,cost_code,phase:'Structure',category:'labor',quantity:'1',unit:'job',cost_unit_cents:n?20000:100000,unit_cents:n?40000:200000}))})
  await jobAct(`/quotes/${job.quotes[0].id}/accept`,{method:'signed',evidence:'Synthetic accepted exact source',schedule_choice:{kind:'none',reason:'Compare bids first'}})
  const frozen=structuredClone(job.budgets),vendorIds=[],scopeIds=[]
  for(let n=0;n<2;n++){
   const vendor=(await api('/vendors',{kind:'subcontractor',name:`synthetic-plinth-${n+2}`,trades:['Framing'],contacts:[{id:`synthetic-plinth-${n+2}`,name:`Synthetic contact ${n+2}`,email:`synthetic-plinth-${n+2}@example.com`}]})).value.vendor;vendorIds.push(vendor.id)
   assert.equal((await api(`/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Framing',status:'qualified',evidence:'Synthetic reviewed qualification'})).status,200)
   const scope=await jobAct('/subcontracts',{vendor_id:vendor.id,trade:'Framing',scope:`Synthetic previously released contact scope ${n+1}`,contact_ids:[`synthetic-plinth-${n+2}`],awarded_on:'2026-10-21'});scopeIds.push(scope.id);await jobAct(`/subcontracts/${scope.id}/release`)
  }
  let bidSource=(await api(`/bids/${job.id}`)).value.source
  const bidAct=async(path,body,cookie=f.owner)=>{const r=await api(`/bids/${job.id}${path}`,{expected_version:bidSource.version,...body},cookie);assert.ok(r.status===200||r.status===201,JSON.stringify(r.value));bidSource=r.value.source;return r}
  const pdf=(title,revision=1)=>({name:`synthetic-plinth-${revision}.pdf`,base64:handoverDocument(title,revision).toString('base64')})
  let r=await bidAct('',{title:'Synthetic framing package',trade:'Framing',scope:'Frame and blocking',mode:'unpriced',lines:codes.map(cost_code=>({cost_code,description:cost_code==='06-100'?'Framing':'Blocking'})),note:'Initial issued plan',due_on:'2099-12-31',plans:[pdf('Synthetic bid plans')]});const packageId=r.value.record_id,revision=bidSource.bids[0].revisions[0].id
  await bidAct(`/${packageId}/publish`,{revision_id:revision,confirm:true})
  for(let n=0;n<2;n++){
   await bidAct(`/${packageId}/invite`,{vendor_id:vendorIds[n],contact_id:`synthetic-plinth-${n+2}`,subcontract_id:scopeIds[n],cost_codes:[codes[0]],confirm:true})
   await bidAct(`/${packageId}/acknowledge`,{revision_id:revision},bidders[n]);await bidAct(`/${packageId}/respond`,{revision_id:revision,items:[{cost_code:codes[0],description:n?'10 panels with tax':'100 square feet excluding painting',amount_cents:n?130000:120000}],exclusions:n?'Crane excluded':'Painting excluded',attachments:[pdf(n?'Ten-panel quotation':'Square-foot quotation',n+2)]},bidders[n])
  }
  const originals=(await api(`/bids/${job.id}`)).value.source.bids[0].invitations.map(i=>structuredClone(i.responses[0]))
  let source=(await api(`/bid-comparisons/${job.id}`)).value.source
  const act=async(path,body={},cookie=f.owner)=>{const result=await api(`/bid-comparisons/${job.id}${path}`,{expected_version:source.version,...body},cookie);if(result.value.source)source=result.value.source;return result}
  for(const cookie of [client,...bidders])assert.equal((await api(`/bid-comparisons/${job.id}`,undefined,cookie)).status,403)
  assert.equal((await f.json(`/api/plinth/bid-comparisons/${job.id}`,{token:agent})).status,403)
  assert.equal((await f.request(`/api/plinth/bid-comparisons/${job.id}`)).status,401)
  r=await act('',{package_id:packageId,title:'Synthetic framing comparison'});assert.equal(r.status,201,JSON.stringify(r.value));const id=r.value.record_id
  let comparison=source.comparisons[0];assert.equal(comparison.candidates.length,2);assert.ok(comparison.flags.every(f=>f.items.includes('06-200: no original price line')))
  const reviewInput=(candidate,n)=>({candidate_id:candidate.id,response_id:candidate.response.id,confirm:true,lines:codes.map((cost_code,k)=>({cost_code,quantity:k?null:n?'10':'100',unit:k?null:n?'panel':'square foot',allowance_cents:k?null:n?5000:0,tax_cents:k?null:n?6500:0,scope:k?'missing':'included',original_note:k?'No blocking price in the original':'Read the quoted quantity and exclusions from page 1',normalized_cents:k?20000:n?145000:135000,normalization_note:k?'Estimator allowance for missing blocking':'Comparable installation allowance, original quote unchanged',evidence:[{kind:'attachment',attachment_id:candidate.response.attachments[0].id,checksum:candidate.response.attachments[0].checksum,locator:'Page 1, quoted scope'}]})),duration_days:n?3:5,alternates:[{description:n?'Weatherproof panels':'Primer coat',amount_cents:n?12000:10000,note:'Page 1 alternate, excluded from original base award'}],exclusions:candidate.response.exclusions,note:'Human-reviewed source interpretation and separate comparison normalization'})
  let invalid=reviewInput(comparison.candidates[0],0);invalid.lines[0].evidence[0].checksum='not-the-original';assert.equal((await act(`/${id}/review`,invalid)).status,409)
  for(let n=0;n<2;n++){r=await act(`/${id}/review`,reviewInput(comparison.candidates[n],n));assert.equal(r.status,200,JSON.stringify(r.value))}
  comparison=source.comparisons[0];assert.equal(comparison.reviews[0].lines[0].unit,'square foot');assert.equal(comparison.reviews[1].lines[0].unit,'panel');assert.deepEqual(comparison.candidates.map(c=>c.response),originals)
  const awardInput=(n,expected=100000)=>({candidate_id:comparison.candidates[n].id,review_id:comparison.reviews.filter(r=>r.candidate_id===comparison.candidates[n].id).at(-1).id,amount_cents:originals[n].total_cents,confirm:true,acknowledge_missing_scope:true,decision:'Choose exact original scope; blocking remains separately budgeted',terms_reference:'Reviewed original quotation, page 1',award_scope:n?'Ten panel framing scope':'100 square feet framing scope',awarded_on:'2026-10-22',budget_allocations:[{cost_code:codes[0],amount_cents:80000,expected_cost_cents:expected}]})
  assert.equal((await act(`/${id}/award`,{...awardInput(0),acknowledge_missing_scope:false})).status,409)
  assert.equal((await act(`/${id}/award`,{...awardInput(0),amount_cents:comparison.reviews[0].total_cents})).status,409,'Normalization is not a vendor contractual price')
  const team=(await api('/team')).value.team.find(p=>p.email==='synthetic-plinth-4@example.com');assert.equal((await f.json(`/api/plinth/team/${team.id}`,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'project_manager',job_ids:[job.id],po_limit_cents:0}})).status,200)
  assert.equal((await api(`/bid-comparisons/${job.id}`,undefined,pm)).status,200);assert.equal((await act(`/${id}/award`,awardInput(0),pm)).status,403)
  r=await act(`/${id}/award`,awardInput(0));assert.equal(r.status,200,JSON.stringify(r.value));const first=source.awards[0],oldVersion=source.version
  assert.equal(source.commitments.length,1);assert.equal(source.commitments[0].amount_cents,120000);assert.equal(source.cost_budget.codes[0].current_cost_cents,140000);assert.deepEqual(source.cost_budget.adjustments[0].lines[0],{cost_code:codes[0],previous_cents:100000,allocation_cents:80000,commitment_cents:120000,delta_cents:40000,current_cents:140000})
  assert.equal((await act(`/${id}/award`,awardInput(0,140000))).status,409,'Replay cannot double the commitment or adjustment')
  assert.equal(source.awards.length,1);assert.equal(source.cost_budget.adjustments.length,1)
  assert.equal((await api(`/bid-comparisons/${job.id}/${id}/replace`,{expected_version:oldVersion-1,...awardInput(1),replaces_award_id:first.id,replacement_reason:'Reviewed alternate contractor'})).status,409)
  r=await act(`/${id}/replace`,{...awardInput(1),replaces_award_id:first.id,replacement_reason:'Reviewed contractor replacement before release'});assert.equal(r.status,200,JSON.stringify(r.value));const second=source.awards[1]
  assert.equal(source.awards[0].cancelled.reason,'Reviewed contractor replacement before release');assert.equal(source.commitments.find(c=>c.id===first.subcontract_id).status,'cancelled');assert.equal(source.commitments.filter(c=>c.status!=='cancelled').length,1);assert.equal(source.cost_budget.codes[0].current_cost_cents,150000);assert.equal(source.cost_budget.adjustments.length,3);assert.equal(new Set(source.cost_budget.adjustments.map(a=>a.source_key)).size,3)
  job=(await api(`/jobs/${job.id}`)).value.job;assert.deepEqual(job.budgets,frozen);assert.deepEqual(job.bids[0].invitations.map(i=>i.responses[0]),originals)
  assert.equal((await api(`/jobs/${job.id}/subcontracts/${first.subcontract_id}/release`,{expected_version:job.version})).status,409,'Cancelled commitments cannot be released through the existing door')
  assert.equal((await act(`/${id}/cancel`,{award_id:second.id,subcontract_id:second.subcontract_id,confirm:true,reason:'Owner cancelled before release'})).status,200);assert.equal(source.cost_budget.codes[0].current_cost_cents,100000);assert.equal(source.commitments.filter(c=>c.status!=='cancelled').length,0)
  assert.equal((await act(`/${id}/cancel`,{award_id:second.id,subcontract_id:second.subcontract_id,confirm:true,reason:'Replay'})).status,409)
  r=await act(`/${id}/award`,awardInput(0));assert.equal(r.status,200);const third=source.awards.at(-1);job=(await api(`/jobs/${job.id}`)).value.job
  r=await api(`/jobs/${job.id}/subcontracts/${third.subcontract_id}/release`,{expected_version:job.version});assert.equal(r.status,200);source=(await api(`/bid-comparisons/${job.id}`)).value.source
  assert.equal((await act(`/${id}/replace`,{...awardInput(1),replaces_award_id:third.id,replacement_reason:'Cannot cancel started scope'})).status,409,'A released scope must be settled outside this unstarted-work cancellation flow')
  for(const path of [`/api/plinth/jobs/${job.id}`,'/api/plinth/jobs']){const projection=await f.json(path,{token:agent});assert.equal(projection.status,200);const visible=projection.value.job??projection.value.jobs.find(j=>j.id===job.id);for(const key of ['bid_comparisons','bid_cost_adjustments','bid_comparison_awards'])assert.equal(visible[key],undefined);assert.ok(!visible.approvals.some(a=>a.kind.startsWith('bid.award')),'Generic agent job doors do not expose private award comparisons')} 
  const external=(await api(`/jobs/${job.id}`,undefined,client)).value.job;for(const key of ['bid_comparisons','bid_cost_adjustments','bid_comparison_awards'])assert.equal(external[key],undefined)
  const person=(await api('/team')).value.team.find(p=>p.email==='synthetic-plinth-4@example.com');assert.equal((await f.json(`/api/plinth/team/${person.id}`,{method:'PUT',cookie:f.owner,body:{expected_version:1,role:'project_manager',job_ids:[],po_limit_cents:0}})).status,200);assert.equal((await api(`/bid-comparisons/${job.id}`,undefined,pm)).status,404)
 }finally{await f.close()}
})
