import { auditStatement } from './audit'
import { need, object, stamp, text, DomainError, type Actor, type Input } from './model'
import { requireOwner } from './auth'
import { transaction } from './store'

/** ROLE-005: owner holds on a job or a company record. A legal hold lasts until the owner releases it; retention lasts until its date.
 * Either one stops the erasure of the subject and its documents and communications, with the recorded reason. */
export interface Hold { id: string; subject_kind: 'job' | 'vendor'; subject_id: string; kind: 'legal_hold' | 'retention'; reason: string; until: string | null; placed_by: { id: string; name: string; role: string; at: string }; placed_at: string; released_by?: { id: string; name: string; role: string; at: string }; released_at?: string; release_reason?: string }
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const today = () => new Date().toISOString().slice(0, 10)
type Row = Omit<Hold, 'placed_by' | 'released_by'> & { placed_by: string; released_by: string | null }
const hold = (row: Row): Hold => ({ ...row, placed_by: JSON.parse(row.placed_by), ...(row.released_by ? { released_by: JSON.parse(row.released_by) } : {}) })
/** SQL for "this subject has a hold in force", reused as an atomic erasure guard. */
export const heldSql = (kind: string, id: string) => ({ sql: "EXISTS(SELECT 1 FROM pl_holds WHERE subject_kind=? AND subject_id=? AND released_at IS NULL AND (kind='legal_hold' OR until>=?))", params: [kind, id, today()] })
export async function activeHolds(db: D1Database, kind: 'job' | 'vendor', id: string): Promise<Hold[]> {
 const { results } = await db.prepare("SELECT * FROM pl_holds WHERE subject_kind=? AND subject_id=? AND released_at IS NULL AND (kind='legal_hold' OR until>=?) ORDER BY placed_at").bind(kind, id, today()).all<Row>()
 return results.map(hold)
}
/** An erasure request meets any hold first: the refusal is recorded, then explained with who held it, why and until when. */
export async function requireNoHold(db: D1Database, actor: Actor, kind: 'job' | 'vendor', id: string) {
 const holds = await activeHolds(db, kind, id)
 if (!holds.length) return
 await db.batch([auditStatement(db, actor, { kind: 'erasure', action: `${kind === 'job' ? 'jobs' : 'vendors'}.erase_refused`, subject_kind: kind, subject_id: id, ...(kind === 'job' ? { job_id: id } : {}), detail: { holds: holds.map(h => ({ id: h.id, kind: h.kind, until: h.until })) } })])
 throw new DomainError('retention_hold', `Erasure is blocked: ${holds.map(h => h.kind === 'legal_hold' ? `legal hold placed by ${h.placed_by.name} on ${h.placed_at.slice(0, 10)}` : `retention until ${h.until} set by ${h.placed_by.name}`).join('; ')}. Reason: ${holds.map(h => h.reason).join(' / ')}. Release the hold first; the audit history is kept after erasure.`, 409, { holds })
}
/** GET /holds?subject_kind=&subject_id= lists holds (owner or administrator); POST /holds places one and POST /holds/:id/release lifts it (owner only, audited). */
export async function holdsResponse(request: Request, db: D1Database, actor: Actor, parts: string[], readBody: (request: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[0] !== 'holds') return null
 need(actor.role === 'owner' || actor.role === 'admin', 'Only an owner or administrator reads holds', 403, 'forbidden')
 if (request.method === 'GET' && parts.length === 1) {
  const url = new URL(request.url), kind = url.searchParams.get('subject_kind'), id = url.searchParams.get('subject_id')
  const { results } = await db.prepare('SELECT * FROM pl_holds WHERE (? IS NULL OR subject_kind=?) AND (? IS NULL OR subject_id=?) ORDER BY placed_at DESC LIMIT 200').bind(kind, kind, id, id).all<Row>()
  return Response.json({ holds: results.map(hold) }, { headers })
 }
 requireOwner(actor); need(request.method === 'POST', 'Method not allowed', 405, 'method_not_allowed')
 const input = object(await readBody(request))
 if (parts.length === 1) {
  const subject_kind = input.subject_kind, subject_id = text(input.subject_id, 'subject_id', 100), kind = input.kind
  need(subject_kind === 'job' || subject_kind === 'vendor', 'Hold a job or a company record'); need(kind === 'legal_hold' || kind === 'retention', 'Choose legal_hold or retention')
  const until = kind === 'retention' ? text(input.until, 'until', 10) : null
  need(until === null || (/^\d{4}-\d{2}-\d{2}$/.test(until) && Number.isFinite(Date.parse(until + 'T00:00:00Z')) && new Date(until + 'T00:00:00Z').toISOString().slice(0, 10) === until && until >= today()), 'Retention needs a calendar date that is not in the past')
  need(input.confirm === true, 'Confirm that this hold stops erasure and that only the owner can release it')
  const found = await db.prepare(subject_kind === 'job' ? 'SELECT 1 AS ok FROM pl_jobs WHERE id=?' : 'SELECT 1 AS ok FROM pl_vendors WHERE id=?').bind(subject_id).first()
  need(found, 'Hold an existing record', 404, 'not_found')
  const row: Hold = { id: crypto.randomUUID(), subject_kind, subject_id, kind, reason: text(input.reason, 'A hold needs a reason', 2000), until, placed_by: stamp(actor), placed_at: new Date().toISOString() }
  await transaction(db, actor, null, [db.prepare('INSERT INTO pl_holds(id,subject_kind,subject_id,kind,reason,until,placed_by,placed_at) VALUES(?,?,?,?,?,?,?,?)').bind(row.id, subject_kind, subject_id, kind, row.reason, until, JSON.stringify(row.placed_by), row.placed_at)], undefined, { kind: 'hold', action: `holds.${kind}`, subject_kind, subject_id, ...(subject_kind === 'job' ? { job_id: subject_id } : {}), detail: { hold_id: row.id, until } })
  return Response.json({ hold: row }, { status: 201, headers })
 }
 need(parts.length === 3 && parts[2] === 'release', 'Unknown hold route', 404, 'not_found')
 const row = await db.prepare('SELECT * FROM pl_holds WHERE id=?').bind(parts[1]).first<Row>(); need(row, 'Hold not found', 404, 'not_found'); need(row.released_at === null, 'This hold is already released', 409, 'immutable')
 const released_by = stamp(actor), reason = text(input.reason, 'A release needs a reason', 2000)
 await transaction(db, actor, null, [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_holds WHERE id=? AND released_at IS NULL) THEN 1 ELSE 0 END').bind(row.id), db.prepare('UPDATE pl_holds SET released_by=?,released_at=?,release_reason=? WHERE id=?').bind(JSON.stringify(released_by), released_by.at, reason, row.id)], undefined, { kind: 'hold', action: 'holds.release', subject_kind: row.subject_kind, subject_id: row.subject_id, ...(row.subject_kind === 'job' ? { job_id: row.subject_id } : {}), detail: { hold_id: row.id } })
 return Response.json({ hold: hold({ ...row, released_by: JSON.stringify(released_by), released_at: released_by.at, release_reason: reason }) }, { headers })
}
