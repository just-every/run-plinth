import type { Bindings } from '../auth.server'
import { attemptColumns, type PaymentAttempt } from './pay-model'
import { applyPaymentFact, paymentAttempt, paymentFact } from './pay-reconcile'
import { stripeCall, verifyStripeSignature, type CheckoutSession, type StripeCharge, type StripeDispute, type StripeRefund } from './pay-stripe'
import { DomainError, need } from './model'

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
const reply = (status: number, body: unknown) => Response.json(body, { status, headers })
const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
interface StripeEvent { id: string; type: string; livemode: boolean; data: { object: CheckoutSession & StripeCharge & StripeRefund & StripeDispute } }
/** A signed event is a reconciliation trigger. Money always follows Stripe's current records. */
export async function stripeEvents(request: Request, env: Bindings): Promise<Response> {
 if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) return reply(503, { error: 'payments_unconfigured', message: 'Stripe events are not configured' })
 const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
 if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) { await reader.cancel(); return reply(413, { error: 'too_large' }) } chunks.push(value) }
 const all = new Uint8Array(size); let at = 0; for (const c of chunks) { all.set(c, at); at += c.length }
 let body: string; try { body = new TextDecoder('utf-8', { fatal: true }).decode(all) } catch { return reply(400, { error: 'event_invalid' }) }
 if (!await verifyStripeSignature(body, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET, Date.now())) return reply(400, { error: 'event_signature_invalid' })
 let event: StripeEvent
 try { event = JSON.parse(body); need(typeof event.id === 'string' && event.id.length <= 255 && typeof event.type === 'string' && typeof event.livemode === 'boolean' && event.data?.object, 'invalid') } catch { return reply(400, { error: 'event_invalid' }) }
 if (await env.DB.prepare('SELECT 1 FROM pl_payment_events WHERE id=?').bind(event.id).first()) return reply(200, { duplicate: true })
 try {
  const object = event.data.object, checkout = event.type.startsWith('checkout.session.')
  let attempt: PaymentAttempt | null = null
  if (checkout) {
   const id = object.client_reference_id ?? object.metadata?.plinth_attempt
   attempt = typeof id === 'string' ? await paymentAttempt(env.DB, id) : null
  } else if (/^(charge\.|refund\.|payment_intent\.)/.test(event.type)) {
   const pi = event.type.startsWith('payment_intent.') ? object.id : object.payment_intent
   if (pi) attempt = await env.DB.prepare(`SELECT ${attemptColumns} FROM pl_payment_attempts WHERE payment_intent_id=?`).bind(pi).first<PaymentAttempt>()
   if (!attempt && object.metadata?.plinth_attempt) attempt = await paymentAttempt(env.DB, object.metadata.plinth_attempt)
  }
  if (!attempt) return reply(200, { ignored: true })
  need((attempt.livemode === 1) === event.livemode, 'Wrong event mode', 400, 'event_unauthorized')
  if (checkout) need(attempt.session_id === object.id && object.currency === 'usd' && object.amount_total === attempt.amount_cents, 'The event does not match this payment instruction', 400, 'event_unauthorized')
  // A charge or dispute before the Checkout completion still resolves via the own hosted session.
  const session = checkout ? object : await stripeCall<CheckoutSession>(env, `/checkout/sessions/${encodeURIComponent(attempt.session_id!)}`)
  need(session.id === attempt.session_id, 'Wrong processor session', 400, 'event_unauthorized')
  const fact = await paymentFact(env, attempt, session)
  // Unpaid Checkout completion can arrive before the bank intent exists at the edge.
  if (checkout && !session.payment_intent && event.type === 'checkout.session.completed' && session.payment_status !== 'paid') fact.state = 'processing'
  if (checkout && !session.payment_intent && event.type === 'checkout.session.async_payment_failed') fact.state = 'failed'
  if (checkout && !session.payment_intent && event.type === 'checkout.session.expired') fact.state = 'canceled'
  await applyPaymentFact(env, attempt.id, fact, { id: event.id, type: event.type, digest: await digest(body) })
  return reply(200, { received: true })
 } catch (error) {
  if (error instanceof DomainError) return reply(error.status, { error: error.code, message: error.message })
  throw error
 }
}
