import type { Bindings } from '../auth.server'
import { attempts, paymentsEnabled, shown, startCheckout } from './pay-checkout'
import { stripeEvents } from './pay-events'
import { requireManager } from './auth'
import { paymentAttempt, reconcilePayment } from './pay-reconcile'
import { refundPayment } from './pay-refunds'
import { feeStatement } from './pay-model'
import { need, type Actor, type Input, type Job } from './model'

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
/** The job's payment instructions. A client lists and starts only their own; the office reads every attempt with its processor references and fee. */
export async function jobPayResponse(request: Request, env: Bindings, actor: Actor, job: Job, parts: string[], body: (r: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[2] !== 'payments') return null
 need(actor.role !== 'agent', 'A person reads job payments', 403, 'human_required')
 if (parts.length === 5 && request.method === 'POST' && ['reconcile', 'refund'].includes(parts[4])) {
  requireManager(actor)
  const attempt = await paymentAttempt(env.DB, parts[3]); need(attempt && attempt.job_id === job.id, 'Payment not found', 404, 'not_found')
  if (parts[4] === 'refund') return json(await refundPayment(request, env, actor, job, attempt.id, await body(request)))
  return json({ attempt: await reconcilePayment(env, attempt) })
 }
 need(parts.length === 3, 'Unknown payments route', 404, 'not_found')
 if (request.method === 'GET') return json({ enabled: paymentsEnabled(env), statement: feeStatement, attempts: shown(await attempts(env.DB, job.id, actor), actor), ...(actor.role === 'owner' || actor.role === 'admin' ? { refunds: (await env.DB.prepare('SELECT r.id,r.attempt_id,r.amount_cents,r.status,r.provider_id,r.created_at FROM pl_payment_refunds r JOIN pl_payment_attempts a ON a.id=r.attempt_id WHERE a.job_id=? ORDER BY r.created_at').bind(job.id).all()).results } : {}) })
 if (request.method === 'POST') return json(await startCheckout(env, actor, job, await body(request)), 201)
 need(false, 'Method not allowed', 405, 'method_not_allowed')
}
export async function payPublicResponse(request: Request, env: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (path !== '/api/plinth/payments/stripe/events') return null
 if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, allow: 'POST' } })
 return stripeEvents(request, env)
}
