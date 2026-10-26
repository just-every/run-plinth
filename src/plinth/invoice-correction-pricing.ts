import { cents, find, need, sum, type Job } from './model'
import { invoiceRows, type Invoice, type InvoiceCorrectionDocument, type InvoiceTaxLine } from './invoice-model'

/** Cumulative rounding closes a full credit to the original reviewed tax cent. */
function proportional(amount: number, tax: number, gross: number) {
 need(gross > 0 && tax >= 0 && tax <= gross && amount >= 0, 'The original reviewed line cannot support this correction', 409, 'invoice_tax_balance')
 return cents(Number((2n * BigInt(amount) * BigInt(tax) + BigInt(gross)) / (2n * BigInt(gross))), 'Correction tax')
}
export function movements(invoice: Invoice, line: InvoiceTaxLine) {
 const corrections = (invoice.corrections ?? []).flatMap(c => c.document.lines).filter(l => l.invoice_line_id === line.id)
 return { gross: sum([line.gross_cents, ...corrections.map(l => l.gross_cents)]), tax: sum([line.tax_cents, ...corrections.map(l => l.tax_cents)]) }
}
function reverseLine(invoice: Invoice, line: InvoiceTaxLine, amount: number, sign: number): InvoiceCorrectionDocument['lines'][number] {
 const earlier = (invoice.corrections ?? []).flatMap(c => c.document.lines).filter(l => l.invoice_line_id === line.id)
 const lots = [line, ...earlier.filter(l => l.gross_cents * sign > 0)]
 need(amount <= movements(invoice, line).gross * sign, 'A reversal cannot exceed the remaining original line value', 409, 'invoice_correction_balance')
 let remaining = amount
 const tax_allocations: NonNullable<InvoiceCorrectionDocument['lines'][number]['tax_allocations']> = []
 for (const lot of lots) {
  if (!remaining || !lot.gross_cents) continue
  const consumed = sum(earlier.flatMap(l => l.tax_allocations ?? []).filter(a => a.lot_id === lot.id).map(a => a.gross_cents))
  const take = Math.min(remaining, sum([lot.gross_cents * sign, -consumed]))
  if (take <= 0) continue
  const tax = proportional(sum([consumed, take]), lot.tax_cents * sign, lot.gross_cents * sign) - proportional(consumed, lot.tax_cents * sign, lot.gross_cents * sign)
  tax_allocations.push({ lot_id: lot.id, gross_cents: take, tax_cents: tax }); remaining -= take
 }
 need(remaining === 0, 'Original tax allocation history does not reconcile', 409, 'invoice_tax_balance')
 const tax_cents = -sign * sum(tax_allocations.map(a => a.tax_cents))
 return { ...structuredClone(line), id: crypto.randomUUID(), invoice_line_id: line.id, gross_cents: -sign * amount, tax_cents, subtotal_cents: sum([-sign * amount, -tax_cents]), tax_allocations }
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
function extendLine(job: Job, invoice: Invoice, line: InvoiceTaxLine, amount: number, pending: InvoiceCorrectionDocument['lines'], sign: number): InvoiceCorrectionDocument['lines'][number] {
 const allocated = invoiceRows(job).filter(i => i.issued && (i.kind === 'deposit') === (invoice.kind === 'deposit') && (invoice.kind !== 'cost_plus' || i.id === invoice.id)).flatMap(i => i.issued!.lines.filter(l => sourceKey(l) === sourceKey(line)).map(l => movements(i, l)))
 const remainingGross = sum([line.reviewed_source_gross_cents, -sum(allocated.map(a => a.gross))]), remainingTax = sum([line.reviewed_source_tax_cents, -sum(allocated.map(a => a.tax))])
 const prior = pending.filter(l => sourceKey(l) === sourceKey(line)), before = sum(prior.map(l => l.gross_cents * sign)), after = sum([before, amount])
 need(remainingGross * sign > 0 && after <= remainingGross * sign, 'Correction exceeds the remaining human-reviewed source value', 409, 'invoice_correction_balance')
 const tax_cents = sign * proportional(after, remainingTax * sign, remainingGross * sign) - sum(prior.map(l => l.tax_cents))
 return { ...structuredClone(line), id: crypto.randomUUID(), invoice_line_id: line.id, gross_cents: sign * amount, tax_cents, subtotal_cents: sum([sign * amount, -tax_cents]) }
}
/** Positive inputs describe the magnitude; the document kind fixes the financial direction. */
export function correctionLines(job: Job, invoice: Invoice, changes: { invoice_line_id: string; amount_cents: number }[], kind: 'credit' | 'debit') {
 const result: InvoiceCorrectionDocument['lines'] = []
 for (const change of changes) {
  const line = find(invoice.issued!.lines, change.invoice_line_id)
  const sign = Math.sign(line.reviewed_source_gross_cents || line.gross_cents) || 1
  const direction = kind === 'credit' ? -1 : 1
  result.push(direction === sign ? extendLine(job, invoice, line, change.amount_cents, result, sign) : reverseLine(invoice, line, change.amount_cents, sign))
 }
 return result
}
