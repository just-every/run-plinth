import { need, text, type Input } from './model'

type Binding = {id: string; receiver_origin: string; job_ids: string; event_types: string; revoked_at: string | null}

/** Archive metadata is a recovery checklist, never delivery authority. */
export async function recoveryBindings(db: D1Database, after: string) {
 const rows = await db.prepare(`SELECT b.* FROM pl_connector_bindings b
  WHERE b.id>? AND NOT EXISTS(SELECT 1 FROM pl_connector_subscriptions s WHERE s.id=b.id) ORDER BY b.id LIMIT 101`).bind(after).all<Binding>()
 const page = rows.results.slice(0, 100)
 return {next: rows.results.length > 100 ? page.at(-1)!.id : null, bindings: page.map(row => ({...row, job_ids: JSON.parse(row.job_ids), event_types: JSON.parse(row.event_types)}))}
}

export async function recoveryId(db: D1Database, input: Input, receiver: string, jobs: string[], types: string[]) {
 if (input.recovery_id === undefined) return crypto.randomUUID()
 const id = text(input.recovery_id, 'recovery_id', 200)
 const row = await db.prepare('SELECT * FROM pl_connector_bindings WHERE id=?').bind(id).first<Binding>()
 need(row && !row.revoked_at, 'Recovery binding is unavailable', 409, 'recovery_binding')
 const same = (stored: string, current: string[]) => JSON.stringify(JSON.parse(stored).sort()) === JSON.stringify([...new Set(current)].sort())
 need(row.receiver_origin === new URL(receiver).origin && same(row.job_ids, jobs) && same(row.event_types, types), 'Review the exact recovered origin, jobs and event types', 409, 'recovery_binding')
 return id
}

export function bindingStatement(db: D1Database, row: {id: string; receiver: string; job_ids: string; event_types: string}) {
 return db.prepare('INSERT INTO pl_connector_bindings(id,receiver_origin,job_ids,event_types) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(row.id, new URL(row.receiver).origin, row.job_ids, row.event_types)
}
