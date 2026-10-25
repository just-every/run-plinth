import type { Bindings } from '../auth.server'
import { auditStatement, automation, jobRef } from './audit'
import { invoiceBalance } from './invoices'
import { invoiceRows, type InvoiceReceipt } from './invoice-model'
import { attemptColumns, settledLabel, type PaymentAttempt } from './pay-model'
import { stripeCall, verifyStripeSignature, type CheckoutSession, type PaymentIntent } from './pay-stripe'
import { DomainError, find, need, type Job, type Stamp } from './model'
import { readClock } from './store'
import { wallClock } from './time-zone'
import { loadWarrantyJob } from './warranty-store'

const noStore = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: noStore })
const runner = () => automation('stripe-events', 'Stripe signed events')
const MAX = 1024 * 1024
const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
interface StripeEvent { id: string; type: string; livemode: boolean; data: { object: CheckoutSession } }
const attemptOf = (db: D1Database, id: string) => db.prepare(`SELECT ${attemptColumns} FROM pl_payment_attempts WHERE id=?`).bind(id).first<PaymentAttempt>()
/** The one place a processor-settled payment becomes an invoice receipt: job version, clock, attempt, event receipt and audit commit in a single batch, so a retry can never double-credit. */
async function settle(env: Bindings, attempt: PaymentAttempt, session: CheckoutSession, event: StripeEvent, body: string) {
 need(session.payment_intent, 'The checkout has no payment to settle', 400, 'event_invalid')
 const intent = await stripeCall<PaymentIntent>(env, `/payment_intents/${session.payment_intent}?expand[]=latest_charge.balance_transaction`)
 need(intent.id === session.payment_intent && intent.status === 'succeeded' && intent.currency === 'usd' && intent.amount_received === attempt.amount_cents && intent.livemode === event.livemode, 'The processor payment does not match this instruction', 400, 'event_unauthorized')
 const charge = typeof intent.latest_charge === 'object' && intent.latest_charge ? intent.latest_charge : null, details = charge?.payment_method_details
 const method = details?.type ?? 'unknown', wallet = details?.card?.wallet?.type ?? null, bt = charge && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null, fee = typeof bt?.fee === 'number' ? bt.fee : null
 for (let n = 0; n < 3; n++) {
  const clock = await readClock(env.DB), previous = await loadWarrantyJob(env.DB, attempt.job_id), current = await attemptOf(env.DB, attempt.id)
  if (!previous || !current) throw new DomainError('payment_job_gone', 'The job or payment instruction no longer exists', 409)
  if (current.status === 'paid' || current.status === 'review') return
  const next = structuredClone(previous) as Job, invoice = find(invoiceRows(next), attempt.invoice_id), before = invoiceBalance(previous, find(invoiceRows(previous), attempt.invoice_id))
  const received_on = wallClock(Date.now(), next.time_zone ?? 'UTC').date, reference = intent.id
  need(!invoiceRows(next).some(i => i.receipts.some(r => r.reference === reference)), 'This processor payment is already recorded', 409, 'invoice_duplicate')
  const by: Stamp = { id: runner().id, name: runner().name, role: 'agent', at: new Date().toISOString() }
  const receipt: InvoiceReceipt = { id: crypto.randomUUID(), amount_cents: attempt.amount_cents, received_on, reference, method: 'stripe', recorded_by: by, label: settledLabel, processor: { name: 'stripe', attempt_id: attempt.id, checkout_session_id: session.id, payment_intent_id: intent.id, method, wallet, fee_cents: fee, livemode: intent.livemode } }
  invoice.receipts.push(receipt)
  const review = current.status !== 'open' && current.status !== 'processing' || attempt.amount_cents > before.due_cents
  next.version = previous.version + 1
  const data = JSON.stringify(next); need(data.length <= 8_000_000, 'Job history is too large')
  const label = review ? 'Paid, but the balance changed or this instruction was replaced; the office reviews this receipt' : 'Paid and recorded on the invoice'
  const at = new Date().toISOString()
  try {
   await env.DB.batch([
    env.DB.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_clock WHERE id=1 AND version=?) THEN 1 ELSE 0 END').bind(clock),
    env.DB.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(previous.id, previous.version),
    env.DB.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(next.version, data, next.id, previous.version),
    env.DB.prepare('UPDATE pl_payment_attempts SET status=?,label=?,payment_intent_id=?,method=?,wallet=?,fee_cents=?,livemode=?,receipt_id=?,updated_at=? WHERE id=?').bind(review ? 'review' : 'paid', label, intent.id, method, wallet, fee, intent.livemode ? 1 : 0, receipt.id, at, attempt.id),
    env.DB.prepare('INSERT INTO pl_payment_events(id,type,attempt_id,digest,received_at) VALUES(?,?,?,?,?)').bind(event.id, event.type, attempt.id, await digest(body), at),
    auditStatement(env.DB, runner(), { kind: 'financial', action: 'payments.stripe.receipt', subject_kind: 'payment', subject_id: attempt.id, job_id: next.id, version_before: previous.version, version_after: next.version, before_ref: await jobRef(JSON.stringify(previous)), after_ref: await jobRef(data), detail: { invoice_number: invoice.number, amount_cents: attempt.amount_cents, method, wallet, review } }),
    env.DB.prepare('UPDATE pl_clock SET version=version+1 WHERE id=1'), env.DB.prepare('DELETE FROM pl_guard'),
   ])
   return
  } catch (error) { if (!/CHECK constraint failed|UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(String(error))) throw error }
 }
 throw new DomainError('conflict', 'The job changed while recording the payment; Stripe will retry', 409)
}
async function record(env: Bindings, event: StripeEvent, body: string, attempt: PaymentAttempt | null, change?: { status: PaymentAttempt['status']; label: string; only: string[] }) {
 const at = new Date().toISOString(), writes = [env.DB.prepare('INSERT INTO pl_payment_events(id,type,attempt_id,digest,received_at) VALUES(?,?,?,?,?)').bind(event.id, event.type, attempt?.id ?? null, await digest(body), at)]
 if (attempt && change) writes.push(env.DB.prepare(`UPDATE pl_payment_attempts SET status=?,label=?,updated_at=? WHERE id=? AND status IN (${change.only.map(() => '?').join(',')})`).bind(change.status, change.label, at, attempt.id, ...change.only), auditStatement(env.DB, runner(), { kind: 'financial', action: `payments.stripe.${change.status}`, subject_kind: 'payment', subject_id: attempt.id, job_id: attempt.job_id }))
 await env.DB.batch(writes)
}
/** Public and signature-gated: Stripe's signed events for the builder's own endpoint. */
export async function stripeEvents(request: Request, env: Bindings): Promise<Response> {
 if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) return reply(503, { error: 'payments_unconfigured', message: 'Stripe events are not configured' })
 const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
 if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX) { await reader.cancel(); return reply(413, { error: 'too_large', message: 'Event body too large' }) } chunks.push(value) }
 const all = new Uint8Array(size); let at = 0; for (const c of chunks) { all.set(c, at); at += c.length }
 let body: string; try { body = new TextDecoder('utf-8', { fatal: true }).decode(all) } catch { return reply(400, { error: 'event_invalid', message: 'Unreadable event' }) }
 if (!await verifyStripeSignature(body, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET, Date.now())) return reply(400, { error: 'event_signature_invalid', message: 'The event signature is not valid' })
 let event: StripeEvent
 try { event = JSON.parse(body) as StripeEvent; need(typeof event.id === 'string' && event.id.length <= 255 && typeof event.type === 'string' && event.data?.object, 'invalid') } catch { return reply(400, { error: 'event_invalid', message: 'Unreadable event' }) }
 if (await env.DB.prepare('SELECT 1 AS seen FROM pl_payment_events WHERE id=?').bind(event.id).first()) return reply(200, { duplicate: true })
 if (!event.type.startsWith('checkout.session.')) { await record(env, event, body, null); return reply(200, { ignored: true }) }
 const session = event.data.object, id = session.client_reference_id ?? session.metadata?.plinth_attempt
 const attempt = typeof id === 'string' ? await attemptOf(env.DB, id) : null
 // The builder's Stripe account may carry other business: a session with no instruction here is not ours and is acknowledged untouched, so Stripe never disables the endpoint over it.
 if (!attempt) return reply(200, { ignored: true })
 // The signature proves Stripe sent it; only this installation's own instruction, session, amount and mode make it ours.
 if (attempt.session_id !== session.id || session.currency !== 'usd' || session.amount_total !== attempt.amount_cents || (attempt.livemode === 1) !== !!event.livemode) return reply(400, { error: 'event_unauthorized', message: 'The event does not match a payment instruction of this installation' })
 try {
  if (event.type === 'checkout.session.completed' && session.payment_status === 'paid' || event.type === 'checkout.session.async_payment_succeeded') await settle(env, attempt, session, event, body)
  else if (event.type === 'checkout.session.completed') await record(env, event, body, attempt, { status: 'processing', label: 'Bank payment processing; the invoice is credited only when the processor confirms it', only: ['open'] })
  else if (event.type === 'checkout.session.async_payment_failed') await record(env, event, body, attempt, { status: 'failed', label: 'The bank payment failed; nothing was credited to the invoice', only: ['open', 'processing'] })
  else if (event.type === 'checkout.session.expired') await record(env, event, body, attempt, { status: 'expired', label: 'The checkout expired unpaid', only: ['open'] })
  else await record(env, event, body, attempt)
 } catch (error) {
  if (error instanceof DomainError && error.status < 500 && error.code !== 'conflict' && error.code !== 'payment_provider') return reply(error.status, { error: error.code, message: error.message })
  throw error
 }
 return reply(200, { received: true })
}
