import test from 'node:test'
import assert from 'node:assert/strict'
import ICAL from 'ical.js'
import { createActiveJob, createFixture } from './helpers.mjs'

test('SCH-001 — reviewed working-calendar dependencies, milestones, critical path and scoped calendar revisions', async () => {
 const f = await createFixture()
 try {
  const client = await f.invite('schedule-client@example.com', 'Morgan Chen'), stranger = await f.invite('elsewhere@example.com'), agent = await f.agent()
  let job = await createActiveJob(f, '480,000 dollar Maple Street whole-home remodel', 'schedule-client@example.com', 48_000_000)
  const root = `/api/plinth/jobs/${job.id}`
  const post = (suffix, body = {}, credentials = { cookie: f.owner }) => f.json(root + suffix, { method: 'POST', ...credentials, body: { expected_version: job.version, ...body } })
  const calendar = { weekdays: [1, 2, 3, 4, 5], start_hour: 8, end_hour: 17, holidays: ['2026-11-11'] }
  const task = (id, description, start, duration_minutes, predecessors = [], extra = {}) => ({ id, description, trade: id === 'permit' ? 'City inspections' : id + ' subcontractor', owner: id === 'inspection' ? 'Alex Rivera, superintendent' : 'Jordan Lee, project manager', start, duration_minutes, predecessors, milestone: duration_minutes === 0, ...extra })
  const proposed = [
   task('demolition', 'Demolition and safe removal of existing kitchen', '2026-11-06T08:00:00Z', 540),
   task('inspection', 'Rough inspection', '2026-11-06T08:00:00Z', 120, [{ id: 'demolition', lag_minutes: 60 }]),
   task('drywall', 'Drywall after permit and rough inspection', '2026-11-06T08:00:00Z', 540, [{ id: 'inspection', lag_minutes: 0 }, { id: 'permit', lag_minutes: 0 }]),
   task('permit', 'Permit released', '2026-11-06T08:00:00Z', 0),
  ]
  assert.equal((await post('/schedule/preview', { calendar, tasks: proposed }, { cookie: client })).status, 403)
  assert.equal((await post('/schedule/preview', { calendar, tasks: proposed }, { cookie: stranger })).status, 404)
  let r = await post('/schedule/preview', { calendar, tasks: proposed }, { token: agent }); assert.equal(r.status, 200)
  let preview = r.value.preview
  const row = id => preview.tasks.find(s => s.id === id)
  assert.equal(row('inspection').start, '2026-11-09T09:00:00.000Z', 'Weekend and finish-to-start working-minute lag are observed')
  assert.equal(row('drywall').start, '2026-11-09T11:00:00.000Z')
  assert.equal(row('drywall').end, '2026-11-10T11:00:00.000Z', 'Working duration excludes nights')
  assert.equal(row('permit').start, row('permit').end, 'Permit is a zero-duration milestone')
  assert.equal(row('inspection').owner, 'Alex Rivera, superintendent')
  assert.deepEqual(preview.critical_path, ['demolition', 'inspection', 'drywall'])
  assert.equal(preview.completion_before, null); assert.equal(preview.completion_after, '2026-11-10T11:00:00.000Z')
  assert.equal((await f.json(root, { cookie: client })).value.job.schedules.length, 0, 'Preview leaves published work unchanged')
  assert.equal((await post('/schedule/publish', { calendar, tasks: preview.tasks, digest: preview.digest }, { token: agent })).status, 403)
  assert.equal((await post('/schedule/publish', { calendar, tasks: preview.tasks, digest: 'unreviewed' })).status, 409)
  r = await post('/schedule/publish', { calendar, tasks: preview.tasks, digest: preview.digest }); assert.equal(r.status, 200); job = r.value.job
  assert.deepEqual(job.schedule_calendar, calendar); assert.deepEqual(job.schedule_critical_path, ['demolition', 'inspection', 'drywall'])
  r = await post('/calendar', { action: 'rotate' }, { cookie: client }); assert.equal(r.status, 200); const feedPath = r.value.urlPath
  const events = async () => { const response = await f.request(feedPath); assert.equal(response.status, 200); return new ICAL.Component(ICAL.parse(await response.text())).getAllSubcomponents('vevent').map(c => ({ event: new ICAL.Event(c), status: c.getFirstPropertyValue('status') })) }
  let feed = await events(); assert.equal(feed.length, 4)
  const initialInspection = feed.find(s => s.event.uid === 'inspection@plinth').event
  assert.equal(initialInspection.startDate.toJSDate().toISOString(), '2026-11-09T09:00:00.000Z')
  assert.equal(initialInspection.sequence, 0)
  const delayed = job.schedules.map(s => s.id === 'inspection' ? { ...s, start: '2026-11-10T16:00:00Z' } : s)
  r = await post('/schedule/preview', { calendar, tasks: delayed }); assert.equal(r.status, 200); preview = r.value.preview
  assert.equal(row('inspection').end, '2026-11-12T09:00:00.000Z', 'Holiday and overnight gaps are excluded')
  assert.equal(row('drywall').start, '2026-11-12T09:00:00.000Z')
  assert.equal(row('drywall').end, '2026-11-13T09:00:00.000Z')
  assert.equal(preview.completion_before, '2026-11-10T11:00:00.000Z'); assert.equal(preview.completion_after, '2026-11-13T09:00:00.000Z')
  assert.ok(preview.changes.some(c => c.id === 'drywall' && c.before.start !== c.after.start), 'Dependent shifts are explicit before publication')
  feed = await events(); assert.equal(feed.find(s => s.event.uid === 'inspection@plinth').event.sequence, 0, 'Preview does not change subscription dates')
  assert.equal((await post('/schedule/publish', { calendar, tasks: preview.tasks.map(s => s.id === 'inspection' ? { ...s, start: '2026-11-13T08:00:00Z' } : s), digest: preview.digest })).status, 409, 'Changed review payload cannot publish')
  const second = await createActiveJob(f, 'Oak Street guest suite', 'elsewhere@example.com')
  r = await f.json(`/api/plinth/jobs/${second.id}/schedules`, { method: 'POST', cookie: f.owner, body: { expected_version: second.version, trade: 'inspection subcontractor', description: 'Other site inspection', start: '2026-11-10T16:00:00Z', end: '2026-11-10T17:00:00Z' } }); assert.equal(r.status, 200)
  assert.equal((await f.json(`/api/plinth/jobs/${second.id}/schedule/preview`, { method: 'POST', cookie: f.owner, body: { expected_version: r.value.job.version, calendar, tasks: [...r.value.job.schedules, proposed[0]] } })).status, 409, 'Task event identities cannot collide across jobs')
  r = await post('/schedule/preview', { calendar, tasks: delayed }); assert.equal(r.status, 200); assert.ok(r.value.preview.conflicts.some(c => c.job_id === second.id), 'Preview identifies cross-job trade conflicts')
  assert.equal((await post('/schedule/publish', { calendar, tasks: r.value.preview.tasks, digest: r.value.preview.digest })).status, 409)
  r = await post('/schedule/preview', { calendar, tasks: job.schedules.map(s => s.id === 'inspection' ? { ...s, start: '2026-11-12T08:00:00Z' } : s) }); assert.equal(r.status, 200); preview = r.value.preview
  assert.equal((await post('/schedule/publish', { calendar, tasks: preview.tasks, digest: preview.digest, expected_version: job.version - 1 })).status, 409)
  r = await post('/schedule/publish', { calendar, tasks: preview.tasks, digest: preview.digest }); assert.equal(r.status, 200); job = r.value.job
  feed = await events(); const moved = feed.find(s => s.event.uid === initialInspection.uid).event
  assert.equal(moved.sequence, 1); assert.equal(moved.startDate.toJSDate().toISOString(), '2026-11-12T08:00:00.000Z')
  assert.equal(feed.find(s => s.event.uid === 'drywall@plinth').event.sequence, 1, 'Every moved dependent increments sequence')
  const visible = (await f.json(root, { cookie: client })).value.job
  assert.deepEqual(visible.schedules.map(s => [s.id, s.start, s.end]), job.schedules.map(s => [s.id, s.start, s.end]))
  const lastApproval = job.approvals.at(-1)
  assert.equal(lastApproval.kind, 'schedule.publish'); assert.equal(lastApproval.approved_by.role, 'owner')
  assert.equal(lastApproval.snapshot.before.tasks.find(s => s.id === 'inspection').start, '2026-11-09T09:00:00.000Z')
  assert.equal(lastApproval.snapshot.after.tasks.find(s => s.id === 'inspection').start, '2026-11-12T08:00:00.000Z')
  assert.equal((await post('/schedules/inspection/move', { start: '2026-11-14T08:00:00Z', end: '2026-11-14T09:00:00Z' })).status, 409, 'Direct moves cannot bypass dependency review')
  r = await post('/schedule/preview', { calendar, tasks: job.schedules.map(s => s.id === 'demolition' ? { ...s, predecessors: [{ id: 'drywall', lag_minutes: 0 }] } : s) }); assert.equal(r.status, 409); assert.equal(r.value.error, 'dependency_cycle')
  r = await post('/schedule/preview', { calendar, tasks: job.schedules.filter(s => s.id !== 'permit') }); assert.equal(r.status, 400, 'Existing event identities cannot disappear')
  r = await post('/schedule/preview', { calendar, tasks: job.schedules.map(s => s.id === 'drywall' ? { ...s, status: 'cancelled' } : s) }); assert.equal(r.status, 200); preview = r.value.preview
  r = await post('/schedule/publish', { calendar, tasks: preview.tasks, digest: preview.digest }); assert.equal(r.status, 200); job = r.value.job
  feed = await events(); const cancelled = feed.find(s => s.event.uid === 'drywall@plinth')
  assert.equal(cancelled.event.sequence, 2); assert.equal(cancelled.status, 'CANCELLED')
  assert.equal((await f.json(root, { cookie: f.owner })).value.job.schedules.find(s => s.id === 'drywall').status, 'cancelled', 'Reload retains published cancellation')
 } finally { await f.close() }
})
