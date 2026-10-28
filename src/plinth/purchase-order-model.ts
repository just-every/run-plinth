import { selected } from './selection-model'
import { cents, DomainError, find, need, object, stamp, sum, text, type Actor, type Input, type Job, type Order, type Stamp } from './model'

/** Quantities are exact to a thousandth; a line total is quantity × unit price rounded half up to the cent; line receipts and returns are priced as the change in that rounded value. */
export interface PoLine { id: string; description: string; cost_code: string; quantity: string; unit: string; unit_cents: number; total_cents: number }
export interface LineQuantity { line_id: string; quantity: string }
export type PoSource = { kind: 'award'; subcontract_id: string } | { kind: 'budget'; cost_code: string } | { kind: 'selection'; selection_id: string; revision_id: string }
export interface PoReturn { returned_on?: string; id: string; lines: LineQuantity[]; amount_cents: number; reason: string; reference: string; recorded_by: Stamp }
export interface PoShipment { id: string; carrier: string; tracking: string; freight_cents: number; shipped_on: string; recorded_by: Stamp }
export interface PoAmendment { id: string; revision: number; reason: string; previous: { lines: PoLine[]; amount_cents: number; promised_on?: string }; proposed: { lines: PoLine[]; amount_cents: number; promised_on?: string }; budget_impact_cents: number; date_impact_days: number; status: 'pending' | 'approved'; prepared_by: Stamp; approved_by?: Stamp }
export interface PoFulfillment { delivery_status: 'draft' | 'issued' | 'acknowledged' | 'shipped' | 'partially_received' | 'received' | 'cancelled'; commitment_cents: number; received_cents: number; returned_cents: number; outstanding_cents: number; freight_cents: number; lines: { line_id: string; ordered: string; received: string; returned: string; outstanding: string }[] }

export const milli = (value: unknown, name: string, allowZero = false) => { const q = typeof value === 'number' ? String(value) : value; need(typeof q === 'string' && /^\d{1,9}(\.\d{1,3})?$/.test(q), `${name} must be a ${allowZero ? 'non-negative' : 'positive'} quantity with up to three decimals`); const [whole, frac = ''] = q.split('.'); const n = Number(whole) * 1000 + Number(frac.padEnd(3, '0')); need(allowZero || n > 0, `${name} must be positive`); return n }
export const show = (m: number) => m % 1000 ? `${Math.floor(m / 1000)}.${String(m % 1000).padStart(3, '0').replace(/0+$/, '')}` : String(m / 1000)
const lineTotal = (m: number, unit: number) => Math.floor((m * unit + 500) / 1000)
export const day = (value: unknown, name: string) => { const d = text(value, name, 10); need(/^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d, `${name} must be a calendar date (YYYY-MM-DD)`); return d }
const days = (from?: string, to?: string) => from && to ? Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) : 0

export function poLines(value: unknown): PoLine[] {
 need(Array.isArray(value) && value.length > 0 && value.length <= 200, 'Send one to 200 PO lines')
 const lines = (value as unknown[]).map(v => { const l = object(v), m = milli(l.quantity, 'quantity'), unit = cents(l.unit_cents, 'unit_cents'); return { id: l.id === undefined ? crypto.randomUUID() : text(l.id, 'line id', 100), description: text(l.description, 'line description', 500), cost_code: text(l.cost_code, 'cost code', 40), quantity: show(m), unit: text(l.unit, 'unit', 40), unit_cents: unit, total_cents: lineTotal(m, unit) } })
 need(new Set(lines.map(l => l.id)).size === lines.length, 'PO line ids must be unique'); sum(lines.map(l => l.total_cents)); return lines
}
/** Budget of a cost code: the cost of the accepted quote's included lines with that code. */
export function budgetOf(job: Job, code: string) {
 const quote = job.quotes.find(q => q.status === 'accepted'); need(quote, 'Accept a quote before ordering against its budget', 409, 'quote_required')
 return sum(quote.lines.filter(l => l.included !== false && l.cost_code === code).map(l => l.cost_total_cents ?? 0))
}
const committed = (job: Job, code: string, except?: string) => sum(job.orders.filter(o => o.id !== except && o.status !== 'draft').flatMap(o => o.lines ?? []).filter(l => l.cost_code === code).map(l => l.total_cents))
/** A sourced PO stays inside its award amount, or names a cost code the accepted budget carries. */
export function poSource(job: Job, input: Input, lines: PoLine[], except?: string): PoSource {
 const s = object(input.source)
 if (s.kind === 'award') {
  const award = find(job.subcontracts ?? [], text(s.subcontract_id, 'subcontract_id', 100))
  need(award.status === 'released', 'Release the subcontract scope before ordering from it', 409, 'subcontract_state')
  const ordered = sum([...job.orders.filter(o => o.id !== except && o.status !== 'draft' && o.source?.kind === 'award' && o.source.subcontract_id === award.id).map(o => o.amount_cents), ...lines.map(l => l.total_cents)])
  need(award.amount_cents === undefined || ordered <= award.amount_cents, 'Orders would exceed the awarded amount', 409, 'award_balance')
  return { kind: 'award', subcontract_id: award.id }
 }
 if (s.kind === 'selection') {
  const selection_id = text(s.selection_id, 'selection_id', 100), revision_id = text(s.revision_id, 'revision_id', 100)
  const { selection, revision, option } = selected(job, selection_id, revision_id)
  need(selection.revisions.filter(r => r.status === 'signed').at(-1)?.id === revision.id, 'A newer signed choice requires a new PO', 409, 'selection_revision')
  need(!job.orders.some(o => o.id !== except && o.status !== 'cancelled' && o.source?.kind === 'selection' && o.source.selection_id === selection_id && o.source.revision_id === revision_id), 'This signed selection already has a PO', 409, 'selection_ordered')
  need(lines.length === 1 && lines[0]!.quantity === '1' && lines[0]!.unit === 'selection' && lines[0]!.unit_cents === option.price_cents && lines[0]!.cost_code === revision.cost_code && lines[0]!.description === option.name, 'The PO must retain the exact signed selection price, option and code', 409, 'selection_terms')
  need(input.supplier === undefined || input.supplier === option.supplier, 'The PO supplier must match the signed choice', 409, 'selection_terms')
  return { kind: 'selection', selection_id, revision_id }
 }
 need(s.kind === 'budget', 'source.kind must be award, budget or selection')
 const code = text(s.cost_code, 'cost_code', 40); need(budgetOf(job, code) > 0, `The accepted budget has no ${code} cost`, 409, 'budget_code')
 need(lines.every(l => l.cost_code === code), 'Every line of a budget PO carries its cost code')
 return { kind: 'budget', cost_code: code }
}
/** Per line, in thousandths: ordered, received (gross) and returned quantities. */
function lineState(order: Order) {
 const qty = (rows: { lines?: LineQuantity[] }[], id: string) => rows.flatMap(r => r.lines ?? []).filter(l => l.line_id === id).reduce((n, l) => n + milli(l.quantity, 'quantity', true), 0)
 return (order.lines ?? []).map(l => ({ line: l, ordered: milli(l.quantity, 'quantity'), received: qty(order.receipts, l.id), returned: qty(order.returns ?? [], l.id) }))
}
export function fulfillment(order: Order): PoFulfillment {
 const received = sum(order.receipts.map(r => r.amount_cents)), returned = sum((order.returns ?? []).map(r => r.amount_cents)), freight = sum((order.shipments ?? []).map(s => s.freight_cents)), net = received - returned
 const lines = lineState(order).map(s => ({ line_id: s.line.id, ordered: show(s.ordered), received: show(s.received - s.returned), returned: show(s.returned), outstanding: show(s.ordered - s.received + s.returned) }))
 const delivery_status = order.status === 'draft' ? 'draft' : order.status === 'cancelled' ? 'cancelled' : net >= order.amount_cents ? 'received' : net > 0 ? 'partially_received' : order.shipments?.length ? 'shipped' : order.acknowledgment ? 'acknowledged' : 'issued'
 return { delivery_status, commitment_cents: order.amount_cents, received_cents: net, returned_cents: returned, outstanding_cents: order.amount_cents - net, freight_cents: freight, lines }
}
/** Line receipts and returns price at the line's unit price: a receipt never exceeds what is outstanding and a return never exceeds what was kept. */
export function lineQuantities(order: Order, value: unknown, mode: 'receive' | 'return', allowZero = false) {
 need(order.lines && Array.isArray(value) && value.length > 0 && value.length <= 200, 'Send the line quantities')
 const state = lineState(order), rows = (value as unknown[]).map(v => {
  const q = object(v), s = state.find(x => x.line.id === text(q.line_id, 'line_id', 100)); need(s, 'PO line not found', 404, 'not_found')
  const m = milli(q.quantity, 'quantity', allowZero), kept = s.received - s.returned, limit = mode === 'receive' ? s.ordered - kept : kept
  if (m > limit) throw new DomainError(mode === 'receive' ? 'over_receipt' : 'over_return', `${s.line.description}: only ${show(limit)} ${s.line.unit} ${mode === 'receive' ? 'outstanding' : 'received'}`, 409)
  // Priced as the change in the kept quantity's rounded value, so a fully received line sums to its total exactly.
  const priced = (n: number) => lineTotal(n, s.line.unit_cents)
  return { line_id: s.line.id, quantity: show(m), cents: mode === 'receive' ? priced(kept + m) - priced(kept) : priced(kept) - priced(kept - m) }
 })
 need(new Set(rows.map(r => r.line_id)).size === rows.length, 'Name each line once')
 return { lines: rows.map(({ line_id, quantity }) => ({ line_id, quantity })), amount_cents: sum(rows.map(r => r.cents)) }
}
export function amendment(order: Order, input: Input, actor: Actor, job: Job): PoAmendment {
 need(order.status === 'issued', 'Only an issued PO is amended', 409, 'order_state'); need(!order.amendments?.some(a => a.status === 'pending'), 'Approve or replace the pending amendment first', 409, 'amendment_pending')
 const lines = poLines(input.lines), amount = sum(lines.map(l => l.total_cents)), promised_on = input.promised_on === undefined ? order.promised_on : day(input.promised_on, 'promised date')
 need(amount >= fulfillment(order).received_cents, 'An amendment cannot commit less than is already received', 409, 'amendment_received')
 if (order.source) poSource(job, { source: order.source }, lines, order.id)
 return { id: crypto.randomUUID(), revision: (order.amendments?.length ?? 0) + 1, reason: text(input.reason, 'amendment reason', 2000), previous: { lines: structuredClone(order.lines ?? []), amount_cents: order.amount_cents, ...(order.promised_on ? { promised_on: order.promised_on } : {}) }, proposed: { lines, amount_cents: amount, ...(promised_on ? { promised_on } : {}) }, budget_impact_cents: amount - order.amount_cents, date_impact_days: days(order.promised_on, promised_on), status: 'pending', prepared_by: stamp(actor) }
}
