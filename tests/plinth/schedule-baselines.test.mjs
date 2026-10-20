import test from 'node:test'
import assert from 'node:assert/strict'
import ICAL from 'ical.js'
import { createActiveJob, createFixture } from './helpers.mjs'

test('SCH-002 — sold-job templates, immutable human baselines, evidenced actuals and named feed revisions', async () => {
 const f = await createFixture()
 try {
  const client = await f.invite('baseline-client@example.com', 'Morgan Chen'), agent = await f.agent()
  const calendar = { weekdays: [1, 2, 3, 4, 5], start_hour: 8, end_hour: 17, holidays: [] }
  const task = (id, duration_minutes, predecessors = []) => ({ id, trade: id + ' crew', description: id, owner: 'Alex Rivera', start: '2026-11-02T08:00:00Z', duration_minutes, milestone: duration_minutes === 0, predecessors })
  const tasks = [task('framing', 540), task('inspection', 60, [{ id: 'framing', lag_minutes: 0 }]), task('handover', 0, [{ id: 'inspection', lag_minutes: 0 }])]
  const templateRoot = '/api/plinth/schedule-templates'
  assert.equal((await f.json(templateRoot)).status, 401)
  assert.equal((await f.json(templateRoot, { cookie: client })).status, 403)
  assert.equal((await f.json(templateRoot, { method: 'POST', token: agent, body: { name: 'Remodel', calendar, tasks } })).status, 403)
  let r = await f.json(templateRoot, { method: 'POST', cookie: f.owner, body: { name: 'Remodel', calendar, tasks } })
  assert.equal(r.status, 201); let template = r.value.template
  assert.equal((await f.json(templateRoot, { token: agent })).value.templates[0].id, template.id, 'Agents may inspect company templates to prepare a proposal')
  const firstTemplateRevision = structuredClone(template.revisions[0])
  r = await f.json(`${templateRoot}/${template.id}`, { method: 'PUT', cookie: f.owner, body: { expected_version: template.version, name: template.name, calendar, tasks, revision_name: 'Inspection responsibility confirmed', reason: 'The superintendent owns rough inspection', } })
  assert.equal(r.status, 200); template = r.value.template
  assert.deepEqual(template.revisions[0], firstTemplateRevision, 'Template revision retains its approved predecessor')
  assert.equal((await f.json(`${templateRoot}/${template.id}`, { method: 'PUT', cookie: f.owner, body: { expected_version: template.version - 1, name: template.name, calendar, tasks, revision_name: 'Stale edit', reason: 'Outdated screen' } })).status, 409)

  r = await f.json('/api/plinth/jobs', { method: 'POST', cookie: f.owner, body: { name: 'Maple Street remodel on sale', client_email: 'baseline-client@example.com' } })
  assert.equal(r.status, 201); let job = r.value.job
  const root = `/api/plinth/jobs/${job.id}`
  const post = (suffix, body = {}, credentials = { cookie: f.owner }) => f.json(root + suffix, { method: 'POST', ...credentials, body: { expected_version: job.version, ...body } })
  const application = { template_id: template.id, start: '2026-11-09T08:00:00Z' }
  assert.equal((await post('/schedule-template/preview', application)).status, 409, 'Quote acceptance precedes template application')
  r = await post('/quotes', { lines: [{ description: 'Remodel works', quantity: 1, unit_cents: 48_000_000 }] }); assert.equal(r.status, 200); job = r.value.job
  r = await post(`/quotes/${job.quotes[0].id}/accept`, { method: 'signed',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'}, evidence: 'Client signed the remodel contract' }); assert.equal(r.status, 200); job = r.value.job
  r = await post('/schedule-template/preview', application, { token: agent }); assert.equal(r.status, 200); let preview = r.value.preview
  assert.equal(preview.tasks.find(task => task.description === 'framing').start, '2026-11-09T08:00:00.000Z')
  assert.equal(preview.completion_after, '2026-11-10T09:00:00.000Z')
  assert.equal((await post('/schedule-template/apply', { ...application, digest: preview.digest }, { token: agent })).status, 403)
  assert.equal((await post('/schedule-template/apply', { ...application, digest: 'unreviewed' })).status, 409)
  r = await f.json(`${templateRoot}/${template.id}`, {method:'PUT',cookie:f.owner,body:{expected_version:template.version,name:template.name,calendar,tasks,revision_name:'Reviewed company source',reason:'Company approval changed after the job preview'}});assert.equal(r.status,200);template=r.value.template
  assert.equal((await post('/schedule-template/apply',{...application,digest:preview.digest})).status,409,'Even unchanged task dates require review of the current source-template revision')
  r = await post('/schedule-template/preview', application);assert.equal(r.status,200);preview=r.value.preview
  r = await post('/schedule-template/apply', { ...application, digest: preview.digest }); assert.equal(r.status, 200); job = r.value.job
  assert.equal(job.schedule_template.template_id, template.id)
  assert.equal(job.schedule_template.template_version, template.version)
  assert.equal(job.schedule_template.approved_by.role, 'owner')
  assert.equal((await post('/schedule-baseline', { name: 'Original client promise', reason: 'Contract schedule accepted at sale' }, { token: agent })).status, 403)
  r = await post('/schedule-baseline', { name: 'Original client promise', reason: 'Contract schedule accepted at sale' }); assert.equal(r.status, 200); job = r.value.job
  const baseline = structuredClone(job.schedule_baselines[0])
  assert.equal(job.approvals.find(row => row.id === baseline.approval_id).kind, 'schedule.baseline')
  assert.equal((await post('/schedule-baseline', { name: baseline.name, reason: 'Overwrite attempt' })).status, 409)
  r = await post('/calendar', { action: 'rotate' }, { cookie: client }); assert.equal(r.status, 200); const feedPath = r.value.urlPath
  const events = async () => {
   const response = await f.request(feedPath); assert.equal(response.status, 200)
   return new ICAL.Component(ICAL.parse(await response.text())).getAllSubcomponents('vevent').map(component => ({ event: new ICAL.Event(component), status: component.getFirstPropertyValue('status') }))
  }
  const taskId = description => job.schedules.find(task => task.description === description).id
  const original = (await events()).find(row => row.event.uid === `${taskId('handover')}@plinth`).event
  assert.equal(original.sequence, 0)
  const actualStart = { task_id: taskId('framing'), actual_start: '2026-11-10T08:00:00Z', evidence: 'Superintendent daily log: framing crew arrived after delayed lumber delivery' }
  assert.equal((await post('/schedule-actuals', actualStart, { token: agent })).status, 403)
  assert.equal((await post('/schedule-actuals', { ...actualStart, actual_start: '2026-11-10T08:00:00' })).status, 400, 'Actual instants require explicit UTC')
  assert.equal((await post('/schedule-actuals', { ...actualStart, task_id: 'missing' })).status, 404)
  r = await post('/schedule-actuals', actualStart); assert.equal(r.status, 200); job = r.value.job
  const firstActual = structuredClone(job.schedule_actuals[0])
  const finishEvidence = 'Daily log and site photographs confirm framing completed Thursday at 10:00:45 UTC'
  r = await post('/schedule-actuals', { ...actualStart, actual_finish: '2026-11-12T10:00:45Z', evidence: finishEvidence })
  assert.equal(r.status, 200); job = r.value.job
  assert.deepEqual(job.schedule_actuals[0], firstActual)
  assert.equal(job.schedule_actuals[1].supersedes, firstActual.id)
  assert.equal(job.schedule_actuals[1].recorded_by.role, 'owner')
  assert.equal((await post('/schedule-actuals', { ...actualStart, actual_start: '2026-11-10T09:00:00Z', actual_finish: '2026-11-12T10:00:45Z' })).status, 400, 'Corrected evidence needs a reason')
  const unpublishedClient = (await f.json(root, { cookie: client })).value.job
  assert.deepEqual(unpublishedClient.schedule_actuals ?? [], [], 'Unpublished field records stay in the office')
  assert.ok(!JSON.stringify(unpublishedClient).includes(actualStart.evidence) && !JSON.stringify(unpublishedClient).includes(finishEvidence), 'Client responses contain no raw field evidence')
  assert.equal((await events()).find(row => row.event.uid === original.uid).event.sequence, 0, 'Actual evidence does not itself publish schedule changes')
  r = await post('/schedule/preview', { calendar, tasks: job.schedules }); assert.equal(r.status, 200); preview = r.value.preview
  assert.equal(preview.tasks.find(task => task.description === 'framing').start, '2026-11-10T08:00:00.000Z')
  assert.equal(preview.tasks.find(task => task.description === 'framing').end, '2026-11-12T10:00:45.000Z')
  assert.equal(preview.tasks.find(task => task.description === 'inspection').start, '2026-11-12T10:00:45.000Z')
  assert.equal(preview.completion_after, '2026-11-12T11:00:45.000Z')
  assert.equal((await post('/schedule/publish', { calendar, tasks: preview.tasks, digest: preview.digest })).status, 400, 'A baseline change requires a named authorizing revision')
  r = await post('/schedule/publish', { calendar, tasks: preview.tasks, digest: preview.digest, revision_name: 'Lumber delay recovery', reason: 'Late lumber delayed framing; the superintendent confirmed actual completion before inspection' })
  assert.equal(r.status, 200); job = r.value.job
  assert.deepEqual(job.schedule_baselines[0], baseline, 'Original client promise stays immutable after publication')
  const revision = job.schedule_revisions.at(-1), decision = job.approvals.find(row => row.id === revision.approval_id)
  assert.equal(revision.baseline_id, baseline.id)
  assert.equal(decision.snapshot.reason, revision.reason)
  assert.equal(decision.snapshot.name, revision.name)
  assert.equal(decision.approved_by.role, 'owner')
  assert.equal(decision.snapshot.before.tasks.find(task => task.description === 'handover').start, '2026-11-10T09:00:00.000Z')
  assert.equal(decision.snapshot.after.tasks.find(task => task.description === 'handover').start, '2026-11-12T11:00:45.000Z')
  let feedEvent = (await events()).find(row => row.event.uid === original.uid).event
  assert.equal(feedEvent.sequence, 1); assert.equal(feedEvent.startDate.toJSDate().toISOString(), '2026-11-12T11:00:45.000Z')
  const clientJob = (await f.json(root, { cookie: client })).value.job
  assert.ok(clientJob.approvals.some(row => row.id === revision.approval_id), 'Assigned client can open the authorizing decision')
  assert.deepEqual(clientJob.schedule_baselines[0], baseline)
  assert.equal(clientJob.schedule_actuals.at(-1).actual_finish, '2026-11-12T10:00:45.000Z')
  assert.equal(clientJob.schedule_actuals.at(-1).evidence, undefined)
  assert.equal(clientJob.schedule_actuals.at(-1).reason, undefined)
  assert.equal(clientJob.schedule_actuals.at(-1).recorded_by, undefined)
  assert.ok(!JSON.stringify(clientJob).includes(actualStart.evidence) && !JSON.stringify(clientJob).includes(finishEvidence), 'Approval history and variance do not expose raw actual evidence')
  const correctionReason = 'Corrected finish from the signed crew time record', correctedEvidence = 'Foreman signed the corrected framing finish in the office log'
  r = await post('/schedule-actuals', { ...actualStart, actual_finish: '2026-11-12T10:30:45Z', evidence: correctedEvidence, reason: correctionReason }); assert.equal(r.status, 200); job = r.value.job
  assert.equal(job.schedule_actuals.at(-1).actual_finish, '2026-11-12T10:30:45.000Z')
  assert.equal(job.schedule_actuals.at(-1).reason, correctionReason)
  const clientBeforeRepublication = (await f.json(root, { cookie: client })).value.job
  assert.equal(clientBeforeRepublication.schedule_actuals.at(-1).actual_finish, '2026-11-12T10:00:45.000Z', 'A raw correction does not alter the human-published actual time')
  assert.ok(!JSON.stringify(clientBeforeRepublication).includes(correctedEvidence) && !JSON.stringify(clientBeforeRepublication).includes(correctionReason), 'Unpublished correction evidence stays office-only')
  r = await post('/schedule/preview', { calendar, tasks: job.schedules.map(task => task.description === 'handover' ? { ...task, status: 'cancelled' } : task) }); assert.equal(r.status, 200); preview = r.value.preview
  r = await post('/schedule/publish', { calendar, tasks: preview.tasks, digest: preview.digest, revision_name: 'Handover replaced by client walk-through', reason: 'Client requested a separate walk-through after inspection' }); assert.equal(r.status, 200); job = r.value.job
  const clientAfterRepublication = (await f.json(root, { cookie: client })).value.job
  assert.equal(clientAfterRepublication.schedule_actuals.at(-1).actual_finish, '2026-11-12T10:30:45.000Z')
  assert.ok(!JSON.stringify(clientAfterRepublication).includes(correctedEvidence) && !JSON.stringify(clientAfterRepublication).includes(correctionReason), 'Publication shares actual instants while preserving office evidence privacy')
  const cancelled = (await events()).find(row => row.event.uid === original.uid)
  assert.equal(cancelled.event.sequence, 2); assert.equal(cancelled.status, 'CANCELLED')
  assert.deepEqual(job.schedule_baselines[0], baseline)
  assert.equal(job.schedule_revisions.length, 2)

  const reuseJob = await createActiveJob(f, 'Elm Street remodel', 'another-client@example.com')
  r = await f.json(`/api/plinth/jobs/${reuseJob.id}/schedule-template/preview`, { method: 'POST', cookie: f.owner, body: { expected_version: reuseJob.version, template_id: template.id, start: '2026-12-07T08:00:00Z' } }); assert.equal(r.status, 200)
  assert.equal(r.value.preview.tasks.find(task => task.description === 'framing').start, '2026-12-07T08:00:00.000Z', 'The company template is reusable after a second sale')
  r = await f.json(`/api/plinth/jobs/${reuseJob.id}/schedule-template/apply`, { method: 'POST', cookie: f.owner, body: { expected_version: reuseJob.version, template_id: template.id, start: '2026-12-07T08:00:00Z', digest: r.value.preview.digest } }); assert.equal(r.status, 200)
  const secondJob = r.value.job, secondFramingId = secondJob.schedules.find(task => task.description === 'framing').id
  assert.notEqual(secondFramingId, taskId('framing'), 'Each sold job has its own stable task identity')
  r = await f.json(`/api/plinth/jobs/${reuseJob.id}/calendar`, { method: 'POST', cookie: f.owner, body: { expected_version: secondJob.version, action: 'rotate' } }); assert.equal(r.status, 200)
  const secondFeed = await f.request(r.value.urlPath); assert.equal(secondFeed.status, 200)
  const secondEvents = new ICAL.Component(ICAL.parse(await secondFeed.text())).getAllSubcomponents('vevent').map(component => new ICAL.Event(component))
  const firstFramingEvent = (await events()).find(row => row.event.uid === `${taskId('framing')}@plinth`).event
  assert.notEqual(secondEvents.find(event => event.uid === `${secondFramingId}@plinth`).uid, firstFramingEvent.uid, 'Subscriptions to two jobs cannot merge reused template events')
  r = await f.json(`${templateRoot}/${template.id}`, { method: 'DELETE', cookie: f.owner, body: { expected_version: template.version, revision_name: 'Retired remodel sequence', reason: 'Use the newly approved company process for future sales' } }); assert.equal(r.status, 200)
  assert.equal(r.value.template.archived, true)
  assert.deepEqual(r.value.template.revisions[0], firstTemplateRevision)
  assert.equal((await f.json(`/api/plinth/jobs/${reuseJob.id}/schedule-template/preview`, { method: 'POST', cookie: f.owner, body: { expected_version: secondJob.version, template_id: template.id, start: '2026-12-07T08:00:00Z' } })).status, 409)
  assert.deepEqual((await f.json(root, { cookie: f.owner })).value.job.schedule_baselines[0], baseline, 'Retiring the template leaves sold-job promises intact')
 } finally { await f.close() }
})

test('SCH-002 — approved template revisions update and cancel the original published calendar identities', async () => {
 const f = await createFixture()
 try {
  const calendar = { weekdays: [1, 2, 3, 4, 5], start_hour: 8, end_hour: 17, holidays: [] }
  const tasks = [
   { id: 'framing', trade: 'Framers', description: 'Framing', owner: 'Alex Rivera', start: '2026-11-02T08:00:00Z', duration_minutes: 60 },
   { id: 'walkthrough', trade: 'Superintendent', description: 'Client walk-through', owner: 'Jordan Lee', start: '2026-11-02T10:00:00Z', duration_minutes: 60 },
  ]
  const templateRoot = '/api/plinth/schedule-templates'
  let r = await f.json(templateRoot, { method: 'POST', cookie: f.owner, body: { name: 'Small remodel', calendar, tasks } }); assert.equal(r.status, 201); let template = r.value.template
  let job = await createActiveJob(f)
  const root = `/api/plinth/jobs/${job.id}`
  const post = (suffix, body) => f.json(root + suffix, { method: 'POST', cookie: f.owner, body: { expected_version: job.version, ...body } })
  const proposal = { template_id: template.id, start: '2026-11-09T08:00:00Z' }
  r = await post('/schedule-template/preview', proposal); assert.equal(r.status, 200)
  r = await post('/schedule-template/apply', { ...proposal, digest: r.value.preview.digest }); assert.equal(r.status, 200); job = r.value.job
  r = await post('/schedule-baseline', { name: 'Sold schedule', reason: 'Dates agreed in signed quote' }); assert.equal(r.status, 200); job = r.value.job
  const originalBaseline = structuredClone(job.schedule_baselines[0])
  r = await post('/calendar', { action: 'rotate' }); assert.equal(r.status, 200); const feedPath = r.value.urlPath
  const events = async () => {
   const response = await f.request(feedPath); assert.equal(response.status, 200)
   return new ICAL.Component(ICAL.parse(await response.text())).getAllSubcomponents('vevent').map(component => ({ event: new ICAL.Event(component), status: component.getFirstPropertyValue('status') }))
  }
  const originalEvents = await events(), taskId = description => job.schedules.find(task => task.description === description).id
  const framingUid = originalEvents.find(row => row.event.uid === `${taskId('Framing')}@plinth`).event.uid
  const walkthroughUid = originalEvents.find(row => row.event.uid === `${taskId('Client walk-through')}@plinth`).event.uid
  const revise = async (nextTasks, revision_name, reason) => {
   const response = await f.json(`${templateRoot}/${template.id}`, { method: 'PUT', cookie: f.owner, body: { expected_version: template.version, name: template.name, calendar, tasks: nextTasks, revision_name, reason } })
   assert.equal(response.status, 200); template = response.value.template
  }
  await revise(tasks.map(task => task.id === 'framing' ? { ...task, duration_minutes: 120 } : task), 'Framing scope extended', 'Engineer added another framing section')
  r = await post('/schedule-template/preview', proposal); assert.equal(r.status, 200)
  r = await post('/schedule-template/apply', { ...proposal, digest: r.value.preview.digest, revision_name: 'Apply engineer framing revision', reason: 'Human reviewed the additional hour before publication' }); assert.equal(r.status, 200); job = r.value.job
  const framing = (await events()).find(row => row.event.uid === framingUid)
  assert.equal(framing.event.sequence, 1)
  assert.equal(framing.event.endDate.toJSDate().toISOString(), '2026-11-09T10:00:00.000Z')
  assert.deepEqual(job.schedule_baselines[0], originalBaseline)
  await revise(template.tasks.filter(task => task.id !== 'walkthrough'), 'Remove separate walk-through', 'Client will join the already scheduled inspection instead')
  r = await post('/schedule-template/preview', proposal); assert.equal(r.status, 200)
  assert.equal(r.value.preview.tasks.find(task => task.description === 'Client walk-through').status, 'cancelled')
  r = await post('/schedule-template/apply', { ...proposal, digest: r.value.preview.digest, revision_name: 'Apply walk-through cancellation', reason: 'Client confirmed the replacement inspection visit' }); assert.equal(r.status, 200); job = r.value.job
  const cancelled = (await events()).find(row => row.event.uid === walkthroughUid)
  assert.equal(cancelled.event.sequence, 1); assert.equal(cancelled.status, 'CANCELLED')
  assert.deepEqual(job.schedule_baselines[0], originalBaseline)
  assert.equal(job.schedule_revisions.length, 2)
  const applications = job.approvals.filter(approval => approval.kind === 'schedule.template')
  assert.equal(applications.length, 3)
  assert.equal(applications[0].snapshot.application.template_version, 1)
  assert.equal(applications.at(-1).snapshot.application.template_version, template.version)
 } finally { await f.close() }
})
