import test from 'node:test'
import assert from 'node:assert/strict'
import {setPortalFeatures} from './helpers.mjs'
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

test('SUB-003 — owner insurance and license rules hold an award with expired evidence, prepare an unsent renewal and release only after a designated reviewer verifies replacement coverage', async () => {
 const f = await createFixture()
 try {
  const agent = await f.agent(), client = await f.invite('plumbing-client@example.com')
  const api = (path, body, { method = 'POST', cookie = f.owner, token } = {}) => f.json('/api/plinth' + path, { method, ...(token ? { token } : { cookie }), ...(body ? { body } : {}) })
  const year = new Date().getUTCFullYear(), past = `${year - 1}-01-01`, lapsed = `${year - 1}-12-31`, future = `${year + 1}-12-31`
  const requirements = [{ trade: 'Plumbing', kind: 'general_liability', min_limit_cents: 100_000_000, enforcement: 'hold' }, { trade: '*', kind: 'workers_comp', enforcement: 'hold' }, { trade: 'Plumbing', kind: 'license', enforcement: 'flag' }]
  const rules = { expected_version: 0, reviewers: [], requirements }
  assert.equal((await api('/compliance-rules', rules, { method: 'PUT', token: agent })).status, 403)
  assert.equal((await api('/compliance-rules', rules, { method: 'PUT', cookie: client })).status, 403)
  let r = await api('/compliance-rules', rules, { method: 'PUT' }); assert.equal(r.status, 200, JSON.stringify(r.value))
  r = await api('/vendors', { kind: 'subcontractor', name: 'Lakeside Plumbing Co', trades: ['Plumbing'], contacts: [{ id: 'kim', name: 'Kim Ortiz', email: 'kim@lakeside.example' }] }); let vendor = r.value.vendor
  const post = async (path, body, credentials) => { const result = await api(`/vendors/${vendor.id}${path}`, { expected_version: vendor.version, ...body }, credentials); if (result.status === 200) vendor = result.value.vendor; return result }
  assert.equal((await post('/qualifications', { trade: 'Plumbing', status: 'qualified', evidence: 'Master plumber references checked' })).status, 200)
  const coi = (kind, extra = {}) => ({ kind, issuer: 'Vermont Mutual', reference: `${kind}-POL-77`, limit_cents: 200_000_000, endorsements: ['Additional insured: builder'], effective_on: past, expires_on: future, document: { name: `${kind}.pdf`, base64: Buffer.from(`%PDF-1.7\n${kind} certificate\n%%EOF`).toString('base64') }, ...extra })
  assert.equal((await post('/compliance', { ...coi('general_liability'), verified: true })).status, 400, 'An upload cannot declare itself verified')
  assert.equal((await post('/compliance', coi('general_liability', { expires_on: lapsed }))).status, 200, 'Expired COI is recorded as received')
  r = await post('/compliance', coi('workers_comp')); assert.equal(r.status, 200); const comp = r.value.record
  assert.equal(comp.review, undefined, 'Uploading a PDF never constitutes verification')
  assert.equal((await post(`/compliance/${comp.id}/review`, { decision: 'verified', note: 'Called carrier' }, { token: agent })).status, 403)
  assert.equal((await post(`/compliance/${comp.id}/review`, { decision: 'verified', note: 'Workers comp confirmed with Vermont Mutual' })).status, 200)
  assert.equal((await post(`/compliance/${comp.id}/review`, { decision: 'rejected', note: 'again' })).status, 409, 'A decision is immutable')

  let job = await createActiveJob(f, 'Colchester bath rough-in', 'plumbing-client@example.com')
  const act = async (path, body = {}, credentials) => { const result = await api(`/jobs/${job.id}${path}`, { expected_version: job.version, ...body }, credentials); if (result.status === 200) job = result.value.job; return result }
  r = await act('/subcontracts', { vendor_id: vendor.id, trade: 'Plumbing', scope: 'Rough-in plumbing for the primary bath', contact_ids: ['kim'], awarded_on: '2026-10-20', amount_cents: 1_250_000 }); assert.equal(r.status, 200, JSON.stringify(r.value))
  const award = r.value.record
  assert.equal(award.status, 'on_hold', 'The assignment is held')
  assert.deepEqual(award.compliance.holds, [{ kind: 'general_liability', problem: 'expired' }])
  assert.deepEqual(award.compliance.flags, [{ kind: 'license', problem: 'missing' }], 'Flag rules warn without holding')
  vendor = (await api(`/vendors/${vendor.id}`, undefined, { method: 'GET' })).value.vendor
  assert.deepEqual(vendor.renewal_requests.map(q => [q.kind, q.problem, q.job_id]).sort(), [['general_liability', 'expired', job.id], ['license', 'missing', job.id]])
  assert.ok(vendor.renewal_requests.every(q => q.delivery.startsWith('Prepared, not sent')), 'Renewal requests are never claimed as sent')
  r = await act(`/subcontracts/${award.id}/release`); assert.equal(r.status, 409); assert.equal(r.value.error, 'compliance_hold')

  // Replacement coverage: unverified until a designated reviewer decides; an undesignated administrator cannot.
  r = await post('/compliance', coi('general_liability', { limit_cents: 50_000_000 })); const thin = r.value.record
  assert.equal((await post(`/compliance/${thin.id}/review`, { decision: 'verified', note: 'Certificate checked' })).status, 200)
  r = await act(`/subcontracts/${award.id}/release`); assert.equal(r.status, 409); assert.deepEqual(r.value.details.holds, [{ kind: 'general_liability', problem: 'below_limit' }])
  r = await post('/compliance', coi('general_liability')); const replacement = r.value.record
  r = await act(`/subcontracts/${award.id}/release`); assert.deepEqual(r.value.details.holds, [{ kind: 'general_liability', problem: 'unverified' }])
  // An administrator reviews only once the owner names them as a compliance reviewer.
  const reviewerEmail = 'compliance-admin@example.com', reviewer = await f.invite(reviewerEmail, 'Jordan Lee', 'admin')
  const decision = { decision: 'verified', note: 'Replacement GL certificate confirmed with carrier; additional insured endorsement present' }
  assert.equal((await post(`/compliance/${replacement.id}/review`, decision, { cookie: reviewer })).status, 403, 'An undesignated administrator cannot verify')
  assert.equal((await api('/compliance-rules', { expected_version: 1, reviewers: [reviewerEmail], requirements }, { method: 'PUT', cookie: reviewer })).status, 403, 'Only the owner sets rules and reviewers')
  assert.equal((await api('/compliance-rules', { expected_version: 1, reviewers: [reviewerEmail], requirements }, { method: 'PUT' })).status, 200)
  assert.equal((await post(`/compliance/${replacement.id}/review`, decision, { cookie: reviewer })).status, 200)
  assert.equal((await act(`/subcontracts/${award.id}/release`, {}, { token: agent })).status, 403)
  r = await act(`/subcontracts/${award.id}/release`); assert.equal(r.status, 200, JSON.stringify(r.value))
  assert.equal(r.value.record.status, 'released'); assert.deepEqual(r.value.record.compliance.holds, [])
  assert.ok(job.approvals.some(a => a.kind === 'subcontract.release' && a.approved_by.role === 'owner'))
  const evidence = await f.request(`/api/plinth/vendors/${vendor.id}/compliance/${replacement.id}`, { cookie: f.owner })
  assert.equal(evidence.status, 200); assert.equal(evidence.headers.get('x-plinth-verification'), 'Verified by Jordan Lee')
  assert.equal((await f.request(`/api/plinth/vendors/${vendor.id}/compliance/${replacement.id}`, { cookie: client })).status, 403)
  assert.equal((await f.json(`/api/plinth/jobs/${job.id}`, { cookie: client })).value.job.subcontracts, undefined)
 } finally { await f.close() }
})

test('SUB-004 — conditional waiver for a sub draw, exact signed release, recorded payment, matching unconditional release and unresolved downstream waivers in the draw packet', async () => {
 const f = await createFixture()
 try {
  const agent = await f.agent(), client = await f.invite('waiver-client@example.com'), admin = await f.invite('office@example.com', 'Office Admin', 'admin')
  const api = (path, body, { method = 'POST', cookie = f.owner, token } = {}) => f.json('/api/plinth' + path, { method, ...(token ? { token } : { cookie }), ...(body ? { body } : {}) })
  const year = new Date().getUTCFullYear(), passed = `${year - 1}-12-31`, ahead = `${year + 1}-06-30`
  let r = await api('/vendors', { kind: 'subcontractor', name: 'Champlain Electric Inc', trades: ['Electrical'], contacts: [{ id: 'lee', name: 'Lee Park', email: 'lee@champlain.example' }] }); let vendor = r.value.vendor
  r = await api(`/vendors/${vendor.id}/qualifications`, { expected_version: vendor.version, trade: 'Electrical', status: 'qualified', evidence: 'Master electrician license reviewed' }); assert.equal(r.status, 200)
  let job = await createActiveJob(f, 'Essex kitchen electrical', 'waiver-client@example.com', 5_000_000)
  const act = async (path, body = {}, credentials) => { const result = await api(`/jobs/${job.id}${path}`, { expected_version: job.version, ...body }, credentials); if (result.status === 200) job = result.value.job; return result }
  r = await act('/subcontracts', { vendor_id: vendor.id, trade: 'Electrical', scope: 'Kitchen rewiring and panel upgrade', contact_ids: ['lee'], awarded_on: '2026-10-20', amount_cents: 2_000_000 }); const sub = r.value.record.id
  assert.equal((await act(`/subcontracts/${sub}/release`)).status, 200)

  // State and job waiver wording: owner-provided, the job's own wording wins over the state template.
  const wording = (form, state = 'VT', job_id) => ({ name: `${state} ${form}${job_id ? ' (this job)' : ''}`, state, form, wording: `${form} release of lien rights for the amount and through-date stated.`, ...(job_id ? { job_id } : {}) })
  const templates = { expected_version: 0, templates: [wording('conditional_progress'), wording('unconditional_progress'), wording('conditional_progress', 'VT', job.id)] }
  for (const credentials of [{ token: agent }, { cookie: client }, { cookie: admin }]) assert.equal((await api('/lien-waiver-templates', templates, { method: 'PUT', ...credentials })).status, 403, 'Only the owner sets waiver wording')
  r = await api('/lien-waiver-templates', templates, { method: 'PUT' }); assert.equal(r.status, 200, JSON.stringify(r.value))
  assert.ok(r.value.templates.templates.every(t => t.source.includes('does not certify statutory')), 'Wording is never claimed as a certified statutory form')

  // Draws need the lien setup: tier 1 is the awarded company, the supplier is tier 2 with an open notice deadline.
  assert.equal((await act(`/subcontracts/${sub}/draws`, { through_date: '2026-10-31', amount_cents: 800_000 })).value.error, 'lien_setup')
  const lien = { state: 'VT', notice_received_on: '2026-10-21', notice_deadline_on: ahead, lower_tiers: [{ id: 'wire', name: 'Northern Wire Supply', parent_id: vendor.id, notice_deadline_on: passed }] }
  for (const credentials of [{ token: agent }, { cookie: client }]) assert.equal((await act(`/subcontracts/${sub}/lien`, lien, credentials)).status, 403)
  r = await act(`/subcontracts/${sub}/lien`, lien, { cookie: admin }); assert.equal(r.status, 200, JSON.stringify(r.value)); assert.deepEqual(r.value.record.parties.map(p => [p.id, p.tier]), [[vendor.id, 1], ['wire', 2]])
  assert.equal((await act(`/subcontracts/${sub}/draws`, { through_date: '2026-10-31', amount_cents: 2_500_000 })).value.error, 'draw_balance')
  r = await act(`/subcontracts/${sub}/draws`, { through_date: '2026-10-31', amount_cents: 800_000 }); assert.equal(r.status, 200); const draw = r.value.record.id
  const waivers = `/subcontracts/${sub}/draws/${draw}/waivers`

  // Conditional waiver for the draw; the unconditional waits for confirmed payment.
  assert.equal((await act(waivers, { party_id: vendor.id, kind: 'unconditional' })).value.error, 'payment_unconfirmed')
  r = await act(waivers, { party_id: vendor.id, kind: 'conditional' }); assert.equal(r.status, 200, JSON.stringify(r.value)); const conditional = r.value.record
  assert.equal(conditional.amount_cents, 800_000); assert.equal(conditional.through_date, '2026-10-31')
  assert.equal(conditional.template.name, 'VT conditional_progress (this job)', 'The job template wins over the state template'); assert.equal(conditional.template.state, 'VT')
  assert.ok(job.subcontracts[0].draws[0].waivers[0].template && !('job_id' in conditional.template), 'The job wording snapshot is kept with the request')
  assert.ok(conditional.delivery.startsWith('Prepared, not sent'), 'A waiver request is never claimed as sent')
  assert.equal((await act(waivers, { party_id: vendor.id, kind: 'conditional' })).value.error, 'waiver_exists')
  r = await act(`/subcontracts/${sub}/draws/${draw}/payment`, { paid_on: '2026-11-05', amount_cents: 800_000, reference: 'Check 1041' }); assert.equal(r.value.error, 'waiver_required')
  assert.deepEqual(r.value.details.missing.map(p => p.party_id), [vendor.id, 'wire'])

  // Signed release: through-date or amount that differs from the request is refused without a write.
  const pdf = Buffer.from('%PDF-1.7\nConditional waiver signed by Lee Park\n%%EOF'), signed = (extra = {}) => ({ signer_name: 'Lee Park', amount_cents: 800_000, through_date: '2026-10-31', document: { name: 'conditional-1.pdf', base64: pdf.toString('base64') }, ...extra })
  const release = id => `${waivers}/${id}/release`, before = job.version
  assert.equal((await act(release(conditional.id), signed({ through_date: '2026-11-15' }))).value.error, 'waiver_mismatch')
  r = await act(release(conditional.id), signed({ amount_cents: 850_000 })); assert.equal(r.value.error, 'waiver_mismatch'); assert.deepEqual(r.value.details.expected, { amount_cents: 800_000, through_date: '2026-10-31' })
  assert.equal(job.version, before, 'Mismatched releases write nothing')
  assert.equal((await act(release(conditional.id), signed(), { token: agent })).status, 403)
  r = await act(release(conditional.id), signed()); assert.equal(r.status, 200, JSON.stringify(r.value)); assert.equal(r.value.record.status, 'received')
  assert.equal(r.value.record.release.signature, 'Signed release received; Plinth did not verify the signature')
  const file = (credentials) => f.request(`/api/plinth/jobs/${job.id}/lien-waiver-files/${r.value.record.release.document.id}`, credentials)
  let response = await file({ cookie: f.owner }); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf, 'The signed original returns unchanged')
  for (const credentials of [{ token: agent }, { cookie: client }]) assert.equal((await file(credentials)).status, 403)
  // The reviewer signs off by restating the exact figures.
  assert.equal((await act(`${waivers}/${conditional.id}/accept`, { amount_cents: 800_000, through_date: '2026-10-30' })).value.error, 'waiver_mismatch')
  r = await act(`${waivers}/${conditional.id}/accept`, { amount_cents: 800_000, through_date: '2026-10-31' }, { cookie: admin }); assert.equal(r.status, 200); assert.equal(r.value.record.accepted_by.role, 'admin')

  // The draw packet shows the tier-2 supplier's waiver unresolved; the client and agents never reach it.
  r = await act('/claims', { cumulative_cents: 1_500_000, description: 'Rough-in electrical draw' }); const claim = r.value.record.id
  const packet = credentials => api(`/jobs/${job.id}/claims/${claim}/packet`, undefined, { method: 'GET', ...credentials })
  for (const credentials of [{ token: agent }, { cookie: client }]) assert.equal((await packet(credentials)).status, 403)
  r = await packet({ cookie: f.owner }); assert.equal(r.status, 200)
  assert.deepEqual(r.value.lien_waivers.unresolved.map(w => [w.party_id, w.tier, w.kind, w.status]), [['wire', 2, 'conditional', 'not_requested']])
  assert.deepEqual(r.value.lien_waivers.notices.map(n => [n.party_id, n.status]), [[vendor.id, 'received'], ['wire', 'past_deadline']])
  r = await act(waivers, { party_id: 'wire', kind: 'conditional', amount_cents: 900_000 }); assert.equal(r.status, 400, 'A lower-tier amount stays within the draw')
  r = await act(waivers, { party_id: 'wire', kind: 'conditional', amount_cents: 250_000 }); const supplier = r.value.record
  assert.equal((await act(release(supplier.id), signed({ signer_name: 'Sam Wire', amount_cents: 250_000 }))).status, 200)
  assert.equal((await act(`${waivers}/${supplier.id}/accept`, { amount_cents: 250_000, through_date: '2026-10-31' })).status, 200)

  // Settle the payment, then request the matching unconditional release.
  assert.equal((await act(`/subcontracts/${sub}/draws/${draw}/payment`, { paid_on: '2026-11-05', amount_cents: 700_000, reference: 'Check 1041' })).value.error, 'payment_amount')
  r = await act(`/subcontracts/${sub}/draws/${draw}/payment`, { paid_on: '2026-11-05', amount_cents: 800_000, reference: 'Check 1041' }); assert.equal(r.status, 200)
  assert.equal(r.value.record.label, 'Payment recorded by staff; Plinth did not send or verify funds')
  assert.equal((await act(waivers, { party_id: 'wire', kind: 'conditional', amount_cents: 250_000 })).value.error, 'payment_recorded')
  r = await act(waivers, { party_id: vendor.id, kind: 'unconditional' }); assert.equal(r.status, 200); const unconditional = r.value.record
  assert.deepEqual([unconditional.amount_cents, unconditional.through_date, unconditional.template.form], [800_000, '2026-10-31', 'unconditional_progress'])
  assert.equal((await act(release(unconditional.id), signed({ through_date: '2026-11-05', document: { name: 'unconditional-1.pdf', base64: pdf.toString('base64') } }))).value.error, 'waiver_mismatch')
  assert.equal((await act(release(unconditional.id), signed({ document: { name: 'unconditional-1.pdf', base64: pdf.toString('base64') } }))).status, 200)
  assert.equal((await act(`${waivers}/${unconditional.id}/accept`, { amount_cents: 800_000, through_date: '2026-10-31' })).status, 200)

  // The exported draw packet still lists the supplier's missing unconditional release.
  assert.equal((await act(`/claims/${claim}/approve`)).status, 200)
  r = await act(`/claims/${claim}/export`); assert.equal(r.status, 200)
  assert.deepEqual(r.value.report.lien_waivers.unresolved.map(w => [w.party_name, w.tier, w.kind, w.status]), [['Northern Wire Supply', 2, 'unconditional', 'not_requested']])
  assert.deepEqual(r.value.report.lien_waivers.resolved.map(w => [w.tier, w.kind]), [[1, 'unconditional']])

  // Paying without waivers needs the owner's recorded exception.
  r = await act(`/subcontracts/${sub}/draws`, { through_date: '2026-10-15', amount_cents: 100_000 }); assert.equal(r.value.error, 'draw_order')
  r = await act(`/subcontracts/${sub}/draws`, { through_date: '2026-11-30', amount_cents: 400_000 }); const second = r.value.record.id
  assert.equal((await act(`/subcontracts/${sub}/draws/${second}/exception`, { reason: 'Emergency payment to keep the panel delivery' }, { cookie: admin })).status, 403)
  r = await act(`/subcontracts/${sub}/draws/${second}/exception`, { reason: 'Emergency payment to keep the panel delivery' }); assert.equal(r.status, 200)
  assert.ok(job.approvals.some(a => a.kind === 'lien_waiver.exception' && a.approved_by.role === 'owner'))
  assert.equal((await act(`/subcontracts/${sub}/draws/${second}/payment`, { paid_on: '2026-12-02', amount_cents: 400_000, reference: 'ACH 88' })).status, 200)

  r = await f.json(`/api/plinth/jobs/${job.id}`, { cookie: client }); assert.equal(r.status, 200)
  assert.ok(!JSON.stringify(r.value).includes('Northern Wire') && !JSON.stringify(r.value).includes('lien_waivers'), 'Clients never see sub draws or waivers')
 } finally { await f.close() }
})

test('BID-001 — three qualified contacts receive pre-award and released scoped revised plans, two private priced responses and one decline; current grants gate every door', async () => {
 const f=await createFixture()
 try{
  const cookies=await Promise.all([1,2,3,4].map(n=>f.invite(`synthetic-plinth-${n}@example.com`,`Synthetic bidder ${n}`))),agent=await f.agent()
  const api=(path,body,cookie=f.owner)=>f.json('/api/plinth'+path,{method:body===undefined?'GET':'POST',cookie,body})
  let result=await api('/jobs',{name:'synthetic-plinth-1',client_email:'synthetic-plinth-4@example.com',address:'Synthetic bid site'}),job=result.value.job
  const jobAct=async(path,body)=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});assert.equal(r.status,200,JSON.stringify(r.value));job=r.value.job;return r.value.record}
  const codes=['06-100','06-200','06-300']
  await jobAct('/quotes',{lines:codes.map((code,n)=>({id:`synthetic-plinth-${n+1}`,description:`Synthetic scope ${n+1}`,quantity:'1',unit:'job',unit_cents:100000,cost_code:code,phase:'Structure',category:'labor'}))})
  await jobAct(`/quotes/${job.quotes[0].id}/accept`,{method:'signed',evidence:'Synthetic client accepted the exact estimate',schedule_choice:{kind:'none',reason:'Bid preparation first'}})
  const vendors=[],scopes=[]
  for(let n=0;n<3;n++){
   let r=await api('/vendors',{kind:'subcontractor',name:`synthetic-plinth-${n+1}`,trades:['Framing'],contacts:[{id:`synthetic-plinth-${n+1}`,name:`Synthetic bidder ${n+1}`,email:`synthetic-plinth-${n+1}@example.com`}]});assert.equal(r.status,201);let vendor=r.value.vendor
   r=await api(`/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Framing',status:'qualified',evidence:'Synthetic human-reviewed qualification'});assert.equal(r.status,200);vendors.push(r.value.vendor)
   if(n===2){const scope=await jobAct('/subcontracts',{vendor_id:vendor.id,trade:'Framing',scope:`Synthetic released scope ${n+1}`,contact_ids:[`synthetic-plinth-${n+1}`],awarded_on:'2026-10-21'});scopes.push(scope.id);await jobAct(`/subcontracts/${scope.id}/release`,{})}else scopes.push(undefined)
  }
  const original=Buffer.from('%PDF-1.7\nsynthetic-plinth-1 plan\n%%EOF'),revised=Buffer.from('%PDF-1.7\nsynthetic-plinth-2 revised plan\n%%EOF'),file=(name,bytes)=>({name,base64:bytes.toString('base64')})
  let source=(await api(`/bids/${job.id}`)).value.source
  const act=async(path,body={},cookie=f.owner)=>{const r=await api(`/bids/${job.id}${path}`,{expected_version:source.version,...body},cookie);if(r.value.source)source=r.value.source;return r}
  const initial={title:'Synthetic framing package',trade:'Framing',scope:'Private estimator package description',mode:'priced',lines:codes.map((cost_code,n)=>({cost_code,description:`Invited scope ${n+1}`,budget_cents:100000+n})),note:'Initial plans',due_on:'2099-12-31',plans:[file('synthetic-plinth-1.pdf',original)]}
  assert.equal((await api(`/bids/${job.id}`,{expected_version:source.version,...initial},cookies[0])).status,404)
  assert.equal((await f.json(`/api/plinth/bids/${job.id}`,{method:'POST',token:agent,body:{expected_version:source.version,...initial}})).status,403)
  result=await act('',initial);assert.equal(result.status,201,JSON.stringify(result.value));const id=result.value.record_id,revision=source.bids[0].revisions[0].id
  assert.equal((await act(`/${id}/invite`,{vendor_id:vendors[0].id,contact_id:'synthetic-plinth-1',pre_award:true,cost_codes:[codes[0]],confirm:true})).status,409,'Draft package cannot be invited')
  assert.equal((await act(`/${id}/publish`,{revision_id:revision,confirm:false})).status,400)
  assert.equal((await act(`/${id}/publish`,{revision_id:revision,confirm:true})).status,200)
  assert.equal((await act(`/${id}/invite`,{vendor_id:vendors[0].id,contact_id:'synthetic-plinth-1',subcontract_id:scopes[2],cost_codes:[codes[0]],confirm:true})).status,409,'A rival released scope cannot grant access')
  for(let n=0;n<3;n++)assert.equal((await act(`/${id}/invite`,{vendor_id:vendors[n].id,contact_id:`synthetic-plinth-${n+1}`,...(n<2?{pre_award:true}:{subcontract_id:scopes[n]}),cost_codes:[codes[n]],confirm:true})).status,200)
  assert.equal((await api(`/jobs/${job.id}`)).value.job.subcontracts.length,1,'The two pre-award invitations never manufacture awards')
  for(const path of ['/subcontractor-portal','/trade-confirmations','/punch','/rfi-inbox','/todos']){const r=await api(path,undefined,cookies[0]);assert.equal(r.status,200);assert.ok(!(JSON.stringify(r.value).includes(job.id)),'A pre-award bid grants no work portal access')}
  assert.equal((await api(`/jobs/${job.id}`,undefined,cookies[0])).status,404,'Invitation never grants general job access')
  assert.equal((await api(`/bids/${job.id}`,undefined,cookies[3])).status,404,'Uninvited job client cannot read bids')
  assert.equal((await api(`/jobs/${job.id}`,undefined,cookies[3])).value.job.bids,undefined,'General client projection strips private bid state')
  assert.equal((await f.request(`/api/plinth/bids/${job.id}`)).status,401)
  const oldVersion=source.version
  assert.equal((await act(`/${id}/acknowledge`,{revision_id:revision},cookies[0])).status,200)
  assert.equal((await api(`/bids/${job.id}/${id}/question`,{expected_version:oldVersion,revision_id:revision,text:'stale'},cookies[0])).status,409)
  const past=`${new Date().getUTCFullYear()-1}-12-31`
  assert.equal((await act(`/${id}/addendum`,{revision_id:revision,confirm:true,note:'Revised detail A',due_on:past,plans:[file('synthetic-plinth-2.pdf',revised)]})).status,200)
  const current=source.bids[0].revisions.at(-1).id
  assert.equal((await act(`/${id}/respond`,{revision_id:revision,items:[]},cookies[0])).status,409,'Superseded revision cannot receive prices')
  assert.equal((await act(`/${id}/respond`,{revision_id:current,items:[]},cookies[0])).status,409,'Reading is not acknowledgment')
  assert.equal((await act(`/${id}/question`,{revision_id:current,text:'Synthetic private question 1'},cookies[0])).status,200)
  let ownerSource=(await api(`/bids/${job.id}`)).value.source,invitation=ownerSource.bids[0].invitations[0]
  assert.equal((await act(`/${id}/answer`,{invitation_id:invitation.id,question_id:invitation.questions[0].id,text:'Synthetic private answer 1'})).status,200)
  for(let n=0;n<2;n++){
   assert.equal((await act(`/${id}/acknowledge`,{revision_id:current},cookies[n])).status,200)
   assert.equal((await act(`/${id}/respond`,{revision_id:current,items:[{cost_code:codes[(n+1)%3],description:'Rival scope',amount_cents:50000}]},cookies[n])).status,400)
   result=await act(`/${id}/respond`,{revision_id:current,items:[{cost_code:codes[n],description:`Synthetic private price ${n+1}`,amount_cents:123400+n}],exclusions:`Synthetic exclusion ${n+1}`,attachments:[file(`synthetic-plinth-${n+3}.pdf`,original)]},cookies[n]);assert.equal(result.status,200,JSON.stringify(result.value))
   assert.equal((await act(`/${id}/respond`,{revision_id:current,items:[]},cookies[n])).status,409,'Submitted original is immutable')
  }
  assert.equal((await act(`/${id}/acknowledge`,{revision_id:current},cookies[2])).status,200)
  assert.equal((await act(`/${id}/decline`,{revision_id:current,reason:'Synthetic unavailable crew'},cookies[2])).status,200)
  ownerSource=(await api(`/bids/${job.id}`)).value.source
  const bid=ownerSource.bids[0];assert.deepEqual(bid.invitations.map(i=>i.status),['Received','Received','Declined']);assert.ok(bid.invitations.every(i=>i.late&&i.acknowledgments.some(a=>a.revision_id===current)))
  assert.equal(bid.revisions.length,2);assert.equal(bid.invitations[0].responses[0].total_cents,123400)
  const ownFile=bid.invitations[0].responses[0].attachments[0].id,rivalFile=bid.invitations[1].responses[0].attachments[0].id,planFile=bid.revisions[1].plans[0].id
  for(let n=0;n<3;n++){
   const projected=(await api(`/bids/${job.id}`,undefined,cookies[n])).value.source.bids[0]
   assert.equal(projected.invitations.length,1);assert.equal(projected.invitations[0].email,`synthetic-plinth-${n+1}@example.com`);assert.deepEqual(projected.lines.map(l=>l.cost_code),[codes[n]])
   const serialized=JSON.stringify(projected);assert.ok(!serialized.includes(`synthetic-plinth-${(n+1)%3+1}@example.com`));if(n!==0)assert.ok(!serialized.includes('Synthetic private question 1')&&!serialized.includes('Synthetic private answer 1'))
   const download=await f.request(`/api/plinth/bids/${job.id}/files/${planFile}`,{cookie:cookies[n]});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),revised)
  }
  assert.equal((await f.request(`/api/plinth/bids/${job.id}/files/${rivalFile}`,{cookie:cookies[0]})).status,404)
  assert.equal((await f.request(`/api/plinth/bids/${job.id}/files/${ownFile}`,{cookie:cookies[0]})).status,200)
  assert.equal((await api(`/jobs/${job.id}/bids`)).status,200,'Job route authenticates independently')
  assert.equal((await api(`/jobs/${job.id}/bids`,undefined,cookies[3])).status,404)
  await setPortalFeatures(f,job.id,[],['bids']);source=(await api(`/bids/${job.id}`)).value.source
  for(const path of [`/bids/${job.id}`,`/jobs/${job.id}/bids`,`/bids/${job.id}/files/${ownFile}`,`/bids/${job.id}/files/${planFile}`])assert.equal((await api(path,undefined,cookies[0])).status,404,'Disabled bid feature closes each bid door')
  assert.deepEqual((await api('/bids',undefined,cookies[0])).value.sources,[])
  assert.equal((await act(`/${id}/question`,{revision_id:current,text:'Disabled feature'},cookies[0])).status,404)
  await setPortalFeatures(f,job.id);source=(await api(`/bids/${job.id}`)).value.source
  const messages=f.messages.length
  result=await act('',{...initial,title:'Synthetic unpriced package',mode:'unpriced'});assert.equal(result.status,201);assert.ok(source.bids.at(-1).lines.every(l=>l.budget_cents===undefined));assert.equal(f.messages.length,messages,'Bids never send automatic notices')
  result=await api(`/vendors/${vendors[0].id}/qualifications`,{expected_version:vendors[0].version,trade:'Framing',status:'rejected',evidence:'Synthetic qualification withdrawn'});assert.equal(result.status,200)
  for(const path of [`/bids/${job.id}`,`/bids/${job.id}/files/${ownFile}`,`/bids/${job.id}/files/${planFile}`])assert.equal((await api(path,undefined,cookies[0])).status,404,'Qualification withdrawal removes every portal door')
  assert.equal((await act(`/${id}/question`,{revision_id:current,text:'No longer qualified'},cookies[0])).status,404)
  const v=vendors[1]
  result=await api(`/vendors/${v.id}`,{expected_version:v.version,contacts:[{...v.contacts[0],email:'synthetic-plinth-5@example.com'}]});assert.equal(result.status,200)
  assert.equal((await api(`/bids/${job.id}`,undefined,cookies[1])).status,404,'A changed directory contact immediately loses the grant')
  assert.equal((await act(`/${id}/revoke`,{invitation_id:bid.invitations[2].id})).status,200)
  assert.equal((await api(`/bids/${job.id}`,undefined,cookies[2])).status,404,'Explicit revocation removes access')
  const people=(await f.json('/auth/operators',{cookie:f.owner})).value,person=people.find(p=>p.email==='synthetic-plinth-3@example.com')
  assert.equal((await f.request('/auth/operator/status',{method:'POST',cookie:f.owner,body:{operatorId:person.id,status:'inactive'}})).status,200)
  assert.equal((await api('/bids',undefined,cookies[2])).status,401,'An inactive member cannot reach the portal at all')
  for(const path of [`/api/plinth/jobs/${job.id}`,'/api/plinth/jobs']){const visible=await f.json(path,{token:agent});assert.equal(visible.status,200);assert.equal((visible.value.job??visible.value.jobs.find(j=>j.id===job.id)).bids,undefined,'Generic agent job doors do not expose private bids')}
 }finally{await f.close()}
})
