import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture } from './helpers.mjs'

test('SUB-001 — restricted subcontractor directory, private W-9 custody, reviewed rates, qualification and dated scope awards', async () => {
 const f = await createFixture()
 try {
  const agent = await f.agent(), client = await f.invite('framing-client@example.com'), other = await f.invite('other-client@example.com')
  const call = (path, { method = 'POST', body, cookie = f.owner, token } = {}) => f.json('/api/plinth/vendors' + path, { method, ...(token ? { token } : { cookie }), ...(body ? { body } : {}) })
  const framing = { kind: 'subcontractor', name: 'Green Mountain Framing LLC', trades: ['Framing', 'Sheathing'], service_areas: ['Chittenden County, VT'], contacts: [{ id: 'dana', name: 'Dana Brooks', email: 'dana@gmframing.example', phone: '(802) 555-0170' }] }
  assert.equal((await call('', { body: framing, token: agent })).status, 403, 'Agents cannot create directory records')
  assert.equal((await call('', { body: framing, cookie: client })).status, 403)
  let r = await call('', { body: framing }); assert.equal(r.status, 201, JSON.stringify(r.value)); let vendor = r.value.vendor
  assert.equal(vendor.contacts[0].phone_e164, '+18025550170')
  const post = async (path, body, credentials = {}) => { const result = await call(`/${vendor.id}${path}`, { body: { expected_version: vendor.version, ...body }, ...credentials }); if (result.status === 200) vendor = result.value.vendor; return result }

  // Reviewed dated rates.
  const rate = { description: 'Wall framing labor', unit: 'sq ft', cents: 285, effective_on: '2026-10-01', reference: 'Green Mountain quote GM-2210' }
  assert.equal((await post('/rates', rate)).status, 400, 'A person must confirm the rate review')
  assert.equal((await post('/rates', { ...rate, human_reviewed: true })).status, 200)
  assert.equal((await post('/rates', { ...rate, human_reviewed: true, expected_version: vendor.version - 1 })).status, 409, 'Stale directory version is refused')

  // W-9 through the restricted upload: never a full TIN field, only signed originals.
  const pdf = Buffer.from('%PDF-1.7\nForm W-9 signed by Dana Brooks, EIN on form\n%%EOF')
  const w9 = { legal_name: 'Green Mountain Framing LLC', tin_type: 'EIN', tin_last4: '6789', document: { name: 'W-9 signed.pdf', base64: pdf.toString('base64') } }
  assert.equal((await post('/w9', { ...w9, tin: '12-3456789' })).status, 400, 'The full TIN is never stored as a field')
  assert.equal((await post('/w9', { ...w9, document: { name: 'w9.txt', base64: Buffer.from('plain text').toString('base64') } })).status, 400)
  assert.equal((await post('/w9', w9, { token: agent })).status, 403)
  r = await post('/w9', w9); assert.equal(r.status, 200, JSON.stringify(r.value))
  assert.equal(vendor.tax.verification, 'W-9 received, TIN not checked with the IRS'); assert.equal(vendor.tax.tin_last4, '6789')
  assert.ok(!JSON.stringify(vendor).includes('3456789'), 'No full TIN in the record')
  const download = path => f.request(`/api/plinth/vendors/${vendor.id}/w9`, path)
  let response = await download({ cookie: f.owner }); assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf, 'The original W-9 bytes return unchanged')
  for (const credentials of [{ token: agent }, { cookie: client }, { cookie: other }]) assert.equal((await download(credentials)).status, 403, 'Only owners and administrators retrieve the W-9')
  const audited = await f.db.prepare("SELECT count(*) AS n FROM oa_auth_audit WHERE action='vendor.w9.download' AND value LIKE ?").bind(vendor.id + ':%').first()
  assert.equal(audited.n, 1, 'Each W-9 download is audited')

  // Agents read only the unrestricted directory fields; clients read nothing.
  r = await call('', { method: 'GET', token: agent }); assert.equal(r.status, 200)
  const seen = r.value.vendors[0]
  assert.equal(seen.name, framing.name); for (const key of ['rates', 'tax', 'contacts', 'history']) assert.equal(seen[key], undefined, `agents never receive ${key}`)
  assert.equal((await call('', { method: 'GET', cookie: client })).status, 403)
  assert.equal((await call(`/${vendor.id}`, { method: 'GET', cookie: other })).status, 403)

  // Qualification and dated scope award.
  let job = await createActiveJob(f, 'Shelburne addition framing', 'framing-client@example.com')
  const award = (body, credentials = { cookie: f.owner }) => f.json(`/api/plinth/jobs/${job.id}/subcontracts`, { method: 'POST', ...credentials, body: { expected_version: job.version, ...body } })
  const scope = { vendor_id: vendor.id, trade: 'framing', scope: 'Frame and sheathe the two-storey addition per plan A-201', contact_ids: ['dana'], awarded_on: '2026-10-20', amount_cents: 4_850_000 }
  assert.equal((await award(scope)).status, 409, 'An unqualified company cannot be awarded a scope')
  assert.equal((await post('/qualifications', { trade: 'Roofing', status: 'qualified', evidence: 'n/a' })).status, 400, 'Only listed trades are qualified')
  assert.equal((await post('/qualifications', { trade: 'Framing', status: 'qualified', evidence: 'Reviewed three completed framing jobs and references' }, { token: agent })).status, 403)
  assert.equal((await post('/qualifications', { trade: 'Framing', status: 'qualified', evidence: 'Reviewed three completed framing jobs and references' })).status, 200)
  assert.equal((await award(scope, { token: agent })).status, 403, 'Agents cannot award scopes')
  assert.equal((await award({ ...scope, contact_ids: ['someone-else'] })).status, 400)
  r = await award(scope); assert.equal(r.status, 200, JSON.stringify(r.value)); job = r.value.job
  assert.equal(job.subcontracts[0].vendor_name, framing.name); assert.equal(job.subcontracts[0].awarded_on, '2026-10-20')
  assert.ok(job.approvals.some(a => a.kind === 'subcontract.award' && a.approved_by.role === 'owner'))
  r = await f.json(`/api/plinth/jobs/${job.id}`, { cookie: client }); assert.equal(r.status, 200)
  assert.equal(r.value.job.subcontracts, undefined, 'Clients never see awards, award amounts or rates')
  assert.ok(!JSON.stringify(r.value).includes('Green Mountain'), 'The client job response carries no directory data')

  // A rejection supersedes the qualification for new awards.
  assert.equal((await post('/qualifications', { trade: 'Framing', status: 'rejected', evidence: 'License lapsed' })).status, 200)
  assert.equal((await award(scope)).status, 409)

  // Owner-only erasure removes the record and its W-9 original.
  assert.equal((await call(`/${vendor.id}`, { method: 'DELETE', token: agent, body: { expected_version: vendor.version } })).status, 403)
  assert.equal((await call(`/${vendor.id}`, { method: 'DELETE', body: { expected_version: vendor.version } })).status, 200)
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM pl_vendor_documents').first()).n, 0)
  assert.equal((await download({ cookie: f.owner })).status, 404)
 } finally { await f.close() }
})
