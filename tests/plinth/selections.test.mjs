import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture } from './helpers.mjs'

test('CLIENT-002 — room allowances, exact client signatures, immutable replacements and signed-choice PO fulfillment through public HTTP', async () => {
 const f = await createFixture()
 try {
  const client = await f.invite('client@example.com', 'Alex Chen'), foreign = await f.invite('foreign@example.com', 'Other client'), token = await f.agent()
  let job = await createActiveJob(f, 'Maple Street kitchen and powder room', 'client@example.com', 4_800_000)
  const api = (path, options = {}) => f.json('/api/plinth' + path, { cookie: f.owner, ...options })
  const act = async (path, body = {}, options = {}) => { const r = await api(`/jobs/${job.id}${path}`, { method: 'POST', body: { expected_version: job.version, ...body }, ...options }); if (r.status === 200) job = (await api(`/jobs/${job.id}`)).value.job; return r }
  const terms = (category, price = 225_000) => ({ room: category === 'Flooring' ? 'Kitchen' : 'Powder room', category, allowance_cents: 200_000, cost_code: category === 'Flooring' ? '09-650' : '22-400', decision_on: '2026-11-04', lead_days: 21, options: [{ name: 'Natural oak', supplier: 'Maple Supply', specifications: 'Engineered white oak, matte, 7 inch boards, 120 square feet', price_cents: price }, { name: 'Porcelain', supplier: 'Tile House', specifications: 'Warm gray, 12 by 24 inch, 120 square feet', price_cents: 175_000 }] })
  let r = await act('/selections', terms('Flooring'), { token, cookie: undefined }); assert.equal(r.status, 200); const flooring = r.value.record.id
  r = await act('/selections', terms('Fixtures', 180_000)); assert.equal(r.status, 200); const fixtures = r.value.record.id
  const floor = () => job.selections.find(s => s.id === flooring), current = () => floor().revisions.at(-1)
  assert.equal(job.selections.length, 2); assert.equal(current().allowance_cents, 200_000); assert.equal(current().decision_on, '2026-11-04'); assert.equal(current().lead_days, 21)
  assert.deepEqual((await api(`/jobs/${job.id}`, { cookie: client })).value.job.selections, [], 'Draft choices are not client-visible')
  r = await act(`/selections/${flooring}/present`, { revision_id: current().id }, { token, cookie: undefined }); assert.equal(r.status, 403)
  r = await act(`/selections/${flooring}/present`, { revision_id: current().id }); assert.equal(r.status, 200)
  const fixtureRevision = job.selections.find(s => s.id === fixtures).revisions[0]
  assert.equal((await act(`/selections/${fixtures}/present`, { revision_id: fixtureRevision.id })).status, 200)
  let visible = (await api(`/jobs/${job.id}`, { cookie: client })).value.job
  assert.equal(visible.selections.length, 2); assert.equal(visible.selections[0].revisions[0].category, 'Flooring'); assert.equal(visible.selections[0].revisions[0].options.length, 2)
  assert.equal(visible.selections[0].revisions[0].cost_code, undefined)
  assert.equal(visible.selections[1].revisions[0].allowance_cents, 200_000)
  assert.deepEqual(visible.selections[0].revisions[0].options.map(o=>o.price_cents), [225_000, 175_000])
  const firstRevision = current().id, firstOption = current().options[0].id
  r = await act(`/selections/${flooring}/comment`, { revision_id: firstRevision, text: 'Please confirm this is the matte finish.' }, { cookie: client }); assert.equal(r.status, 200); assert.equal(r.value.record.revisions[0].cost_code, undefined); assert.equal(r.value.record.comments[0].by.name, 'Alex Chen'); assert.equal(r.value.record.comments[0].text, 'Please confirm this is the matte finish.')
  const sign = { revision_id: firstRevision, option_id: firstOption, statement: 'I approve Natural oak at the displayed exact price.', confirm: true }
  const before = job.version
  for (const options of [{ cookie: f.owner }, { cookie: undefined, token }, { cookie: foreign }]) assert.ok([403, 404].includes((await act(`/selections/${flooring}/sign`, sign, options)).status))
  assert.equal(job.version, before)
  assert.equal((await act(`/selections/${flooring}/sign`, { ...sign, confirm: false }, { cookie: client })).status, 400)
  assert.equal((await act(`/selections/${flooring}/order`, { revision_id: firstRevision })).value.error, 'selection_unsigned')
  r = await act(`/selections/${flooring}/sign`, sign, { cookie: client }); assert.equal(r.status, 200); assert.equal(r.value.record.revisions[0].cost_code, undefined)
  const termsOnly = ({ procurement, ...terms }) => terms
  const signed = structuredClone(termsOnly(current())); assert.equal(signed.signature.option.price_cents, 225_000); assert.equal(signed.signature.by.name, 'Alex Chen')
  assert.equal((await act(`/selections/${flooring}/sign`, sign, { cookie: client })).status, 409)
  assert.equal((await act(`/selections/${flooring}/order`, { revision_id: firstRevision }, { cookie: client })).status, 403)
  const tampered = await act('/orders', { supplier: signed.signature.option.supplier, description: 'Tampered selection', source: { kind: 'selection', selection_id: flooring, revision_id: firstRevision }, lines: [{ description: signed.signature.option.name, cost_code: '09-650', quantity: '1', unit: 'selection', unit_cents: 1 }] }); assert.equal(tampered.value.error, 'selection_terms')
  r = await act(`/selections/${flooring}/order`, { revision_id: firstRevision, vendor_email: 'office-only@example.com', promised_on: '2026-11-18' }); assert.equal(r.status, 200, JSON.stringify(r.value)); const order = r.value.record
  assert.equal(order.amount_cents, signed.signature.option.price_cents); assert.equal(order.supplier, signed.signature.option.supplier); assert.equal(order.lines[0].cost_code, '09-650')
  assert.equal((await act(`/selections/${flooring}/order`, { revision_id: firstRevision })).value.error, 'selection_ordered')
  assert.equal((await act(`/orders/${order.id}/issue`)).status, 200)
  assert.equal((await act(`/orders/${order.id}/acknowledge`, { acknowledged_on: '2026-10-20', by_name: 'Supplier dispatch', reference: 'Vendor email MS-221', promised_on: '2026-11-19' })).status, 200)
  assert.equal((await act(`/orders/${order.id}/ship`, { carrier: 'Regional Freight', tracking: 'MS-221', shipped_on: '2026-11-17', freight_cents: 12_000 })).status, 200)
  assert.equal((await act(`/orders/${order.id}/receive`, { lines: [{ line_id: order.lines[0].id, quantity: '0.5' }], reference: 'Half of shipment, ticket MS-221-A' })).status, 200)
  visible = (await api(`/jobs/${job.id}`, { cookie: client })).value.job
  const tracker = visible.selections[0].revisions[0].procurement[0]
  assert.equal(tracker.delivery_status, 'partially_received'); assert.equal(tracker.promised_on, '2026-11-19'); assert.equal(tracker.quantities[0].received, '0.5'); assert.equal(tracker.quantities[0].outstanding, '0.5')
  assert.deepEqual(visible.orders, []); assert.equal(tracker.amount_cents, undefined); assert.equal(tracker.vendor_email, undefined)
  assert.ok(!JSON.stringify(visible).includes('office-only@example.com'))
  assert.equal((await api(`/jobs/${job.id}/orders/${order.id}`, { cookie: client })).status, 403)
  r = await act(`/selections/${flooring}/revise`, terms('Flooring', 235_000)); assert.equal(r.status, 200)
  assert.deepEqual(termsOnly(floor().revisions[0]), signed, 'A replacement preserves the earlier exact decision')
  assert.equal(current().status, 'draft'); assert.equal(current().signature, undefined)
  assert.equal((await act(`/selections/${flooring}/sign`, { ...sign, revision_id: current().id }, { cookie: client })).status, 409)
  assert.equal((await act(`/selections/${flooring}/order`, { revision_id: current().id })).status, 409)
  assert.equal((await act(`/selections/${flooring}/present`, { revision_id: current().id })).status, 200)
  visible = (await api('/jobs', { cookie: client })).value.jobs[0]
  assert.equal(visible.selections[0].revisions.length, 2); assert.equal(visible.selections[0].revisions[1].status, 'presented'); assert.equal(visible.selections[0].revisions[1].signature, undefined)
  const stale = await api(`/jobs/${job.id}/selections/${flooring}/sign`, { method: 'POST', cookie: client, body: { expected_version: before, revision_id: current().id, option_id: current().options[0].id, statement: 'Approved replacement', confirm: true } }); assert.equal(stale.status, 409)
  assert.equal((await act(`/selections/${flooring}/sign`, { revision_id: current().id, option_id: current().options[0].id, statement: 'Approved replacement at $2350', confirm: true }, { cookie: client })).status, 200)
  assert.deepEqual(termsOnly(floor().revisions[0]), signed); assert.equal(current().signature.option.price_cents, 235_000)
  assert.equal(job.quotes.find(q => q.status === 'accepted').total_cents, 4_800_000, 'CLIENT-003 carries contract and billing effects; a choice never silently changes them')
  assert.equal(job.orders.length, 1, 'A replacement never rewrites or duplicates the original PO')
  assert.equal((await api(`/jobs/${job.id}`, { cookie: foreign })).status, 404)
 } finally { await f.close() }
})
