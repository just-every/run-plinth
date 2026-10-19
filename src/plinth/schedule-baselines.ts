import { templateTaskId } from './schedule-baseline-model'
import { requireJobManager, requireManager } from './auth'
import { active, emptyJob, find, need, object, recordApproval, stamp, text, type Actor, type Input, type Job } from './model'
import { workingCalendar } from './schedule-calendar'
import { previewSchedule, publishSchedule } from './schedule-plan'
import { readClock, transaction } from './store'
import type { BaselineJob, ScheduleActual, ScheduleBaseline, ScheduleRevision, ScheduleSnapshot, ScheduleTemplate, TemplateRevision, TemplateTask } from './schedule-baseline-model'

export * from './schedule-baseline-model'
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const snapshot = (job: Job): ScheduleSnapshot => ({ calendar: workingCalendar(job.schedule_calendar, job.time_zone), tasks: structuredClone(job.schedules) })
function utc(value: unknown, name: string): string {
 const raw = text(value, name, 40)
 need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(raw) && Number.isFinite(Date.parse(raw)), `${name} requires an explicit UTC timestamp ending in Z`)
 const result = new Date(raw).toISOString()
 need(result.slice(0, 10) === raw.slice(0, 10), `${name} must be a valid date`)
 return result
}
function uniqueName(rows: { name: string }[], value: unknown, label: string): string {
 const name = text(value, label, 200)
 need(!rows.some(row => row.name.toLowerCase() === name.toLowerCase()), `Choose a distinct ${label}`, 409, 'revision_name')
 return name
}

/** Internal lookup: the HTTP handler has already authenticated the actor. */
export async function getScheduleTemplate(db: D1Database, id: string): Promise<ScheduleTemplate> {
 const row = await db.prepare('SELECT data FROM pl_schedule_templates WHERE id=?').bind(id).first<{ data: string }>()
 need(row, 'Schedule template not found', 404, 'not_found')
 return JSON.parse(row.data) as ScheduleTemplate
}
async function templateBody(request: Request): Promise<Input> {
 need((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === 'application/json', 'Send application/json', 415, 'content_type')
 const reader = request.body?.getReader(); need(reader, 'JSON body is required')
 const chunks: Uint8Array[] = []; let size = 0
 for (;;) {
  const chunk = await reader.read(); if (chunk.done) break
  size += chunk.value.byteLength
  if (size > 2_000_000) { await reader.cancel(); need(false, 'Request is too large', 413, 'body_size') }
  chunks.push(chunk.value)
 }
 const bytes = new Uint8Array(size); let offset = 0
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
 let value: unknown
 try { value = JSON.parse(new TextDecoder().decode(bytes)) } catch { need(false, 'Invalid JSON body') }
 return object(value)
}
async function normalizeTemplate(actor: Actor, input: Input): Promise<{ calendar: ScheduleTemplate['calendar']; tasks: TemplateTask[] }> {
 const validationJob = emptyJob({ name: 'Template validation', client_email: 'template@example.invalid' }, actor)
 validationJob.status = 'active'
 const preview = await previewSchedule(validationJob, actor, input, [])
 need(preview.tasks.length > 0, 'A template needs at least one task')
 need(preview.tasks.every(task => task.status !== 'cancelled'), 'Template tasks must be active')
 const tasks = preview.tasks.map(({ id, trade, description, owner, start, duration_minutes, milestone, predecessors }) => ({ id, trade, description, owner, start, duration_minutes, milestone, predecessors }))
 return { calendar: preview.calendar, tasks }
}
/** Called by the authenticated Plinth router; every mutation uses the authority/clock guard. */
export async function templateResponse(request: Request, env: { DB: D1Database }, actor: Actor, parts: string[]): Promise<Response | null> {
 if (parts[0] !== 'schedule-templates') return null
 requireManager(actor, request.method === 'GET')
 need(parts.length <= 2, 'Unknown schedule template route', 404, 'not_found')
 if (request.method === 'GET') {
  if (parts[1]) return json({ template: await getScheduleTemplate(env.DB, parts[1]) })
  const rows = await env.DB.prepare('SELECT data FROM pl_schedule_templates ORDER BY rowid DESC').all<{ data: string }>()
  return json({ templates: rows.results.map(row => JSON.parse(row.data) as ScheduleTemplate) })
 }
 need(parts[1] ? ['PUT', 'POST', 'DELETE'].includes(request.method) : request.method === 'POST', 'Method not allowed', 405, 'method_not_allowed')
 const input = await templateBody(request), clock = await readClock(env.DB)
 const previous = parts[1] ? await getScheduleTemplate(env.DB, parts[1]) : undefined
 if (previous) need(input.expected_version === previous.version, 'Template changed. Reload before applying this action.', 409, 'stale_version')
 const archived = request.method === 'DELETE'
 need(!previous?.archived, 'Archived templates retain their history and cannot be edited', 409, 'template_archived')
 const normalized = archived ? { calendar: previous!.calendar, tasks: previous!.tasks } : await normalizeTemplate(actor, input)
 const name = archived ? previous!.name : text(input.name, 'Template name', 200)
 const revision: TemplateRevision = {
  revision: (previous?.version ?? 0) + 1,
  name: previous ? uniqueName(previous.revisions, input.revision_name, 'revision name') : name,
  reason: previous ? text(input.reason, 'Revision reason', 4000) : text(input.reason, 'Template reason', 4000, true),
  ...normalized, archived, approved_by: stamp(actor),
 }
 const template: ScheduleTemplate = { id: previous?.id ?? crypto.randomUUID(), version: revision.revision, name, ...normalized, archived, revisions: [...(previous?.revisions ?? []), structuredClone(revision)] }
 const data = JSON.stringify(template); need(data.length <= 8_000_000, 'Template history is too large', 413, 'body_size')
 const writes = previous ? [
  env.DB.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_schedule_templates WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(previous.id, previous.version),
  env.DB.prepare('UPDATE pl_schedule_templates SET version=?,data=? WHERE id=? AND version=?').bind(template.version, data, template.id, previous.version),
 ] : [env.DB.prepare('INSERT INTO pl_schedule_templates(id,version,data) VALUES(?,?,?)').bind(template.id, template.version, data)]
 await transaction(env.DB, actor, null, writes, clock)
 return json({ template }, previous ? 200 : 201)
}

/** Translate a reusable schedule by elapsed UTC time, then let the planner resolve work calendars/dependencies. */
export async function templateScheduleInput(job: BaselineJob, template: ScheduleTemplate, input: Input): Promise<Input> {
 active(job); need(!template.archived, 'This schedule template is archived', 409, 'template_archived')
 need(!job.schedule_template || job.schedule_template.template_id === template.id, 'Revise the applied template or review changes in the schedule planner', 409, 'template_applied')
 const start = utc(input.start, 'start'); need(Date.parse(start) % 60000 === 0, 'Template starts must use whole minutes')
 const anchor = Math.min(...template.tasks.map(task => Date.parse(task.start))), delta = Date.parse(start) - anchor
 const mapping = new Map(await Promise.all(template.tasks.map(async task => [task.id, await templateTaskId(job.id, template.id, task.id)] as const)))
 const tasks = template.tasks.map(task => ({
  ...structuredClone(task), id: mapping.get(task.id)!, start: new Date(Date.parse(task.start) + delta).toISOString(),
  predecessors: (task.predecessors ?? []).map(dependency => ({ ...dependency, id: mapping.get(dependency.id)! })),
  ...(job.schedules.find(previous => previous.id === mapping.get(task.id))?.status === 'cancelled' ? { status: 'cancelled' } : {}),
 }))
 const ids = new Set(tasks.map(task => task.id)), oldIds = new Set(job.schedule_template?.task_ids ?? [])
 need(job.schedules.every(task => !ids.has(task.id) || oldIds.has(task.id)), 'Template task ids overlap existing work. Review that work in the schedule planner.', 409, 'template_task_conflict')
 return { calendar: template.calendar, tasks: [...tasks, ...job.schedules.filter(task => !ids.has(task.id)).map(task => oldIds.has(task.id) ? { ...task, status: 'cancelled' } : task)] }
}
async function templateDigest(digest: string, template: ScheduleTemplate) {
 const bytes = new TextEncoder().encode(JSON.stringify([digest,template.id,template.version]))
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('')
}
export async function previewScheduleTemplate(job: BaselineJob, actor: Actor, input: Input, template: ScheduleTemplate, all: Job[]) {
 const preview = await previewSchedule(job, actor, await templateScheduleInput(job, template, input), all)
 return {...preview,digest:await templateDigest(preview.digest,template)}
}
export async function applyScheduleTemplate(job: BaselineJob, actor: Actor, input: Input, template: ScheduleTemplate, all: Job[]) {
 requireJobManager(actor)
 const proposal = await templateScheduleInput(job, template, input)
 const reviewed = await previewSchedule(job, actor, proposal, all)
 need(input.digest === await templateDigest(reviewed.digest,template),'The source template changed. Preview its current revision before applying.',409,'schedule_review')
 const preview = await publishSchedule(job, actor, { ...proposal, digest: reviewed.digest }, all)
 const publication = job.approvals.at(-1)!
 job.schedule_template = { template_id: template.id, template_version: template.version, template_name: template.name, start: utc(input.start, 'start'), task_ids: await Promise.all(template.tasks.map(task => templateTaskId(job.id, template.id, task.id))), publication_id: publication.id, approved_by: stamp(actor) }
 recordApproval(job, actor, 'schedule.template', { id: template.id, prepared_by: template.revisions.at(-1)!.approved_by, revision: template.version }, { application: job.schedule_template, publication_id: publication.id })
 recordRevision(job, actor, input)
 return preview
}

/** Call immediately after publishSchedule; a failed validation must prevent saving the cloned job. */
export function recordRevision(job: BaselineJob, actor: Actor, input: Input): ScheduleRevision | undefined {
 requireJobManager(actor)
 const suppliedName = text(input.revision_name, 'Revision name', 200, true), suppliedReason = text(input.reason, 'Revision reason', 4000, true)
 if (!job.schedule_baselines?.length && !suppliedName && !suppliedReason) return
 const publication = job.approvals.findLast(approval => approval.kind === 'schedule.publish')
 need(publication, 'Publish the reviewed schedule before recording its revision', 409, 'schedule_review')
 need(!job.schedule_revisions?.some(revision => revision.publication_id === publication.id), 'This publication already has its authorizing revision', 409, 'revision_exists')
 const name = uniqueName(job.schedule_revisions ?? [], suppliedName, 'revision name'), reason = text(suppliedReason, 'Revision reason', 4000)
 const revision: ScheduleRevision = { id: crypto.randomUUID(), name, reason, baseline_id: job.schedule_baselines?.[0]?.id ?? null, publication_id: publication.id, approval_id: '', approved_by: stamp(actor), ...snapshot(job) }
 recordApproval(job, actor, 'schedule.revision', { id: revision.id, prepared_by: stamp(actor) }, { name, reason, baseline_id: revision.baseline_id, publication_id: publication.id, before: (publication.snapshot as { before: unknown }).before, after: snapshot(job) })
 revision.approval_id = job.approvals.at(-1)!.id
 ;(job.schedule_revisions ??= []).push(revision)
 return revision
}

/** Actual evidence and baseline decisions append history; neither changes a published feed. */
export async function scheduleBaselineAction(job: BaselineJob, actor: Actor, input: Input, action: 'baseline' | 'actuals', all: Job[]) {
 requireJobManager(actor); active(job)
 if (action === 'baseline') {
  need(job.schedules.some(task => task.status === 'booked') && job.schedules.every(task => task.status !== 'draft'), 'Publish the reviewed schedule before recording a baseline', 409, 'schedule_review')
  const baseline: ScheduleBaseline = { id: crypto.randomUUID(), revision: (job.schedule_baselines?.length ?? 0) + 1, name: uniqueName(job.schedule_baselines ?? [], input.name, 'baseline name'), reason: text(input.reason, 'Baseline reason', 4000), approval_id: '', approved_by: stamp(actor), ...snapshot(job) }
  recordApproval(job, actor, 'schedule.baseline', { id: baseline.id, prepared_by: stamp(actor), revision: baseline.revision }, { name: baseline.name, reason: baseline.reason, calendar: baseline.calendar, tasks: baseline.tasks })
  baseline.approval_id = job.approvals.at(-1)!.id
  ;(job.schedule_baselines ??= []).push(baseline)
  return baseline
 }
 const task = find(job.schedules, text(input.task_id, 'Task id', 80))
 need(task.status === 'booked', 'Actual work must refer to a published active task', 409, 'schedule_state')
 const previous = job.schedule_actuals?.findLast(actual => actual.task_id === task.id)
 const actual: ScheduleActual = { id: crypto.randomUUID(), task_id: task.id, actual_start: utc(input.actual_start, 'actual_start'), evidence: text(input.evidence, 'Actual work evidence', 4000), recorded_by: stamp(actor), ...(previous ? { supersedes: previous.id } : {}) }
 if (input.actual_finish !== undefined && input.actual_finish !== '') actual.actual_finish = utc(input.actual_finish, 'actual_finish')
 need(!actual.actual_finish || actual.actual_finish >= actual.actual_start, 'Actual finish must be at or after actual start')
 need(!previous?.actual_finish || actual.actual_finish, 'A completed task retains its actual finish')
 if (previous && (previous.actual_start !== actual.actual_start || previous.actual_finish !== actual.actual_finish && previous.actual_finish !== undefined)) actual.reason = text(input.reason, 'Correction reason', 4000)
 ;(job.schedule_actuals ??= []).push(actual)
 const forecast = await previewSchedule(job, actor, { calendar: job.schedule_calendar, tasks: job.schedules }, all)
 return { actual, forecast }
}
