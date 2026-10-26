import type { Bindings } from '../auth.server'
import { jobRef } from './audit'
import { actorPredicate, authorize, requireManager } from './auth'
import { invoiceBalance } from './invoices'
import { invoiceRows } from './invoice-model'
import { applyPaymentFact, paymentAttempt, paymentFact } from './pay-reconcile'
import { stripeCall, type StripeRefund } from './pay-stripe'
import { refundPosting } from './refund-posting'
import { cents, find, need, text, type Actor, type Input, type Job } from './model'
import { jobOf, readClock, transaction } from './store'

interface RefundInstruction { id: string; attempt_id: string; amount_cents: number; reason: string; created_by: string; status: string; provider_id: string | null; created_at: string }
/** A refund consumes an issued credit and confirmed funds, with a durable reservation before the provider call. */
export async function refundPayment(request: Request, env: Bindings, actor: Actor, job: Job, id: string, input: Input) {
 requireManager(actor)
 need(input.confirm === true, 'Explicitly approve this exact processor refund')
 const operation = text(input.operation_id, 'operation_id', 100), amount = cents(input.amount_cents), reason = text(input.reason, 'Refund reason', 2000)
 need(/^[a-zA-Z0-9-]{8,100}$/.test(operation) && amount > 0, 'Choose a unique operation id and positive refund amount')
 const prior = await env.DB.prepare('SELECT * FROM pl_payment_refunds WHERE id=?').bind(operation).first<RefundInstruction>()
 let attempt = await paymentAttempt(env.DB, id)
 need(attempt && attempt.job_id === job.id, 'Payment not found', 404, 'not_found')
 if (prior) {
  need(prior.attempt_id === id && prior.amount_cents === amount && prior.reason === reason, 'Refund operation already names a different instruction', 409, 'refund_conflict')
  if (prior.status === 'unresolved') {
   const list = await stripeCall<{data: StripeRefund[]}>(env, `/refunds?payment_intent=${encodeURIComponent(attempt.payment_intent_id!)}&limit=100`)
   const found = list.data.find(r => r.metadata?.plinth_refund === operation)
   need(found, 'Refund instruction remains unresolved; no second refund was sent', 409, 'refund_unresolved')
  }
  await applyPaymentFact(env, id, await paymentFact(env, attempt))
  return { refund: await env.DB.prepare('SELECT id,amount_cents,status,provider_id FROM pl_payment_refunds WHERE id=?').bind(operation).first(), reused: true }
 }
 need(input.expected_version === job.version, 'Job changed; review this refund again', 409, 'stale_version')
 const fact = await paymentFact(env, attempt)
 need(fact.intent?.status === 'succeeded' && fact.state !== 'disputed' && fact.state !== 'ach_returned' && amount <= attempt.amount_cents - fact.reversed, 'Refund exceeds available settled funds or payment is disputed', 409, 'refund_funds')
 // Reauthenticate after the provider read; a revoked session cannot authorize outbound money.
 actor = await authorize(request, env); requireManager(actor)
 const clock = await readClock(env.DB), currentJob = await jobOf(env.DB, actor, job.id)
 need(currentJob.version === input.expected_version, 'Job changed; review the refund again', 409, 'stale_version')
 attempt = (await paymentAttempt(env.DB, id))!
 const invoice = find(invoiceRows(currentJob), attempt.invoice_id), pending = await env.DB.prepare("SELECT COALESCE(SUM(r.amount_cents),0) AS amount,COALESCE(SUM(CASE WHEN r.attempt_id=? THEN r.amount_cents ELSE 0 END),0) AS reserved_funds FROM pl_payment_refunds r JOIN pl_payment_attempts a ON a.id=r.attempt_id WHERE a.invoice_id=? AND r.status IN ('unresolved','pending','requires_action')").bind(id,invoice.id).first<{amount: number;reserved_funds:number}>()
 need(amount <= attempt.amount_cents - fact.reversed - (pending?.reserved_funds ?? 0), 'Pending refund instructions already reserve these settled funds', 409, 'refund_funds')
 need(amount <= -invoiceBalance(currentJob, invoice).due_cents - (pending?.amount ?? 0), 'Issue a linked credit before refunding; the refund cannot exceed available customer credit', 409, 'refund_credit')
 const posting = refundPosting(currentJob, actor, input)
 await transaction(env.DB, actor, currentJob, [env.DB.prepare("INSERT INTO pl_payment_refunds(id,attempt_id,amount_cents,reason,created_by,status,created_at,posting_json) VALUES(?,?,?,?,?,'unresolved',?,?)").bind(operation, id, amount, reason, actor.id, new Date().toISOString(), JSON.stringify(posting))], clock, {kind:'financial',action:'payments.refund.approve',subject_kind:'payment',subject_id:id,job_id:job.id,version_before:currentJob.version,version_after:currentJob.version,before_ref:await jobRef(JSON.stringify(currentJob)),after_ref:await jobRef(JSON.stringify(currentJob)),detail:{operation_id:operation,amount_cents:amount,invoice_id:invoice.id,invoice_number:invoice.number,payment_intent_id:fact.intent.id,original_receipt_id:attempt.receipt_id}})
 const authority = actorPredicate(actor)
 need((await jobOf(env.DB,actor,job.id)).version === input.expected_version, 'Refund credit changed before the provider instruction', 409, 'stale_version')
 need(await env.DB.prepare(`SELECT 1 WHERE ${authority.sql}`).bind(...authority.params).first(), 'Refund authority changed', 403, 'forbidden')
 const refund = await stripeCall<StripeRefund>(env, '/refunds', {idempotencyKey:`plinth-refund-${id}-${operation}`,body:{payment_intent:fact.intent.id,amount,metadata:{plinth_refund:operation,plinth_attempt:id}}})
 need(refund.id && refund.amount === amount && refund.payment_intent === fact.intent.id, 'Processor refund response did not match the instruction; reconcile it', 502, 'refund_unresolved')
 await applyPaymentFact(env, id, await paymentFact(env, attempt))
 return { refund: {id:operation,amount_cents:amount,status:refund.status,provider_id:refund.id}, reused:false }
}
