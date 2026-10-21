import { fieldConfig, reportAudit } from './report-store'
import { financialId } from './report-records'
import { parseFieldValues, requireFieldsAtStage } from './report-field-model'
import { requireJobManager } from './auth'
import { invoiceBalance } from './invoices'
import { invoiceRows, type InvoiceReceipt } from './invoice-model'
import { cents, find, need, object, recordApproval, stamp, sum, text, usdOnly, type Actor, type Input, type Job, type Stamp } from './model'

export interface RemittanceAllocation {
 invoice_id: string; receipt_id: string; amount_cents: number; applied_on: string; recorded_by: Stamp
}
export interface Remittance {
 id: string; amount_cents: number; received_on: string; reference: string; method: 'bank' | 'check'; evidence: string
 prepared_by: Stamp; label: 'Recorded by staff; Plinth did not move or independently verify funds'
 allocations: RemittanceAllocation[]
 returned?: { returned_on: string; reference: string; reason: string; recorded_by: Stamp; amount_cents: number }
}
export function localDate(value: unknown, name: string) {
 const result = text(value, name, 10)
 need(/^\d{4}-\d{2}-\d{2}$/.test(result) && Number.isFinite(Date.parse(result + 'T00:00:00Z')) && new Date(result + 'T00:00:00Z').toISOString().slice(0, 10) === result, `${name} must be a valid YYYY-MM-DD job-local date`)
 return result
}
export function unapplied(row: Remittance) { return row.returned ? 0 : sum([row.amount_cents, -sum(row.allocations.map(a => a.amount_cents))]) }
const recordedLabel = 'Recorded by staff; Plinth did not move or independently verify funds' as const

/** Use the existing human receipt authority; job/version/authority fences commit all allocations together. */
export function remittanceAction(job: Job, actor: Actor, input: Input, id?: string, action?: string): Remittance {
 requireJobManager(actor); usdOnly(job)
 need(input.confirm === true, 'Confirm the external bank/check evidence; Plinth does not move or independently verify funds')
 let row: Remittance
 if (!id) {
  need(!action, 'Unknown remittance action', 404, 'not_found')
  const reference = text(input.reference, 'External receipt reference', 500)
  need(!(job.remittances ?? []).some(r => r.reference.toLowerCase() === reference.toLowerCase()) && !invoiceRows(job).some(i => i.receipts.some(r => r.reference.toLowerCase() === reference.toLowerCase())), 'This external receipt reference is already recorded on this job', 409, 'invoice_duplicate')
  const amount_cents = cents(input.amount_cents); need(amount_cents > 0, 'Record a positive receipt')
  need(input.method === 'bank' || input.method === 'check', 'Choose bank or check receipt')
  row = { id: crypto.randomUUID(), amount_cents, reference, method: input.method, received_on: localDate(input.received_on, 'received_on'), evidence: text(input.evidence, 'Remittance evidence', 4000), prepared_by: stamp(actor), allocations: [], label: recordedLabel }
  ;(job.remittances ??= []).push(row)
 } else {
  row = find(job.remittances ?? [], id)
  need(!row.returned, 'This remittance was returned; its original and reversal history remain fixed', 409, 'remittance_returned')
 }
 if (action === 'return') {
  const returned_on = localDate(input.returned_on, 'returned_on')
  need(returned_on >= row.received_on && row.allocations.every(a => returned_on >= a.applied_on), 'Return date cannot precede receipt or allocation')
  const returned = { returned_on, reference: text(input.reference, 'Return evidence reference', 500), reason: text(input.reason, 'Return reason', 2000), recorded_by: stamp(actor), amount_cents: row.amount_cents }
  for (const allocation of row.allocations) {
   const invoice = find(invoiceRows(job), allocation.invoice_id)
   const receipt = find(invoice.receipts, allocation.receipt_id)
   need(receipt.remittance_id === row.id && receipt.amount_cents === allocation.amount_cents && !invoice.receipts.some(r => r.reversal_of === receipt.id), 'Allocation history changed; review before recording a return', 409, 'remittance_history')
   invoice.receipts.push({ id: crypto.randomUUID(), amount_cents: -receipt.amount_cents, received_on: returned_on, reference: returned.reference, method: row.method, recorded_by: stamp(actor), remittance_id: row.id, reversal_of: receipt.id, label: 'Return recorded by staff; allocation reversed, no funds moved or independently verified' })
  }
  row.returned = returned
 } else {
  need(!action || action === 'allocate', 'Unknown remittance action', 404, 'not_found')
  need(Array.isArray(input.allocations) && input.allocations.length <= 200 && (!id || input.allocations.length > 0), 'Provide up to 200 invoice allocations; a later allocation cannot be empty')
  const allocations = input.allocations.map(value => {
   const item = object(value), invoice_id = text(item.invoice_id, 'invoice_id', 100), amount_cents = cents(item.amount_cents)
   need(amount_cents > 0, 'Every allocation needs positive integer cents')
   return { invoice_id, amount_cents }
  })
  need(new Set(allocations.map(a => a.invoice_id)).size === allocations.length, 'Name each invoice once per allocation request')
  need(sum(allocations.map(a => a.amount_cents)) <= unapplied(row), 'Allocations exceed the remaining unapplied receipt', 409, 'remittance_balance')
  const applied_on = id ? localDate(input.applied_on, 'applied_on') : row.received_on
  need(applied_on >= row.received_on, 'Allocation date cannot precede receipt')
  for (const allocation of allocations) {
   const invoice = find(invoiceRows(job), allocation.invoice_id)
   need(invoice.kind === 'milestone' && invoice.status === 'issued' && invoice.issued, 'Allocate to an issued milestone invoice; deposit requests retain their existing separate ledger', 409, 'invoice_state')
   need(allocation.amount_cents <= invoiceBalance(job, invoice).due_cents, 'Allocation exceeds the current invoice balance', 409, 'invoice_balance')
   const receipt: InvoiceReceipt = { id: crypto.randomUUID(), amount_cents: allocation.amount_cents, received_on: applied_on, reference: row.reference, method: row.method, recorded_by: stamp(actor), remittance_id: row.id, label: recordedLabel }
   invoice.receipts.push(receipt)
   row.allocations.push({ ...allocation, receipt_id: receipt.id, applied_on, recorded_by: stamp(actor) })
  }
 }
 // Bound the installation's checked-cent totals as well as individual inputs.
 sum((job.remittances ?? []).filter(r => !r.returned).map(r => r.amount_cents))
 recordApproval(job, actor, 'remittance.' + (action ?? 'record'), row, row)
 return row
}

/** as_of changes age only: balances are explicitly the current ledger, not a historical reconstruction. */
export function receivables(job: Job, asOf?: string) {
 usdOnly(job)
 const jobToday = new Intl.DateTimeFormat('en-CA', { timeZone: job.time_zone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
 const as_of = localDate(asOf ?? jobToday, 'as_of')
 const invoices = invoiceRows(job).filter(i => i.issued).map(invoice => {
  const balance = invoiceBalance(job, invoice), due_on = invoice.issued!.due_on
  const days_overdue = Math.max(0, Math.round((Date.parse(as_of + 'T00:00:00Z') - Date.parse(due_on + 'T00:00:00Z')) / 86400000))
  const bucket = days_overdue === 0 ? 'current' : days_overdue <= 30 ? '1-30' : days_overdue <= 60 ? '31-60' : days_overdue <= 90 ? '61-90' : '91+'
  return { invoice_id: invoice.id, number: invoice.number!, kind: invoice.kind, due_on, days_overdue, bucket, ...balance, held_retainage_cents: Math.max(0, balance.withheld_cents - balance.released_retainage_cents) }
 })
 const milestones = invoices.filter(i => i.kind === 'milestone')
 const aging = Object.fromEntries(['current', '1-30', '31-60', '61-90', '91+'].map(bucket => [bucket, sum(milestones.filter(i => i.bucket === bucket).map(i => i.due_cents))]))
 return { job_id: job.id, currency: 'USD', time_zone: job.time_zone ?? 'UTC', as_of, balance_basis: 'Current recorded ledger; as_of changes age only, not historical balances', funds_label: recordedLabel, invoices, aging, due_cents: sum(milestones.map(i => i.due_cents)), held_retainage_cents: sum(milestones.map(i => i.held_retainage_cents)), received_cents: sum(milestones.map(i => i.received_cents)), unapplied_cents: sum((job.remittances ?? []).map(unapplied)), remittances: (job.remittances ?? []).map(r => ({ ...r, unapplied_cents: unapplied(r) })) }
}

/** RPT-004 financial custom fields and required native-stage rules travel with the money record. */
export async function remittanceFields(db: D1Database, job: Job, actor: Actor, row: Remittance, input: Input): Promise<D1PreparedStatement[]> {
 const config = await fieldConfig(db), id = financialId(job.id, 'remittance', row.id)
 const previous = await db.prepare("SELECT version,stage,data FROM pl_report_values WHERE record_scope='financial' AND record_id=?").bind(id).first<{version:number;stage:string;data:string}>()
 need(input.custom_fields === undefined || actor.role === 'owner' || actor.role === 'admin', 'Only the office edits financial custom values', 403, 'forbidden')
 const values = parseFieldValues(input.custom_fields ?? {}, config.fields, 'financial', 'USD', JSON.parse(previous?.data ?? '{}'))
 const stage = row.returned ? 'returned' : 'recorded'
 requireFieldsAtStage(config.fields, 'financial', stage, values)
 return [db.prepare("INSERT INTO pl_report_values(record_scope,record_id,job_id,version,stage,data) VALUES('financial',?,?,?,?,?) ON CONFLICT(record_scope,record_id) DO UPDATE SET version=excluded.version,stage=excluded.stage,data=excluded.data").bind(id,job.id,(previous?.version ?? 0)+1,stage,JSON.stringify(values)), reportAudit(db, actor, 'remittance', {id,stage:previous?.stage}, {id,stage,field_ids:Object.keys(values)})]
}
