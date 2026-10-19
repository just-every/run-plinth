import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from './helpers.mjs'

// Independent cent reconciliation from the exported decimal factors, through HTTP only.
const rational = value => {
 const [whole, fraction = ''] = String(value).split('.')
 return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)]
}
const rounded = (line, rate) => {
 const [q, qd] = rational(line.quantity), [n, nd] = rational(line.conversion?.numerator ?? '1'), [d, dd] = rational(line.conversion?.denominator ?? '1')
 const top = q * n * dd * BigInt(rate), bottom = qd * nd * d
 const whole = top / bottom, remainder = top % bottom
 return Number(whole + (remainder * 2n >= bottom ? 1n : 0n))
}
const csvRows = text => text.trim().split('\r\n').map(row => [...row.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"')))

test('EST-001 — exact coded multi-trade costs/sell, selected alternates, immutable revisions and reconciled exports', async () => {
 const f = await createFixture()
 try {
  const client = await f.invite('estimate-client@example.com'), foreign = await f.invite('other-estimate@example.com'), agent = await f.agent()
  let response = await f.json('/api/plinth/jobs', { method: 'POST', cookie: f.owner, body: { name: 'Measured kitchen and exterior remodel', client_email: 'estimate-client@example.com' } })
  assert.equal(response.status, 201); let job = response.value.job
  const root = `/api/plinth/jobs/${job.id}`
  const post = (path, body, credentials = { cookie: f.owner }) => f.json(root + path, { method: 'POST', ...credentials, body: { expected_version: job.version, ...body } })
  const line = (id, category, quantity, cost, sell, extra = {}) => ({ id, description: `${category} trade scope`, cost_code: category === 'labor' ? '06-100' : '09-200', phase: category === 'labor' ? 'Framing' : 'Finishes', category, quantity, unit: 'each', rate_unit: 'each', cost_unit_cents: cost, unit_cents: sell, ...extra })
  const lines = [
   line('labor', 'labor', '2.5', 2001, 3001, { unit: 'hour', rate_unit: 'hour' }),
   line('material', 'material', '18.125', 801, 1201, { description: 'Trim measured in inches', unit: 'inch', rate_unit: 'foot', conversion: { numerator: '1', denominator: '12' } }),
   line('equipment', 'equipment', '0.1', 15, 45, { unit: 'hour', rate_unit: 'day', conversion: { numerator: '1', denominator: '3' } }),
   line('subcontract', 'subcontract', '1.333333333333333333', 9001, 12001),
   line('other', 'other', '1', 25, 50),
   line('oak', 'material', '10.125', 225, 375, { description: 'Oak finish', alternate_group: 'Finish', alternate_option: 'Oak' }),
   line('tile', 'material', '10.125', 325, 525, { description: 'Tile finish', alternate_group: 'Finish', alternate_option: 'Tile' }),
  ]
  const body = { lines, alternate_selections: { Finish: 'Oak' }, inclusions: ['Install and protect finishes'], exclusions: ['Unforeseen concealed defects'], notes: 'Site measurement revision' }
  assert.equal((await post('/quotes', body, { cookie: client })).status, 403)
  assert.equal((await f.json(root + '/quotes', { method: 'POST', body })).status, 401)
  const invalids = [
   { quantity: 0.1 }, { quantity: '-1' }, { quantity: '0' }, { quantity: '1e2' }, { quantity: '0.1234567890123456789' },
   { conversion: { numerator: '1', denominator: '0' } }, { cost_unit_cents: 1.5 }, { unit_cents: -1 }, { unit_cents: 1_000_000_000_000, quantity: '2' },
   { category: 'unknown' }, { cost_code: '' }, { unit: 'inch', rate_unit: 'foot' },
  ]
  for (const invalid of invalids) assert.equal((await post('/quotes', { ...body, lines: [{ ...lines[0], ...invalid }] })).status, 400, JSON.stringify(invalid))
  assert.equal((await post('/quotes', { ...body, lines: [lines[0], lines[0]] })).status, 400)
  assert.equal((await post('/quotes', { ...body, alternate_selections: { Finish: 'Unknown' } })).status, 400)
  // Bearer agents retain existing draft preparation authority and cannot accept/export.
  response = await post('/quotes', body, { token: agent }); assert.equal(response.status, 200); job = response.value.job
  const first = structuredClone(job.quotes.at(-1))
  for (const actual of first.lines) {
   assert.equal(actual.total_cents, rounded(actual, actual.unit_cents))
   assert.equal(actual.cost_total_cents, rounded(actual, actual.cost_unit_cents))
  }
  assert.equal(first.lines.find(row => row.id === 'equipment').cost_total_cents, 1, 'A half-cent rounds up once after exact conversion')
  assert.equal(first.lines.find(row => row.id === 'tile').included, false)
  assert.equal(first.lines.find(row => row.id === 'oak').included, true)
  const totals = quote => quote.lines.filter(row => row.included).reduce((total, row) => ({ sell: total.sell + rounded(row, row.unit_cents), cost: total.cost + rounded(row, row.cost_unit_cents) }), { sell: 0, cost: 0 })
  assert.equal(first.total_cents, totals(first).sell); assert.equal(first.cost_total_cents, totals(first).cost)
  assert.equal((await post(`/quotes/${first.id}/accept`, { method: 'signed', evidence: 'Agent cannot record this decision' }, { token: agent })).status, 403)
  assert.equal((await f.json(root, { cookie: client })).value.job.quotes.length, 0, 'Draft estimate stays private')

  const revisedBody = { ...body, lines: first.lines.map(row => row.id === 'labor' ? { ...row, quantity: '3.75', phase: 'Framing revised' } : row), alternate_selections: { Finish: 'Tile' }, inclusions: [...body.inclusions, 'Additional framing bay'], exclusions: ['Existing electrical repairs'] }
  response = await post('/quotes', revisedBody); assert.equal(response.status, 200); job = response.value.job
  const second = structuredClone(job.quotes.at(-1))
  assert.equal(second.revision, first.revision + 1)
  assert.deepEqual(job.quotes[0], { ...first, status: 'superseded' }, 'Earlier measured scope and prices stay fixed')
  assert.equal(second.lines.find(row => row.id === 'labor').quantity, '3.75')
  assert.equal(second.lines.find(row => row.id === 'oak').included, false)
  assert.equal(second.lines.find(row => row.id === 'tile').included, true)
  assert.notEqual(second.total_cents, first.total_cents); assert.notEqual(second.cost_total_cents, first.cost_total_cents)
  assert.equal(second.total_cents, totals(second).sell); assert.equal(second.cost_total_cents, totals(second).cost)
  assert.deepEqual(second.inclusions, revisedBody.inclusions); assert.deepEqual(second.exclusions, revisedBody.exclusions)
  assert.equal((await post('/quotes', { ...body, expected_version: job.version - 1 })).status, 409)
  assert.equal((await post(`/quotes/${first.id}/accept`, { method: 'email', evidence: 'Old revision' })).status, 409)

  for (const quote of [first, second]) {
   const path = `${root}/quotes/${quote.id}/cost-codes`
   for (const credentials of [{}, { cookie: client }, { cookie: foreign }, { token: agent }]) {
    assert.ok([401, 403, 404].includes((await f.request(path + '.json', credentials)).status))
    assert.ok([401, 403, 404].includes((await f.request(path + '.csv', credentials)).status))
   }
   const exported = await f.json(path + '.json', { cookie: f.owner }); assert.equal(exported.status, 200)
   const report = exported.value
   assert.equal(report.total_cents, totals(quote).sell); assert.equal(report.cost_total_cents, totals(quote).cost)
   assert.equal(report.cost_codes.reduce((sum, code) => sum + code.total_cents, 0), report.total_cents)
   assert.equal(report.cost_codes.reduce((sum, code) => sum + code.cost_total_cents, 0), report.cost_total_cents)
   for (const code of report.cost_codes) {
    const selected = report.lines.filter(row => row.included && row.cost_code === code.cost_code && row.phase === code.phase && row.category === code.category)
    assert.equal(code.total_cents, selected.reduce((sum, row) => sum + rounded(row, row.unit_cents), 0))
    assert.equal(code.cost_total_cents, selected.reduce((sum, row) => sum + rounded(row, row.cost_unit_cents), 0))
   }
   const csvResponse = await f.request(path + '.csv', { cookie: f.owner }); assert.equal(csvResponse.status, 200)
   const [headings, ...rows] = csvRows(await csvResponse.text()), records = rows.map(row => Object.fromEntries(headings.map((key, index) => [key, row[index]])))
   const detail = records.filter(row => row.row_type === 'line')
   assert.equal(detail.length, quote.lines.length)
   for (const row of detail) {
    const actual = quote.lines.find(line => line.id === row.line_id)
    assert.equal(row.quantity, String(actual.quantity)); assert.equal(Number(row.total_cents), rounded(actual, actual.unit_cents)); assert.equal(Number(row.cost_total_cents), rounded(actual, actual.cost_unit_cents))
   }
   const codeRows=records.filter(row=>row.row_type==='code_total')
   assert.equal(codeRows.length,report.cost_codes.length)
   for(const row of codeRows){const code=report.cost_codes.find(code=>code.cost_code===row.cost_code&&code.phase===row.phase&&code.category===row.category);assert.ok(code);assert.equal(Number(row.total_cents),code.total_cents);assert.equal(Number(row.cost_total_cents),code.cost_total_cents)}
   assert.equal(Number(records.find(row => row.row_type === 'estimate_total').total_cents), report.total_cents)
   assert.equal(Number(records.find(row => row.row_type === 'estimate_total').cost_total_cents), report.cost_total_cents)
  }
  response = await post(`/quotes/${second.id}/accept`, { method: 'signed', evidence: 'Client signed the measured scope and Tile selection' }); assert.equal(response.status, 200); job = response.value.job
  const snapshot = job.approvals.find(row => row.kind === 'quote').snapshot
  assert.deepEqual(snapshot.lines, second.lines); assert.deepEqual(snapshot.inclusions, second.inclusions); assert.deepEqual(snapshot.exclusions, second.exclusions); assert.deepEqual(snapshot.alternate_selections, second.alternate_selections)
  assert.equal(snapshot.cost_total_cents, second.cost_total_cents)
  assert.equal((await post('/quotes', revisedBody)).status, 409)
  const visible = (await f.json(root, { cookie: client })).value.job
  assert.equal(visible.quotes[0].total_cents, second.total_cents)
  assert.equal(visible.quotes[0].lines.length, second.lines.filter(line => line.included).length)
  assert.ok(visible.quotes[0].lines.every(line => line.cost_code === undefined && line.phase === undefined && line.category === undefined))
  assert.deepEqual(visible.quotes[0].exclusions, second.exclusions)
  const listing=await f.json('/api/plinth/jobs',{cookie:client});assert.equal(listing.status,200)
  assert.deepEqual(listing.value.jobs.find(row=>row.id===job.id).quotes,visible.quotes,'List and detail use the same current client projection')
  const clientBytes = JSON.stringify(visible)
  assert.ok(!clientBytes.includes('cost_unit_cents') && !clientBytes.includes('cost_total_cents'), 'Client quote and approval snapshots expose selling terms without internal costs')
  assert.equal((await f.json(root, { cookie: foreign })).status, 404)
  assert.deepEqual((await f.json(root, { cookie: f.owner })).value.job.quotes.at(-1), { ...second, status: 'accepted', acceptance: job.quotes.at(-1).acceptance })

  // Real reviewed import supplies a historic uncoded quote; do not fabricate rates or costs.
  const csv = 'external_id,title,client_email,site_address,quote_cents,accepted_on\nEST-LEGACY,Historical uncoded job,legacy@example.com,,12345,2026-10-01\n'
  const preview = await f.json('/api/plinth/imports/preview', { method: 'POST', cookie: f.owner, body: { csv } }); assert.equal(preview.status, 200)
  assert.equal((await f.json('/api/plinth/imports/commit', { method: 'POST', cookie: f.owner, body: { csv, fingerprint: preview.value.fingerprint } })).status, 200)
  const legacy = (await f.json('/api/plinth/jobs', { cookie: f.owner })).value.jobs.find(row => row.import_evidence?.external_id === 'EST-LEGACY')
  assert.equal(legacy.quotes[0].total_cents, 12345)
  const legacyExport = await f.json(`/api/plinth/jobs/${legacy.id}/quotes/${legacy.quotes[0].id}/cost-codes.json`, { cookie: f.owner })
  assert.equal(legacyExport.status, 200); assert.equal(legacyExport.value.total_cents, legacy.quotes[0].total_cents); assert.equal(legacyExport.value.cost_total_cents, null)
  assert.equal(legacyExport.value.cost_codes[0].cost_code, null)
 } finally { await f.close() }
})
