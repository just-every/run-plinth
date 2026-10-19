import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture } from './helpers.mjs'

test('ROLE-001 — owner, administrator and assignment-scoped project manager with a PO limit; refusals write nothing and a role change applies on the next request', async () => {
 const f = await createFixture()
 try {
  const admin = await f.invite('office@example.com', 'Office Admin', 'admin'), pm = await f.invite('pm@example.com', 'Pat Manager', 'admin')
  const api = (path, { method = 'GET', body, cookie = f.owner } = {}) => f.json('/api/plinth' + path, { method, cookie, ...(body ? { body } : {}) })
  const assigned = await createActiveJob(f, 'Burlington porch rebuild', 'porch@example.com'), other = await createActiveJob(f, 'Winooski basement finish', 'basement@example.com')
  const version = async id => (await api(`/jobs/${id}`)).value.job.version
  let r = await api('/team'); const person = r.value.team.find(m => m.email === 'pm@example.com')
  assert.equal(person.role, 'admin')
  const grant = { expected_version: 0, role: 'project_manager', job_ids: [assigned.id], po_limit_cents: 500_000 }
  assert.equal((await api(`/team/${person.id}`, { method: 'PUT', body: grant, cookie: admin })).status, 403, 'Only the owner changes access')
  assert.equal((await api(`/team/${person.id}`, { method: 'PUT', body: grant, cookie: pm })).status, 403)
  r = await api(`/team/${person.id}`, { method: 'PUT', body: grant }); assert.equal(r.status, 200, JSON.stringify(r.value))

  // Job routes: the project manager sees and works only the assigned job.
  r = await api('/jobs', { cookie: pm }); assert.equal(r.value.role, 'project_manager'); assert.deepEqual(r.value.jobs.map(j => j.id), [assigned.id])
  assert.equal((await api(`/jobs/${other.id}`, { cookie: pm })).status, 404)
  const before = await version(other.id)
  assert.equal((await api(`/jobs/${other.id}/orders`, { method: 'POST', cookie: pm, body: { expected_version: before, supplier: 'Lumber yard', description: 'Joists', amount_cents: 10_000 } })).status, 404)
  assert.equal(await version(other.id), before, 'An unassigned action writes nothing')
  assert.equal((await api('/jobs', { method: 'POST', cookie: pm, body: { name: 'New job', client_email: 'x@example.com' } })).status, 403, 'Project managers do not create jobs')
  r = await api('/jobs', { cookie: admin }); assert.equal(r.value.role, 'admin'); assert.equal(r.value.jobs.length, 2, 'Administrators manage every job')

  // PO routes: issue within the owner-set limit; over the limit fails without a write; administrators have no limit.
  let job = assigned
  const act = async (path, body = {}, cookie = pm) => { const result = await api(`/jobs/${job.id}${path}`, { method: 'POST', cookie, body: { expected_version: job.version, ...body } }); if (result.status === 200) job = result.value.job; return result }
  r = await act('/orders', { supplier: 'Champlain Lumber', description: 'Porch framing lumber', amount_cents: 500_000 }); assert.equal(r.status, 200)
  r = await act(`/orders/${r.value.record.id}/issue`); assert.equal(r.status, 200, 'A PO at the limit is within it'); assert.equal(r.value.record.issued_by.role, 'project_manager')
  r = await act('/orders', { supplier: 'Champlain Lumber', description: 'Composite decking', amount_cents: 500_001 }); const big = r.value.record.id
  const held = job.version
  r = await act(`/orders/${big}/issue`); assert.equal(r.status, 403); assert.equal(r.value.error, 'over_limit')
  assert.equal(await version(job.id), held, 'An over-limit PO writes nothing')
  r = await act(`/orders/${big}/issue`, {}, admin); assert.equal(r.status, 200, 'Administrators issue above the project manager limit')

  // Connector route: the project manager's calendar feed for the assigned job is rechecked on every fetch.
  r = await api(`/jobs/${job.id}/calendar`, { method: 'POST', cookie: pm, body: { expected_version: job.version, action: 'rotate' } }); assert.equal(r.status, 200, JSON.stringify(r.value))
  const feed = r.value.urlPath; assert.equal((await f.request(feed)).status, 200)
  assert.equal((await api(`/jobs/${other.id}/calendar`, { method: 'POST', cookie: pm, body: { expected_version: await version(other.id), action: 'rotate' } })).status, 404)
  // Company records, installation secrets, connectors and erasure.
  for (const [cookie, who] of [[pm, 'project manager'], [admin, 'administrator']]) {
   assert.equal((await api('/agent-credentials', { method: 'POST', cookie, body: {} })).status, 403, `No ${who} mints installation credentials`)
   assert.equal((await api('/agent-credentials', { cookie })).status, 403)
   assert.equal((await api(`/jobs/${job.id}`, { method: 'DELETE', cookie, body: { expected_version: job.version } })).status, 403, `No ${who} erases a job`)
   assert.equal((await api('/lien-waiver-templates', { method: 'PUT', cookie, body: { expected_version: 0, templates: [] } })).status, 403)
  }
  assert.equal((await api('/vendors', { cookie: pm })).status, 403, 'Project managers do not manage company records')
  assert.equal((await api('/company', { method: 'PUT', cookie: pm, body: { expected_version: 0 } })).status, 403)
  assert.equal((await api('/team', { cookie: pm })).status, 403)
  assert.equal((await f.request('/auth/invite', { method: 'POST', cookie: pm, body: { email: 'new-client@example.com', displayName: 'New Client', role: 'member', returnTo: '/app' } })).status, 403, 'Project managers cannot invite or change people')
  assert.equal((await f.request('/auth/operators', { cookie: pm })).status, 403)
  assert.equal((await api('/vendors', { cookie: admin })).status, 200, 'Administrators manage company records')
  assert.equal(await version(job.id), job.version)

  // Reassignment applies on the next request: administrator, then a project manager with no jobs.
  r = await api(`/team/${person.id}`, { method: 'PUT', body: { expected_version: 1, role: 'admin' } }); assert.equal(r.status, 200)
  assert.equal((await api(`/jobs/${other.id}`, { cookie: pm })).status, 200)
  assert.equal((await api('/jobs', { cookie: pm })).value.role, 'admin')
  r = await api(`/team/${person.id}`, { method: 'PUT', body: { expected_version: 0, role: 'project_manager', job_ids: [], po_limit_cents: 0 } }); assert.equal(r.status, 200)
  assert.equal((await api(`/jobs/${assigned.id}`, { cookie: pm })).status, 404, 'Removing the assignment removes the job on the next request')
  assert.equal((await f.request(feed)).status, 404, 'The calendar feed stops with the assignment')
  const audited = await f.db.prepare("SELECT count(*) AS n FROM oa_auth_audit WHERE action='plinth.role' AND value LIKE ?").bind(person.id + ':%').first()
  assert.equal(audited.n, 3, 'Each role change is audited')
  assert.equal((await api(`/jobs/${job.id}`, { method: 'DELETE', body: { expected_version: job.version } })).status, 200, 'The owner erases')
 } finally { await f.close() }
})
