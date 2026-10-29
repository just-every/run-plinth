import assert from 'node:assert/strict'

/** Native source setup shared by decision and recovery sanity journeys. */
export async function decisionGraphFixture(f, initial) {
 let job = initial
 const root = '/api/plinth/jobs/' + job.id
 const read = async () => { job = (await f.json(root, { cookie: f.owner })).value.job; return job }
 const act = async (path, body = {}, options = {}) => {
  await read()
  const r = await f.json(root + path, { method: 'POST', cookie: f.owner, body: { expected_version: job.version, ...body }, ...options })
  assert.equal(r.status, 200, JSON.stringify(r.value)); await read(); return r.value.record
 }
 const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='
 const productTerms = { name: 'Synthetic fixture', sku: 'synthetic-plinth-1', supplier: 'Synthetic fixtures', source_url: 'https://supplier.example.invalid/fixture', dimensions: '8 inch reach', cost_quote_cents: 10000, lead_days: 14, captured_on: '2026-10-01', valid_until: '2027-10-01', discontinued: false, evidence: 'Reviewed synthetic supplier quote', image: { name: 'fixture.png', mime: 'image/png', base64: png } }
 const original = await act('/products', productTerms)
 await act('/products/' + original.id + '/review', { revision_id: original.revisions[0].id, confirm: true })
 const alternate = await act('/products', { ...productTerms, name: 'Synthetic alternate', dimensions: '9 inch reach', cost_quote_cents: 7500 })
 await act('/products/' + alternate.id + '/review', { revision_id: alternate.revisions[0].id, confirm: true })
 const terms = { room: 'Kitchen', category: 'Fixture', allowance_cents: 12000, cost_code: '22', decision_on: '2026-11-09', lead_days: 14, options: [{ name: 'Original fixture', supplier: 'Synthetic fixtures', specifications: '8 inch reach', price_cents: 12000, product_id: original.id, product_revision_id: original.revisions[0].id }] }
 const selection = await act('/selections', terms)
 const task = await act('/schedules', { trade: 'Synthetic fixtures', description: 'Install chosen fixture', start: '2026-11-30T08:00:00Z', end: '2026-11-30T10:00:00Z' })
 const link = { selection_id: selection.id, revision_id: selection.revisions[0].id, task_ids: [task.id], product_ids: [alternate.id], rfi_ids: [], order_ids: [], lead_days: 14, review_days: 5, buffer_days: 2 }
 const review = async (links = [link]) => act('/decision-graphs', { as_of: '2026-11-10', links, confirm: true, review: 'Owner explicitly selects these sources for private decision drafts' })
 const packet = await review()
 return { get job() { return job }, root, read, act, original, alternate, productTerms, selection, task, terms, link, review, packet }
}
