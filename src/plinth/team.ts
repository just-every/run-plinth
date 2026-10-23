import { requireOwner } from './auth'
import { cents, need, object, stamp, text, type Actor, type Input, type Stamp, type TeamRole } from './model'
import { readClock, transaction } from './store'
import { presets as presetRoles } from './role-model'
import { roleOf } from './role-store'

/** A project manager is an operator-auth administrator narrowed to assigned jobs and an owner-set PO approval limit (USD cents, inclusive).
 * ROLE-002: an estimator, superintendent or crew member is the same narrowing with a different preset; their PO limit is always zero. */
export interface TeamGrant { role: TeamRole | 'custom'; /** ROLE-006: a custom role names the operator-auth role it rides on and its definition. */ base?: TeamRole | 'admin'; role_id?: string; job_ids: string[]; po_limit_cents: number; updated_by: Stamp }
const presets: TeamRole[] = ['project_manager', 'estimator', 'superintendent', 'crew']
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
/** Read on every request, so a role or assignment change applies on that person's next request. */
export async function teamGrant(db: D1Database, operatorId: string): Promise<{ version: number; grant: TeamGrant } | null> {
 const row = await db.prepare('SELECT version,data FROM pl_team WHERE operator_id=?').bind(operatorId).first<{ version: number; data: string }>()
 return row ? { version: row.version, grant: JSON.parse(row.data) as TeamGrant } : null
}
/** GET /team lists internal people and their preset role; PUT /team/:operator sets admin or a job-assigned preset: project_manager, estimator, superintendent or crew (owner only, audited). */
export async function teamResponse(request: Request, db: D1Database, actor: Actor, parts: string[], readBody: (request: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[0] !== 'team') return null
 need(actor.role === 'owner' || actor.role === 'admin', 'Only an owner or administrator reads the team', 403, 'forbidden')
 if (request.method === 'GET' && parts.length === 1) {
  const { results } = await db.prepare("SELECT o.id,o.email,o.display_name,o.role,t.version,t.data FROM oa_operators o LEFT JOIN pl_team t ON t.operator_id=o.id WHERE o.status='active' AND o.role IN ('owner','admin') ORDER BY o.email").all<{ id: string; email: string; display_name: string; role: string; version: number | null; data: string | null }>()
  const names = new Map((await db.prepare('SELECT id,json_extract(data,\'$.name\') AS name FROM pl_roles').all<{ id: string; name: string }>()).results.map(r => [r.id, r.name]))
  return Response.json({ team: results.map(r => ({ id: r.id, email: r.email, name: r.display_name, role: r.data ? (JSON.parse(r.data) as TeamGrant).role : r.role, ...(r.data ? { version: r.version, ...JSON.parse(r.data) as TeamGrant, ...((JSON.parse(r.data) as TeamGrant).role_id ? { role_name: names.get((JSON.parse(r.data) as TeamGrant).role_id!) } : {}) } : {}) })) }, { headers })
 }
 need(request.method === 'PUT' && parts.length === 2, 'Unknown team route', 404, 'not_found'); requireOwner(actor)
 const input = object(await readBody(request)), clock = await readClock(db), id = text(parts[1], 'operator id', 100)
 const person = await db.prepare("SELECT role FROM oa_operators WHERE id=? AND status='active'").bind(id).first<{ role: string }>()
 need(person?.role === 'admin', 'Invite the person as an administrator under People & access first', 409, 'not_admin')
 const previous = await teamGrant(db, id)
 need(input.expected_version === (previous?.version ?? 0), 'Their role changed; reload before saving', 409, 'stale_version')
 need(input.role === 'admin' || input.role === 'custom' || presets.includes(input.role as TeamRole), 'role must be admin, project_manager, estimator, superintendent, crew or custom')
 const custom = input.role === 'custom' ? await roleOf(db, text(input.role_id, 'role_id', 100)) : null; need(input.role !== 'custom' || custom, 'Choose an existing custom role', 404, 'not_found')
 const base = custom ? presetRoles[custom.role.copy_of].base : undefined
 const audit = (value: string) => db.prepare("INSERT INTO oa_auth_audit(id,actor_id,action,value,created_at) VALUES(?,?,'plinth.role',?,?)").bind(crypto.randomUUID(), actor.id, value, Date.now())
 const stale = previous ? db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_team WHERE operator_id=? AND version=?) THEN 1 ELSE 0 END').bind(id, previous.version) : db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pl_team WHERE operator_id=?) THEN 1 ELSE 0 END').bind(id)
 if (input.role === 'admin') {
  await transaction(db, actor, null, [stale, db.prepare('DELETE FROM pl_team WHERE operator_id=?').bind(id), audit(`${id}:admin`)], clock)
  return Response.json({ member: { id, role: 'admin' } }, { headers })
 }
 need(base === 'admin' || Array.isArray(input.job_ids) && input.job_ids.length <= 500, 'job_ids must be a list of up to 500')
 const job_ids = base === 'admin' ? [] : [...new Set((input.job_ids as unknown[]).map(j => text(j, 'job id', 100)))]
 const known = job_ids.length ? (await db.prepare(`SELECT count(*) AS n FROM pl_jobs WHERE id IN (${job_ids.map(() => '?').join(',')})`).bind(...job_ids).first<{ n: number }>())!.n : 0
 need(known === job_ids.length, 'Assign existing jobs only', 404, 'not_found')
 const role = input.role as TeamRole | 'custom', grant: TeamGrant = { role, ...(custom ? { base, role_id: custom.role.id } : {}), job_ids, po_limit_cents: role === 'project_manager' ? cents(input.po_limit_cents, 'po_limit_cents') : 0, updated_by: stamp(actor) }, version = (previous?.version ?? 0) + 1, data = JSON.stringify(grant)
 await transaction(db, actor, null, [stale, db.prepare('INSERT INTO pl_team(operator_id,version,data) VALUES(?,?,?) ON CONFLICT(operator_id) DO UPDATE SET version=excluded.version,data=excluded.data').bind(id, version, data), audit(`${id}:${role === 'custom' ? 'custom:' + custom!.role.id : role}:${version}`), ...(custom ? [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_roles WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(custom.role.id, custom.version)] : [])], clock)
 return Response.json({ member: { id, version, ...grant } }, { headers })
}
