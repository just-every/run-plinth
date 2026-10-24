import type { Job } from './model'
import { presets, type Feature } from './role-model'
import { roleOf } from './role-store'
import { teamGrant } from './team'

/** A known internal recipient must retain the same feature and job grant at the final send fence. */
export async function deliveryPermissions(db: D1Database, job: Job, email: string, feature: Feature, financial: boolean): Promise<D1PreparedStatement[] | null> {
 const person = await db.prepare('SELECT id,role,version,status FROM oa_operators WHERE lower(email)=?').bind(email.toLowerCase()).first<{ id: string; role: string; version: number; status: string }>()
 if (!person) return []
 if (person.status !== 'active') return null
 const guards = [db.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active') THEN 1 ELSE 0 END").bind(person.id, person.version)]
 if (person.role !== 'admin') return guards
 const team = await teamGrant(db, person.id)
 if (!team) return [...guards, db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pl_team WHERE operator_id=?) THEN 1 ELSE 0 END').bind(person.id)]
 const custom = team.grant.role === 'custom' ? await roleOf(db, team.grant.role_id!) : null
 if (team.grant.role === 'custom' && !custom) return null
 const spec = custom?.role ?? presets[team.grant.role as keyof typeof presets]
 if (!spec || !spec.permissions[feature].view || financial && !spec.financial_visible) return null
 if ((custom ? presets[custom.role.copy_of].base : team.grant.role) !== 'admin' && !team.grant.job_ids.includes(job.id)) return null
 guards.push(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_team WHERE operator_id=? AND version=?) THEN 1 ELSE 0 END').bind(person.id, team.version))
 if (custom) guards.push(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_roles WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(custom.role.id, custom.version))
 return guards
}
