import test from 'node:test'
import assert from 'node:assert/strict'
import ICAL from 'ical.js'
import { createActiveJob, createFixture } from './helpers.mjs'

test('SCH-006 — permit originals, inspection failure and rain holds gate every publication door with human clearance history', async () => {
 const f = await createFixture()
 try {
  const agent = await f.agent(), client = await f.invite('holds-client@example.com'), stranger = await f.invite('other-site@example.com')
  let job = await createActiveJob(f, 'Alvarez whole-home remodel — permit and rough inspection', 'holds-client@example.com')
  const root = `/api/plinth/jobs/${job.id}`
  const post = async (path, body = {}, credentials = {cookie:f.owner}) => { const result = await f.json(root+path, {method:'POST',...credentials,body:{expected_version:job.version,...body}}); if(result.status===200 && result.value.job)job=result.value.job; return result }
  const file = {name:'Inspection result.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.7\nOriginal signed inspection evidence\n%%EOF').toString('base64')}
  let r = await post('/schedules', {trade:'Drywall crew',description:'Hang drywall after rough inspection',start:'2026-11-02T08:00:00Z',end:'2026-11-02T09:00:00Z'}, {token:agent}); assert.equal(r.status,200)
  const drywall = job.schedules[0].id
  const requirement = {kind:'inspection',title:'Rough inspection before drywall',jurisdiction:'City of Burlington, Vermont',accountable:'Alex Rivera, superintendent',task_ids:[drywall],reason:'Inspection requested for rough plumbing and wiring',documents:[file]}
  assert.equal((await post('/schedule-constraints', requirement,{token:agent})).status,403)
  assert.equal((await post('/schedule-constraints', requirement,{cookie:client})).status,403)
  assert.equal((await post('/schedule-constraints', requirement,{cookie:stranger})).status,404)
  r = await post('/schedule-constraints', requirement); assert.equal(r.status,200)
  const inspection = r.value.record.id, original = r.value.record.events[0].documents[0]
  assert.equal((await post(`/schedules/${drywall}/approve`)).status,409,'A pending request blocks legacy approval')
  r = await post('/schedule-constraints/'+inspection,{action:'failed',reason:'Inspector found incomplete nail plates',documents:[file]}); assert.equal(r.status,200)
  r = await post('/schedule-constraints',{kind:'weather',title:'Rain hold on open roof',jurisdiction:'Burlington site',accountable:'Morgan Chen, builder',task_ids:[drywall],reason:'Unsafe rain exposure until roof dry and weather reviewed'}); assert.equal(r.status,200); const rain=r.value.record.id
  r = await post('/schedule-constraints',{kind:'permit',title:'City building permit',jurisdiction:'Burlington building department',accountable:'Alex Rivera',task_ids:[],reason:'Permit release required for job work',documents:[file]}); assert.equal(r.status,200); const permit=r.value.record.id
  assert.equal((await post('/schedule-constraints/'+permit,{action:'cleared',reason:'Permit issued'})).status,400,'Unverified text is not original permit evidence')
  r=await post('/schedule-constraints/'+permit,{action:'cleared',reason:'Permit issued, original attached',documents:[file]}); assert.equal(r.status,200)
  const calendar={weekdays:[1,2,3,4,5],start_hour:8,end_hour:17,holidays:[]}
  let tasks=[{...job.schedules[0],owner:'Alex Rivera',duration_minutes:60},{id:'paint-after-drywall',trade:'Painting crew',owner:'Morgan Chen',description:'Paint after drywall',start:'2026-11-02T08:00:00Z',duration_minutes:60,predecessors:[{id:drywall,lag_minutes:0}]}]
  r=await post('/schedule/preview',{calendar,tasks}); assert.equal(r.status,200); let preview=r.value.preview
  assert.ok(preview.blockers.some(b=>b.constraint_id===inspection&&b.task_id==='paint-after-drywall'),'Inspection gates transitive successors')
  assert.ok(preview.blockers.some(b=>b.constraint_id===rain&&b.task_id===drywall))
  assert.equal((await post('/schedule/publish',{calendar,tasks:preview.tasks,digest:preview.digest})).status,409)
  assert.equal(job.schedules.length,1,'Blocked publication does not commit candidate tasks')
  assert.equal((await post('/schedule-constraints/'+inspection,{action:'cleared',reason:'Passed',documents:[file]},{token:agent})).status,403)
  r=await post('/schedule-constraints/'+inspection,{action:'cleared',reason:'Inspector passed rough work after nail plates installed',documents:[file]}); assert.equal(r.status,200)
  r=await post('/schedule/preview',{calendar,tasks}); assert.equal(r.status,200); assert.ok(r.value.preview.blockers.every(b=>b.constraint_id===rain),'Rain remains after passed inspection')
  assert.equal((await post(`/schedules/${drywall}/approve`)).status,409)
  r=await post('/schedule-constraints/'+rain,{action:'cleared',reason:'Builder reviewed dry site and safe weather conditions',documents:[file]}); assert.equal(r.status,200)
  r=await post(`/schedules/${drywall}/approve`);assert.equal(r.status,200)
  r=await post('/schedule-constraints',{kind:'site',title:'Temporary access exclusion',jurisdiction:'Burlington site',accountable:'Alex Rivera',task_ids:[drywall],reason:'Access unsafe during scaffold removal'});assert.equal(r.status,200);const site=r.value.record.id
  assert.equal((await post(`/schedules/${drywall}/move`,{start:'2026-11-03T08:00:00Z',end:'2026-11-03T09:00:00Z'})).status,409,'Legacy move cannot bypass holds')
  r=await post('/schedule-constraints/'+site,{action:'cleared',reason:'Scaffold removed and access reviewed',documents:[file]});assert.equal(r.status,200)
  tasks=tasks.map(t=>({...t,start:'2026-11-04T08:00:00Z'}))
  r=await post('/schedule/preview',{calendar,tasks});assert.equal(r.status,200);preview=r.value.preview;assert.deepEqual(preview.blockers,[])
  r=await post('/schedule/publish',{calendar,tasks:preview.tasks,digest:preview.digest});assert.equal(r.status,200)
  assert.equal(job.schedules.find(t=>t.id===drywall).start,'2026-11-04T08:00:00.000Z')
  const response=await f.request(root+'/schedule-documents/'+original.id,{cookie:f.owner});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()).toString('base64'),file.base64)
  assert.equal(response.headers.get('content-disposition').startsWith('attachment;'),true)
  assert.equal((await f.request(root+'/schedule-documents/'+original.id,{cookie:client})).status,403)
  assert.equal((await f.request(root+'/schedule-documents/'+original.id,{cookie:stranger})).status,404)
  assert.equal((await f.request(root+'/schedule-documents/'+original.id)).status,401)
  const reload=(await f.json(root,{cookie:f.owner})).value.job
  assert.deepEqual(reload.schedule_constraints.find(c=>c.id===inspection).events.map(e=>e.action),['requested','failed','cleared'])
  assert.equal(reload.schedule_constraints.find(c=>c.id===inspection).jurisdiction,'City of Burlington, Vermont')
  assert.ok(reload.schedule_constraints.flatMap(c=>c.events).every(e=>e.recorded_by.id&&e.recorded_by.at&&e.recorded_by.role==='owner'))
  const clientJob=(await f.json(root,{cookie:client})).value.job;assert.equal(clientJob.schedule_constraints,undefined);assert.ok(clientJob.approvals.every(a=>a.kind!=='schedule.constraint'))
  assert.ok(reload.approvals.filter(a=>a.kind==='schedule.constraint').length>=9,'Every request, failure, hold and release has history')
  r=await post('/schedule-constraints/'+rain,{action:'held',reason:'Rain returned'});assert.equal(r.status,200)
  r=await post('/schedule/preview',{calendar,tasks:job.schedules});assert.equal(r.status,200)
  assert.equal((await post('/schedule/publish',{calendar,tasks:r.value.preview.tasks,digest:r.value.preview.digest})).status,409,'A cleared constraint can be reopened without erasing its old release')
 } finally {await f.close()}
})

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

test('SCH-005 — a superintendent reads today, tomorrow and the look-ahead with contacts, sheet, prerequisites and materials, completes a checklist item and records progress that moves the office forecast; unassigned jobs stay hidden', async () => {
 const { takeoffPlan } = await import('../fixtures/takeoff-plan.mjs')
 const f = await createFixture()
 try {
  const sup = await f.invite('field-super@example.com', 'Sam Superintendent', 'admin'), crew = await f.invite('field-crew@example.com', 'Casey Crew', 'admin')
  const api = (path, { method = 'GET', body, cookie = f.owner } = {}) => f.json('/api/plinth' + path, { method, cookie, ...(body ? { body } : {}) })
  const team = (await api('/team')).value.team
  let job = await createActiveJob(f, 'Orchard addition framing', 'field-client@example.com'); const other = await createActiveJob(f, 'Unassigned garage', 'garage-client@example.com')
  for (const [email, role] of [['field-super@example.com', 'superintendent'], ['field-crew@example.com', 'crew']]) assert.equal((await api(`/team/${team.find(m => m.email === email).id}`, { method: 'PUT', body: { expected_version: 0, role, job_ids: [job.id], po_limit_cents: 0 } })).status, 200)
  const post = async (path, body = {}, cookie = f.owner) => { job = (await api(`/jobs/${job.id}`)).value.job; const r = await api(`/jobs/${job.id}${path}`, { method: 'POST', cookie, body: { expected_version: job.version, ...body } }); if (r.status === 200 && r.value.job) job = (await api(`/jobs/${job.id}`)).value.job; return r }
  const day = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  const calendar = { weekdays: [0, 1, 2, 3, 4, 5, 6], start_hour: 8, end_hour: 17, holidays: [] }
  let r = await post('/schedules', { trade: 'Framing', description: 'Frame addition walls', start: `${day(0)}T08:00:00Z`, end: `${day(0)}T12:00:00Z` }); assert.equal(r.status, 200); const frame = job.schedules[0].id
  let tasks = [{ ...job.schedules[0], duration_minutes: 240 }, { id: 'drywall', trade: 'Drywall', description: 'Hang drywall', start: `${day(1)}T08:00:00Z`, duration_minutes: 240, predecessors: [{ id: frame, lag_minutes: 0 }] }, { id: 'paint', trade: 'Painting', description: 'Prime and paint', start: `${day(2)}T08:00:00Z`, duration_minutes: 240, predecessors: [{ id: 'drywall', lag_minutes: 0 }] }]
  r = await post('/schedule/preview', { calendar, tasks }); assert.equal(r.status, 200, JSON.stringify(r.value)); assert.equal((await post('/schedule/publish', { calendar, tasks: r.value.preview.tasks, digest: r.value.preview.digest })).status, 200)
  const drywall = job.schedules.find(t => t.description === 'Hang drywall').id
  r = await post('/schedule-constraints', { kind: 'inspection', title: 'Rough framing inspection', jurisdiction: 'City of Burlington', accountable: 'Sam Superintendent', task_ids: [drywall], reason: 'Inspection requested before drywall' }); assert.equal(r.status, 200)
  assert.equal((await post('/takeoff', { name: 'S1 Framing plan', page: 1, width: 400, height: 400, document: { name: 'synthetic-plinth-plan.pdf', mime: 'application/pdf', base64: takeoffPlan().toString('base64') } })).status, 200)
  r = await post('/orders', { supplier: 'Champlain Lumber', description: 'Framing lumber package', amount_cents: 250_000 }); const order = r.value.record.id
  assert.equal((await post(`/orders/${order}/issue`)).status, 200); assert.equal((await post(`/orders/${order}/promise`, { promised_on: day(1), reason: 'Promised in the vendor acknowledgment' })).status, 200)
  r = await post('/todos', { title: 'Layout walk', due_at: `${day(-1)}T17:00`, items: [{ title: 'Check stud layout', assignee: { kind: 'office', email: 'field-super@example.com' } }, { title: 'Stack lumber', assignee: { kind: 'office', email: 'field-crew@example.com' } }] }); assert.equal(r.status, 201, JSON.stringify(r.value))

  // The plan: contacts, current sheet, prerequisites, materials without amounts, and only their own checklist item.
  const view = (await api(`/jobs/${job.id}`, { cookie: sup })).value.job
  assert.deepEqual(view.site_contacts.map(c => [c.role, c.email]), [['Builder', 'builder@example.com'], ['Crew', 'field-crew@example.com'], ['Superintendent', 'field-super@example.com']], 'The owner and the assigned people are the site contacts')
  assert.equal(view.address, '22 Example Street'); assert.equal(view.takeoff[0].name, 'S1 Framing plan'); assert.equal(view.takeoff[0].revisions.at(-1).revision, 1)
  assert.deepEqual(view.materials_due.map(m => [m.supplier, m.promised_on, m.received]), [['Champlain Lumber', day(1), false]]); assert.ok(!JSON.stringify(view.materials_due).includes('amount'), 'Materials due carry no price')
  assert.equal(view.schedule_constraints[0].title, 'Rough framing inspection'); assert.deepEqual(view.schedules.filter(t => t.predecessors?.length).map(t => t.predecessors[0].id), [frame, drywall])
  const mine = (await api(`/jobs/${job.id}/todos?mine=true`, { cookie: sup })).value.todos; assert.deepEqual(mine.flatMap(t => t.items.map(i => i.title)), ['Check stud layout'])
  assert.equal((await api(`/jobs/${job.id}/todos/${mine[0].id}/complete`, { method: 'POST', cookie: sup, body: { expected_revision: mine[0].revision, operation_id: crypto.randomUUID(), item_id: mine[0].items[0].id } })).status, 200)
  assert.deepEqual((await api(`/jobs/${job.id}/todos?mine=true`, { cookie: sup })).value.todos.flatMap(t => t.items.filter(i => !i.completed)), [], 'The completed item leaves the open list')

  // Unassigned job data stays hidden and a refused recording writes nothing.
  assert.equal((await api(`/jobs/${other.id}`, { cookie: sup })).status, 404)
  const held = (await api(`/jobs/${other.id}`)).value.job.version; assert.equal((await api(`/jobs/${other.id}/schedule-actuals`, { method: 'POST', cookie: sup, body: { expected_version: held, task_id: 'x', actual_start: new Date().toISOString(), evidence: 'x' } })).status, 404); assert.equal((await api(`/jobs/${other.id}`)).value.job.version, held)
  const actual = { task_id: frame, actual_start: `${day(0)}T08:00:00Z`, installed: { quantity: '40', unit: 'studs', cost_code: '06-100' }, evidence: 'North and east walls framed to the top plate' }
  assert.equal((await post('/schedule-actuals', actual, crew)).status, 403, 'Crew read the plan; they do not record progress')
  assert.equal((await post('/schedule-actuals', { ...actual, installed: { quantity: '-3', unit: 'studs' } }, sup)).status, 400)
  const before = job.version; r = await post('/schedule-actuals', actual, sup); assert.equal(r.status, 200, JSON.stringify(r.value)); assert.equal(job.version, before + 1)
  assert.deepEqual(r.value.record.actual.installed, { quantity: '40', unit: 'studs', cost_code: '06-100' }); assert.equal(r.value.record.actual.recorded_by.role, 'superintendent'); assert.ok(r.value.record.actual.recorded_by.at)
  assert.equal(r.value.record.forecast.conflicts, undefined, 'A field recorder receives dates, not other jobs’ conflicts')

  // Finishing two days late moves tomorrow's dependent work; the office preview agrees with the forecast the worker saw.
  const late = { ...actual, actual_finish: `${day(2)}T12:00:00Z`, evidence: 'Corrected after the wall plates arrived late' }
  r = await post('/schedule-actuals', { ...late, reason: undefined, evidence: undefined }, sup); assert.equal(r.status, 400, JSON.stringify(r.value))
  r = await post('/schedule-actuals', { ...late, reason: 'Plates delivered late' }, sup); assert.equal(r.status, 200, JSON.stringify(r.value))
  const forecast = r.value.record.forecast; assert.ok(forecast.completion_after > forecast.completion_before, 'The forecast finish moves out'); assert.ok(forecast.tasks.find(t => t.id === drywall).start >= `${day(2)}T12:00`)
  assert.equal(job.schedule_actuals.length, 2); assert.equal(job.schedule_actuals[1].supersedes, job.schedule_actuals[0].id); assert.equal(job.schedule_actuals[0].installed.quantity, '40', 'The earlier record is retained')
  const preview = (await post('/schedule/preview', { calendar, tasks: job.schedules })).value.preview
  for (const cookie of [sup, crew]) assert.deepEqual((await api(`/jobs/${job.id}/forecast`, { cookie })).value.forecast.completion_after, forecast.completion_after, 'The plan shows the same forecast on load')
  assert.equal((await api(`/jobs/${other.id}/forecast`, { cookie: sup })).status, 404)
  assert.equal(preview.completion_after, forecast.completion_after); assert.equal(preview.tasks.find(t => t.id === drywall).start, forecast.tasks.find(t => t.id === drywall).start)
 } finally { await f.close() }
})

test('Professional inspection prerequisites hold work until exact signed qualified review, preserve decisions and refuse revoked authority and replay',async()=>{
 const f=await createFixture({now:Date.parse('2031-10-28T12:00:00Z')})
 try{
  const {professionalClient,professionalFiles,professionalOriginal}=await import('./professional-support.mjs')
  const c=await professionalClient(f,await createActiveJob(f,'Synthetic professional inspection'))
  const email=['synthetic-plinth-reviewer','example.invalid'].join('@'),admin=await f.invite(email,'Synthetic office reviewer','admin'),client=await f.invite(['client','example.com'].join('@')),agent=await f.agent()
  const reviewer=(await c.read()).reviewers.find(p=>p.name==='Synthetic office reviewer')
  const task=await c.act('/schedules',{trade:'Synthetic inspection',start:'2031-11-02T08:00:00Z',end:'2031-11-02T09:00:00Z',description:'Inspect framing before enclosure'},{token:agent})
  const constraint=await c.act('/schedule-constraints',{kind:'inspection',title:'Framing inspection',jurisdiction:'Synthetic jurisdiction',accountable:'Synthetic inspector',task_ids:[task.id],reason:'Inspection needed'})
  let row=await c.act('/professional-prerequisites',{title:'Professional inspection release',source:{kind:'inspection',source_id:constraint.id},task_ids:[task.id],due_on:'2031-11-01'})
  await c.act('/schedule-constraints/'+constraint.id,{action:'cleared',reason:'Inspection result received',documents:[professionalFiles[0]]})
  const originalJob=(await f.json(c.root,{cookie:f.owner})).value.job
  assert.equal(originalJob.professional_prerequisites,undefined,'General job and agent projections omit private professional evidence')
  for(const credentials of [{cookie:client},{token:agent}]){assert.equal((await f.json(c.register,credentials)).status,403);assert.equal((await c.request('/professional-prerequisites',{},credentials)).status,403)}
  const held=async()=>{const before=await c.read();const r=await c.request(`/schedules/${task.id}/approve`);assert.equal(r.status,409,JSON.stringify(r.value));assert.deepEqual(await c.read(),before);assert.equal(c.job.schedules[0].status,'draft')}
  await held()
  const calendar={weekdays:[1,2,3,4,5],start_hour:8,end_hour:17,holidays:[]},tasks=[{...c.job.schedules[0],owner:'Synthetic accountable manager',duration_minutes:60},{id:'synthetic-plinth-successor',trade:'Synthetic finishing',owner:'Synthetic accountable manager',description:'Finish after inspected framing',start:'2031-11-02T08:00:00Z',duration_minutes:60,predecessors:[{id:task.id,lag_minutes:0}]}]
  const preview=await c.request('/schedule/preview',{calendar,tasks});assert.equal(preview.status,200)
  const beforePublish=await c.read()
  assert.equal((await c.request('/schedule/publish',{calendar,tasks:preview.value.preview.tasks,digest:preview.value.preview.digest})).value.error,'professional_hold','Planner publication cannot bypass the prerequisite or release its successor')
  assert.deepEqual(await c.read(),beforePublish)
  const submit=async extra=>row=await c.act(`/professional-prerequisites/${row.id}/evidence`,await c.evidence(row,{reviewer_id:reviewer.id,...extra}))
  const decide=async(extra={},credentials={cookie:admin})=>c.request(`/professional-prerequisites/${row.id}/review`,await c.review(row,extra),credentials)
  for(const extra of [{signed:false},{expires_on:'2031-10-27'},{effective_on:'2032-01-01'}]){await submit(extra);const before=await c.read();assert.equal((await decide()).status,409);assert.deepEqual(await c.read(),before);await held()}
  await submit({})
  let before=await c.read()
  assert.equal((await decide({}, {cookie:f.owner})).status,403,'Owner cannot substitute for the designated reviewer')
  assert.equal((await decide({source_document_id:'synthetic-plinth-mismatch'})).status,409)
  assert.deepEqual(await c.read(),before)
  assert.equal((await decide({disposition:'rejected',reason:'Signed source does not approve this work'})).status,200)
  row=(await c.read()).register[0];const rejected=structuredClone(row.evidence.at(-1));await held()
  assert.equal((await decide()).status,409,'A reasoned rejection cannot be overwritten')
  await submit({})
  assert.equal((await decide()).status,200)
  row=(await c.read()).register[0]
  assert.deepEqual(row.evidence.at(-2),rejected);assert.equal(row.evidence.at(-1).decision.by.id,reviewer.id)
  assert.equal((await c.request(`/professional-prerequisites/${row.id}/review`,await c.review(row))).status,409,'Replay cannot duplicate the decision')
  for(const attachment of row.evidence.at(-1).attachments){const r=await f.request(c.register+'/files/'+attachment.id,{cookie:f.owner});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),professionalOriginal);assert.equal((await f.request(c.register+'/files/'+attachment.id,{cookie:client})).status,403)}
  assert.equal((await c.request(`/schedules/${task.id}/approve`)).status,200,'Current qualified signed review permits the ordinary native release')
  const approved=structuredClone((await c.read()).register)
  const person=(await f.json('/auth/operators',{cookie:f.owner})).value.find(p=>p.email===email)
  assert.equal((await f.request('/auth/operator/status',{method:'POST',cookie:f.owner,body:{operatorId:person.id,status:'inactive'}})).status,200)
  assert.equal((await decide()).status,401,'Revoked reviewer session cannot write')
  const move={start:'2031-11-03T08:00:00Z',end:'2031-11-03T09:00:00Z'}
  assert.equal((await c.request(`/schedules/${task.id}/move`,move)).value.error,'professional_authority')
  assert.deepEqual((await c.read()).register.map(r=>r.evidence),approved.map(r=>r.evidence))
  // Rerouting is explicit, keeps historical decisions and remains inert until reviewed again.
  await submit({reviewer_id:(await c.read()).person_id})
  assert.equal((await decide({}, {cookie:f.owner})).status,200)
  assert.equal((await c.request(`/schedules/${task.id}/move`,move)).status,200)
  await c.act('/schedule-constraints/'+constraint.id,{action:'held',reason:'Inspection result withdrawn'})
  assert.equal((await c.request(`/schedules/${task.id}/move`,{start:'2031-11-04T08:00:00Z',end:'2031-11-04T09:00:00Z'})).status,409,'Native inspection holds still apply')
  const allWork=await c.act('/schedule-constraints',{kind:'inspection',title:'Whole-site professional prerequisite',jurisdiction:'Synthetic jurisdiction',accountable:'Synthetic inspector',task_ids:[],reason:'New job work needs professional release'})
  await c.act('/schedule-constraints/'+allWork.id,{action:'cleared',reason:'Original whole-site inspection received',documents:[professionalFiles[0]]})
  await c.act('/professional-prerequisites',{title:'Review before any new work',source:{kind:'inspection',source_id:allWork.id},task_ids:[],due_on:'2031-11-01'})
  const beforeNewWork=await c.read()
  assert.equal((await c.request('/schedules',{trade:'Synthetic unallocated crew',description:'New work before professional release',start:'2031-11-05T08:00:00Z',end:'2031-11-05T09:00:00Z'})).value.error,'professional_hold','A prerequisite can hold first publication before any task exists')
  assert.deepEqual(await c.read(),beforeNewWork)
  const hold=await f.json('/api/plinth/holds',{method:'POST',cookie:f.owner,body:{subject_kind:'job',subject_id:c.job.id,kind:'legal_hold',reason:'Preserve exact professional decisions',confirm:true}});assert.equal(hold.status,201)
  const retained=await c.read()
  assert.equal((await f.json(c.root,{method:'DELETE',cookie:f.owner,body:{expected_version:c.job.version}})).value.error,'retention_hold')
  assert.deepEqual(await c.read(),retained,'Professional review cannot bypass existing retention holds')
  assert.equal((await f.json(`/api/plinth/holds/${hold.value.hold.id}/release`,{method:'POST',cookie:f.owner,body:{reason:'Owner records the reasoned release'}})).status,200)
  const version=c.job.version
  assert.equal((await f.json(c.root,{method:'DELETE',cookie:f.owner,body:{expected_version:version,confirm:c.job.name}})).status,200)
  assert.equal((await decide({}, {cookie:f.owner})).status,404,'Captured review cannot resurrect erased work')
  assert.equal((await f.request(c.register+'/files/'+row.evidence.at(-1).attachments[0].id,{cookie:f.owner})).status,404)
 }finally{await f.close()}
})
