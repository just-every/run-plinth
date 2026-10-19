import { cents, find, need, object, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'
import { day, fulfillment } from './purchase-order-model'

export interface SelectionOption { id: string; name: string; specifications: string; supplier: string; price_cents: number }
export interface SelectionRevision { id: string; revision: number; room: string; category: string; allowance_cents: number; cost_code: string; decision_on: string; lead_days: number; options: SelectionOption[]; procurement?: ReturnType<typeof selectionTracker>; status: 'draft' | 'presented' | 'signed'; prepared_by: Stamp; presented_by?: Stamp; signature?: { option: SelectionOption; by: Stamp; statement: string } }
export interface Selection { id: string; revisions: SelectionRevision[]; comments: { id: string; revision_id: string; text: string; by: Stamp }[] }

export function selectionRevision(input: Input, actor: Actor, revision: number): SelectionRevision {
 need(Array.isArray(input.options) && input.options.length > 0 && input.options.length <= 30, 'Provide one to 30 priced options')
 const options = input.options.map(value => { const o = object(value); return { id: crypto.randomUUID(), name: text(o.name, 'option name', 200), specifications: text(o.specifications, 'specifications', 4000), supplier: text(o.supplier, 'supplier', 200), price_cents: cents(o.price_cents, 'option price') } })
 const lead_days = input.lead_days; need(typeof lead_days === 'number' && Number.isInteger(lead_days) && lead_days >= 0 && lead_days <= 3650, 'Lead time must be zero to 3650 calendar days')
 return { id: crypto.randomUUID(), revision, room: text(input.room, 'room', 200), category: text(input.category, 'category', 200), allowance_cents: cents(input.allowance_cents, 'allowance'), cost_code: text(input.cost_code, 'cost code', 40), decision_on: day(input.decision_on, 'decision date'), lead_days, options, status: 'draft', prepared_by: stamp(actor) }
}
export function selected(job: Job, selectionId: string, revisionId: string) {
 const selection = find(job.selections ?? [], selectionId), revision = find(selection.revisions, revisionId)
 need(revision.status === 'signed' && revision.signature, 'The selection needs a client signature before ordering', 409, 'selection_unsigned')
 return { selection, revision, option: revision.signature.option }
}
/** Client tracker exposes only the chosen selection's fulfillment facts, never the office PO. */
export function selectionTracker(job: Job, selectionId: string, revisionId: string) {
 return job.orders.filter(o => o.source?.kind === 'selection' && o.source.selection_id === selectionId && o.source.revision_id === revisionId && o.status !== 'draft').map(o => {
  const f = fulfillment(o)
  return { order_id: o.id, delivery_status: f.delivery_status, promised_on: o.promised_on, quantities: f.lines.map(l => ({ ordered: l.ordered, received: l.received, returned: l.returned, outstanding: l.outstanding })) }
 })
}
export function clientSelections(job: Job): Selection[] {
 return (job.selections ?? []).map(s => ({ ...s, revisions: s.revisions.filter(r => r.status !== 'draft').map(r => { const { cost_code, ...visible } = r; return visible as SelectionRevision }), comments: s.comments.filter(c => s.revisions.some(r => r.id === c.revision_id && r.status !== 'draft')) })).filter(s => s.revisions.length > 0)
}
