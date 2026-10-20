import { authGuard } from './auth'
import { clientAccess } from './job-customers'
import { DomainError, need, type Actor, type Job } from './model'
import { readClock } from './store'
import { teamGrant } from './team'
import type { WarrantyAuthority, WarrantyPromise, WarrantyRecipient, WarrantyReminder, WarrantyState } from './warranty-model'

export const warrantyState = (job: Job): WarrantyState => job.warranties ??= { components: [], promises: [], cases: [], reminders: [] }
export async function warrantyGeneration(db: D1Database): Promise<number> {
 const settings = await db.prepare('SELECT generation FROM oa_auth_settings WHERE singleton=1').first<{ generation: number }>()
 need(settings && Number.isSafeInteger(settings.generation), 'The installation authority is unavailable', 409, 'authority_unavailable')
 return settings.generation
}
/** Office authority is checked against native active identities and the current Plinth assignment. */
export async function officeAuthority(db: D1Database, job: Job, identity: string, byId = false): Promise<WarrantyAuthority | null> {
 const person = await db.prepare(`SELECT id,email,version,role FROM oa_operators WHERE ${byId ? 'id' : 'lower(email)'}=? AND status='active' AND role IN ('owner','admin')`).bind(byId ? identity : identity.toLowerCase()).first<WarrantyAuthority>()
 if (!person) return null
 const team = person.role === 'admin' ? await teamGrant(db, person.id) : null
 if (team && !team.grant.job_ids.includes(job.id)) return null
 return { id: person.id, email: person.email.toLowerCase(), version: person.version, role: person.role, ...(team ? { team_version: team.version } : {}) }
}
export function authorityGuards(db: D1Database, authority: WarrantyAuthority): D1PreparedStatement[] {
 const guards = [db.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND lower(email)=? AND version=? AND role=? AND status='active') THEN 1 ELSE 0 END").bind(authority.id, authority.email, authority.version, authority.role)]
 if (authority.team_version !== undefined) guards.push(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_team WHERE operator_id=? AND version=?) THEN 1 ELSE 0 END').bind(authority.id, authority.team_version))
 else if (authority.role === 'admin') guards.push(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pl_team WHERE operator_id=?) THEN 1 ELSE 0 END').bind(authority.id))
 return guards
}
export async function recipientGuards(db: D1Database, job: Job, recipient: WarrantyRecipient): Promise<D1PreparedStatement[] | null> {
 if (recipient.kind === 'office') {
  const office = await officeAuthority(db, job, recipient.operator_id ?? '', true)
  return office && office.email === recipient.email ? authorityGuards(db, office) : null
 }
 if (!await clientAccess(db, job, recipient.email)) return null
 // Assigned customer contacts need not have signed in, but a revoked native person cannot receive notices.
 const person = await db.prepare('SELECT id,version,status FROM oa_operators WHERE lower(email)=?').bind(recipient.email).first<{ id: string; version: number; status: string }>()
 if (person && person.status !== 'active') return null
 return [person
  ? db.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active') THEN 1 ELSE 0 END").bind(person.id, person.version)
  : db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM oa_operators WHERE lower(email)=?) THEN 1 ELSE 0 END').bind(recipient.email)]
}
export async function promiseGuards(db: D1Database, job: Job, promise: WarrantyPromise): Promise<{ guards: D1PreparedStatement[]; reason?: undefined } | { guards?: undefined; reason: string }> {
 if (promise.status !== 'active') return { reason: 'The reminder agreement is paused or revoked' }
 if (promise.case_id && job.warranties?.cases.find(c => c.id === promise.case_id)?.status !== 'open') return { reason: 'The linked case is closed or unavailable' }
 if (!job.warranties?.components.some(c => c.id === promise.component_id)) return { reason: 'The component is unavailable' }
 const generation = await warrantyGeneration(db)
 if (generation !== promise.auth_generation) return { reason: 'Installation authority changed; a person must resume and reconfirm the agreement' }
 const creator = await officeAuthority(db, job, promise.authority.id, true)
 if (!creator || creator.email !== promise.authority.email || creator.version !== promise.authority.version || creator.role !== promise.authority.role || creator.team_version !== promise.authority.team_version) return { reason: 'The configuring person or their assignment changed; a person must resume the agreement' }
 const recipient = await recipientGuards(db, job, promise.recipient)
 if (!recipient) return { reason: 'The recipient no longer has current access to this job' }
 return { guards: [...authorityGuards(db, creator), ...recipient, db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_auth_settings WHERE singleton=1 AND generation=?) THEN 1 ELSE 0 END').bind(generation)] }
}
export async function loadWarrantyJob(db: D1Database, id: string): Promise<Job | null> {
 const row = await db.prepare('SELECT data FROM pl_jobs WHERE id=?').bind(id).first<{ data: string }>()
 return row ? JSON.parse(row.data) as Job : null
}
/** Immediately before the external effect, recheck native grants and the surviving reserved job atomically. */
export async function checkWarrantySend(db: D1Database, job: Job, clock: number, guards: D1PreparedStatement[], actor?: Actor): Promise<void> {
 try {
  await db.batch([
   db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_clock WHERE id=1 AND version=?) THEN 1 ELSE 0 END').bind(clock),
   db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(job.id, job.version),
   ...(actor ? [authGuard(db, actor)] : []), ...guards, db.prepare('DELETE FROM pl_guard'),
  ])
 } catch (error) {
  if (/CHECK constraint failed|UNIQUE constraint failed|job_erased|FOREIGN KEY constraint failed/.test(String(error))) throw new DomainError('conflict', 'Reminder authority changed before sending', 409)
  throw error
 }
}
/** Scheduler writes use native authority fences, never fabricated sessions or widened Actor roles. */
export async function saveWarrantyJob(db: D1Database, previous: Job, next: Job, clock: number, guards: D1PreparedStatement[] = [], actor?: Actor): Promise<void> {
 next.version = previous.version + 1
 const data = JSON.stringify(next)
 need(data.length <= 8_000_000, 'Job history is too large')
 const checks = [
  db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_clock WHERE id=1 AND version=?) THEN 1 ELSE 0 END').bind(clock),
  db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(previous.id, previous.version),
  ...(actor ? [authGuard(db, actor)] : []), ...guards,
 ]
 try {
  await db.batch([...checks, db.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(next.version, data, next.id, previous.version), db.prepare('UPDATE pl_clock SET version=version+1 WHERE id=1'), db.prepare('DELETE FROM pl_guard')])
 } catch (error) {
  if (/CHECK constraint failed|UNIQUE constraint failed|job_erased|FOREIGN KEY constraint failed/.test(String(error))) throw new DomainError('conflict', 'The job or reminder authority changed; reload before trying again', 409)
  throw error
 }
}
/** Updating an existing attempt on the latest surviving job never recreates erased data or revives an agreement. */
export async function finishWarrantyAttempt(db: D1Database, jobId: string, attemptId: string, outcome: Pick<WarrantyReminder, 'status' | 'label'> & Partial<Pick<WarrantyReminder, 'provider_message_id'>>, now: number): Promise<boolean> {
 for (let n = 0; n < 3; n++) {
  const clock = await readClock(db), previous = await loadWarrantyJob(db, jobId)
  if (!previous) return false
  const next = structuredClone(previous), attempt = next.warranties?.reminders.find(r => r.id === attemptId)
  if (!attempt || attempt.status !== 'unknown' || attempt.completed_at) return false
  Object.assign(attempt, outcome, { completed_at: new Date(now).toISOString() })
  try { await saveWarrantyJob(db, previous, next, clock); return true }
  catch (error) { if (!(error instanceof DomainError) || error.code !== 'conflict') throw error }
 }
 // The reserved unknown outcome stays visible and can never be automatically resent.
 return false
}
