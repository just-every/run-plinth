import type { Bindings } from '../auth.server'
import { attempts, paymentsEnabled, shown, startCheckout } from './pay-checkout'
import { stripeEvents } from './pay-events'
import { feeStatement } from './pay-model'
import { need, type Actor, type Input, type Job } from './model'

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
/** The job's payment instructions. A client lists and starts only their own; the office reads every attempt with its processor references and fee. */
export async function jobPayResponse(request: Request, env: Bindings, actor: Actor, job: Job, parts: string[], body: (r: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[2] !== 'payments') return null
 need(actor.role !== 'agent', 'A person reads job payments', 403, 'human_required')
 need(parts.length === 3, 'Unknown payments route', 404, 'not_found')
 if (request.method === 'GET') return json({ enabled: paymentsEnabled(env), statement: feeStatement, attempts: shown(await attempts(env.DB, job.id, actor), actor) })
 if (request.method === 'POST') return json(await startCheckout(env, actor, job, await body(request)), 201)
 need(false, 'Method not allowed', 405, 'method_not_allowed')
}
export async function payPublicResponse(request: Request, env: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (path !== '/api/plinth/payments/stripe/events') return null
 if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, allow: 'POST' } })
 return stripeEvents(request, env)
}
