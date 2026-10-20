import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from './helpers.mjs'

const rateBody = { jurisdiction: 'Synthetic fixture jurisdiction', effective_on: '2026-10-01', kind: 'sales', percent: '7.5', reference: 'Reviewed synthetic fixture rate schedule, October 1', human_reviewed: true }
const rule = (scope, key, values = {}) => ({ scope, ...(key ? { key } : {}), overhead_percent: '0', method: 'markup', percent: '0', discount_percent: '0', ...values })
async function estimate(f, client_email, lines) {
 let result = await f.json('/api/plinth/jobs', { method: 'POST', cookie: f.owner, body: { name: 'Scoped pricing review', client_email } })
 assert.equal(result.status, 201)
 let job = result.value.job
 result = await f.json(`/api/plinth/jobs/${job.id}/quotes`, { method: 'POST', cookie: f.owner, body: { expected_version: job.version, lines } })
 assert.equal(result.status, 200); return result.value.job
}
const line = (id, phase, cost = 10000, sell = 20000) => ({ id, description: `Measured ${id}`, quantity: '1', unit: 'each', rate_unit: 'each', cost_code: '06-100', phase, category: 'labor', cost_unit_cents: cost, unit_cents: sell })

test('EST-003 — human-reviewed scoped pricing reconciles final lines, preserves revisions and refuses stale or frozen approval', async () => {
 const f = await createFixture()
 try {
  const client = await f.invite('pricing-client@example.com'), agent = await f.agent()
  const rates = '/api/plinth/pricing-rates'
  for (const credentials of [{}, { cookie: client }, { token: agent }]) assert.ok([401, 403].includes((await f.json(rates, { method: 'POST', ...credentials, body: rateBody })).status))
  assert.equal((await f.json(rates, { cookie: client })).status, 403)
  assert.equal((await f.json(rates, { method: 'POST', cookie: f.owner, body: { ...rateBody, human_reviewed: false } })).status, 400)
  let result = await f.json(rates, { method: 'POST', cookie: f.owner, body: rateBody }); assert.equal(result.status, 201)
  let rate = result.value.rate
  assert.equal(rate.revisions[0].approved_by.role, 'owner')
  let job = await estimate(f, 'pricing-client@example.com', [line('a', 'Prep'), line('b', 'Prep'), line('c', 'Finish')])
  const original = structuredClone(job.quotes.at(-1)), root = `/api/plinth/jobs/${job.id}`
  const post = (path, body, credentials = { cookie: f.owner }) => f.json(root + path, { method: 'POST', ...credentials, body: { expected_version: job.version, ...body } })
  const input = { basis: 'cost', as_of: '2026-10-20', rules: [rule('project', undefined, { percent: '20', discount_percent: '10' }), rule('line', 'b', { overhead_percent: '100' }), rule('phase', 'Prep', { method: 'margin', percent: '20', discount_percent: '10' }), rule('line', 'a', { overhead_percent: '100' })], tax: { rate_id: rate.id, taxable_line_ids: ['a', 'c'], exemption_reference: 'Reviewed fixture exemption certificate for b', provider: 'manual' } }
  assert.equal((await post('/pricing/preview', input, { cookie: client })).status, 403)
  const invalids = [
   { rules: [rule('project'), rule('project')] }, { rules: [rule('line', 'unknown')] }, { rules: [rule('phase', 'Unknown')] },
   { rules: [rule('project', undefined, { method: 'margin', percent: '100' })] }, { rules: [rule('project', undefined, { overhead_percent: '-1' })] },
   { rules: [rule('project', undefined, { discount_percent: '100.1' })] }, { rules: [rule('project', undefined, { percent: 0.1 })] },
   { tax: { ...input.tax, taxable_line_ids: ['a', 'a'] } }, { tax: { ...input.tax, taxable_line_ids: ['missing'] } }, { tax: { ...input.tax, exemption_reference: '' } },
  ]
  for (const invalid of invalids) assert.equal((await post('/pricing/preview', { ...input, ...invalid })).status, 400, JSON.stringify(invalid))
  assert.equal((await post('/pricing/preview', { ...input, as_of: '2026-09-01' })).status, 409)
  result = await post('/pricing/preview', { ...input, tax: { ...input.tax, provider: 'unavailable-provider' } }); assert.equal(result.status, 503); assert.equal(result.value.error, 'tax_provider_unavailable')
  result = await post('/pricing/preview', input, { token: agent }); assert.equal(result.status, 200)
  let preview = result.value.preview
  assert.equal(preview.proposal.total_cents, 62033)
  const pricing = preview.proposal.pricing
  assert.equal(pricing.subtotal_cents, 59400); assert.equal(pricing.tax.taxable_cents, 35100); assert.equal(pricing.tax.exempt_cents, 24300); assert.equal(pricing.tax.tax_cents, 2633, 'Half-cent tax rounds up at the reviewed taxable scope')
  assert.deepEqual(preview.proposal.lines.map(row => row.total_cents), [26123, 24300, 11610])
  assert.equal(pricing.stages.find(stage => stage.kind === 'margin').total_cents, 50000)
  assert.equal(pricing.stages.find(stage => stage.kind === 'markup' && stage.scope === 'project').total_cents, 72000)
  assert.equal(pricing.stages.find(stage => stage.kind === 'discount' && stage.scope === 'project').total_cents, 59400)
  assert.equal((await post('/pricing/apply', { ...input, digest: preview.digest }, { token: agent })).status, 403)
  assert.equal((await post('/pricing/apply', { ...input, digest: 'unreviewed' })).status, 409)
  assert.equal((await post('/pricing/apply', { ...input, basis: 'sell', digest: preview.digest })).status, 409)
  // A new reviewed revision invalidates the old preview even when its dated rate value is unchanged.
  result = await f.json(rates + '/' + rate.id, { method: 'POST', cookie: f.owner, body: { ...rateBody, reference: 'Corrected reviewed source reference', expected_version: rate.version } }); assert.equal(result.status, 200); rate = result.value.rate
  assert.equal((await post('/pricing/apply', { ...input, digest: preview.digest })).status, 409)
  assert.equal((await f.json(rates + '/' + rate.id, { method: 'POST', cookie: f.owner, body: { ...rateBody, expected_version: rate.version - 1 } })).status, 409)
  result = await post('/pricing/preview', input); assert.equal(result.status, 200); preview = result.value.preview
  result = await post('/pricing/apply', { ...input, digest: preview.digest }); assert.equal(result.status, 200); job = result.value.job
  const priced = structuredClone(job.quotes.at(-1))
  assert.equal(priced.total_cents, 62033); assert.deepEqual(job.quotes[0], { ...original, status: 'superseded' })
  assert.equal(priced.cost_total_cents, 30000); assert.deepEqual(priced.pricing.base_lines, original.lines)
  assert.equal(priced.pricing.tax.rate_version, 2)
  assert.equal(job.approvals.find(row => row.kind === 'estimate.pricing').snapshot.total_cents, priced.total_cents)
  result = await f.json(`${root}/quotes/${priced.id}/cost-codes.json`, { cookie: f.owner }); assert.equal(result.status, 200)
  assert.equal(result.value.total_cents, priced.total_cents)
  assert.equal(result.value.lines.reduce((sum, row) => sum + row.total_cents, 0), priced.total_cents)
  assert.equal(result.value.cost_codes.reduce((sum, row) => sum + row.total_cents, 0), priced.total_cents)
  const csv = await f.request(`${root}/quotes/${priced.id}/cost-codes.csv`, { cookie: f.owner }); assert.equal(csv.status, 200); assert.ok((await csv.text()).includes('"62033"'))
  assert.equal((await post('/pricing/apply', { ...input, digest: preview.digest })).status, 409, 'A changed job revision also invalidates the preview')
  const repeat = await post('/pricing/preview', input); assert.equal(repeat.status, 200); assert.equal(repeat.value.preview.proposal.total_cents, priced.total_cents, 'Repeat pricing starts from original base lines')
  result = await post(`/quotes/${priced.id}/accept`, { method: 'signed',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'}, evidence: 'Client signed scoped pricing and reviewed tax terms' }); assert.equal(result.status, 200); job = result.value.job
  const signed = structuredClone(job.quotes.at(-1)), signedApproval = job.approvals.find(row => row.kind === 'quote').snapshot
  assert.deepEqual(signedApproval.pricing, signed.pricing)
  result = await f.json(rates + '/' + rate.id, { method: 'POST', cookie: f.owner, body: { ...rateBody, percent: '8', expected_version: rate.version } }); assert.equal(result.status, 200)
  const impact = await post('/pricing/preview', input); assert.equal(impact.status, 200); assert.equal(impact.value.preview.sold, true); assert.notEqual(impact.value.preview.proposal.total_cents, signed.total_cents)
  assert.equal((await post('/pricing/apply', { ...input, digest: impact.value.preview.digest })).status, 409)
  const retained = (await f.json(root, { cookie: f.owner })).value.job
  assert.deepEqual(retained.quotes.at(-1), signed); assert.deepEqual(retained.approvals.find(row => row.kind === 'quote').snapshot, signedApproval)
  const visible = (await f.json(root, { cookie: client })).value.job
  assert.equal(visible.quotes[0].total_cents, signed.total_cents)
  assert.deepEqual(visible.quotes[0].lines.map(row => row.total_cents), [26123, 24300, 11610])
  const listing=await f.json('/api/plinth/jobs',{cookie:client});assert.equal(listing.status,200);assert.deepEqual(listing.value.jobs.find(row=>row.id===job.id).quotes,visible.quotes)
  assert.equal((await f.json(`${root}/quotes/${signed.id}/cost-codes.json`,{cookie:client})).status,403)
  const clientBytes = JSON.stringify(visible)
  for (const privateKey of ['base_lines', 'overhead_percent', 'discount_percent', 'cost_unit_cents', 'cost_total_cents', 'Corrected reviewed source reference']) assert.ok(!clientBytes.includes(privateKey), `Client projection omits ${privateKey}`)
 } finally { await f.close() }
})

test('EST-003 — markup and gross margin differ with exact half-up stages, zero discounts and reviewed exemptions', async () => {
 const f = await createFixture()
 try {
  const rate = (await f.json('/api/plinth/pricing-rates', { method: 'POST', cookie: f.owner, body: { ...rateBody, kind: 'use', percent: '50' } })).value.rate
  const job = await estimate(f, 'rounding@example.com', [line('fraction', 'Finish', 101, 301)])
  const post = body => f.json(`/api/plinth/jobs/${job.id}/pricing/preview`, { method: 'POST', cookie: f.owner, body: { expected_version: job.version, ...body } })
  const input = { basis: 'cost', as_of: '2026-10-20', rules: [rule('project', undefined, { percent: '50', discount_percent: '50' })], tax: { rate_id: rate.id, taxable_line_ids: ['fraction'] } }
  const markup = await post(input); assert.equal(markup.status, 200)
  assert.equal(markup.value.preview.proposal.pricing.stages.find(stage => stage.kind === 'markup').total_cents, 152)
  assert.equal(markup.value.preview.proposal.pricing.subtotal_cents, 76); assert.equal(markup.value.preview.proposal.total_cents, 114)
  const margin = await post({ ...input, rules: [rule('project', undefined, { method: 'margin', percent: '50', discount_percent: '50' })] }); assert.equal(margin.status, 200)
  assert.equal(margin.value.preview.proposal.pricing.stages.find(stage => stage.kind === 'margin').total_cents, 202)
  assert.equal(margin.value.preview.proposal.pricing.subtotal_cents, 101); assert.equal(margin.value.preview.proposal.total_cents, 152)
  const exempt = await post({ ...input, tax: { ...input.tax, taxable_line_ids: [], exemption_reference: 'Reviewed whole-scope fixture exemption' } }); assert.equal(exempt.status, 200)
  assert.equal(exempt.value.preview.proposal.pricing.tax.tax_cents, 0); assert.equal(exempt.value.preview.proposal.total_cents, 76)
  const free = await post({ ...input, rules: [rule('project', undefined, { discount_percent: '100' })] }); assert.equal(free.status, 200); assert.equal(free.value.preview.proposal.total_cents, 0)
 } finally { await f.close() }
})
