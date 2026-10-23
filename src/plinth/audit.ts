import type { Actor } from './model'

/** ROLE-005 event kinds; each audited write names one. */
export type AuditKind = 'financial' | 'permission' | 'export' | 'send' | 'import' | 'automation' | 'record' | 'hold' | 'erasure'
export interface AuditEvent { kind?: AuditKind; action?: string; subject_kind?: string; subject_id?: string; job_id?: string; version_before?: number; version_after?: number; before_ref?: string; after_ref?: string; detail?: Record<string, unknown> }
const financial = new Set(['quotes', 'variations', 'orders', 'claims', 'invoices', 'remittances', 'retainage', 'sov', 'subcontracts', 'budgets', 'budget', 'pricing', 'variation-pricing', 'allowance-changes', 'estimate-template', 'takeoff-estimate', 'pricing-rates', 'estimate-catalog', 'company', 'costs'])
const permission = new Set(['team', 'roles', 'portal-policy', 'rfi-access', 'agent-credentials', 'access'])
const isId = (value: string) => /^[0-9a-f]{8}-[0-9a-f-]{20,}$|^[0-9a-f]{16,}$/i.test(value)
/** The route is the event: POST /jobs/J/orders/O/issue is orders.issue on job J, a POST to a collection is a create, a DELETE of a job is its erasure. */
export function classify(method: string, path: string): Required<Pick<AuditEvent, 'kind' | 'action'>> & Pick<AuditEvent, 'subject_kind' | 'subject_id' | 'job_id'> {
 const parts = path.replace(/^\/api\/plinth\//, '').split('/').filter(Boolean), job = parts[0] === 'jobs' && parts[1] ? parts[1] : undefined, rest = job ? parts.slice(2) : parts
 const category = rest[0] ?? (job ? 'job' : 'plinth'), id = rest.find((part, n) => n > 0 && isId(part)), verbs = rest.slice(1).filter(part => !isId(part))
 const verb = verbs.at(-1) ?? (method === 'DELETE' ? 'erase' : id || method === 'PUT' || (job && !rest.length) ? 'update' : 'create')
 const kind: AuditKind = category==='costs'&&rest[1]==='accountant'?'permission':['send', 'notify', 'run'].includes(verb) ? 'send' : verb.startsWith('export') ? 'export' : permission.has(category) || verb === 'access' ? 'permission' : category === 'imports' ? 'import' : method === 'DELETE' ? 'erasure' : financial.has(category) || ['draws', 'lien', 'retainage'].includes(verb) ? 'financial' : 'record'
 return { kind, action: `${category === 'costs' ? 'cost.' + (rest[1] ?? 'ledger') : category}.${verb === rest[1] && category === 'costs' ? 'create' : verb}`, subject_kind: category, ...(id ? { subject_id: id } : {}), ...(job ? { job_id: job } : {}) }
}
export const source = (actor: Actor) => actor.credential_id ? 'agent' : actor.session_id ? 'session' : 'automation'
async function digest(value: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('') }
export const jobRef = (data: string) => digest(data)
/** The audit row for one committed write. It joins the same D1 batch as the write, so a change and its history commit or fail together. */
export function auditSql(actor: Actor, event: AuditEvent = {}): { sql: string; params: unknown[] } {
 const routed = actor.request ? classify(actor.request.method, actor.request.path) : undefined
 const kind = event.kind ?? routed?.kind ?? 'automation', action = event.action ?? routed?.action ?? 'automation.run'
 return {
  sql: 'INSERT INTO pl_audit(id,at,kind,action,actor_id,actor_name,actor_role,source,credential_id,subject_kind,subject_id,job_id,version_before,version_after,before_ref,after_ref,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  params: [crypto.randomUUID(), new Date().toISOString(), kind, action, actor.id, actor.name, actor.role, source(actor), actor.credential_id ?? null, event.subject_kind ?? routed?.subject_kind ?? null, event.subject_id ?? routed?.subject_id ?? null, event.job_id ?? routed?.job_id ?? null, event.version_before ?? null, event.version_after ?? null, event.before_ref ?? null, event.after_ref ?? null, event.detail ? JSON.stringify(event.detail) : null],
 }
}
export function auditStatement(db: D1Database, actor: Actor, event: AuditEvent = {}): D1PreparedStatement { const { sql, params } = auditSql(actor, event); return db.prepare(sql).bind(...params) }
/** Scheduler and other unattended work records itself under a named automation, never a borrowed person. */
export const automation = (id: string, name: string): Actor => ({ id: `automation:${id}`, email: '', name, role: 'agent', version: 0 })
