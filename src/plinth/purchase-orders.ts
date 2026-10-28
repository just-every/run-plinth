import { requireJobManager } from './auth'
import { cents, find, need, recordApproval, stamp, text, type Actor, type Input, type Job, type Order } from './model'
import { amendment, day, fulfillment, lineQuantities, poSource } from './purchase-order-model'

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const issued = (job: Job, id: string) => { const row = find(job.orders, id); need(row.status === 'issued', 'Only an issued, open PO records fulfillment', 409, 'order_state'); return row }
const log = (job: Job, actor: Actor, kind: string, row: Order, snapshot: unknown) => recordApproval(job, actor, `purchase_order.${kind}`, { id: row.id, prepared_by: row.prepared_by }, snapshot)
/** Staff record what the vendor said or did, with its source; Plinth never claims it contacted the vendor. */
export function orderAction(job: Job, actor: Actor, id: string, action: string, input: Input, inventoryReturn = false): Order {
 requireJobManager(actor, action === 'amend')
 const row = action === 'cancel' ? find(job.orders, id) : issued(job, id)
 switch (action) {
  case 'acknowledge': {
   need(!row.acknowledgment, 'This PO is already acknowledged', 409, 'immutable')
   row.acknowledgment = { acknowledged_on: day(input.acknowledged_on, 'acknowledgment date'), by_name: text(input.by_name, 'vendor contact name', 200), reference: text(input.reference, 'acknowledgment source', 300), recorded_by: stamp(actor) }
   if (input.promised_on !== undefined) promise(row, actor, day(input.promised_on, 'promised date'), 'Promised in the vendor acknowledgment')
   log(job, actor, 'acknowledge', row, row.acknowledgment); break
  }
  case 'promise': promise(row, actor, day(input.promised_on, 'promised date'), text(input.reason, 'reason for the new date', 1000)); log(job, actor, 'promise', row, row.promise_history!.at(-1)); break
  case 'ship': {
   const shipment = { id: crypto.randomUUID(), carrier: text(input.carrier, 'carrier', 200), tracking: text(input.tracking, 'tracking number', 200), freight_cents: cents(input.freight_cents ?? 0, 'freight_cents'), shipped_on: day(input.shipped_on, 'ship date'), recorded_by: stamp(actor) }
   ;(row.shipments ??= []).push(shipment); log(job, actor, 'ship', row, shipment); break
  }
  case 'return': {
   need(inventoryReturn || !job.site_inventory?.lots.some(l=>l.order_id===row.id), 'Use the inventory return door for located stock',409,'inventory_return')
   const quantities = lineQuantities(row, input.lines, 'return'), back = { id: crypto.randomUUID(), ...quantities, reason: text(input.reason, 'return reason', 1000), reference: text(input.reference, 'return reference', 300), recorded_by: stamp(actor) }
   ;(row.returns ??= []).push(back); log(job, actor, 'return', row, back); break
  }
  case 'cancel': {
   need(row.status !== 'cancelled', 'This PO is already cancelled', 409, 'immutable')
   const kept = row.status === 'draft' ? 0 : fulfillment(row).received_cents
   row.cancelled = { reason: text(input.reason, 'cancellation reason', 1000), released_cents: row.amount_cents - kept, by: stamp(actor) }
   row.amount_cents = kept; row.status = 'cancelled'; log(job, actor, 'cancel', row, row.cancelled); break
  }
  case 'amend': (row.amendments ??= []).push(amendment(row, input, actor, job)); break
  case 'approve-amendment': {
   const pending = row.amendments?.find(a => a.status === 'pending'); need(pending, 'No amendment awaits approval', 409, 'amendment_state')
   need(actor.role !== 'agent', 'Agents prepare drafts; a person must approve', 403, 'human_required')
   // The reviewer restates the budget and date impact; a different figure means they reviewed something else.
   need(cents(input.budget_impact_cents, 'budget_impact_cents', true) === pending.budget_impact_cents && input.date_impact_days === pending.date_impact_days, 'Review the budget and date impact shown on the amendment', 409, 'impact_unreviewed', { budget_impact_cents: pending.budget_impact_cents, date_impact_days: pending.date_impact_days })
   need(!actor.team || pending.proposed.amount_cents <= actor.team.po_limit_cents, 'This amendment is above your approval limit; ask the owner or an administrator', 403, 'over_limit')
   if (row.source) poSource(job, { source: row.source }, pending.proposed.lines, row.id)
   recordApproval(job, actor, 'purchase_order.amendment', { id: pending.id, prepared_by: pending.prepared_by, revision: pending.revision }, pending)
   pending.status = 'approved'; pending.approved_by = stamp(actor); row.lines = pending.proposed.lines; row.amount_cents = pending.proposed.amount_cents
   if (pending.proposed.promised_on && pending.proposed.promised_on !== row.promised_on) promise(row, actor, pending.proposed.promised_on, `Amendment ${pending.revision}`)
   break
  }
  default: need(false, 'Unknown action', 404, 'not_found')
 }
 return row
}
function promise(row: Order, actor: Actor, to: string, reason: string) { (row.promise_history ??= []).push({ ...(row.promised_on ? { from: row.promised_on } : {}), to, reason, recorded_by: stamp(actor) }); row.promised_on = to }
/** Office reads: the PO with its reconciled fulfillment, and the approved document prepared for the vendor. */
export function orderResponse(job: Job, actor: Actor, id: string, document: boolean): Response {
 requireJobManager(actor, true); const row = find(job.orders, id)
 if (!document) return Response.json({ order: row, fulfillment: fulfillment(row) }, { headers })
 need(row.status !== 'draft' && row.delivery, 'Issue the PO before preparing its vendor document', 409, 'order_state')
 const approved = job.approvals.filter(a => a.subject_id === row.id && a.kind === 'purchase_order').at(-1)
 return Response.json({ format: 'plinth-purchase-order-v1', delivery: row.delivery, job: { id: job.id, name: job.name, address: job.address }, order: { id: row.id, supplier: row.supplier, description: row.description, lines: row.lines ?? [], amount_cents: row.amount_cents, promised_on: row.promised_on, status: row.status, amendments: (row.amendments ?? []).filter(a => a.status === 'approved').map(a => ({ revision: a.revision, reason: a.reason, amount_cents: a.proposed.amount_cents })) }, approved_by: approved?.approved_by }, { headers: { ...headers, 'content-disposition': `attachment; filename=po-${row.id.slice(0, 8)}.json`, 'x-plinth-delivery': row.delivery.label } })
}
