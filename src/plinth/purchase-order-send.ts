import { selected } from './selection-model'
import { operatorMail } from '../mail.server.mjs'
import type { Bindings } from '../auth.server'
import { requireJobManager } from './auth'
import { company } from './company'
import { find, need, recordApproval, stamp, type Actor, type Input, type Job, type Order } from './model'
import { jobOf, readClock, saveJob } from './store'

export type DeliveryStatus = 'prepared' | 'sending' | 'accepted' | 'refused' | 'uncertain' | 'development'
export interface PoDelivery { status: DeliveryStatus; label: string; to?: string; prepared_at: string; revision?: number; attempt_id?: string; provider_message_id?: string; sent_by?: ReturnType<typeof stamp> }
export const UNCONFIGURED = 'Prepared, not sent: Plinth has no vendor mail connection yet' as const
/** The approved revision: 1 at issue, plus each approved amendment. */
export const revisionOf = (row: Order) => 1 + (row.amendments ?? []).filter(a => a.status === 'approved').length
const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
function message(job: Job, row: Order, from: string, replyTo: string, builder: string, attempt: string) {
 const lines = (row.lines ?? []).map(l => `- ${l.cost_code} ${l.description}: ${l.quantity} ${l.unit} at ${usd(l.unit_cents)} = ${usd(l.total_cents)}`)
 const text = [`${builder} has approved this purchase order for ${job.name}${job.address ? `, ${job.address}` : ''}.`, '', `Supplier: ${row.supplier}`, `Order: ${row.description}`, ...lines, `Total: ${usd(row.amount_cents)}`, ...(row.promised_on ? [`Requested delivery: ${row.promised_on}`] : []), '', `Please reply to ${replyTo} to acknowledge this order with your promised delivery date.`].join('\n')
 const html = `<pre style="font-family:inherit;white-space:pre-wrap">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`
 return { deliveryId: attempt, from, to: [row.vendor_email!], replyTo, subject: `Purchase order ${row.id.slice(0, 8)} (revision ${revisionOf(row)}) from ${builder}: ${job.name}`, text, html, headers: {} }
}
/** One claimed send per approved revision: the attempt is reserved in a committed write before the provider is called, and its outcome is recorded honestly. */
export async function sendOrder(env: Bindings, previous: Job, actor: Actor, id: string, input: Input, clock: number) {
 requireJobManager(actor); need(actor.role !== 'agent', 'Agents prepare drafts; a person sends the PO', 403, 'human_required')
 const current = find(previous.orders, id), delivery = current.delivery as PoDelivery | undefined
 need(current.status === 'issued' && delivery, 'Issue the PO before sending it', 409, 'order_state')
 need(current.vendor_email, 'Add the vendor email to the PO before sending it', 409, 'vendor_email')
 if(current.source?.kind==='selection')selected(previous,current.source.selection_id,current.source.revision_id)
 const revision = revisionOf(current), sender = operatorMail(env), from = env.MAIL_FROM
 need(sender && from, `${UNCONFIGURED}; download the PO and send it yourself`, 409, 'mail_unconfigured')
 need(!(delivery.status === 'accepted' && delivery.revision === revision), 'This revision was already accepted by the mail provider', 409, 'already_sent')
 need(!['sending', 'uncertain'].includes(delivery.status) || input.vendor_not_received === true, 'The last send has an unknown outcome; confirm with the vendor that it did not arrive before sending again', 409, 'send_uncertain')
 const reserved = structuredClone(previous), row = find(reserved.orders, id), attempt = crypto.randomUUID()
 row.delivery = { ...delivery, status: 'sending', label: `Sending to ${current.vendor_email}; outcome not yet known`, to: current.vendor_email, revision, attempt_id: attempt, sent_by: stamp(actor) } as PoDelivery as Order['delivery']
 await saveJob(env.DB, actor, previous, reserved, [], clock)
 let status: DeliveryStatus = 'uncertain', label = 'Send outcome unknown: check with the vendor before sending again', providerId: string | undefined
 try {
  const result = await sender.send(message(reserved, row, from, actor.email, (await company(env.DB))?.name ?? 'Your builder', attempt))
  if (result.status === 'accepted') { status = 'accepted'; label = `Accepted by the mail provider for ${current.vendor_email}; delivery not confirmed`; providerId = result.providerMessageId ?? undefined }
  else if (result.status === 'development') { status = 'development'; label = 'Development mail: not sent to the vendor' }
  else if (result.status === 'rejected' || result.status === 'rate_limited') { status = 'refused'; label = `Not sent: the mail provider refused it${result.code ? ` (${result.code})` : ''}` }
 } catch { /* uncertain: the provider may or may not have taken it */ }
 // Record the outcome on the latest job version; another write may have landed while the provider answered.
 const latest = await jobOf(env.DB, actor, previous.id), outcome = structuredClone(latest), final = find(outcome.orders, id)
 need((final.delivery as PoDelivery | undefined)?.attempt_id === attempt, 'The PO changed while sending; reload it', 409, 'conflict')
 final.delivery = { ...(row.delivery as PoDelivery), status, label, ...(providerId ? { provider_message_id: providerId } : {}) } as PoDelivery as Order['delivery']
 recordApproval(outcome, actor, 'purchase_order.send', { id: final.id, prepared_by: final.prepared_by, revision }, { to: current.vendor_email, revision, status, label })
 await saveJob(env.DB, actor, latest, outcome, [], await readClock(env.DB))
 return outcome
}
