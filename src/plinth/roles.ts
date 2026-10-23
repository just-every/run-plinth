import { escalation, holds, parseSpec, presets, type Preset, type Role, type RoleSpec } from './role-model'
import { need, object, stamp, type Actor, type Input } from './model'
import { readClock, transaction } from './store'
import { roleOf } from './role-store'

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
/** What the signed-in person holds: an owner or unconstrained administrator holds everything; anyone else holds their role's switches. */
const everything = { permissions: presets.administrator.permissions, financial_visible: true, po_limit_cents: null as number | null }
const held = (actor: Actor) => actor.permissions ? { permissions: actor.permissions.matrix, financial_visible: actor.permissions.financial, po_limit_cents: actor.permissions.po_limit_cents } : everything
/** GET /roles lists the presets and custom roles; POST /roles copies a preset; PUT /roles/:id edits one; DELETE removes an unassigned one. The owner role is fixed. */
export async function rolesResponse(request: Request, db: D1Database, actor: Actor, parts: string[], readBody: (request: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[0] !== 'roles') return null
 const editor = actor.role === 'owner' || actor.role === 'admin' && (!actor.permissions || holds(held(actor), 'company', 'edit'))
 need(request.method === 'GET' ? actor.role === 'owner' || actor.role === 'admin' : editor, 'Only an owner or an administrator who may edit company settings manages roles', 403, 'forbidden')
 if (request.method === 'GET' && parts.length === 1) {
  const { results } = await db.prepare('SELECT version,data FROM pl_roles ORDER BY rowid').all<{ version: number; data: string }>()
  const assigned = new Map<string, number>(); for (const r of (await db.prepare("SELECT data FROM pl_team").all<{ data: string }>()).results) { const g = JSON.parse(r.data) as { role_id?: string }; if (g.role_id) assigned.set(g.role_id, (assigned.get(g.role_id) ?? 0) + 1) }
  return Response.json({ presets: [{ id: 'owner', name: 'Owner', locked: true }, ...Object.entries(presets).map(([id, p]) => ({ id, name: p.name, permissions: p.permissions, financial_visible: p.financial_visible, po_limit_cents: p.po_limit_cents, builtin: true }))], roles: results.map(r => ({ ...JSON.parse(r.data) as Role, assigned: assigned.get((JSON.parse(r.data) as Role).id) ?? 0 })) }, { headers })
 }
 need(parts[1] !== 'owner' && !(parts[1] && parts[1] in presets), 'The owner role and the presets cannot be edited or deleted; copy one instead', 403, 'locked')
 const clock = await readClock(db), at = (event: string) => ({ kind: 'permission' as const, action: event })
 if (request.method === 'POST' && parts.length === 1) {
  const input = object(await readBody(request)), spec = parseSpec(input)
  const blocked = escalation(held(actor), undefined, spec); need(!blocked, `You cannot grant ${blocked}, which you do not hold`, 403, 'escalation')
  const duplicate = await db.prepare('SELECT 1 AS n FROM pl_roles WHERE lower(json_extract(data,\'$.name\'))=?').bind(spec.name.toLowerCase()).first(); need(!duplicate, 'A role with this name exists', 409, 'duplicate')
  const role: Role = { ...spec, id: crypto.randomUUID(), version: 1, created_by: stamp(actor), updated_by: stamp(actor) }
  await transaction(db, actor, null, [db.prepare('INSERT INTO pl_roles(id,version,data) VALUES(?,?,?)').bind(role.id, 1, JSON.stringify(role))], clock, { ...at('roles.create'), subject_kind: 'roles', subject_id: role.id, detail: { name: role.name, copy_of: role.copy_of } })
  return Response.json({ role }, { status: 201, headers })
 }
 need(parts.length === 2, 'Unknown role route', 404, 'not_found')
 const found = await roleOf(db, parts[1]!); need(found, 'Role not found', 404, 'not_found')
 const input = object(await readBody(request)); need(input.expected_version === found.version, 'This role changed; reload before saving', 409, 'stale_version')
 const fence = db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_roles WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(found.role.id, found.version)
 if (request.method === 'DELETE') {
  const users = (await db.prepare('SELECT count(*) AS n FROM pl_team WHERE json_extract(data,\'$.role_id\')=?').bind(found.role.id).first<{ n: number }>())!.n; need(users === 0, 'Move everyone off this role before deleting it', 409, 'assigned')
  await transaction(db, actor, null, [fence, db.prepare('DELETE FROM pl_roles WHERE id=?').bind(found.role.id)], clock, { ...at('roles.delete'), subject_kind: 'roles', subject_id: found.role.id })
  return Response.json({ deleted: true }, { headers })
 }
 need(request.method === 'PUT', 'Method not allowed', 405, 'method_not_allowed')
 const spec: RoleSpec = parseSpec(input, found.role), blocked = escalation(held(actor), found.role, spec); need(!blocked, `You cannot grant ${blocked}, which you do not hold`, 403, 'escalation')
 const role: Role = { ...found.role, ...spec, version: found.version + 1, updated_by: stamp(actor) }
 await transaction(db, actor, null, [fence, db.prepare('UPDATE pl_roles SET version=?,data=? WHERE id=? AND version=?').bind(role.version, JSON.stringify(role), role.id, found.version)], clock, { ...at('roles.update'), subject_kind: 'roles', subject_id: role.id, version_before: found.version, version_after: role.version, detail: { name: role.name } })
 return Response.json({ role }, { headers })
}
