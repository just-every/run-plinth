import { requireJobManager } from './auth'
import { find, need, object, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'
import { day } from './purchase-order-model'
import { officeAuthority, authorityGuards } from './warranty-store'
import { thread } from './mail-store'
import { jobRef } from './audit'

export interface WorkLink { kind: 'schedule' | 'rfi' | 'selection' | 'change' | 'daily'; id: string; source_ref: string; href: string; snapshot: unknown }
export interface MeetingAction { id: string; title: string; owner_email: string; due_on: string; by: Stamp; assignment_history?: { previous_owner_email: string; owner_email: string; reason: string; by: Stamp }[]; completion?: { answer: string; links: WorkLink[]; message_id?: string; by: Stamp } }
export interface Meeting { id: string; title: string; held_on: string; agenda: string; minutes: string; attendees: string[]; decisions: string; tags: string[]; sheet: string; cost_code: string; by: Stamp; actions: MeetingAction[]; history: { kind: string; by: Stamp; detail: string }[] }
/** Interim private office records: a current job manager acts, and no custom role implicitly gains a new door. */
export function meetingAccess(actor: Actor) { requireJobManager(actor); need(!actor.permissions, 'Meeting access is not included in this custom role', 403, 'forbidden') }
const list = (value: unknown, label: string, max: number) => { need(Array.isArray(value) && value.length <= max, `Provide up to ${max} ${label}`); return value.map(v => text(v, label, 200)) }
export async function workLinks(job: Job, value: unknown): Promise<WorkLink[]> {
 need(Array.isArray(value) && value.length > 0 && value.length <= 20, 'Link the resolved answer to 1–20 changed work records')
 return Promise.all(value.map(async raw => { const v = object(raw), kind = String(v.kind), id = text(v.id, 'Work record', 100)
  const sources = { schedule: job.schedules, rfi: job.rfis ?? [], selection: job.selections ?? [], change: job.variations, daily: job.diary }
  need(Object.hasOwn(sources, kind), 'Choose a supported work record'); const source = find(sources[kind as keyof typeof sources] as { id: string }[], id)
  return { kind: kind as WorkLink['kind'], id, snapshot: structuredClone(source), source_ref: await jobRef(JSON.stringify(source)), href: '' }
 }))
}
export async function meetingAction(db: D1Database, job: Job, actor: Actor, input: Input, id?: string, action?: string) {
 meetingAccess(actor)
 const guards: D1PreparedStatement[] = []
 async function assigned(raw: unknown): Promise<MeetingAction> { const v = object(raw), email = text(v.owner_email, 'Action owner email', 254).toLowerCase(), authority = await officeAuthority(db, job, email); need(authority, 'The action owner must currently manage this job'); guards.push(...authorityGuards(db, authority)); return { id: crypto.randomUUID(), title: text(v.title, 'Action', 1000), owner_email: email, due_on: day(v.due_on, 'Action due date'), by: stamp(actor) } }
 if (!id) {
  need((job.meetings?.length ?? 0) < 200, 'A job supports up to 200 meetings')
  need(Array.isArray(input.actions) && input.actions.length <= 50, 'Provide up to 50 meeting actions')
  const meeting: Meeting = { id: crypto.randomUUID(), title: text(input.title, 'Meeting title', 240), held_on: day(input.held_on, 'Meeting date'), agenda: text(input.agenda, 'Agenda', 20000), minutes: text(input.minutes, 'Minutes', 20000), attendees: list(input.attendees, 'attendees', 100), decisions: text(input.decisions, 'Decisions', 20000), tags: list(input.tags ?? [], 'tags', 30), sheet: text(input.sheet ?? '', 'Sheet', 200, true), cost_code: text(input.cost_code ?? '', 'Cost code', 80, true), by: stamp(actor), actions: await Promise.all(input.actions.map(assigned)), history: [] }
  meeting.history.push({ kind: 'recorded', by: stamp(actor), detail: 'Meeting recorded' }); (job.meetings ??= []).push(meeting); return { record: meeting, writes: guards }
 }
 const meeting = find(job.meetings ?? [], id)
 if (action === 'add-action') { need(meeting.actions.length < 50, 'A meeting holds at most 50 actions'); const row = await assigned(input); meeting.actions.push(row); meeting.history.push({ kind: 'assigned', by: stamp(actor), detail: row.id }); return { record: row, writes: guards } }
 const row = find(meeting.actions, text(input.action_id, 'Action id', 100))
 if (action === 'reassign') {
  need(!row.completion, 'A completed action cannot be reassigned', 409, 'completed')
  const next = await assigned({ ...input, title: row.title, due_on: row.due_on })
  need(next.owner_email !== row.owner_email, 'Choose a different current action owner')
  const change = { previous_owner_email: row.owner_email, owner_email: next.owner_email, reason: text(input.reason, 'Reassignment reason', 2000), by: stamp(actor) }
  ;(row.assignment_history ??= []).push(change); row.owner_email = next.owner_email
  meeting.history.push({ kind: 'reassigned', by: change.by, detail: row.id }); return { record: row, writes: guards }
 }
 need(action === 'complete', 'Unknown meeting action', 404, 'not_found')
 need(row.owner_email === actor.email.toLowerCase(), 'Only the currently assigned action owner completes it', 403, 'forbidden'); need(!row.completion, 'Action already completed', 409, 'completed')
 const authority = await officeAuthority(db, job, row.owner_email); need(authority, 'The action owner no longer manages this job', 403, 'forbidden'); guards.push(...authorityGuards(db, authority))
 const message_id = input.message_id === undefined ? undefined : text(input.message_id, 'Source message', 100)
 if (message_id) need((await thread(db, job.id, actor)).some(m => m.id === message_id), 'Source message not found', 404, 'not_found')
 const links = await workLinks(job, input.links)
 links.forEach((link, index) => { link.href = `/api/plinth/jobs/${job.id}/meetings/${meeting.id}/links/${row.id}/${index}` })
 row.completion = { answer: text(input.answer, 'Resolved answer', 20000), links, ...(message_id ? { message_id } : {}), by: stamp(actor) }
 meeting.history.push({ kind: 'completed', by: stamp(actor), detail: row.id }); return { record: row, writes: guards }
}
