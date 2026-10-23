import type { Role } from './role-model'
/** Read on every request, so an edit to a role applies on its holders' next request. */
export async function roleOf(db: D1Database, id: string): Promise<{ version: number; role: Role } | null> {
 const row = await db.prepare('SELECT version,data FROM pl_roles WHERE id=?').bind(id).first<{ version: number; data: string }>()
 return row ? { version: row.version, role: JSON.parse(row.data) as Role } : null
}
