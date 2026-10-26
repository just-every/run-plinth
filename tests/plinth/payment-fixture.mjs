import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createFixture } from './helpers.mjs'

const SECRET = 'synthetic-plinth-webhook-secret-1'
/** Stripe at the network edge: hosted checkout sessions and the processor's own record of each payment. */
export function stripeEdge() {
 const edge = { sessions: [], intents: new Map(), disputes: [], refunds: [], refundKeys: [], loseResponse: false, refundStatus: 'succeeded', loseRefundResponse: false, calls: [], handler: async request => {
  const url = new URL(request.url); edge.calls.push(`${request.method} ${url.pathname}`)
  if (request.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
   const form = new URLSearchParams(await request.text()), id = `cs_synthetic_${edge.sessions.length + 1}`
   edge.sessions.push({ id, form, key: request.headers.get('idempotency-key'), payment_status: 'unpaid', status: 'open', livemode: false })
   edge.onCheckout?.();if(edge.holdCheckout)await edge.holdCheckout
   if (edge.loseResponse) return new Response('response lost after creation', {status:502})
   return Response.json({ id, url: `https://checkout.stripe.test/c/pay/${id}`, livemode: false, status: 'open', payment_status: 'unpaid' })
  }
  if (request.method === 'POST' && /^\/v1\/checkout\/sessions\/[^/]+\/expire$/.test(url.pathname)) return Response.json({ status: 'expired' })
  if (request.method === 'GET' && url.pathname.startsWith('/v1/checkout/sessions')) {
   const project = s => ({id:s.id,url:`https://checkout.stripe.test/c/pay/${s.id}`,client_reference_id:s.form.get('client_reference_id'),metadata:{plinth_attempt:s.form.get('client_reference_id')},currency:'usd',amount_total:Number(s.form.get('line_items[0][price_data][unit_amount]')),payment_intent:s.payment_intent??null,payment_status:s.payment_status,status:s.status,livemode:s.livemode})
   const session = edge.sessions.find(s => s.id === url.pathname.split('/').pop())
   return Response.json(session ? project(session) : {data:edge.sessions.map(project),has_more:false})
  }
  if (url.pathname === '/v1/disputes') return Response.json({data:edge.disputes})
  if (url.pathname === '/v1/refunds') {
   if (request.method === 'GET') return Response.json({data:edge.refunds.filter(r=>r.payment_intent===url.searchParams.get('payment_intent'))})
   const form = new URLSearchParams(await request.text()), pi = edge.intents.get(form.get('payment_intent')), amount=Number(form.get('amount')); edge.refundKeys.push(request.headers.get('idempotency-key'))
   const refund={id:`synthetic-plinth-refund-${edge.refunds.length+1}`,status:edge.refundStatus,amount,payment_intent:pi.id,metadata:{plinth_refund:form.get('metadata[plinth_refund]')}}
   edge.refunds.push(refund);if(edge.failAfterRefund)edge.failIntentOnce=true;if(refund.status==='succeeded')pi.latest_charge.amount_refunded=(pi.latest_charge.amount_refunded??0)+amount;pi.latest_charge.refunds={data:edge.refunds.filter(r=>r.payment_intent===pi.id)};return edge.loseRefundResponse?new Response(null,{status:502}):Response.json(refund)
  }
  const intent = edge.intents.get(url.pathname.split('/').pop())
  if (request.method === 'GET' && intent) {const own=edge.sessions.find(s=>s.payment_intent===intent.id);if(own&&!intent.metadata)intent.metadata={plinth_attempt:own.form.get('client_reference_id')};if(edge.failIntentOnce){edge.failIntentOnce=false;return new Response(null,{status:502})}const hook=edge.onIntent;edge.onIntent=null;if(hook)await hook();return Response.json(intent)}
  return new Response('unexpected', { status: 500 })
 } }
 return edge
}
export const intent = (id, amount, { type = 'card', wallet = null, fee = 100 } = {}) => ({ id, status: 'succeeded', amount, amount_received: amount, currency: 'usd', livemode: false, latest_charge: { id: `synthetic-plinth-charge-${id}`, amount, payment_method_details: { type, ...(type === 'card' ? { card: { wallet: wallet ? { type: wallet } : null } } : {}) }, balance_transaction: { fee } } })

export async function setup(options = {}) {
 const edge = stripeEdge(), f = await createFixture({ ...options, stripeEdge: edge.handler })
 const client = await f.invite('client@example.com', 'Alex Chen'), foreign = await f.invite('foreign@example.com', 'Other client'), agent = await f.agent()
 const api = (path, o = {}) => f.json('/api/plinth' + path, { cookie: f.owner, ...o })
 let job = (await api('/jobs', { method: 'POST', body: { name: 'Maple Street framing draws', client_email: 'client@example.com', address: '2480 Maple Street, Burlington, VT 05401', time_zone: 'America/New_York' } })).value.job
 const act = async (path, body = {}) => { const r = await api(`/jobs/${job.id}${path}`, { method: 'POST', body: { expected_version: job.version, ...body } }); if (r.value.job) job = r.value.job; return r }
 assert.equal((await act('/quotes', { lines: [{ id: 'material', description: 'Framing material', cost_code: '06-100', phase: 'Framing', category: 'material', quantity: '1', unit: 'job', unit_cents: 1000000, cost_unit_cents: 750000 }, { id: 'labor', description: 'Framing labor', cost_code: '06-200', phase: 'Framing', category: 'labor', quantity: '1', unit: 'job', unit_cents: 1000000, cost_unit_cents: 600000 }] })).status, 200)
 const rate = (await api('/pricing-rates', { method: 'POST', body: { jurisdiction: 'Human-reviewed fixture jurisdiction', kind: 'sales', percent: '10', effective_on: '2026-01-01', reference: 'Reviewed fixture taxable materials and labor exemption', human_reviewed: true } })).value.rate
 const price = { basis: 'sell', as_of: '2026-10-21', rules: [], tax: { rate_id: rate.id, taxable_line_ids: ['material'], exemption_reference: 'Reviewed labor exemption' } }
 let r0 = await act('/pricing/preview', price); assert.equal(r0.status, 200); assert.equal((await act('/pricing/apply', { ...price, digest: r0.value.preview.digest })).status, 200)
 assert.equal((await act(`/quotes/${job.quotes.at(-1).id}/accept`, { method: 'signed', evidence: 'Externally signed contract with fixed draws', schedule_choice: { kind: 'none', reason: 'Construction dates planned separately' } })).status, 200)
 await act('/sov', {})
 const draw = async (amount, label) => {
  job=(await api(`/jobs/${job.id}`)).value.job
  let r = await api(`/jobs/${job.id}/invoices`, { method: 'POST', body: { expected_version: job.version, kind: 'deposit', description: label, amount_cents: amount, recipient_email: 'client@example.com', due_on: '2026-11-15', terms: 'Card or bank transfer through the hosted checkout' } }); assert.equal(r.status, 200, JSON.stringify(r.value))
  const id = r.value.record.id; job = r.value.job
  r = await api(`/jobs/${job.id}/invoices/${id}/issue`, { method: 'POST', body: { expected_version: job.version } }); assert.equal(r.status, 200); job = r.value.job
  return id
 }
 const pay = (invoice_id, o = {}) => api(`/jobs/${job.id}/payments`, { method: 'POST', cookie: client, body: { invoice_id, confirm: true }, ...o })
 const event = (type, session, extra = {}, id = `evt_synthetic_${Math.random().toString(36).slice(2)}`) => {if(!session.payment_intent&&extra.payment_intent)session.payment_intent=extra.payment_intent;return ({ id, type, livemode: false, data: { object: { id: session.id, client_reference_id: session.form.get('client_reference_id'), currency: 'usd', amount_total: Number(session.form.get('line_items[0][price_data][unit_amount]')), payment_status: 'paid', ...extra } } })}
 const send = (payload, { secret = SECRET, at = Math.floor((options.now ?? Date.now()) / 1000) } = {}) => { const body = JSON.stringify(payload), signature = createHmac('sha256', secret).update(`${at}.${body}`).digest('hex'); return fetch(f.origin + '/api/plinth/payments/stripe/events', { method: 'POST', body, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${at},v1=${signature}` } }) }
 const read = async () => (await api(`/jobs/${job.id}`)).value.job
 const attempts = async o => (await api(`/jobs/${job.id}/payments`, o)).value.attempts
 const changeDraw = async (amount, label) => {
  job = await read()
  const id = crypto.randomUUID(), change = { description: label, direction: 'charge', basis: 'sell', as_of: '2026-10-21', lines: [{ id, description: label, cost_code: '06-100', phase: 'Framing', category: 'material', quantity: '1', unit: 'job', unit_cents: amount, cost_unit_cents: 0 }], rules: [], tax: { rate_id: rate.id, taxable_line_ids: [], exemption_reference: 'Reviewed change-order exemption' } }
  const preview = await act('/variation-pricing/preview', change); assert.equal(preview.status, 200)
  assert.equal((await act('/variation-pricing/apply', { ...change, digest: preview.value.preview.digest })).status, 200)
  assert.equal((await act(`/variations/${job.variations.at(-1).id}/approve`)).status, 403, 'Owner cannot substitute for client change approval')
  const approved = await api(`/jobs/${job.id}/variations/${job.variations.at(-1).id}/approve`, { method: 'POST', cookie: client, body: { expected_version: job.version } }); assert.equal(approved.status, 200); job = approved.value.job
  const line = 'variation:' + job.variations.at(-1).id
  assert.equal((await act('/sov', { code_assignments: { [line]: '06-100' } })).status, 200)
  const claim = await act('/claims', { description: label, lines: job.sov.at(-1).lines.map(source => ({ line_id: source.id, completed_cents: source.id === line ? amount : 0, stored_cents: 0, evidence: source.id === line ? 'Reviewed installed client-approved addition' : 'Not billed in this application' })) }); assert.equal(claim.status, 200, JSON.stringify(claim.value))
  assert.equal((await act(`/claims/${claim.value.record.id}/approve`)).status, 200)
  assert.equal((await act(`/claims/${claim.value.record.id}/issue`)).status, 200)
  const invoice = await act('/invoices', { kind: 'milestone', description: label, source_application_id: claim.value.record.id, recipient_email: 'client@example.com', due_on: '2026-11-15', terms: 'Payment for the exact approved change order' }); assert.equal(invoice.status, 200)
  assert.equal((await act(`/invoices/${invoice.value.record.id}/issue`)).status, 200)
  return invoice.value.record.id
 }
 return { f, edge, client, foreign, agent, api, job: () => job, draw, changeDraw, pay, event, send, read, attempts }
}

