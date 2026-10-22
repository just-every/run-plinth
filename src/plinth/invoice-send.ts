import {portalEnabled} from './portal-policy'
import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { requireJobManager } from './auth'
import { company } from './company'
import { find, need, recordApproval, stamp, type Actor, type Input, type Job } from './model'
import { invoiceRows, type InvoiceDelivery } from './invoice-model'
import { jobOf, readClock, saveJob } from './store'
import { checkWarrantySend, recipientGuards } from './warranty-store'

/** One durable attempt for each immutable invoice. No retry is implicit in any provider outcome. */
export async function sendInvoice(env: Bindings, previous: Job, actor: Actor, id: string, input: Input, clock: number): Promise<Job> {
 requireJobManager(actor)
 need(input.confirm === true, 'Explicitly confirm sending this issued invoice to its current authorized recipient')
 const current = find(invoiceRows(previous), id)
 need(current.issued && current.status === 'issued', 'Issue the invoice before sending it', 409, 'invoice_state')
 need(!current.delivery, 'This invoice already has a reserved send attempt; inspect its outcome and contact the client separately', 409, 'invoice_send_reserved')
 const email = current.issued.recipient_email, guards = await recipientGuards(env.DB, previous, { kind: 'client', email })
 need(portalEnabled(previous,'client','billing')&&guards, 'The invoice recipient is no longer authorized', 403, 'recipient')
 const reserved = structuredClone(previous), row = find(invoiceRows(reserved), id)
 const delivery: InvoiceDelivery = { attempt_id: crypto.randomUUID(), status: 'unknown', label: 'Send reserved; provider outcome unknown. No automatic resend.', to: email, approved_by: stamp(actor) }
 row.delivery = delivery
 recordApproval(reserved, actor, 'invoice.send', row, { number: row.issued!.number, ...delivery })
 await saveJob(env.DB, actor, previous, reserved, guards, clock)
 try {
  const latest = await jobOf(env.DB, actor, previous.id), eligible = await recipientGuards(env.DB, latest, { kind: 'client', email })
  if (!eligible||!portalEnabled(latest,'client','billing')) { delivery.status = 'cancelled'; delivery.label = 'Recipient access changed; nothing was sent' }
  else {
   await checkWarrantySend(env.DB, latest, await readClock(env.DB), eligible, actor)
   const sender = operatorMail(env)
   if (!sender || !env.MAIL_FROM) { delivery.status = 'unconfigured'; delivery.label = 'Mail is not configured; nothing was sent' }
   else {
    const s = row.issued!, builder = (await company(env.DB))?.name ?? 'Your builder'
    const usd = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100)
    const text = `${builder}: invoice ${s.number} for ${s.job_name}\n${s.description}\nOriginal invoice payable: ${usd(s.payable_cents)}\nDue ${s.due_on} inclusive in ${s.time_zone}\nTerms: ${s.terms}\n\nOpen your signed-in Plinth client portal to inspect the immutable invoice and current receipt/deposit allocation ledger. Acknowledgment and mail delivery are separate from payment. Plinth does not move or independently verify funds.`
    const result = await sender.send({ deliveryId: delivery.attempt_id, from: env.MAIL_FROM, to: [email], headers: {}, subject: `Invoice ${s.number} from ${builder}: ${s.job_name}`, text, html: `<pre style="font-family:inherit;white-space:pre-wrap">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>` })
    if (result.status === 'accepted') { delivery.status = 'accepted'; delivery.label = 'Accepted by the mail provider; delivery is not confirmed'; if (result.providerMessageId) delivery.provider_message_id = result.providerMessageId }
    else if (result.status === 'development') { delivery.status = 'development'; delivery.label = 'Development mail suppressed; nothing was sent to the client' }
    else if (result.status === 'rejected' || result.status === 'rate_limited') { delivery.status = 'refused'; delivery.label = 'Provider refused the invoice email; no automatic resend' }
   }
  }
 } catch { /* Preserve the durable unknown outcome: provider acceptance may have occurred. */ }
 const latest = await jobOf(env.DB, actor, previous.id), outcome = structuredClone(latest), final = find(invoiceRows(outcome), id)
 need(final.delivery?.attempt_id === delivery.attempt_id, 'Invoice send history changed; reload before continuing', 409, 'conflict')
 final.delivery = structuredClone(delivery)
 recordApproval(outcome, actor, 'invoice.send_outcome', final, delivery)
 await saveJob(env.DB, actor, latest, outcome, [], await readClock(env.DB))
 return outcome
}
