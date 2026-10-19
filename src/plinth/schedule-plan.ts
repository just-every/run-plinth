import { requireManager } from './auth'
import { active, need, object, recordApproval, stamp, text, type Actor, type Input, type Job, type Schedule } from './model'
import { scheduleTime } from './operations'
import { addWork, nextWork, subtractWork, workingCalendar, workingMinutes } from './schedule-calendar'
import type { SchedulePreview, TaskDependency } from './schedule-model'

const state = (s: Schedule) => ({ start: s.start, end: s.end, status: s.status })
const finish = (tasks: Schedule[]) => tasks.filter(s => s.status !== 'cancelled').reduce<string | null>((end, s) => !end || s.end > end ? s.end : end, null)
function integer(value: unknown, name: string, max = 525600): number { need(Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max, `${name} must be whole working minutes from 0 to ${max}`); return Number(value) }
function normalize(job: Job, actor: Actor, input: Input): Schedule[] {
 need(Array.isArray(input.tasks) && input.tasks.length <= 200, 'Supply up to 200 schedule tasks')
 const seen = new Set<string>()
 const tasks = input.tasks.map(value => {
  const raw = object(value), id = text(raw.id, 'Task id', 80)
  need(/^[a-zA-Z0-9_-]+$/.test(id) && !seen.has(id), 'Task ids must be unique letters, digits, dashes or underscores'); seen.add(id)
  const old = job.schedules.find(s => s.id === id)
  const start = scheduleTime(raw, 'start')
  need(Date.parse(start) % 60000 === 0, 'Task starts must use whole minutes')
  const milestone = raw.milestone === true
  const duration = raw.duration_minutes === undefined && old ? Math.round((Date.parse(old.end) - Date.parse(old.start)) / 60000) : integer(raw.duration_minutes, 'Duration')
  need(milestone ? duration === 0 : duration > 0, 'Milestones have zero duration; work tasks need positive duration')
  need(raw.status === undefined || ['draft', 'booked', 'cancelled'].includes(String(raw.status)), 'Invalid task status')
  const predecessors: TaskDependency[] = []
  need(raw.predecessors === undefined || Array.isArray(raw.predecessors), 'Predecessors must be a list')
  for (const value of (raw.predecessors ?? []) as unknown[]) {
   const dependency = object(value), predecessor = text(dependency.id, 'Predecessor id', 80)
   need(!predecessors.some(d => d.id === predecessor), 'A predecessor may appear only once')
   predecessors.push({ id: predecessor, lag_minutes: integer(dependency.lag_minutes, 'Lag') })
  }
  return { id, trade: text(raw.trade, 'Trade', 200), description: text(raw.description, 'Task', 1000), owner: text(raw.owner ?? old?.owner ?? raw.trade, 'Responsible owner', 200), start, end: old?.end ?? start, duration_minutes: duration, milestone, predecessors, status: raw.status === 'cancelled' ? 'cancelled' as const : 'booked' as const, prepared_by: old?.prepared_by ?? stamp(actor), revision: old?.revision ?? 0, ...(old?.updated_at ? { updated_at: old.updated_at } : {}) }
 })
 need(job.schedules.every(s => seen.has(s.id)), 'Keep every existing task; cancel a task explicitly instead of deleting its history')
 for (const task of tasks) {
  const old = job.schedules.find(s => s.id === task.id)
  need(old?.status !== 'cancelled' || task.status === 'cancelled', 'Cancelled tasks remain cancelled')
  need(task.predecessors.every(d => d.id !== task.id && seen.has(d.id)), 'A task requires existing, different predecessors', 409, 'dependency_cycle')
 }
 return tasks
}
function ordered(tasks: Schedule[]): Schedule[] {
 const done = new Set<string>(), visiting = new Set<string>(), result: Schedule[] = [], byId = new Map(tasks.map(s => [s.id, s]))
 const visit = (task: Schedule) => {
  if (done.has(task.id)) return
  need(!visiting.has(task.id), 'Schedule dependencies contain a cycle', 409, 'dependency_cycle')
  visiting.add(task.id)
  for (const d of task.predecessors ?? []) visit(byId.get(d.id)!)
  visiting.delete(task.id); done.add(task.id); result.push(task)
 }
 tasks.forEach(visit); return result
}
export async function previewSchedule(job: Job, actor: Actor, input: Input, all: Job[]): Promise<SchedulePreview> {
 requireManager(actor, true); active(job)
 const calendar = workingCalendar(input.calendar ?? job.schedule_calendar), tasks = normalize(job, actor, input), sorted = ordered(tasks), byId = new Map(tasks.map(s => [s.id, s]))
 need(!all.some(other => other.id !== job.id && other.schedules.some(task => byId.has(task.id))), 'Task identities must be unique across jobs', 409, 'schedule_identity')
 for (const task of sorted) {
  if (task.status === 'cancelled') continue
  let start = nextWork(Date.parse(task.start), calendar)
  for (const d of task.predecessors ?? []) {
   const previous = byId.get(d.id)!
   need(previous.status !== 'cancelled', 'Remove or replace a cancelled predecessor before publishing its dependent', 409, 'cancelled_predecessor')
   start = Math.max(start, addWork(Date.parse(previous.end), d.lag_minutes, calendar))
  }
  task.start = new Date(nextWork(start, calendar)).toISOString()
  task.end = new Date(task.milestone ? Date.parse(task.start) : addWork(Date.parse(task.start), task.duration_minutes!, calendar)).toISOString()
 }
 const completion = finish(tasks), latest = new Map<string, number>(), critical: string[] = []
 for (const task of [...sorted].reverse()) {
  if (task.status === 'cancelled') continue
  let end = Date.parse(completion!)
  for (const successor of tasks.filter(s => s.status !== 'cancelled')) for (const d of successor.predecessors ?? []) if (d.id === task.id) end = Math.min(end, subtractWork(latest.get(successor.id)!, d.lag_minutes, calendar))
  const start = subtractWork(end, task.duration_minutes!, calendar); latest.set(task.id, start)
  if (workingMinutes(Date.parse(task.start), start, calendar) <= 0) critical.push(task.id)
 }
 const conflicts: SchedulePreview['conflicts'] = []
 const candidate = { ...job, schedules: tasks }
 for (const task of tasks.filter(s => s.status === 'booked' && !s.milestone)) for (const other of [...all.filter(j => j.id !== job.id), candidate]) for (const s of other.schedules) {
  if (s.status === 'booked' && !s.milestone && !(other.id === job.id && s.id === task.id) && s.trade.toLowerCase() === task.trade.toLowerCase() && s.start < task.end && s.end > task.start) conflicts.push({ job_id: other.id, job_name: other.name, schedule_id: s.id, trade: s.trade, start: s.start, end: s.end })
 }
 const changes = tasks.flatMap(task => { const old = job.schedules.find(s => s.id === task.id); return !old || JSON.stringify({ ...old, updated_at: undefined }) !== JSON.stringify({ ...task, updated_at: undefined }) ? [{ id: task.id, description: task.description, before: old ? state(old) : null, after: state(task) }] : [] })
 // Bind publication to the exact semantic proposal; preparer timestamps do not affect dates or review.
 const canonical = { calendar, tasks: tasks.map(({ prepared_by, revision, updated_at, ...task }) => task), version: job.version }
 const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)))), b => b.toString(16).padStart(2, '0')).join('')
 return { tasks, calendar, changes, conflicts, completion_before: finish(job.schedules), completion_after: completion, critical_path: critical.reverse(), digest }
}
export async function publishSchedule(job: Job, actor: Actor, input: Input, all: Job[]) {
 requireManager(actor)
 const preview = await previewSchedule(job, actor, input, all)
 need(input.digest === preview.digest, 'Preview these exact dates before publishing', 409, 'schedule_review')
 need(!preview.conflicts.length, 'Resolve the reviewed trade conflicts before publishing', 409, 'schedule_conflict', { conflicts: preview.conflicts })
 const before = { calendar: job.schedule_calendar, tasks: structuredClone(job.schedules) }
 for (const task of preview.tasks) {
  const old = job.schedules.find(s => s.id === task.id)
  task.prepared_by = old?.prepared_by ?? stamp(actor)
  const semantic = (s: Schedule) => JSON.stringify({ ...s, prepared_by: undefined, revision: undefined, updated_at: undefined })
  if (!old || semantic(old) !== semantic(task)) { task.revision = old ? (old.revision ?? 0) + 1 : 0; task.updated_at = new Date().toISOString() }
 }
 job.schedules = preview.tasks; job.schedule_calendar = preview.calendar; job.schedule_critical_path = preview.critical_path
 recordApproval(job, actor, 'schedule.publish', { id: job.id, prepared_by: stamp(actor) }, { before, after: { calendar: preview.calendar, tasks: preview.tasks }, completion_before: preview.completion_before, completion_after: preview.completion_after, critical_path: preview.critical_path })
 return preview
}
