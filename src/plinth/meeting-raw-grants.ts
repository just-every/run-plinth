import { assignedJob, requireManager } from './auth'
import { recipientAuthority, recipientGuards } from './meeting-people'
import type { MeetingShareRecipient } from './meeting-sharing-model'
import { find, need, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'
import type { Meeting } from './meetings'
import { teamGrant } from './team'
import { warrantyGeneration } from './warranty-store'

export interface MeetingRawGrant {
 id: string; operation_id: string; recipient: MeetingShareRecipient & { team_assignment_id: string }; reason: string; by: Stamp; auth_generation: number
 revocation?: { operation_id: string; reason: string; by: Stamp }
}
export const nativeMeetingReader = (actor: Actor, job: Job) => !!actor.session_id && !actor.credential_id && !actor.permissions && ['owner', 'admin', 'project_manager'].includes(actor.role) && assignedJob(actor, job)
function manager(actor: Actor) {
 requireManager(actor)
 need(actor.session_id && !actor.credential_id && !actor.permissions && !actor.team, 'Only a signed-in owner or administrator manages raw meeting grants', 403, 'forbidden')
}
async function authority(db: D1Database, job: Job, email: string) {
 const recipient = await recipientAuthority(db, job, { email, kind: 'office', can_comment: false })
 if (!recipient || recipient.operator_role !== 'admin') return null
 const team = await teamGrant(db, recipient.operator_id)
 if (!team || !['superintendent', 'project_manager', 'estimator', 'bookkeeper'].includes(team.grant.role) || !team.grant.job_ids.includes(job.id)) return null
 // Legacy assignments stay grantable; every subsequent team write has a unique identity.
 return { ...recipient, team_assignment_id: team.grant.assignment_id ?? JSON.stringify(team.grant.updated_by) }
}
async function active(db: D1Database, job: Job, grant: MeetingRawGrant, generation: number) {
 if (grant.revocation || grant.auth_generation !== generation) return false
 const current = await authority(db, job, grant.recipient.email), saved = grant.recipient
 return !!current && current.operator_id === saved.operator_id && current.operator_version === saved.operator_version && current.team_version === saved.team_version && current.team_assignment_id === saved.team_assignment_id
}
/** History travels with the meeting; authority is bound to this installation and exact current assignment. */
export async function rawGrantHistory(db: D1Database, job: Job, actor: Actor, meetingId: string) {
 manager(actor)
 const generation = await warrantyGeneration(db)
 return Promise.all((find(job.meetings ?? [], meetingId).raw_grants ?? []).map(async grant => ({ ...grant, active: await active(db, job, grant, generation) })))
}
export async function rawGrantAction(db: D1Database, job: Job, actor: Actor, input: Input, meetingId: string, revoke: boolean) {
 manager(actor)
 const meeting = find(job.meetings ?? [], meetingId), operation_id = text(input.operation_id, 'Operation id', 100)
 need(!(job.meetings ?? []).some(m => m.raw_grants?.some(g => g.operation_id === operation_id || g.revocation?.operation_id === operation_id)), 'This raw meeting grant operation is already recorded', 409, 'operation_conflict')
 need(input.confirm === true, 'Confirm this exact raw meeting access change')
 const reason = text(input.reason, revoke ? 'Revocation reason' : 'Sharing reason', 2000)
 if (revoke) {
  const record = find(meeting.raw_grants ?? [], text(input.grant_id, 'Raw grant', 100))
  need(!record.revocation, 'This raw meeting grant was already revoked', 409, 'revoked')
  record.revocation = { operation_id, reason, by: stamp(actor) }
  meeting.history.push({ kind: 'raw-grant-revoked', by: stamp(actor), detail: record.id })
  return { record, writes: [] as D1PreparedStatement[] }
 }
 const email = text(input.email, 'Named internal recipient email', 254).toLowerCase(), recipient = await authority(db, job, email)
 need(recipient, 'Choose a currently assigned noncustom internal superintendent or office person', 403, 'recipient_authority')
 need((meeting.raw_grants?.length ?? 0) < 500, 'This meeting supports up to 500 historical grants')
 const generation = await warrantyGeneration(db)
 for (const grant of meeting.raw_grants ?? []) need(grant.recipient.operator_id !== recipient.operator_id || !await active(db, job, grant, generation), 'This person already has a current raw meeting grant', 409, 'already_granted')
 const record: MeetingRawGrant = { id: crypto.randomUUID(), operation_id, recipient, reason, by: stamp(actor), auth_generation: generation }
 ;(meeting.raw_grants ??= []).push(record)
 meeting.history.push({ kind: 'raw-granted', by: stamp(actor), detail: record.id })
 return { record, writes: [...recipientGuards(db, recipient), db.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_team WHERE operator_id=? AND COALESCE(json_extract(data,'$.assignment_id'),json_extract(data,'$.updated_by'))=?) THEN 1 ELSE 0 END").bind(recipient.operator_id, recipient.team_assignment_id), db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_auth_settings WHERE singleton=1 AND generation=?) THEN 1 ELSE 0 END').bind(generation)] }
}
/** A raw grant never carries retained snapshots, private messages, grants or another record's authority. */
function readOnly(meeting: Meeting): Meeting {
 return { id: meeting.id, title: meeting.title, held_on: meeting.held_on, agenda: meeting.agenda, minutes: meeting.minutes, attendees: meeting.attendees, decisions: meeting.decisions, tags: meeting.tags, sheet: meeting.sheet, cost_code: meeting.cost_code, by: meeting.by, history: [], actions: meeting.actions.map(a => ({ id: a.id, title: a.title, owner_email: a.owner_email, due_on: a.due_on, by: a.by, ...(a.completion ? { completion: { answer: a.completion.answer, by: a.completion.by, links: [] } } : {}) })) }
}
/** All raw read doors resolve this same current, meeting-specific grant. */
export async function projectRawMeetings(db: D1Database, job: Job, actor: Actor): Promise<Meeting[]> {
 if (nativeMeetingReader(actor, job)) return job.meetings ?? []
 if (!actor.session_id || actor.credential_id || actor.permissions || !assignedJob(actor, job)) return []
 const generation = await warrantyGeneration(db), result: Meeting[] = []
 for (const meeting of job.meetings ?? []) for (const grant of meeting.raw_grants ?? []) {
  if (grant.recipient.operator_id === actor.id && grant.recipient.operator_version === actor.version && grant.recipient.email === actor.email.toLowerCase() && await active(db, job, grant, generation)) { result.push(readOnly(meeting)); break }
 }
 return result
}
