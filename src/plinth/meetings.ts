import { roleGate } from './role-gate'
import { clientAccess } from './job-customers'
import { requireJobManager } from './auth'
import { find, need, object, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'
import { day } from './purchase-order-model'
import { officeAuthority, authorityGuards } from './warranty-store'
import { recipientAuthority, recipientGuards } from './meeting-people'
import type { MeetingShareRecipient } from './meeting-sharing-model'
import { thread } from './mail-store'
import { jobRef } from './audit'

export interface WorkLink { kind: 'schedule' | 'rfi' | 'selection' | 'change' | 'daily'; id: string; source_ref: string; href: string; snapshot: unknown }
type OwnerKind = 'manager' | 'office' | 'client' | 'sub'
export interface MeetingAction {
 id: string; title: string; owner_email: string; owner_kind?: OwnerKind; owner_operator_id?: string; subcontract_id?: string; title_confirmed_by?: Stamp; due_on: string; by: Stamp
 assignment_history?: { previous_owner_email: string; previous_owner_kind?: OwnerKind; previous_subcontract_id?: string; owner_email: string; owner_kind?: OwnerKind; subcontract_id?: string; reason: string; by: Stamp }[]
 completion?: { answer: string; links: WorkLink[]; message_id?: string; by: Stamp }
 appended_links?: { links: WorkLink[]; by: Stamp }[]
}
export interface Meeting { raw_grants?: import('./meeting-raw-grants').MeetingRawGrant[]; id: string; title: string; held_on: string; agenda: string; minutes: string; attendees: string[]; decisions: string; tags: string[]; sheet: string; cost_code: string; by: Stamp; actions: MeetingAction[]; history: { kind: string; by: Stamp; detail: string }[] }
export interface OwnMeetingAction { id: string; title: string; due_on: string; assigner: { name: string; at: string }; meeting_on: string; completed: boolean }
/** Raw records remain office-only. An action assignment grants no raw meeting door. */
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
export function meetingWorkChoices(job: Job) {
 return [ ...job.schedules.map(r => ({ kind: 'schedule', id: r.id, title: r.description })), ...job.diary.map(r => ({ kind: 'daily', id: r.id, title: r.note })), ...job.variations.map(r => ({ kind: 'change', id: r.id, title: r.description })), ...(job.selections ?? []).map(r => ({ kind: 'selection', id: r.id, title: r.revisions.at(-1)?.category ?? 'Selection' })) ]
}
async function delegateAuthority(db: D1Database, job: Job, row: MeetingAction): Promise<MeetingShareRecipient | null> {
 if (!row.owner_kind || row.owner_kind === 'manager') return null
 const current = await recipientAuthority(db, job, { email: row.owner_email, kind: row.owner_kind, subcontract_id: row.subcontract_id, can_comment: false })
 return current && current.operator_id === row.owner_operator_id ? current : null
}
export async function ownMeetingActions(db: D1Database, job: Job, actor: Actor): Promise<OwnMeetingAction[]> {
 need(actor.session_id && !actor.credential_id && actor.role !== 'agent', 'Sign in as a person to use meeting actions', 403, 'human_required')
 const actions: OwnMeetingAction[] = []
 for (const meeting of job.meetings ?? []) for (const row of meeting.actions) {
  if (row.owner_email !== actor.email.toLowerCase()) continue
  const current = await delegateAuthority(db, job, row)
  if (!current || current.operator_id !== actor.id || current.operator_version !== actor.version) continue
  const by = row.assignment_history?.at(-1)?.by ?? row.by
  actions.push({ id: row.id, title: row.title, due_on: row.due_on, assigner: { name: by.name, at: by.at }, meeting_on: meeting.held_on, completed: !!row.completion })
 }
 return actions
}
export async function completeMeetingDelegate(db: D1Database, job: Job, actor: Actor, input: Input, actionId: string, permitted: Job) {
 need((await ownMeetingActions(db, job, actor)).some(row => row.id === actionId), 'Assigned meeting action not found', 404, 'not_found')
 const meeting = job.meetings!.find(m => m.actions.some(a => a.id === actionId))!, row = find(meeting.actions, actionId)
 const authority = await delegateAuthority(db, job, row)
 need(authority, 'Your action authority changed', 403, 'forbidden')
 need(!row.completion, 'Action already completed', 409, 'completed')
 const message_id = input.message_id === undefined ? undefined : text(input.message_id, 'Source message', 100)
 if (message_id) {
  need(row.owner_kind !== 'sub' && (actor.role !== 'member' || await clientAccess(db, job, actor.email)), 'Source message not found', 404, 'not_found')
  let permitted = true
  try { roleGate(actor, new Request(`https://plinth.invalid/api/plinth/jobs/${job.id}/correspondence`)) } catch { permitted = false }
  need(permitted && (await thread(db, job.id, actor)).some(m => m.id === message_id), 'Source message not found', 404, 'not_found')
 }
 const links = input.links === undefined || Array.isArray(input.links) && input.links.length === 0 ? [] : await workLinks(permitted, input.links)
 links.forEach((link,index) => { link.href = `/api/plinth/jobs/${job.id}/meetings/${meeting.id}/links/${row.id}/${index}` })
 row.completion = { answer: text(input.answer, 'Resolved answer', 20000), links, ...(message_id ? { message_id } : {}), by: stamp(actor) }
 meeting.history.push({ kind: 'completed', by: stamp(actor), detail: row.id })
 return recipientGuards(db, authority)
}
export async function meetingAction(db: D1Database, job: Job, actor: Actor, input: Input, id?: string, action?: string) {
 meetingAccess(actor)
 const guards: D1PreparedStatement[] = []
 async function assigned(raw: unknown): Promise<MeetingAction> {
  const v = object(raw), email = text(v.owner_email, 'Action owner email', 254).toLowerCase(), kind = v.owner_kind ?? 'manager'
  need(['manager','office','client','sub'].includes(String(kind)), 'Choose the action owner kind')
  let operator: string | undefined
  if (kind === 'manager') {
   const authority = await officeAuthority(db, job, email); need(authority, 'The action owner must currently manage this job'); guards.push(...authorityGuards(db, authority))
  } else {
   need(v.confirm_title === true, 'Confirm this exact title is safe for the delegate')
   const authority = await recipientAuthority(db, job, { email, kind: kind as 'office'|'client'|'sub', can_comment: false, ...(kind === 'sub' ? { subcontract_id: text(v.subcontract_id, 'Released subcontract scope', 100) } : {}) })
   need(authority, 'The delegate must currently have job, client or released-scope authority', 403, 'recipient_authority'); guards.push(...recipientGuards(db, authority)); operator = authority.operator_id
  }
  return { id: crypto.randomUUID(), title: text(v.title, 'Action', 1000), owner_email: email, owner_kind: kind as OwnerKind, ...(operator ? { owner_operator_id: operator, title_confirmed_by: stamp(actor) } : {}), ...(kind === 'sub' ? { subcontract_id: String(v.subcontract_id) } : {}), due_on: day(v.due_on, 'Action due date'), by: stamp(actor) }
 }
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
  need(next.owner_email !== row.owner_email || next.owner_kind !== (row.owner_kind ?? 'manager') || next.subcontract_id !== row.subcontract_id, 'Choose a different current action owner')
  const change = { previous_owner_email: row.owner_email, previous_owner_kind: row.owner_kind ?? 'manager' as OwnerKind, ...(row.subcontract_id ? { previous_subcontract_id: row.subcontract_id } : {}), owner_email: next.owner_email, owner_kind: next.owner_kind, ...(next.subcontract_id ? { subcontract_id: next.subcontract_id } : {}), reason: text(input.reason, 'Reassignment reason', 2000), by: stamp(actor) }
  ;(row.assignment_history ??= []).push(change)
  row.owner_email = next.owner_email; row.owner_kind = next.owner_kind; row.owner_operator_id = next.owner_operator_id; row.subcontract_id = next.subcontract_id; row.title_confirmed_by = next.title_confirmed_by
  meeting.history.push({ kind: 'reassigned', by: change.by, detail: row.id }); return { record: row, writes: guards }
 }
 if (action === 'add-links') {
  need((row.appended_links?.length ?? 0) < 50, 'An action supports up to 50 appended link groups')
  const links = await workLinks(job, input.links), group = row.appended_links?.length ?? 0
  links.forEach((link,index) => { link.href = `/api/plinth/jobs/${job.id}/meetings/${meeting.id}/links/${row.id}/appended/${group}/${index}` })
  ;(row.appended_links ??= []).push({ links, by: stamp(actor) })
  meeting.history.push({ kind: 'links-appended', by: stamp(actor), detail: row.id }); return { record: row, writes: guards }
 }
 need(action === 'complete', 'Unknown meeting action', 404, 'not_found')
 if (row.owner_kind && row.owner_kind !== 'manager' && row.owner_email === actor.email.toLowerCase()) return { record: row, writes: await completeMeetingDelegate(db, job, actor, input, row.id, job) }
 need((!row.owner_kind || row.owner_kind === 'manager') && row.owner_email === actor.email.toLowerCase(), 'Only the currently assigned action owner completes it', 403, 'forbidden'); need(!row.completion, 'Action already completed', 409, 'completed')
 const authority = await officeAuthority(db, job, row.owner_email); need(authority, 'The action owner no longer manages this job', 403, 'forbidden'); guards.push(...authorityGuards(db, authority))
 const message_id = input.message_id === undefined ? undefined : text(input.message_id, 'Source message', 100)
 if (message_id) need((await thread(db, job.id, actor)).some(m => m.id === message_id), 'Source message not found', 404, 'not_found')
 const links = await workLinks(job, input.links)
 links.forEach((link,index) => { link.href = `/api/plinth/jobs/${job.id}/meetings/${meeting.id}/links/${row.id}/${index}` })
 row.completion = { answer: text(input.answer, 'Resolved answer', 20000), links, ...(message_id ? { message_id } : {}), by: stamp(actor) }
 meeting.history.push({ kind: 'completed', by: stamp(actor), detail: row.id }); return { record: row, writes: guards }
}
