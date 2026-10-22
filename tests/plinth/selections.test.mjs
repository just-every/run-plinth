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

test('CLIENT-003 / AUTO-002 — exact overage and underage, immutable reviewed client changes, incremental replacements and one-time budget, PO and next-draw effects', async () => {
 const f = await createFixture()
 try {
  const client = await f.invite('allowance@example.com', 'Sam Client'), foreign = await f.invite('unrelated@example.com'), agent = await f.agent()
  const sent = f.messages.length
  const api = (path, body, cookie = f.owner, token) => f.json('/api/plinth' + path, { cookie, token, ...(body === undefined ? {} : { method: 'POST', body }) })
  let r = await api('/jobs', { name: 'Tile and faucet allowances', client_email: 'allowance@example.com' }); assert.equal(r.status, 201); let job = r.value.job
  const act = async (path, body = {}, cookie = f.owner, token) => { const result = await api(`/jobs/${job.id}${path}`, { expected_version: job.version, ...body }, cookie, token); if (result.status === 200 && result.value.job) job = (await api(`/jobs/${job.id}`)).value.job; return result }
  const line = (id, code, sell, cost) => ({ id, description: id, cost_code: code, phase: 'Finishes', category: 'material', quantity: '1', unit: 'each', unit_cents: sell, cost_unit_cents: cost })
  assert.equal((await act('/quotes', { lines: [line('tile', '09-300', 200_000, 150_000), line('faucet', '22-400', 100_000, 60_000)] })).status, 200)
  r = await api('/pricing-rates', { jurisdiction: 'Synthetic allowance tax jurisdiction', kind: 'sales', percent: '10', effective_on: '2026-01-01', reference: 'Reviewed synthetic rate for public HTTP journey', human_reviewed: true }); assert.equal(r.status, 201); const rate = r.value.rate
  const quotePricing = { basis: 'sell', as_of: '2026-10-20', rules: [], tax: { rate_id: rate.id, taxable_line_ids: ['tile'], exemption_reference: 'Reviewed faucet scope exemption' } }
  r = await act('/pricing/preview', quotePricing); assert.equal(r.status, 200)
  assert.equal((await act('/pricing/apply', { ...quotePricing, digest: r.value.preview.digest })).status, 200)
  const quote = job.quotes.at(-1)
  assert.equal((await act(`/quotes/${quote.id}/accept`, { method: 'email', evidence: 'Client acceptance recorded from dated email', schedule_choice: { kind: 'none', reason: 'Procurement dates require separate review' }, budget: { allowances: [{ cost_code: '09-300', amount_cents: 200_000 }, { cost_code: '22-400', amount_cents: 100_000 }], commitment_plan: [{ cost_code: '09-300', amount_cents: 150_000, description: 'Tile procurement plan' }, { cost_code: '22-400', amount_cents: 60_000, description: 'Faucet procurement plan' }] } })).status, 200)
  const originalBudget = structuredClone(job.budgets[0]), accepted = structuredClone(job.quotes.find(q => q.status === 'accepted'))
  assert.equal(originalBudget.contract_cents, 320_000)
  if (!job.sov?.length) assert.equal((await act('/sov')).status, 200)
  const originalSov = structuredClone(job.sov[0])
  const draw = (tile, faucet) => ({ description: 'Reviewed installed work and allowance reconciliation', lines: job.sov.at(-1).lines.map(l => ({ line_id: l.id, completed_cents: l.source.kind === 'variation' ? l.scheduled_cents : l.source.line_id === 'tile' ? tile : faucet, stored_cents: 0, evidence: 'Superintendent reviewed installed quantities and recorded client changes' })) })
  r = await act('/claims', draw(50_000, 20_000)); assert.equal(r.status, 200); const firstClaimId = r.value.record.id
  assert.equal((await act(`/claims/${firstClaimId}/approve`)).status, 200); assert.equal((await act(`/claims/${firstClaimId}/issue`)).status, 200)
  const firstClaim = structuredClone(job.claims.find(c => c.id === firstClaimId))
  const terms = (category, price) => ({ room: 'Kitchen', category, allowance_cents: category === 'Tile' ? 200_000 : 100_000, cost_code: category === 'Tile' ? '09-300' : '22-400', decision_on: '2026-11-04', lead_days: 21, options: [{ name: category === 'Tile' ? 'Handmade tile' : 'Brushed faucet', specifications: 'Exact finish, size and quantity reviewed with client', supplier: category === 'Tile' ? 'Tile Workshop' : 'Fixture Supply', price_cents: price }] })
  async function choose(category, price, selectionId) {
   r = await act(selectionId ? `/selections/${selectionId}/revise` : '/selections', terms(category, price)); assert.equal(r.status, 200); const s = r.value.record, revision = s.revisions.at(-1)
   assert.equal((await act(`/selections/${s.id}/present`, { revision_id: revision.id })).status, 200)
   assert.equal((await act(`/selections/${s.id}/sign`, { revision_id: revision.id, option_id: revision.options[0].id, statement: `I accept the exact ${category} at ${price} cents`, confirm: true }, client)).status, 200)
   return { selection_id: s.id, revision_id: revision.id }
  }
  const tile = await choose('Tile', 266_550), faucet = await choose('Faucet', 78_000)
  const input = (choice, base, cost, rules = []) => ({ ...choice, schedule_days: choice.selection_id === tile.selection_id ? 5 : 0, impact_reference: 'Manager reviewed supplier lead time, exact tax-inclusive price and date impact', impacts_reviewed: true, basis: 'sell', as_of: '2026-10-20', lines: [line('allowance', choice.selection_id === tile.selection_id ? '09-300' : '22-400', base, cost)], rules, tax: { rate_id: rate.id, taxable_line_ids: ['allowance'] } })
  const tileInput = input(tile, 50_000, 30_000, [{ scope: 'project', overhead_percent: '10', method: 'markup', percent: '10', discount_percent: '0' }]), faucetInput = input(faucet, 20_000, 15_000)
  tileInput.lines=[line('allowance','09-300',40_000,20_000),{...line('freight','09-300',10_000,10_000),description:'Selection freight',unit:'shipment'}];tileInput.tax.taxable_line_ids=['allowance','freight']
  assert.equal(job.budgets.length, 1); assert.equal(job.variations.length, 0); assert.equal(job.orders.length, 0, 'Recording choices changes no contract, budget or PO')
  for (const auth of [{ cookie: client }, { cookie: foreign }]) assert.ok([403, 404].includes((await act('/allowance-changes/preview', tileInput, auth.cookie)).status))
  for (const invalid of [{ ...tileInput, impacts_reviewed: false }, { ...tileInput, schedule_days: 1.5 }, { ...tileInput, impact_reference: '' }, { ...tileInput, lines: [line('allowance', '09-300', 49_999, 30_000)] }, { ...tileInput, lines: [line('allowance', '22-400', 50_000, 30_000)] }]) assert.equal((await act('/allowance-changes/preview', invalid)).status, 400)
  r = await act('/allowance-changes/preview', tileInput, undefined, agent); assert.equal(r.status, 200); let preview = r.value.preview
  assert.equal(preview.proposal.amount_cents, 66_550); assert.equal(preview.proposal.allowance_change.economic_delta_cents, 66_550); assert.equal(preview.proposal.pricing.tax.tax_cents, 6050);assert.equal(preview.proposal.pricing.base_lines.find(l=>l.id==='freight').total_cents,10_000)
  assert.equal((await act('/allowance-changes/apply', { ...tileInput, digest: preview.digest }, undefined, agent)).status, 403)
  assert.equal((await act('/allowance-changes/apply', { ...tileInput, digest: 'unreviewed' })).status, 409)
  assert.equal((await act('/allowance-changes/apply', { ...tileInput, schedule_days: 6, digest: preview.digest })).status, 409)
  assert.equal((await act('/allowance-changes/apply', { ...tileInput, digest: preview.digest })).status, 200); const tileChangeId = job.variations.at(-1).id
  assert.equal(job.budgets.length, 1); assert.equal(job.orders.length, 0)
  assert.equal((await act('/allowance-changes/apply', { ...tileInput, digest: preview.digest })).status, 409, 'Repeated preparation cannot add a second adjustment')
  for (const auth of [{ cookie: f.owner }, { cookie: undefined, token: agent }, { cookie: foreign }]) assert.ok([403, 404].includes((await act(`/variations/${tileChangeId}/approve`, {}, auth.cookie, auth.token)).status))
  const approvalVersion = job.version
  const deliveries = await Promise.all([1, 2].map(() => api(`/jobs/${job.id}/variations/${tileChangeId}/approve`, { expected_version: approvalVersion }, client)))
  assert.deepEqual(deliveries.map(d => d.status).sort(), [200, 409]); job = (await api(`/jobs/${job.id}`)).value.job
  const signedTileChange = structuredClone(job.variations.find(v => v.id === tileChangeId))
  assert.equal(job.budgets.length, 2); assert.equal(job.budgets.at(-1).contract_cents, 386_550)
  const approval = job.approvals.find(a => a.kind === 'variation' && a.subject_id === tileChangeId)
  assert.deepEqual(approval.snapshot.allowance_change, signedTileChange.allowance_change); assert.deepEqual(approval.snapshot.pricing, signedTileChange.pricing)
  r = await act('/allowance-changes/preview', faucetInput); assert.equal(r.status, 200); preview = r.value.preview
  assert.equal(preview.proposal.amount_cents, -22_000); assert.equal(preview.proposal.pricing_direction, 'credit')
  assert.equal((await act('/allowance-changes/apply', { ...faucetInput, digest: preview.digest })).status, 200); const faucetChangeId = job.variations.at(-1).id
  assert.equal((await act(`/variations/${faucetChangeId}/approve`, {}, client)).status, 200)
  assert.equal(job.budgets.at(-1).contract_cents, 364_550)
  assert.deepEqual(job.budgets.at(-1).codes.map(c => [c.cost_code, c.revenue_cents, c.cost_cents, c.allowance_cents, c.commitment_plan_cents]), [['09-300', 286_550, 180_000, 200_000, 150_000], ['22-400', 78_000, 45_000, 100_000, 60_000]])
  assert.equal(job.orders.length, 0, 'Client approval cannot commit or send a vendor order')
  assert.equal((await act(`/selections/${tile.selection_id}/order`, { revision_id: tile.revision_id }, client)).status, 403)
  assert.equal((await act(`/selections/${tile.selection_id}/order`, { revision_id: tile.revision_id, vendor_email: 'private-vendor@example.com' })).status, 200); const order = structuredClone(job.orders.at(-1))
  assert.equal(order.status, 'draft'); assert.equal(order.amount_cents, 266_550); assert.equal(order.lines[0].cost_code, '09-300'); assert.equal(order.delivery, undefined)
  assert.equal((await act(`/orders/${order.id}/issue`, {}, undefined, agent)).status, 403); assert.equal((await act(`/orders/${order.id}/issue`, {}, client)).status, 403)
  assert.equal((await act(`/orders/${order.id}/issue`)).status, 200)
  assert.equal(f.messages.length, sent, 'No allowance, approval or PO issue sends a supplier message')
  const recordedTile = structuredClone(job.selections.find(s => s.id === tile.selection_id).revisions[0])
  const replacement = await choose('Tile', 277_550, tile.selection_id), replacementInput = input(replacement, 10_000, 5000)
  r = await act('/allowance-changes/preview', replacementInput); assert.equal(r.status, 200); preview = r.value.preview
  assert.equal(preview.proposal.amount_cents, 11_000); assert.equal(preview.proposal.allowance_change.prior_variation_id, tileChangeId)
  assert.equal((await act('/allowance-changes/apply', { ...replacementInput, digest: preview.digest })).status, 200); const obsolete = job.variations.at(-1).id
  const finalChoice = await choose('Tile', 255_550, tile.selection_id)
  assert.equal((await act(`/variations/${obsolete}/approve`, {}, client)).status, 409, 'A newer selection invalidates an older pending variation')
  const finalInput = input(finalChoice, 10_000, 5000)
  r = await act('/allowance-changes/preview', finalInput); assert.equal(r.status, 200); preview = r.value.preview
  assert.equal(preview.proposal.allowance_change.economic_delta_cents, 55_550); assert.equal(preview.proposal.amount_cents, -11_000, 'Replacement applies only the difference from approved economics')
  assert.equal((await act('/allowance-changes/apply', { ...finalInput, digest: preview.digest })).status, 200); const finalChangeId = job.variations.at(-1).id
  assert.equal((await act(`/variations/${finalChangeId}/approve`, {}, client)).status, 200)
  assert.equal((await act(`/variations/${finalChangeId}/approve`, {}, client)).status, 409)
  assert.equal(job.budgets.length, 4); assert.equal(job.budgets.at(-1).contract_cents, 353_550)
  assert.deepEqual(job.budgets[0], originalBudget); assert.deepEqual(job.quotes.find(q => q.status === 'accepted'), accepted)
  assert.deepEqual(job.variations.find(v => v.id === tileChangeId), signedTileChange)
  assert.deepEqual(job.selections.find(s => s.id === tile.selection_id).revisions[0], recordedTile)
  assert.equal(job.orders.length, 1); assert.equal(job.orders[0].amount_cents, 266_550, 'A replacement cannot rewrite the earlier vendor commitment')
  const assignments = Object.fromEntries(job.variations.filter(v => v.status === 'approved').map(v => ['variation:' + v.id, v.allowance_change.cost_code]))
  assert.equal((await act('/sov', { code_assignments: assignments })).status, 200)
  assert.deepEqual(job.sov[0], originalSov)
  r = await act('/claims', draw(100_000, 50_000)); assert.equal(r.status, 200); const next = r.value.record
  assert.equal(next.reconciliation.contract_cents, 353_550); assert.equal(next.reconciliation.variation_cents, 33_550); assert.equal(next.reconciliation.previous_cents, 70_000)
  assert.equal(next.reconciliation.current_cents, 113_550); assert.equal(next.reconciliation.cumulative_cents, 183_550)
  assert.equal(next.sov.sov_revision.sources.variations.length, 3)
  assert.deepEqual(next.sov.sov_revision.sources.variations.find(v => v.id === tileChangeId).pricing, signedTileChange.pricing)
  assert.equal((await act(`/claims/${next.id}/approve`)).status, 200); assert.equal((await act(`/claims/${next.id}/issue`)).status, 200)
  assert.deepEqual(job.claims.find(c => c.id === firstClaimId), firstClaim, 'Next draw preserves the earlier issued billing record')
  const exported = (await api(`/jobs/${job.id}/claims/${next.id}/application.json`)).value.application
  assert.equal(exported.scheduled_cents, 353_550); assert.equal(exported.previous_cents + exported.current_cents, exported.total_cents)
  const visible = (await api(`/jobs/${job.id}`, undefined, client)).value.job
  const visibleChange = visible.variations.find(v => v.id === finalChangeId)
  assert.equal(visibleChange.allowance_change.selection_revision_id, finalChoice.revision_id); assert.equal(visibleChange.allowance_change.impacts.schedule_days, 5)
  for (const privateValue of ['cost_unit_cents', 'cost_total_cents', 'pricing', 'private-vendor@example.com', 'commitment_plan_cents', 'cost_code']) assert.ok(!JSON.stringify(visible).includes(privateValue), `Client projection excludes ${privateValue}`)
  const missingPlan={...terms('Faucet',120_000),cost_code:'Unassigned'}
  r=await act('/selections',missingPlan);const unplanned=r.value.record,unplannedRevision=unplanned.revisions[0]
  await act(`/selections/${unplanned.id}/present`,{revision_id:unplannedRevision.id})
  await act(`/selections/${unplanned.id}/sign`,{revision_id:unplannedRevision.id,option_id:unplannedRevision.options[0].id,statement:'Recorded client choice with no original allocation',confirm:true},client)
  const unplannedInput={...input({selection_id:unplanned.id,revision_id:unplannedRevision.id},20_000,10_000),lines:[line('allowance','Unassigned',20_000,10_000)]}
  const version=job.version;assert.equal((await act('/allowance-changes/preview',unplannedInput)).value.error,'allowance_baseline');assert.equal(job.version,version)
  assert.equal(f.messages.length, sent); assert.equal(job.schedules.length, 0, 'Recorded date impacts do not manufacture schedule approval')
  // AUTO-002: commit one real downstream step, abandon the caller, reload and resume.
  const workflow = job.continuity.find(w => w.source.id === finalChangeId), workflowId = workflow.id
  assert.equal(workflow.budget_id, job.budgets.at(-1).id)
  assert.equal((await act(`/continuity/${workflowId}/resume`, {}, client)).status, 403)
  assert.equal((await act(`/continuity/${workflowId}/resume`, {}, foreign)).status, 404)
  assert.equal((await act(`/continuity/${workflowId}/resume`, {}, undefined, agent)).status, 200)
  job = (await api(`/jobs/${job.id}`)).value.job
  const interrupted = structuredClone(job.continuity.find(w => w.id === workflowId))
  assert.equal(interrupted.stage, 'purchasing'); assert.equal(interrupted.schedule.calendar_day_impact, 5)
  assert.equal(interrupted.schedule.selection_revision_id, finalChoice.revision_id)
  assert.deepEqual(interrupted.schedule.tasks, []); assert.equal(interrupted.purchasing, undefined)
  const versionBeforeResume = job.version
  const resumed = await Promise.all([1, 2].map(() => api(`/jobs/${job.id}/continuity/${workflowId}/resume`, { expected_version: versionBeforeResume })))
  assert.deepEqual(resumed.map(r => r.status).sort(), [200, 409])
  job = (await api(`/jobs/${job.id}`)).value.job
  const prepared = job.continuity.find(w => w.id === workflowId), po = job.orders.find(o => o.id === prepared.purchasing.order_id)
  assert.equal(prepared.stage, 'billing'); assert.equal(po.status, 'draft'); assert.equal(po.amount_cents, 255_550)
  assert.equal(po.source.selection_id, finalChoice.selection_id); assert.equal(po.source.revision_id, finalChoice.revision_id)
  assert.equal((await act(`/continuity/${workflowId}/resume`)).status, 200)
  const complete = structuredClone(job.continuity.find(w => w.id === workflowId))
  assert.equal(complete.stage, 'complete'); assert.deepEqual(complete.schedule, interrupted.schedule)
  assert.equal(complete.billing.adjustment_cents, -11_000); assert.deepEqual(complete.billing.budget, job.budgets.at(-1))
  for (let replay = 0; replay < 2; replay++) assert.equal((await act(`/continuity/${workflowId}/resume`)).status, 200)
  assert.deepEqual(job.continuity.find(w => w.id === workflowId), complete)
  assert.equal(job.orders.filter(o => o.source?.revision_id === finalChoice.revision_id).length, 1)
  assert.equal(job.budgets.filter(b => b.source.id === finalChangeId).length, 1)
  // An earlier event adopts its existing issued PO; it never duplicates or changes it.
  const oldWorkflow = job.continuity.find(w => w.source.id === tileChangeId), issuedOrder = structuredClone(job.orders.find(o => o.id === order.id))
  for (let step = 0; step < 3; step++) assert.equal((await act(`/continuity/${oldWorkflow.id}/resume`)).status, 200)
  assert.equal(job.continuity.find(w => w.id === oldWorkflow.id).purchasing.order_id, order.id)
  assert.deepEqual(job.orders.find(o => o.id === order.id), issuedOrder)
  r = await act('/claims', draw(110_000, 60_000)); assert.equal(r.status, 200, JSON.stringify(r.value))
  assert.equal(r.value.record.status, 'draft'); assert.equal(r.value.record.reconciliation.contract_cents, 353_550)
  assert.deepEqual(job.continuity.find(w => w.id === workflowId).billing.claim_ids, [r.value.record.id])
  assert.deepEqual(job.claims.find(c => c.id === firstClaimId), firstClaim)
  assert.equal(f.messages.length, sent, 'Continuation never sends a notice without an owner-approved channel')
  const notice = { email: 'allowance@example.com', channel: 'email', confirm: true }
  assert.equal((await act(`/continuity/${workflowId}/notify`, notice, undefined, agent)).status, 403)
  assert.equal((await act(`/continuity/${workflowId}/notify`, notice, client)).status, 403)
  assert.equal((await act(`/continuity/${workflowId}/notify`, { ...notice, confirm: false })).status, 400)
  assert.equal((await act(`/continuity/${workflowId}/notify`, { ...notice, channel: 'sms' })).status, 400)
  assert.equal((await act(`/continuity/${workflowId}/notify`, { ...notice, email: 'unrelated@example.com' })).status, 403)
  assert.equal((await act(`/continuity/${workflowId}/notify`, notice)).status, 200)
  const outcome = job.continuity.find(w => w.id === workflowId).notices[0]
  assert.equal(outcome.status, 'accepted'); assert.equal(outcome.channel, 'email'); assert.equal(outcome.approved_by.role, 'owner')
  assert.equal(f.messages.length, sent + 1); assert.deepEqual(f.messages.at(-1).to, ['allowance@example.com'])
  assert.ok(!f.messages.at(-1).text.includes('private-vendor')); assert.ok(!f.messages.at(-1).text.includes('353550'))
  assert.equal((await act(`/continuity/${workflowId}/notify`, notice)).status, 409); assert.equal(f.messages.length, sent + 1)
  const noPrivate = (await api(`/jobs/${job.id}`, undefined, client)).value.job
  assert.equal(noPrivate.continuity, undefined)
  const person = await f.db.prepare("SELECT id FROM oa_operators WHERE email='allowance@example.com'").first()
  assert.equal((await f.json('/auth/operator/status', { method: 'POST', cookie: f.owner, body: { operatorId: person.id, status: 'inactive' } })).status, 200)
  assert.equal((await act(`/continuity/${oldWorkflow.id}/notify`, notice)).status, 403)
  assert.equal(f.messages.length, sent + 1)
  // The native role/assignment wins even when an internal person's email is the original client email.
  await f.invite('unassigned-pm@example.com', 'Unassigned project manager', 'admin')
  const internalJob = await createActiveJob(f, 'Internal identity is still assignment-scoped', 'unassigned-pm@example.com')
  const internalPerson = await f.db.prepare("SELECT id FROM oa_operators WHERE email='unassigned-pm@example.com'").first()
  const restricted = await f.json('/api/plinth/team/' + internalPerson.id, { method: 'PUT', cookie: f.owner, body: { expected_version: 0, role: 'project_manager', job_ids: [], po_limit_cents: 0 } })
  assert.equal(restricted.status, 200)
  const denied = await f.json(`/api/plinth/jobs/${internalJob.id}/continuity/${internalJob.continuity[0].id}/notify`, { method: 'POST', cookie: f.owner, body: { expected_version: internalJob.version, email: 'unassigned-pm@example.com', channel: 'email', confirm: true } })
  assert.equal(denied.status, 403, 'An unassigned PM cannot receive a job notice by also matching its client email')

 } finally { await f.close() }
})


test('AUTO-002 — refused, unknown, development and unconfigured notice outcomes remain durable and cannot replay a provider effect', async () => {
 for (const outcome of ['refused', 'unknown', 'development', 'unconfigured']) {
  const f = await createFixture({ mailProvider: outcome === 'unconfigured' ? null : outcome === 'development' ? 'development' : 'resend', mailResponse: () => Response.json({ message: 'Network-edge outcome' }, { status: outcome === 'refused' ? 422 : 500 }) })
  try {
   let job = await createActiveJob(f, 'Pine Street approved sale')
   const id = job.continuity[0].id, path = `/api/plinth/jobs/${job.id}/continuity/${id}/notify`
   const input = { email: 'builder@example.com', channel: 'email', confirm: true }
   let r = await f.json(path, { method: 'POST', cookie: f.owner, body: { expected_version: job.version, ...input } })
   assert.equal(r.status, 200, JSON.stringify(r.value)); job = r.value.job
   assert.equal(job.continuity[0].notices[0].status, outcome)
   const attempts = f.messages.length
   assert.equal(attempts, ['refused', 'unknown'].includes(outcome) ? 1 : 0)
   r = await f.json(path, { method: 'POST', cookie: f.owner, body: { expected_version: job.version, ...input } })
   assert.equal(r.status, 409); assert.equal(f.messages.length, attempts)
   const reloaded = await f.json(`/api/plinth/jobs/${job.id}`, { cookie: f.owner })
   assert.deepEqual(reloaded.value.job.continuity[0].notices, job.continuity[0].notices)
  } finally { await f.close() }
 }
})

test('CLIENT-005 — overdue requests never accept; disputed substitutions require fresh exact builder/client decisions before any PO', async () => {
 const f=await createFixture()
 try {
  const client=await f.invite('client@example.com','Decision Client'),foreign=await f.invite('foreign@example.com'),agent=await f.agent()
  let r=await f.json('/api/plinth/jobs',{method:'POST',cookie:f.owner,body:{name:'Decision hold',client_email:'client@example.com'}}),job=r.value.job
  const read=async(cookie=f.owner)=>(await f.json(`/api/plinth/jobs/${job.id}`,{cookie})).value.job
  const act=async(path,input={},cookie=f.owner,token)=>{const result=await f.json(`/api/plinth/jobs/${job.id}${path}`,{method:'POST',cookie,token,body:{expected_version:job.version,...input}});job=await read();return result}
  assert.equal((await act('/quotes',{lines:[{id:'fixture',description:'Agreed works',cost_code:'22-400',phase:'Finishes',category:'material',quantity:'1',unit:'job',unit_cents:1000000,cost_unit_cents:500000}]})).status,200)
  assert.equal((await act(`/quotes/${job.quotes[0].id}/accept`,{method:'email',evidence:'Recorded scope acceptance',schedule_choice:{kind:'none',reason:'Procurement first'},budget:{allowances:[{cost_code:'22-400',amount_cents:30000}]}})).status,200)
  const terms={room:'Kitchen',category:'Faucet',allowance_cents:30000,cost_code:'22-400',decision_on:'2020-01-01',lead_days:21,options:[{name:'Original brass faucet',supplier:'Synthetic supply',specifications:'Single hole, 8 inch reach',price_cents:30000}]}
  r=await act('/selections',terms);const id=r.value.record.id,current=()=>job.selections[0].revisions.at(-1),path=action=>`/selections/${id}/${action}`
  assert.equal((await act(path('present'),{revision_id:current().id})).status,200)
  const original=structuredClone(current()),beforeMessages=f.messages.length
  const pdf=Buffer.from('%PDF-1.4\nsynthetic-plinth-1\n%%EOF'),file={name:'supplier-notice.pdf',mime:'application/pdf',base64:pdf.toString('base64')}
  r=await act(path('reminder'),{revision_id:current().id,reason:'Deadline passed; request an explicit decision',attachments:[file]});assert.equal(r.status,200);assert.equal(current().status,'presented');assert.equal(current().signature,undefined);assert.equal(f.messages.length,beforeMessages,'A reminder is an honestly labelled record, never a claimed send')
  const attachment=r.value.record.decisions.at(-1).attachments[0]
  for(const cookie of [f.owner,client]){const response=await f.request(`/api/plinth/jobs/${job.id}/decision-files/${attachment.id}`,{cookie});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf)}
  assert.equal((await f.request(`/api/plinth/jobs/${job.id}/decision-files/${attachment.id}`,{cookie:foreign})).status,404)
  assert.equal((await act(path('order'),{revision_id:current().id})).value.error,'selection_unsigned')
  const substitution={...terms,options:[{...terms.options[0],name:'Chrome substitute',price_cents:28000,specifications:'Single hole, 7 inch reach'}],revision_id:current().id,option_id:current().options[0].id,unavailable_reason:'Supplier discontinued the brass finish',previous_available_on:'2026-11-01',available_on:'2026-11-08',specification_comparison:'Chrome instead of brass; reach reduced by one inch',date_impact_days:7}
  for(const [cookie,token] of [[client,undefined],[undefined,agent],[foreign,undefined]])assert.ok([403,404].includes((await act(path('substitute'),substitution,cookie,token)).status))
  r=await act(path('substitute'),substitution);assert.equal(r.status,200);assert.deepEqual(job.selections[0].revisions[0],original)
  const draft=structuredClone(current());assert.equal(draft.status,'draft');assert.equal(draft.substitution.previous_option.price_cents,30000)
  assert.equal((await read(client)).selections[0].revisions.length,1,'A draft comparison is private')
  assert.equal((await act(path('present'),{revision_id:current().id})).value.error,'substitution_review')
  assert.equal((await act(path('present'),{revision_id:current().id,confirm_substitution:true})).status,200)
  assert.equal((await read(client)).selections[0].revisions.at(-1).substitution.specification_comparison,substitution.specification_comparison)
  const sign=()=>({revision_id:current().id,option_id:current().options[0].id,statement:'I approve this exact revised specification and price',confirm:true})
  assert.equal((await act(path('dispute'),{revision_id:current().id,reason:'I need the original reach',attachments:[file]},f.owner)).status,403)
  r=await act(path('dispute'),{revision_id:current().id,reason:'I need the original reach',attachments:[file]},client);assert.equal(r.status,200);assert.equal(r.value.record.decisions.at(-1).by.name,'Decision Client')
  assert.equal((await act(path('sign'),sign(),client)).value.error,'selection_held');assert.equal(job.orders.length,0)
  const disputed=structuredClone(current())
  r=await act(path('substitute'),{...substitution,revision_id:current().id,option_id:current().options[0].id,options:[{...terms.options[0],name:'Revised chrome faucet',price_cents:29000}],specification_comparison:'Same original reach, chrome finish'});assert.equal(r.status,200)
  assert.equal((await act(path('present'),{revision_id:current().id,confirm_substitution:true})).status,200)
  assert.equal((await act(path('sign'),sign(),f.owner)).status,403)
  assert.equal((await act(path('sign'),sign(),client)).status,200);assert.deepEqual(job.selections[0].revisions[1],disputed)
  let signed=structuredClone(current())
  r=await act(path('order'),{revision_id:current().id,vendor_email:'vendor@example.com'});assert.equal(r.status,200);const order=r.value.record
  assert.equal(order.status,'draft');assert.equal(order.amount_cents,29000);assert.equal((await act(`/orders/${order.id}/issue`)).status,200)
  r=await f.json('/api/plinth/pricing-rates',{method:'POST',cookie:f.owner,body:{jurisdiction:'Synthetic exemption',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'Reviewed synthetic exemption',human_reviewed:true}});assert.equal(r.status,201);const rate=r.value.rate
  const allowanceInput={selection_id:id,revision_id:current().id,schedule_days:7,impact_reference:'Reviewed substitution credit and delivery impact',impacts_reviewed:true,basis:'sell',as_of:'2026-10-22',rules:[],tax:{rate_id:rate.id,taxable_line_ids:[],exemption_reference:'Synthetic reviewed exemption'},lines:[{id:'credit',description:'Faucet credit',cost_code:'22-400',phase:'Finishes',category:'material',quantity:'1',unit:'each',unit_cents:1000,cost_unit_cents:500}]}
  r=await act('/allowance-changes/preview',allowanceInput);assert.equal(r.status,200,JSON.stringify(r.value))
  r=await act('/allowance-changes/apply',{...allowanceInput,digest:r.value.preview.digest});assert.equal(r.status,200);const pendingAllowance=r.value.record.id,budgets=structuredClone(job.budgets)
  signed=structuredClone(current())
  assert.equal((await act(path('dispute'),{revision_id:current().id,reason:'Stop further action pending site review'},client)).status,200)
  assert.equal((await act(`/orders/${order.id}/send`)).value.error,'selection_held','A dispute fences even an approved but unsent PO')
  assert.equal((await act(`/variations/${pendingAllowance}/approve`,{},client)).value.error,'selection_held','CLIENT-005: a disputed decision refuses its pending allowance approval')
  assert.deepEqual(job.budgets,budgets);assert.equal(job.variations[0].status,'draft')
  assert.equal(f.messages.length,beforeMessages);assert.deepEqual(current(),signed,'A dispute never erases or changes an earlier signature')
  assert.equal(job.orders.length,1);assert.equal(job.variations.length,1);assert.equal(job.quotes[0].total_cents,1000000)
  r=await act('/selections',{...terms,category:'Withdrawal'});const other=r.value.record,rev=other.revisions[0]
  assert.equal((await act(`/selections/${other.id}/present`,{revision_id:rev.id})).status,200)
  assert.equal((await act(`/selections/${other.id}/withdraw`,{revision_id:rev.id,reason:'Scope removed by builder'})).status,200)
  assert.equal((await act(`/selections/${other.id}/sign`,{revision_id:rev.id,option_id:rev.options[0].id,statement:'Too late',confirm:true},client)).value.error,'selection_held')
 } finally {await f.close()}
})
