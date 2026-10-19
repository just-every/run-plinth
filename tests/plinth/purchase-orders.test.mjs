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
  r = await act(`/quotes/${job.quotes[0].id}/accept`, { method: 'signed', evidence: 'Signed proposal' }); assert.equal(r.status, 200)

  // An itemized, cost-coded PO prepared against the accepted budget.
  const lines = [{ id: 'base', description: 'Base cabinets', cost_code: '12-350', quantity: '10', unit: 'each', unit_cents: 30_000 }, { id: 'pulls', description: 'Cabinet pulls', cost_code: '12-350', quantity: '40', unit: 'each', unit_cents: 1_250 }]
  const po = { supplier: 'Green Mountain Cabinet Co', description: 'Kitchen cabinets and hardware', vendor_email: 'orders@gmcabinet.example', source: { kind: 'budget', cost_code: '12-350' }, lines }
  assert.equal((await act('/orders', { ...po, source: { kind: 'selection', selection_id: 'x' } })).status, 400, 'Selections arrive with CLIENT-002')
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

  r = await f.json(`/api/plinth/jobs/${job.id}`, { cookie: client }); assert.equal(r.status, 200)
  assert.deepEqual(r.value.job.orders, []); assert.ok(!JSON.stringify(r.value).includes('Green Mountain Cabinet'), 'Clients never see vendor POs')
 } finally { await f.close() }
})
