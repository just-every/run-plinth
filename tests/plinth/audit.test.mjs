import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createFixture } from './helpers.mjs'

import { costFixture } from './cost-support.mjs'

const csv = await readFile(new URL('../fixtures/import-accepted-jobs.csv', import.meta.url), 'utf8')

test('ROLE-005 — role, invoice, send, export and import events are searchable and exportable without content; a hold blocks erasure with its reason and only audit metadata survives', async () => {
 const f = await createFixture()
 try {
  const office = await f.invite('office@example.com', 'Office Admin', 'admin'), estimator = await f.invite('estimator@example.com', 'Erin Estimator', 'admin'), agent = await f.agent()
  const api = (path, { method = 'GET', body, cookie = f.owner, token } = {}) => f.json('/api/plinth' + path, { method, cookie, token, ...(body ? { body } : {}) })
  const search = async (query = '', cookie = f.owner) => { const r = await api('/audit' + query, { cookie }); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value.events }
  let job = (await api('/jobs', { method: 'POST', body: { name: 'Audit Street kitchen', client_email: 'audit-client@example.com', address: '12 Audit Street, Burlington, VT 05401' } })).value.job
  const act = async (path, body = {}) => { const r = await api(`/jobs/${job.id}${path}`, { method: 'POST', body: { expected_version: job.version, ...body } }); if (r.status === 200) job = (await api(`/jobs/${job.id}`)).value.job; return r }
  assert.equal((await act('/quotes', { lines: [{ id: 'material', description: 'Framing material', cost_code: '06-100', phase: 'Framing', category: 'material', quantity: '1', unit: 'job', unit_cents: 1000000, cost_unit_cents: 750000 }] })).status, 200)
  const rate = (await api('/pricing-rates', { method: 'POST', body: { jurisdiction: 'Human-reviewed fixture jurisdiction', kind: 'sales', percent: '10', effective_on: '2026-01-01', reference: 'Reviewed fixture', human_reviewed: true } })).value.rate
  const price = { basis: 'sell', as_of: '2026-10-21', rules: [], tax: { rate_id: rate.id, taxable_line_ids: ['material'], exemption_reference: 'Reviewed fixture' } }
  assert.equal((await act('/pricing/apply', { ...price, digest: (await act('/pricing/preview', price)).value.preview.digest })).status, 200)
  assert.equal((await act(`/quotes/${job.quotes.at(-1).id}/accept`, { method: 'signed', evidence: 'Externally signed contract', schedule_choice: { kind: 'none', reason: 'Planned separately' } })).status, 200)

  // A permission change, a financial mutation, a send and exports.
  let r
  const team = (await api('/team')).value.team, person = team.find(m => m.email === 'estimator@example.com')
  assert.equal((await api(`/team/${person.id}`, { method: 'PUT', body: { expected_version: 0, role: 'estimator', job_ids: [job.id], po_limit_cents: 0 } })).status, 200)
  r = await act('/sov'); assert.equal(r.status, 200, JSON.stringify(r.value))
  const deposit = { kind: 'deposit', description: 'Signed contract deposit', amount_cents: 200000, recipient_email: 'audit-client@example.com', due_on: '2026-11-01', terms: 'Check within 14 days' }
  r = await act('/invoices', deposit); assert.equal(r.status, 200, JSON.stringify(r.value)); const invoice = r.value.record.id
  assert.equal((await act(`/invoices/${invoice}/issue`)).status, 200)
  assert.equal((await act(`/invoices/${invoice}/send`, { confirm: true })).status, 200)
  assert.equal((await f.request(`/api/plinth/jobs/${job.id}/invoices/${invoice}/document.csv`, { cookie: f.owner })).status, 200)
  assert.equal((await f.request(`/api/plinth/jobs/${job.id}/quotes/${job.quotes[0].id}/cost-codes.csv`, { cookie: f.owner })).status, 200)

  // Native bill recoding carries financial actor, subject and immutable before and after references.
  const c = await costFixture(f), bill = (await c.ok('/costs/bills', c.bill())).record
  await c.ok(`/costs/bills/${bill.id}/recode`, { line_id: bill.lines[0].id, cost_code: '01-100', reason: 'Reviewed original against labor allocation' })
  const recode = (await search('?kind=financial&action=cost.bills.recode&job_id=' + c.job.id))[0]
  assert.equal(recode.subject_id, bill.id); assert.equal(recode.actor_name, 'Builder'); assert.equal(recode.source, 'session')
  assert.equal(recode.version_after, recode.version_before + 1); assert.match(recode.before_ref, /^[0-9a-f]{64}$/); assert.match(recode.after_ref, /^[0-9a-f]{64}$/); assert.notEqual(recode.before_ref, recode.after_ref); assert.ok(Date.parse(recode.at) > Date.now() - 600_000)
  const billHistory = await f.request('/api/plinth/audit/export.csv?kind=financial&job_id=' + c.job.id, { cookie: f.owner })
  assert.equal(billHistory.status, 200); const billEvents = await billHistory.text(); assert.match(billEvents, /cost\.bills\.recode/); assert.ok(!billEvents.includes('Synthetic Lumber'))

  // Search by kind, actor, job and text; each event names who, through what, and the version and digest before and after.
  const issue = (await search('?kind=financial&action=invoices.issue&job_id=' + job.id))[0]
  assert.equal(issue.actor_name, 'Builder'); assert.equal(issue.actor_role, 'owner'); assert.equal(issue.source, 'session'); assert.equal(issue.subject_id, invoice)
  assert.equal(issue.version_after, issue.version_before + 1); assert.match(issue.before_ref, /^[0-9a-f]{64}$/); assert.match(issue.after_ref, /^[0-9a-f]{64}$/); assert.notEqual(issue.before_ref, issue.after_ref); assert.ok(Date.parse(issue.at) > Date.now() - 600_000)
  assert.equal((await search('?kind=send&job_id=' + job.id))[0].action, 'invoices.send')
  const role = (await search('?kind=permission&q=' + person.id))[0]; assert.equal(role.action, 'team.update'); assert.equal(role.subject_id, person.id)
  assert.deepEqual((await search('?kind=export&job_id=' + job.id)).map(e => e.detail.file).sort(), ['cost-codes.csv', 'document.csv'])
  assert.ok((await search('?kind=financial&job_id=' + job.id)).some(e => e.action === 'quotes.accept'), 'The signed quote is a financial event')
  assert.deepEqual((await search('?actor_id=nobody')), [])
  const page = await api('/audit?limit=2'); assert.equal(page.value.events.length, 2); assert.ok(page.value.next); assert.ok((await search('?before=' + page.value.next))[0].seq < page.value.events[1].seq)

  // Only owners and administrators read it; it is append-only; the export is secret-free and is itself an event.
  for (const [cookie, token] of [[estimator], [f.owner, agent]]) assert.equal((await api('/audit', { cookie: token ? undefined : cookie, token })).status, 403)
  assert.equal((await api('/audit', { cookie: office })).status, 200)
  assert.equal((await api('/audit', { method: 'POST', body: {} })).status, 405)
  await assert.rejects(f.db.prepare("UPDATE pl_audit SET action='changed'").run(), /audit_append_only/); await assert.rejects(f.db.prepare('DELETE FROM pl_audit').run(), /audit_append_only/)
  const exported = await f.request('/api/plinth/audit/export.csv?kind=financial', { cookie: office }), text = await exported.text()
  assert.equal(exported.status, 200); assert.match(text, /invoices\.issue/); assert.ok(!/audit-client@example\.com|Audit Street|base64|token|password|secret/i.test(text), 'The export carries references, never content or secrets')
  assert.equal((await f.request('/api/plinth/audit/export.json?job_id=' + job.id, { cookie: f.owner })).status, 200)
  assert.equal((await search('?kind=export&action=audit.export')).length, 3, 'Exporting the history is recorded')

  // An import is an event, and a held imported job survives an undo.
  const preview = (await api('/imports/preview', { method: 'POST', body: { csv } })).value
  r = await api('/imports/commit', { method: 'POST', body: { csv, fingerprint: preview.fingerprint } }); assert.equal(r.status, 200, JSON.stringify(r.value)); const imported = r.value.job
  assert.equal((await search('?kind=import'))[0].action, 'imports.commit')
  const jobs = (await api('/jobs')).value.jobs, moved = jobs.find(j => j.name === 'Northside extension')
  const placeAt = (subject_kind, subject_id, extra = {}) => api('/holds', { method: 'POST', body: { subject_kind, subject_id, kind: 'legal_hold', reason: 'Dispute notice received 23 October', confirm: true, ...extra } })
  r = await placeAt('job', moved.id); assert.equal(r.status, 201); const importHold = r.value.hold
  assert.notEqual((await api(`/imports/${imported.id}/undo`, { method: 'POST', body: {} })).status, 200); assert.ok((await api(`/jobs/${moved.id}`)).value.job, 'The held imported job survives the undo')
  assert.equal((await api(`/holds/${importHold.id}/release`, { method: 'POST', body: { reason: 'Dispute settled' } })).status, 200)
  assert.equal((await api(`/imports/${imported.id}/undo`, { method: 'POST', body: {} })).status, 200)

  // A legal hold: only the owner places it; erasure meets it with who, when and why; releasing it lets the erasure through and the audit metadata remains.
  assert.equal((await api('/holds', { method: 'POST', cookie: office, body: { subject_kind: 'job', subject_id: job.id, kind: 'legal_hold', reason: 'x', confirm: true } })).status, 403)
  assert.equal((await placeAt('job', job.id, { confirm: false })).status, 400); assert.equal((await placeAt('job', 'missing')).status, 404)
  r = await placeAt('job', job.id); assert.equal(r.status, 201); const hold = r.value.hold; assert.equal(hold.placed_by.role, 'owner')
  await act('/diary', { note: 'Site log under hold' })
  r = await api(`/jobs/${job.id}`, { method: 'DELETE', body: { expected_version: job.version } }); assert.equal(r.status, 409); assert.equal(r.value.error, 'retention_hold'); assert.match(r.value.message, /Dispute notice received 23 October/); assert.match(r.value.message, /Builder/); assert.equal(r.value.details.holds[0].id, hold.id)
  assert.ok((await api(`/jobs/${job.id}`)).value.job, 'A refused erasure removes nothing'); assert.equal((await search('?action=jobs.erase_refused&job_id=' + job.id)).length, 1, 'The refusal is recorded')
  assert.equal((await api(`/holds/${hold.id}/release`, { method: 'POST', cookie: office, body: { reason: 'x' } })).status, 403); assert.equal((await api(`/holds/${hold.id}/release`, { method: 'POST', body: {} })).status, 400)
  assert.equal((await api(`/holds/${hold.id}/release`, { method: 'POST', body: { reason: 'Dispute settled in writing' } })).status, 200); assert.equal((await api(`/holds/${hold.id}/release`, { method: 'POST', body: { reason: 'again' } })).status, 409)
  const before = (await search('?job_id=' + job.id)).length
  assert.equal((await api(`/jobs/${job.id}`, { method: 'DELETE', body: { expected_version: job.version } })).status, 200)
  assert.equal((await api(`/jobs/${job.id}`)).status, 404)
  const kept = await search('?job_id=' + job.id); assert.equal(kept.length, before + 1); assert.equal(kept[0].action, 'jobs.erase'); assert.equal(kept[0].kind, 'erasure')
  const survivors = JSON.stringify(kept); for (const content of ['Audit Street kitchen', 'audit-client@example.com', 'Site log under hold', 'Signed contract deposit']) assert.ok(!survivors.includes(content), `${content} does not survive in the audit history`)
  assert.equal((await api('/holds?subject_id=' + job.id)).value.holds.length, 1)

  // Retention applies to company records too, until its date.
  r = await api('/vendors', { method: 'POST', body: { kind: 'subcontractor', name: 'Retained Framing Co', trades: ['Framing'], contacts: [{ id: 'c1', name: 'Ray', email: 'ray@example.com' }] } }); const vendor = r.value.vendor
  const until = new Date(Date.now() + 86_400_000 * 30).toISOString().slice(0, 10)
  assert.equal((await placeAt('vendor', vendor.id, { kind: 'retention', until: '2020-01-01' })).status, 400)
  r = await placeAt('vendor', vendor.id, { kind: 'retention', until }); assert.equal(r.status, 201); const retention = r.value.hold
  r = await api(`/vendors/${vendor.id}`, { method: 'DELETE', body: { expected_version: vendor.version } }); assert.equal(r.status, 409); assert.match(r.value.message, new RegExp(`retention until ${until}`))
  assert.equal((await api(`/holds/${retention.id}/release`, { method: 'POST', body: { reason: 'Retention period waived by the owner' } })).status, 200)
  assert.equal((await api(`/vendors/${vendor.id}`, { method: 'DELETE', body: { expected_version: vendor.version } })).status, 200)
 } finally { await f.close() }
})
