import { requireManager } from './auth'
import { cents, find, need, object, recordApproval, stamp, sum, text, type Actor, type Input, type Job } from './model'
import { invoiceRows, type Invoice, type InvoiceAccountingEntry, type InvoiceBalance, type InvoiceCorrectionDocument, type InvoiceTaxLine } from './invoice-model'

export const isInvoiceCorrection = (action?: string) => ['credit', 'debit', 'void', 'write-off'].includes(action ?? '')

/** Cumulative rounding closes a full credit to the original reviewed tax cent. */
function proportional(amount: number, tax: number, gross: number) {
 need(gross > 0 && tax >= 0 && tax <= gross && amount >= 0, 'The original reviewed line cannot support this correction', 409, 'invoice_tax_balance')
 return cents(Number((2n * BigInt(amount) * BigInt(tax) + BigInt(gross)) / (2n * BigInt(gross))), 'Correction tax')
}
function entry(account: InvoiceAccountingEntry['account'], signedDebit: number): InvoiceAccountingEntry {
 return { account, debit_cents: Math.max(0, signedDebit), credit_cents: Math.max(0, -signedDebit) }
}
function accounting(invoice: Invoice, gross: number, subtotal: number, tax: number): InvoiceAccountingEntry[] {
 return (invoice.kind === 'deposit'
  ? [entry('deposit_request_receivable', gross), entry('deposit_request_offset', -gross)]
  : [entry('accounts_receivable', gross), entry('earned_revenue', -subtotal), entry('sales_tax_payable', -tax)])
  .filter(e => e.debit_cents || e.credit_cents)
}
function movements(invoice: Invoice, line: InvoiceTaxLine) {
 const corrections = (invoice.corrections ?? []).flatMap(c => c.document.lines).filter(l => l.invoice_line_id === line.id)
 return { gross: sum([line.gross_cents, ...corrections.map(l => l.gross_cents)]), tax: sum([line.tax_cents, ...corrections.map(l => l.tax_cents)]) }
}
function creditLine(invoice: Invoice, line: InvoiceTaxLine, amount: number): InvoiceCorrectionDocument['lines'][number] {
 const earlier = (invoice.corrections ?? []).flatMap(c => c.document.lines).filter(l => l.invoice_line_id === line.id)
 const lots = [line, ...earlier.filter(l => l.gross_cents > 0)]
 need(line.gross_cents >= 0 && amount <= movements(invoice, line).gross, 'A credit cannot exceed the remaining original line value', 409, 'invoice_correction_balance')
 let remaining = amount
 const tax_allocations: NonNullable<InvoiceCorrectionDocument['lines'][number]['tax_allocations']> = []
 for (const lot of lots) {
  if (!remaining || !lot.gross_cents) continue
  const consumed = sum(earlier.flatMap(l => l.tax_allocations ?? []).filter(a => a.lot_id === lot.id).map(a => a.gross_cents))
  const take = Math.min(remaining, sum([lot.gross_cents, -consumed]))
  if (take <= 0) continue
  const tax = proportional(sum([consumed, take]), lot.tax_cents, lot.gross_cents) - proportional(consumed, lot.tax_cents, lot.gross_cents)
  tax_allocations.push({ lot_id: lot.id, gross_cents: take, tax_cents: tax }); remaining -= take
 }
 need(remaining === 0, 'Original tax allocation history does not reconcile', 409, 'invoice_tax_balance')
 const tax_cents = -sum(tax_allocations.map(a => a.tax_cents))
 return { ...structuredClone(line), id: crypto.randomUUID(), invoice_line_id: line.id, gross_cents: -amount, tax_cents, subtotal_cents: sum([-amount, -tax_cents]), tax_allocations }
}
function sourceKey(line: InvoiceTaxLine) { return JSON.stringify([line.source_id, line.source_revision, line.source_line_id ?? null]) }
export function requireReviewedInvoiceCapacity(job: Job, invoice: Invoice, lines: InvoiceTaxLine[]) {
 if (invoice.kind === 'cost_plus') return
 for (const line of lines.filter(l => l.reviewed_source_gross_cents > 0)) {
  const existing = invoiceRows(job).filter(i => i.id !== invoice.id && i.issued && (i.kind === 'deposit') === (invoice.kind === 'deposit'))
  const allocated = sum(existing.flatMap(i => i.issued!.lines.filter(l => sourceKey(l) === sourceKey(line)).map(l => movements(i, l).gross)))
  const current = sum(lines.filter(l => sourceKey(l) === sourceKey(line)).map(l => l.gross_cents))
  need(sum([allocated, current]) <= line.reviewed_source_gross_cents, 'Invoice would rebill reviewed source value already consumed by a debit correction', 409, 'invoice_correction_balance')
 }
}
function debitLine(job: Job, invoice: Invoice, line: InvoiceTaxLine, amount: number, pending: InvoiceCorrectionDocument['lines']): InvoiceCorrectionDocument['lines'][number] {
 const allocated = invoiceRows(job).filter(i => i.issued && (i.kind === 'deposit') === (invoice.kind === 'deposit') && (invoice.kind !== 'cost_plus' || i.id === invoice.id)).flatMap(i => i.issued!.lines.filter(l => sourceKey(l) === sourceKey(line)).map(l => movements(i, l)))
 const remainingGross = sum([line.reviewed_source_gross_cents, -sum(allocated.map(a => a.gross))]), remainingTax = sum([line.reviewed_source_tax_cents, -sum(allocated.map(a => a.tax))])
 const prior = pending.filter(l => sourceKey(l) === sourceKey(line)), before = sum(prior.map(l => l.gross_cents)), after = sum([before, amount])
 need(line.gross_cents >= 0 && remainingGross > 0 && after <= remainingGross, 'Debit exceeds the remaining human-reviewed source value', 409, 'invoice_correction_balance')
 const tax_cents = proportional(after, remainingTax, remainingGross) - sum(prior.map(l => l.tax_cents))
 return { ...structuredClone(line), id: crypto.randomUUID(), invoice_line_id: line.id, gross_cents: amount, tax_cents, subtotal_cents: sum([amount, -tax_cents]) }
}
/** Append final human decisions to the cloned invoice; the caller commits the version and sequence guards together. */
export async function correctInvoice(db: D1Database, job: Job, invoice: Invoice, actor: Actor, input: Input, action: string, balance: InvoiceBalance): Promise<D1PreparedStatement[]> {
 requireManager(actor)
 need(actor.session_id && !actor.credential_id, 'A signed-in owner or administrator must confirm invoice corrections', 403, 'human_required')
 need(invoice.status === 'issued' && invoice.issued, 'Issue the invoice before recording a correction', 409, 'invoice_state')
 need(input.confirm === true, 'Confirm this final invoice correction; it cannot be edited or deleted')
 const operation_id = text(input.operation_id, 'operation_id', 100), reason = text(input.reason, 'Private correction reason', 2000)
 need(!invoiceRows(job).some(i => (i.corrections ?? []).some(c => c.operation_id === operation_id) || (i.write_offs ?? []).some(w => w.operation_id === operation_id)), 'This correction operation is already recorded', 409, 'operation_conflict')
 need(!(invoice.corrections ?? []).some(c => c.document.kind === 'void'), 'A void invoice cannot receive further corrections', 409, 'invoice_void')
 if (action === 'write-off') {
  const amount_cents = cents(input.amount_cents), dispute_reference = text(input.dispute_reference, 'Disputed residual reference', 500)
  need(amount_cents > 0 && amount_cents <= balance.due_cents, 'Write off only a positive separate unpaid residual', 409, 'invoice_balance')
  need(invoice.kind !== 'deposit', 'An unearned deposit request is corrected by a credit, not a bad-debt write-off', 409, 'invoice_state')
  const writeOff = { id: crypto.randomUUID(), operation_id, amount_cents, reason, dispute_reference, recorded_by: stamp(actor), invoice_number: invoice.issued.number,
   accounting_entries: [entry('bad_debt_expense', amount_cents), entry('accounts_receivable', -amount_cents)], label: 'Disputed residual written off by a human; no funds received or moved and no sales tax reversed' }
  ;(invoice.write_offs ??= []).push(writeOff)
  recordApproval(job, actor, 'invoice.write_off', invoice, writeOff)
  return []
 }
 need(action === 'credit' || action === 'debit' || action === 'void', 'Unknown invoice correction', 404, 'not_found')
 need(invoice.issued.withheld_cents === 0, 'Resolve retained-value corrections separately before correcting this invoice', 409, 'invoice_retainage')
 let lines: InvoiceCorrectionDocument['lines']
 if (action === 'void') {
  need(invoice.receipts.length === 0 && invoice.deposit_applications.length === 0 && !invoiceRows(job).some(i => i.deposit_applications.some(a => a.deposit_invoice_id === invoice.id)), 'An invoice with receipt or allocation history cannot be voided', 409, 'invoice_void')
  need(!(invoice.write_offs ?? []).length, 'An invoice with write-off history cannot be voided', 409, 'invoice_void')
  need(input.lines === undefined && input.amount_cents === undefined, 'A void credits the entire remaining invoice')
  lines = invoice.issued.lines.map(line => {
   const remaining = movements(invoice, line)
   return { ...structuredClone(line), id: crypto.randomUUID(), invoice_line_id: line.id, gross_cents: -remaining.gross, tax_cents: -remaining.tax, subtotal_cents: sum([-remaining.gross, remaining.tax]) }
  }).filter(line => line.gross_cents || line.tax_cents)
 } else {
  need(Array.isArray(input.lines) && input.lines.length > 0 && input.lines.length <= invoice.issued.lines.length, 'Choose original invoice lines and positive gross correction amounts')
  const seen = new Set<string>()
  lines = []
  for (const value of input.lines) {
   const item = object(value), lineId = text(item.invoice_line_id, 'invoice_line_id', 100), amount = cents(item.amount_cents)
   need(!seen.has(lineId), 'Choose each original invoice line once'); seen.add(lineId)
   need(amount > 0, 'Correction amounts must be positive')
   const original = find(invoice.issued!.lines, lineId)
   lines.push(action === 'credit' ? creditLine(invoice, original, amount) : debitLine(job, invoice, original, amount, lines))
  }
 }
 const gross_cents = sum(lines.map(l => l.gross_cents)), tax_cents = sum(lines.map(l => l.tax_cents)), subtotal_cents = sum(lines.map(l => l.subtotal_cents))
 need(action === 'debit' ? gross_cents > 0 : gross_cents < 0, 'Correction must change the invoice balance', 409, 'invoice_correction_balance')
 need(balance.written_off_cents === 0 || sum([balance.payable_cents, gross_cents]) >= balance.written_off_cents, 'A correction cannot consume the separate written-off residual', 409, 'invoice_correction_balance')
 const description = text(input.description, 'Public correction description', 2000)
 const counter = await db.prepare('SELECT next_number FROM pl_invoice_sequence WHERE id=1').first<{ next_number: number }>()
 need(counter && Number.isSafeInteger(counter.next_number) && counter.next_number > 0 && counter.next_number < 1_000_000_000_000, 'Invoice numbering is unavailable', 409, 'invoice_sequence')
 const writes = [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_invoice_sequence WHERE id=1 AND next_number=?) THEN 1 ELSE 0 END').bind(counter.next_number), db.prepare('UPDATE pl_invoice_sequence SET next_number=next_number+1 WHERE id=1 AND next_number=?').bind(counter.next_number)]
 const id = crypto.randomUUID(), document: InvoiceCorrectionDocument = structuredClone({ format: 'plinth-invoice-correction-v1', id, number: `${action === 'debit' ? 'DBN' : 'CRN'}-${String(counter.next_number).padStart(6, '0')}`, kind: action,
  original_invoice_id: invoice.id, original_invoice_number: invoice.issued.number, job_id: job.id, currency: 'USD', description,
  due_on: invoice.issued.due_on, terms: invoice.issued.terms, recipient_email: invoice.issued.recipient_email, issued_by: stamp(actor), gross_cents, subtotal_cents, tax_cents, lines,
  accounting_entries: accounting(invoice, gross_cents, subtotal_cents, tax_cents), label: action === 'void' ? 'Void by full linked credit; original invoice and numbering preserved; no funds moved' : 'Immutable linked invoice correction; original terms preserved; no funds moved' })
 const correction = { id, operation_id, reason, document }
 ;(invoice.corrections ??= []).push(correction)
 recordApproval(job, actor, 'invoice.' + action, invoice, correction)
 return writes
}
