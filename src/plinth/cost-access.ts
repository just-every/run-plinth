import { roleGate } from './role-gate'
import { need, type Actor, type Job } from './model'
import { costRequirement } from './permissions'
import { presets, type Preset } from './role-model'

/** New cost permissions only expose registered routes; data entry never grants payment or period close. */
export function costAccess(actor: Actor, request: Request) {
 if (actor.role === 'owner' || actor.role === 'admin' && !actor.permissions) return
 const required = costRequirement(request.method, new URL(request.url).pathname.slice('/api/plinth/'.length))
 need(required, 'This role does not include that cost route', 403, 'forbidden')
 const preset = actor.role === 'admin' ? presets.administrator : presets[actor.role as Preset]
 need(preset && preset.permissions[required.feature][required.action] && preset.financial_visible, 'This preset does not include that cost action', 403, 'forbidden')
 if (actor.permissions) need(actor.permissions.financial && actor.permissions.matrix[required.feature][required.action], 'This role does not include that financial action', 403, 'forbidden')
}
export function costLedgerVisible(actor: Actor) {
 return actor.permissions ? actor.permissions.financial && actor.permissions.matrix.budgets.view : ['owner', 'admin', 'bookkeeper'].includes(actor.role)
}
/** A lender packet carries only issued customer draw evidence, never supplier originals or internal cost records. */
export function drawPacket(job: Job) {
 return { format: 'plinth-draw-packet-v1', job_id: job.id, job_name: job.name, source_version: job.version, currency: job.currency ?? 'USD',
  invoices: (job.invoices ?? []).filter(i => i.issued).map(i => ({ id: i.id, number: i.number, kind: i.kind, description: i.description, due_on: i.due_on, gross_cents: i.issued!.gross_cents, payable_cents: i.issued!.payable_cents, withheld_cents: i.issued!.withheld_cents, issued_at: i.issued!.issued_by.at })),
  applications: job.claims.filter(c => c.status !== 'draft').map(c => ({ id: c.id, description: c.description, status: c.status, current_cents: c.reconciliation.current_cents, cumulative_cents: c.cumulative_cents, approved_at: c.approved_by?.at, lines: c.sov?.lines.map(l => ({ cost_code: l.cost_code, description: l.description, scheduled_cents: l.scheduled_cents, completed_cents: l.completed_cents, stored_cents: l.stored_cents, current_cents: l.current_cents, balance_cents: l.balance_cents, evidence: l.evidence })) })),
 }
}

/** The screen uses the same server gates as its actions, without returning any financial record. */
export function costCapabilities(actor: Actor, job: Job) {
 const can = (method: string, path: string) => { try { const r = new Request('https://local.invalid/api/plinth/jobs/' + job.id + '/costs' + path, { method }); roleGate(actor, r); costAccess(actor, r); return true } catch { return false } }
 return { owner: actor.role === 'owner', review: actor.id === job.accounting_authority?.accountant_id && can('POST', '/period-reviews'), bills: can('GET', '/bills'), create: can('POST', '/bills'), edit: can('POST', '/bills/00000000-0000-0000-0000-000000000000/recode'), approve: can('POST', '/bills/00000000-0000-0000-0000-000000000000/post'), packet: can('GET', '/draw-packet') }
}
