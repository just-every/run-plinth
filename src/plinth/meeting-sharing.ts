import { recipientAuthority, recipientGuards } from './meeting-people'
import { authGuard, requireManager } from './auth'
import { find, need, stamp, type Actor, type Input } from './model'
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
