import type { Bindings } from '../auth.server'
import { company } from './company'
import { invoiceBalance } from './invoices'
import { invoiceRows } from './invoice-model'
import { clientAccess } from './job-customers'
import { authorization, attemptColumns, clientAttempt, feeStatement, type PaymentAttempt } from './pay-model'
import { stripeCall, type CheckoutSession } from './pay-stripe'
import { portalEnabled } from './portal-policy'
import { currencyOf, DomainError, find, need, type Actor, type Input, type Job } from './model'
import { readClock, transaction } from './store'

export const paymentsEnabled = (env: Bindings) => !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET
const HOUR = 3_600_000
export async function attempts(db: D1Database, jobId: string, actor: Actor): Promise<PaymentAttempt[]> {
 const client = actor.role === 'member'
 const rows = await db.prepare(`SELECT ${attemptColumns} FROM pl_payment_attempts WHERE job_id=?${client ? ' AND lower(client_email)=?' : ''} ORDER BY created_at DESC,rowid DESC`).bind(...(client ? [jobId, actor.email.toLowerCase()] : [jobId])).all<PaymentAttempt>()
 return rows.results
}
export const shown = (rows: PaymentAttempt[], actor: Actor) => actor.role === 'member' ? rows.map(clientAttempt) : rows
/** A client pays one issued USD invoice's current balance. The instruction is durable before Stripe is called, one is open per invoice, and a repeat returns the same hosted page. */
export async function startCheckout(env: Bindings, actor: Actor, job: Job, input: Input) {
 need(actor.role === 'member' && await clientAccess(env.DB, job, actor.email), 'Only the client pays an invoice here', 403, 'forbidden')
 need(portalEnabled(job, 'client', 'billing'), 'Billing is not available for this job', 404, 'not_found')
 need(paymentsEnabled(env), 'Online payment is not set up for this builder', 409, 'payments_unconfigured')
 need(currencyOf(job) === 'USD', 'Only USD invoices are paid online', 409, 'payment_currency')
 const invoice = find(invoiceRows(job), String(input.invoice_id)), balance = invoiceBalance(job, invoice)
 need(invoice.issued && invoice.status === 'issued', 'Only an issued invoice can be paid', 409, 'invoice_state')
 need(balance.due_cents > 0, 'This invoice has no balance due', 409, 'invoice_paid')
 need(input.confirm === true, 'Confirm the payment authorization shown before leaving for Stripe')
 const email = actor.email.toLowerCase(), now = Date.now()
 const open = await env.DB.prepare(`SELECT ${attemptColumns} FROM pl_payment_attempts WHERE invoice_id=? AND status IN ('open','processing')`).bind(invoice.id).first<PaymentAttempt>()
 if (open?.status === 'processing') throw new DomainError('payment_processing', 'A bank payment for this invoice is still processing; wait for the processor to confirm it', 409)
 if (open && open.client_email.toLowerCase() === email && open.amount_cents === balance.due_cents && open.checkout_url && now - Date.parse(open.created_at) < 23 * HOUR) return { attempt: clientAttempt(open), url: open.checkout_url, reused: true }
 if (open) await env.DB.prepare("UPDATE pl_payment_attempts SET status='expired',label=?,updated_at=? WHERE id=? AND status='open'").bind('Replaced by a newer payment instruction', new Date(now).toISOString(), open.id).run()
 if (open && open.session_id) await stripeCall(env, `/checkout/sessions/${open.session_id}/expire`, { body: {} }).catch(() => undefined)
 const id = crypto.randomUUID(), at = new Date(now).toISOString(), builder = (await company(env.DB))?.name ?? 'Your builder', snapshot = invoice.issued
 const label = authorization(balance.due_cents, snapshot.number, builder)
 await transaction(env.DB, actor, null, [env.DB.prepare("INSERT INTO pl_payment_attempts(id,job_id,invoice_id,amount_cents,currency,status,label,client_email,created_by,created_at,updated_at) VALUES(?,?,?,?,'usd','open',?,?,?,?,?)").bind(id, job.id, invoice.id, balance.due_cents, label, email, actor.id, at, at)], await readClock(env.DB), { kind: 'financial', action: 'payments.checkout', subject_kind: 'payment', subject_id: id, job_id: job.id, detail: { invoice_number: snapshot.number, amount_cents: balance.due_cents } })
 let session: CheckoutSession
 try {
  const origin = env.AUTH_ORIGIN, meta = { plinth_attempt: id, plinth_invoice: invoice.id, plinth_job: job.id }
  session = await stripeCall<CheckoutSession>(env, '/checkout/sessions', { idempotencyKey: `plinth-checkout-${id}`, body: {
   mode: 'payment', payment_method_types: ['card', 'us_bank_account'], client_reference_id: id, customer_email: email, metadata: meta, payment_intent_data: { metadata: meta, description: `Invoice ${snapshot.number}: ${job.name}` },
   line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: balance.due_cents, product_data: { name: `Invoice ${snapshot.number}: ${job.name}`, description: `${builder}. ${snapshot.description}`.slice(0, 500) } } }],
   success_url: `${origin}/app?job=${job.id}&tab=Billing&paid=${id}`, cancel_url: `${origin}/app?job=${job.id}&tab=Billing&canceled=${id}`, expires_at: Math.floor(now / 1000) + 23 * 3600,
  } })
  need(session.id && session.url, 'Stripe did not return a checkout page', 502, 'payment_provider')
 } catch (error) {
  await env.DB.prepare("UPDATE pl_payment_attempts SET status='failed',label=?,updated_at=? WHERE id=? AND status='open'").bind('Stripe did not create the checkout page; nothing was charged', new Date().toISOString(), id).run()
  throw error
 }
 await env.DB.prepare('UPDATE pl_payment_attempts SET session_id=?,checkout_url=?,livemode=? WHERE id=?').bind(session.id, session.url, session.livemode ? 1 : 0, id).run()
 return { attempt: clientAttempt({ ...(await env.DB.prepare(`SELECT ${attemptColumns} FROM pl_payment_attempts WHERE id=?`).bind(id).first<PaymentAttempt>())! }), url: session.url, reused: false, statement: feeStatement }
}
