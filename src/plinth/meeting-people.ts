import { clientAccess } from './job-customers'
import { roleOf } from './role-store'
import { scopeContact } from './scope-contacts'
import { teamGrant } from './team'
import type { MeetingSharingJob, MeetingShareRecipientInput, MeetingShareRecipient } from './meeting-sharing-model'

interface Person { id: string; email: string; version: number; role: 'owner' | 'admin' | 'member' }
async function currentPerson(db: D1Database, email: string): Promise<Person | null> {
 return db.prepare("SELECT id,email,version,role FROM oa_operators WHERE lower(email)=? AND status='active'").bind(email.toLowerCase()).first<Person>()
}

/** Office recipients retain a current job assignment. Custom roles also need their existing document-view permission. */
export async function recipientAuthority(db: D1Database, job: MeetingSharingJob, input: MeetingShareRecipientInput): Promise<MeetingShareRecipient | null> {
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
export function recipientGuards(db: D1Database, recipient: MeetingShareRecipient): D1PreparedStatement[] {
 const guards = [db.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND lower(email)=? AND version=? AND role=? AND status='active') THEN 1 ELSE 0 END").bind(recipient.operator_id, recipient.email, recipient.operator_version, recipient.operator_role)]
 if (recipient.kind === 'office') {
  guards.push(recipient.team_version === undefined
   ? db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pl_team WHERE operator_id=?) THEN 1 ELSE 0 END').bind(recipient.operator_id)
   : db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_team WHERE operator_id=? AND version=?) THEN 1 ELSE 0 END').bind(recipient.operator_id, recipient.team_version))
  if (recipient.role_id) guards.push(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_roles WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(recipient.role_id, recipient.role_version))
 }
 return guards
}
