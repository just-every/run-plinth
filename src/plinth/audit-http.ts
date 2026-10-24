import { auditStatement } from './audit'
import { need, type Actor } from './model'

/** ROLE-005: GET /audit searches the append-only history; GET /audit/export.json|csv exports the same filtered rows. Owners and administrators only.
 * Rows hold references (versions, digests, ids), never record content, so the export carries no secret and no document. */
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const columns = ['seq', 'at', 'kind', 'action', 'actor_id', 'actor_name', 'actor_role', 'source', 'subject_kind', 'subject_id', 'job_id', 'version_before', 'version_after', 'before_ref', 'after_ref', 'detail'] as const
type Row = Record<typeof columns[number], string | number | null> & { credential_id?: string | null }
const kinds = ['financial', 'permission', 'export', 'send', 'import', 'automation', 'record', 'hold', 'erasure']
const like = (value: string) => '%' + value.replace(/[\\%_]/g, c => '\\' + c) + '%'
export async function searchAudit(db: D1Database, url: URL, limit: number) {
 const p = url.searchParams, where: string[] = [], values: unknown[] = []
 const add = (sql: string, ...args: unknown[]) => { where.push(sql); values.push(...args) }
 const kind = p.get('kind'), source = p.get('source'), q = p.get('q')?.trim(), from = p.get('from'), to = p.get('to'), before = p.get('before')
 if (kind) { need(kinds.includes(kind), 'Unknown event kind'); add('kind=?', kind) }
 if (source) { need(['session', 'agent', 'automation'].includes(source), 'Unknown source'); add('source=?', source) }
 for (const key of ['actor_id', 'job_id', 'subject_id', 'action'] as const) if (p.get(key)) add(`${key}=?`, p.get(key))
 if (from) { need(/^\d{4}-\d{2}-\d{2}/.test(from), 'from must be a date'); add('at>=?', from) }
 if (to) { need(/^\d{4}-\d{2}-\d{2}/.test(to), 'to must be a date'); add('at<=?', to.length === 10 ? to + 'T23:59:59.999Z' : to) }
 if (before) { need(/^\d+$/.test(before), 'before must be an event number'); add('seq<?', Number(before)) }
 if (q) { need(q.length <= 200, 'Search is too long'); add("(action LIKE ? ESCAPE '\\' OR actor_name LIKE ? ESCAPE '\\' OR subject_id LIKE ? ESCAPE '\\' OR job_id LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\')", ...Array(5).fill(like(q))) }
 const { results } = await db.prepare(`SELECT ${columns.join(',')} FROM pl_audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY seq DESC LIMIT ?`).bind(...values, limit + 1).all<Row>()
 return { events: results.slice(0, limit).map(r => ({ ...r, detail: r.detail ? JSON.parse(String(r.detail)) : null })), next: results.length > limit ? String(results[limit - 1]!.seq) : null }
}
const cell = (value: unknown) => { const raw = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? ''); return '"' + (/^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw).replaceAll('"', '""') + '"' }
export async function auditResponse(request: Request, db: D1Database, actor: Actor, parts: string[]): Promise<Response | null> {
 if (parts[0] !== 'audit') return null
 need(actor.role === 'owner' || actor.role === 'admin', 'Only an owner or administrator reads the audit history', 403, 'forbidden'); need(request.method === 'GET', 'The audit history is append-only', 405, 'method_not_allowed')
 const url = new URL(request.url)
 if (parts.length === 1) { const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200); return Response.json(await searchAudit(db, url, limit), { headers }) }
 need(parts.length === 2 && ['export.json', 'export.csv'].includes(parts[1]!), 'Unknown audit route', 404, 'not_found')
 const { events } = await searchAudit(db, url, 5000)
 if (parts[1] === 'export.json') return new Response(JSON.stringify({ format: 'plinth-audit-v1', count: events.length, events }), { headers: { ...headers, 'content-type': 'application/json', 'content-disposition': 'attachment; filename=plinth-audit.json' } })
 return new Response([columns.join(','), ...events.map(e => columns.map(c => cell((e as unknown as Record<string, unknown>)[c])).join(','))].join('\r\n') + '\r\n', { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename=plinth-audit.csv' } })
}
const exportPath = /\/(?:export\.(?:json|csv)|payroll\.csv|document\.(?:json|html|csv)|application\.(?:json|csv|html)|cost-codes\.(?:json|csv)|packet|originals|report)$/
/** A successful export read is itself an event; reports and imports already record their own writes. */
export async function auditExport(request: Request, db: D1Database, actor: Actor | undefined, status: number) {
 const path = new URL(request.url).pathname
 if (!actor || request.method !== 'GET' || status >= 400 || !exportPath.test(path) || path.startsWith('/api/plinth/reports/')) return
 const parts = path.replace('/api/plinth/', '').split('/'), job = parts[0] === 'jobs' ? parts[1] : undefined, resource = (job ? parts[2] : parts[0])!
 const search = new URL(request.url).search.slice(0, 500)
 await db.batch([auditStatement(db, actor, { kind: 'export', action: `${resource}.export`, subject_kind: resource, ...(job ? { job_id: job } : {}), detail: { file: parts.at(-1), ...(search ? { query: search } : {}) } })])
}
