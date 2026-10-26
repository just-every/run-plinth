import { authGuard, requireManager } from './auth'
import { clientAccess } from './job-customers'
import { find, need, stamp, type Actor, type Input } from './model'
import { roleOf } from './role-store'
import { scopeContact } from './scope-contacts'
import { teamGrant } from './team'
import {
 publicMeetingShare, shareOperation, shareRecipients, shareText,
 type MeetingShare, type MeetingShareFeedback, type MeetingShareRecipient, type MeetingShareRecipientInput,
 type MeetingSharingJob, type PublicMeetingShare,
} from './meeting-sharing-model'

interface Person { id: string; email: string; version: number; role: 'owner' | 'admin' | 'member' }
const signedIn = (actor: Actor) => need(actor.session_id && !actor.credential_id && actor.role !== 'agent', 'Sign in as a person to use meeting extracts', 403, 'human_required')
function officeManager(actor: Actor) {
 signedIn(actor); requireManager(actor)
 need(!actor.permissions && !actor.team, 'Only a current owner or administrator publishes or revokes meeting extracts', 403, 'forbidden')
}
async function currentPerson(db: D1Database, email: string): Promise<Person | null> {
 return db.prepare("SELECT id,email,version,role FROM oa_operators WHERE lower(email)=? AND status='active'").bind(email.toLowerCase()).first<Person>()
}
const sameActor = (person: Person | null, actor: Actor) => !!person && person.id === actor.id && person.version === actor.version && person.email.toLowerCase() === actor.email.toLowerCase()

/** Office recipients retain a current job assignment. Custom roles also need their existing document-view permission. */
async function recipientAuthority(db: D1Database, job: MeetingSharingJob, input: MeetingShareRecipientInput): Promise<MeetingShareRecipient | null> {
 const person = await currentPerson(db, input.email)
 if (!person) return null
 const recipient: MeetingShareRecipient = {
  email: input.email, kind: input.kind, can_comment: input.can_comment,
  ...(input.kind === 'sub' ? { subcontract_id: input.subcontract_id } : {}),
  operator_id: person.id, operator_version: person.version, operator_role: person.role, can_view: true,
 }
 if (input.kind !== 'office') {
  if (person.role !== 'member') return null
  const allowed = input.kind === 'client' ? await clientAccess(db, job, input.email) : !!await scopeContact(db, job, input.email, input.subcontract_id)
  return allowed ? recipient : null
 }
 if (person.role !== 'owner' && person.role !== 'admin') return null
 const team = await teamGrant(db, person.id)
 if (!team) return recipient
 if (person.role !== 'admin' || !team.grant.job_ids.includes(job.id)) return null
 recipient.team_version = team.version
 if (team.grant.role === 'custom') {
  const custom = await roleOf(db, team.grant.role_id ?? '')
  if (!custom?.role.permissions.documents.view || input.can_comment && !custom.role.permissions.documents.create) return null
  recipient.role_id = custom.role.id; recipient.role_version = custom.version
 }
 return recipient
}
function recipientGuards(db: D1Database, recipient: MeetingShareRecipient): D1PreparedStatement[] {
 const guards = [db.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND lower(email)=? AND version=? AND role=? AND status='active') THEN 1 ELSE 0 END").bind(recipient.operator_id, recipient.email, recipient.operator_version, recipient.operator_role)]
 if (recipient.kind === 'office') {
  guards.push(recipient.team_version === undefined
   ? db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pl_team WHERE operator_id=?) THEN 1 ELSE 0 END').bind(recipient.operator_id)
   : db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_team WHERE operator_id=? AND version=?) THEN 1 ELSE 0 END').bind(recipient.operator_id, recipient.team_version))
  if (recipient.role_id) guards.push(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_roles WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(recipient.role_id, recipient.role_version))
 }
 return guards
}
async function currentRecipient(db: D1Database, job: MeetingSharingJob, actor: Pick<Actor,'id'|'email'|'version'>, share: MeetingShare): Promise<MeetingShareRecipient | null> {
 if (share.revocation) return null
 const granted = share.recipients.find(r => r.operator_id === actor.id && r.email === actor.email.toLowerCase() && r.operator_version === actor.version && r.can_view === true)
 if (!granted) return null
 const current = await recipientAuthority(db, job, granted)
 if (!current || current.operator_id !== granted.operator_id || current.operator_version !== granted.operator_version || current.operator_role !== granted.operator_role || current.team_version !== granted.team_version || current.role_id !== granted.role_id || current.role_version !== granted.role_version) return null
 return granted
}
async function currentManager(db: D1Database, actor: Actor): Promise<boolean> {
 if (!actor.session_id || actor.credential_id || actor.permissions || actor.team || !['owner', 'admin'].includes(actor.role)) return false
 const person = await currentPerson(db, actor.email)
 return sameActor(person, actor) && person!.role === actor.role && !await teamGrant(db, actor.id)
}

/** Mutate only the caller's cloned job. The caller saves with its pre-read installation clock and these guards. No sending occurs. */
export async function publishMeetingShare(db: D1Database, job: MeetingSharingJob, actor: Actor, input: Input, meetingId: string): Promise<{ record: MeetingShare; writes: D1PreparedStatement[] }> {
 officeManager(actor)
 need(await currentManager(db, actor), 'Your meeting sharing authority changed', 403, 'forbidden')
 find(job.meetings ?? [], meetingId)
 need(input.confirm === true, 'Explicitly confirm publication of this exact reviewed extract and its named recipients')
 need((job.meeting_shares?.length ?? 0) < 500, 'A job supports up to 500 meeting extracts')
 const operation_id = shareOperation(job, input), title = shareText(input.title, 'Extract title', 240), body = shareText(input.body, 'Reviewed extract body', 20000)
 need(!/[\r\n]/.test(title), 'Extract title must be one line')
 const inputs = shareRecipients(input.recipients)
 const authorities = await Promise.all(inputs.map(recipient => recipientAuthority(db, job, recipient)))
 need(authorities.every(Boolean), 'Every recipient must be a current active person with current job or released-scope authority', 403, 'recipient_authority')
 const recipients = authorities as MeetingShareRecipient[]
 const record: MeetingShare = { id: crypto.randomUUID(), meeting_id: meetingId, operation_id, title, body, by: stamp(actor), recipients, feedback: [] }
 ;(job.meeting_shares ??= []).push(record)
 return { record, writes: [authGuard(db, actor), ...recipients.flatMap(recipient => recipientGuards(db, recipient))] }
}

/** The authenticated caller's saveJob transaction fences current authority and appends its audit event. */
export function revokeMeetingShare(job: MeetingSharingJob, actor: Actor, input: Input, shareId: string): MeetingShare {
 officeManager(actor)
 const record = find(job.meeting_shares ?? [], shareId)
 need(!record.revocation, 'This meeting extract was already revoked', 409, 'revoked')
 need(input.confirm === true, 'Explicitly confirm revoking this meeting extract')
 const operation_id = shareOperation(job, input), reason = shareText(input.reason, 'Revocation reason', 2000)
 record.revocation = { operation_id, reason, by: stamp(actor) }
 return record
}

/** Use this allowlisted projection for pages, direct requests, search, counts and external exports. */
export async function projectMeetingShares(db: D1Database, job: MeetingSharingJob, actor: Actor): Promise<(MeetingShare | PublicMeetingShare)[]> {
 signedIn(actor)
 if (await currentManager(db, actor)) return structuredClone(job.meeting_shares ?? [])
 const shares: PublicMeetingShare[] = []
 for (const share of job.meeting_shares ?? []) {
  const recipient = await currentRecipient(db, job, actor, share)
  if (recipient) shares.push(publicMeetingShare(share, recipient))
 }
 return shares
}

/** Feedback stays private to its named recipient and the office; it does not complete an action or send anything. */
export async function meetingShareFeedback(db: D1Database, job: MeetingSharingJob, actor: Actor, input: Input, shareId: string): Promise<MeetingShareFeedback> {
 signedIn(actor)
 const share = (job.meeting_shares ?? []).find(row => row.id === shareId)
 const recipient = share ? await currentRecipient(db, job, actor, share) : null
 need(share && recipient, 'Meeting extract not found', 404, 'not_found')
 need(recipient.can_comment === true, 'This extract does not grant commenting', 403, 'forbidden')
 need(share.feedback.length < 1000, 'This extract supports up to 1000 feedback entries')
 const operation_id = shareOperation(job, input), body = shareText(input.body, 'Feedback', 10000)
 const record: MeetingShareFeedback = { id: crypto.randomUUID(), operation_id, recipient_operator_id: actor.id, body, by: stamp(actor) }
 share.feedback.push(record)
 return record
}

export { currentRecipient as currentMeetingShareRecipient, recipientGuards as meetingShareRecipientGuards }
