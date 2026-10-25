import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createFixture } from './helpers.mjs'

const SECRET = 'synthetic-plinth-webhook-secret-1'
/** Stripe at the network edge: hosted checkout sessions and the processor's own record of each payment. */
function stripeEdge() {
 const edge = { sessions: [], intents: new Map(), calls: [], handler: async request => {
  const url = new URL(request.url); edge.calls.push(`${request.method} ${url.pathname}`)
  if (request.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
   const form = new URLSearchParams(await request.text()), id = `cs_synthetic_${edge.sessions.length + 1}`
   edge.sessions.push({ id, form, key: request.headers.get('idempotency-key') })
   return Response.json({ id, url: `https://checkout.stripe.test/c/pay/${id}`, livemode: false, status: 'open', payment_status: 'unpaid' })
  }
  if (request.method === 'POST' && /^\/v1\/checkout\/sessions\/[^/]+\/expire$/.test(url.pathname)) return Response.json({ status: 'expired' })
  const intent = edge.intents.get(url.pathname.split('/').pop())
  if (request.method === 'GET' && intent) return Response.json(intent)
  return new Response('unexpected', { status: 500 })
 } }
 return edge
}
const intent = (id, amount, { type = 'card', wallet = null, fee = 100 } = {}) => ({ id, status: 'succeeded', amount, amount_received: amount, currency: 'usd', livemode: false, latest_charge: { payment_method_details: { type, ...(type === 'card' ? { card: { wallet: wallet ? { type: wallet } : null } } : {}) }, balance_transaction: { fee } } })

async function setup() {
 const edge = stripeEdge(), f = await createFixture({ stripeEdge: edge.handler })
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
  let r = await api(`/jobs/${job.id}/invoices`, { method: 'POST', body: { expected_version: job.version, kind: 'deposit', description: label, amount_cents: amount, recipient_email: 'client@example.com', due_on: '2026-11-15', terms: 'Card or bank transfer through the hosted checkout' } }); assert.equal(r.status, 200, JSON.stringify(r.value))
  const id = r.value.record.id; job = r.value.job
  r = await api(`/jobs/${job.id}/invoices/${id}/issue`, { method: 'POST', body: { expected_version: job.version } }); assert.equal(r.status, 200); job = r.value.job
  return id
 }
 const pay = (invoice_id, o = {}) => api(`/jobs/${job.id}/payments`, { method: 'POST', cookie: client, body: { invoice_id, confirm: true }, ...o })
 const event = (type, session, extra = {}, id = `evt_synthetic_${Math.random().toString(36).slice(2)}`) => ({ id, type, livemode: false, data: { object: { id: session.id, client_reference_id: session.form.get('client_reference_id'), currency: 'usd', amount_total: Number(session.form.get('line_items[0][price_data][unit_amount]')), payment_status: 'paid', ...extra } } })
 const send = (payload, { secret = SECRET, at = Math.floor(Date.now() / 1000) } = {}) => { const body = JSON.stringify(payload), signature = createHmac('sha256', secret).update(`${at}.${body}`).digest('hex'); return fetch(f.origin + '/api/plinth/payments/stripe/events', { method: 'POST', body, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${at},v1=${signature}` } }) }
 const read = async () => (await api(`/jobs/${job.id}`)).value.job
 const attempts = async o => (await api(`/jobs/${job.id}/payments`, o)).value.attempts
 return { f, edge, client, foreign, agent, api, job: () => job, draw, pay, event, send, read, attempts }
}

test('PAY-001 — a client pays issued draws by card, wallet and bank transfer through hosted Stripe checkout and signed events credit each invoice once', async () => {
 const s = await setup(), { f, edge } = s
 try {
  const card = await s.draw(200_000, 'Draw 1: framing'), wallet = await s.draw(150_000, 'Draw 2: windows'), bank = await s.draw(100_000, 'Draw 3: cabinets'), failing = await s.draw(50_000, 'Draw 4: paint')
  // Only the client starts a payment, after confirming the shown authorization; nothing else moves money.
  for (const who of [{ cookie: f.owner }, { cookie: s.foreign }, { cookie: undefined, token: s.agent }]) assert.ok([403, 404].includes((await s.pay(card, who)).status))
  assert.equal((await s.pay(card, { body: { invoice_id: card } })).status, 400); assert.equal(edge.sessions.length, 0, 'No Stripe call without the client\'s confirmation')
  let r = await s.pay(card); assert.equal(r.status, 201); assert.match(r.value.url, /^https:\/\/checkout\.stripe\.test\/c\/pay\/cs_synthetic_1$/); assert.equal(r.value.attempt.status, 'open'); assert.equal(r.value.attempt.livemode, false)
  const form = edge.sessions[0].form; assert.deepEqual([form.get('payment_method_types[0]'), form.get('mode'), form.get('line_items[0][price_data][unit_amount]'), form.get('line_items[0][price_data][currency]'), form.get('customer_email')], [null, 'payment', '200000', 'usd', 'client@example.com'], 'Payment methods are the ones the builder enabled in Stripe, never forced by the request')
  assert.equal(form.get('adaptive_pricing[enabled]'), 'false', 'The client pays the invoice\'s USD amount, never a converted one'); assert.equal(form.get('line_items[1][quantity]'), null, 'No fee line is added to the client\'s amount'); assert.match(edge.sessions[0].key, /^plinth-checkout-/); assert.equal(form.get('client_reference_id'), r.value.attempt.id)
  assert.match((await s.attempts({ cookie: s.client }))[0].label, /authorize .* \$2,000\.00 for invoice .* never reach Plinth/)
  r = await s.pay(card); assert.equal(r.status, 201); assert.equal(r.value.reused, true); assert.equal(edge.sessions.length, 1, 'A repeat instruction returns the same hosted page')
  // Signed events only: a bad signature, a stale one, a foreign session, a wrong amount and a wrong mode credit nothing.
  const session = edge.sessions[0], completed = s.event('checkout.session.completed', session, { payment_intent: 'pi_synthetic_card' })
  edge.intents.set('pi_synthetic_card', intent('pi_synthetic_card', 200_000, { fee: 94 }))
  assert.equal((await s.send(completed, { secret: 'synthetic-plinth-wrong-secret' })).status, 400); assert.equal((await s.send(completed, { at: Math.floor(Date.now() / 1000) - 3600 })).status, 400)
  assert.equal((await s.send(s.event('checkout.session.completed', { ...session, id: 'cs_synthetic_unknown' }, { payment_intent: 'pi_synthetic_card' }))).status, 400)
  assert.equal((await s.send(s.event('checkout.session.completed', session, { payment_intent: 'pi_synthetic_card', amount_total: 1 }))).status, 400)
  assert.equal((await s.send({ ...completed, id: 'evt_synthetic_live', livemode: true })).status, 400)
  let job = await s.read(); assert.equal(job.invoices.find(i => i.id === card).receipts.length, 0)
  // The card payment settles: one receipt with the processor references, the balance is paid and a replay changes nothing.
  assert.equal((await s.send(completed)).status, 200)
  job = await s.read(); const invoice = job.invoices.find(i => i.id === card), receipt = invoice.receipts[0]
  assert.deepEqual([invoice.receipts.length, invoice.balance.due_cents, receipt.method, receipt.amount_cents, receipt.reference], [1, 0, 'stripe', 200_000, 'pi_synthetic_card'])
  assert.deepEqual([receipt.processor.checkout_session_id, receipt.processor.payment_intent_id, receipt.processor.method, receipt.processor.wallet, receipt.processor.fee_cents, receipt.processor.livemode], ['cs_synthetic_1', 'pi_synthetic_card', 'card', null, 94, false])
  assert.match(receipt.label, /Settled by the processor/); assert.equal(receipt.recorded_by.name, 'Stripe signed events')
  const [done] = await s.attempts(); assert.deepEqual([done.status, done.payment_intent_id, done.fee_cents, done.receipt_id], ['paid', 'pi_synthetic_card', 94, receipt.id])
  assert.equal(((await s.attempts({ cookie: s.client })).find(a => a.id === done.id)).fee_cents, undefined, 'The client record carries no fee figure')
  const clientView = (await s.api(`/jobs/${job.id}`, { cookie: s.client })).value.job.invoices.find(i => i.id === card).receipts[0]; assert.equal(clientView.processor.payment_intent_id, 'pi_synthetic_card'); assert.equal(clientView.processor.fee_cents, undefined)
  const replay = await s.send(completed); assert.equal((await replay.json()).duplicate, true)
  assert.equal((await s.send({ ...completed, id: 'evt_synthetic_other' })).status, 200); assert.equal((await s.read()).invoices.find(i => i.id === card).receipts.length, 1, 'A second event for the same payment never credits twice')
  assert.equal((await s.pay(card)).value.error, 'invoice_paid')
  r = await s.api(`/jobs/${job.id}/invoices/${card}/return-receipt`, { method: 'POST', body: { expected_version: job.version, receipt_id: receipt.id, amount_cents: 1, returned_on: '2026-10-27', reference: 'synthetic-return-1', reason: 'x', confirm: true } }); assert.equal(r.value.error, 'processor_receipt')
  // An eligible wallet is the same checkout; the processor reports which wallet paid.
  r = await s.pay(wallet); assert.equal(r.status, 201); const walletSession = edge.sessions.at(-1); edge.intents.set('pi_synthetic_wallet', intent('pi_synthetic_wallet', 150_000, { wallet: 'apple_pay', fee: 74 }))
  assert.equal((await s.send(s.event('checkout.session.completed', walletSession, { payment_intent: 'pi_synthetic_wallet' }))).status, 200)
  const walletAttempt = (await s.attempts()).find(a => a.invoice_id === wallet); assert.deepEqual([walletAttempt.status, walletAttempt.method, walletAttempt.wallet], ['paid', 'card', 'apple_pay'])
  // Bank transfer is processing until the processor confirms; a second instruction waits, and only the settled event credits the invoice.
  r = await s.pay(bank); const bankSession = edge.sessions.at(-1); assert.equal((await s.send(s.event('checkout.session.completed', bankSession, { payment_intent: 'pi_synthetic_ach', payment_status: 'unpaid' }))).status, 200)
  assert.equal((await s.attempts()).find(a => a.invoice_id === bank).status, 'processing'); assert.equal((await s.read()).invoices.find(i => i.id === bank).receipts.length, 0)
  assert.equal((await s.pay(bank)).value.error, 'payment_processing')
  edge.intents.set('pi_synthetic_ach', intent('pi_synthetic_ach', 100_000, { type: 'us_bank_account', fee: 8 }))
  assert.equal((await s.send(s.event('checkout.session.async_payment_succeeded', bankSession, { payment_intent: 'pi_synthetic_ach' }))).status, 200)
  const bankAttempt = (await s.attempts()).find(a => a.invoice_id === bank); assert.deepEqual([bankAttempt.status, bankAttempt.method, bankAttempt.fee_cents], ['paid', 'us_bank_account', 8]); assert.equal((await s.read()).invoices.find(i => i.id === bank).balance.due_cents, 0)
  // A failed bank payment credits nothing and the client may start again.
  r = await s.pay(failing); const failedSession = edge.sessions.at(-1)
  assert.equal((await s.send(s.event('checkout.session.async_payment_failed', failedSession, { payment_status: 'unpaid' }))).status, 200)
  assert.equal((await s.attempts()).find(a => a.invoice_id === failing).status, 'failed'); assert.equal((await s.read()).invoices.find(i => i.id === failing).balance.due_cents, 50_000)
  assert.equal((await s.pay(failing)).status, 201)
  // Audit and storage: every step is recorded by kind without card or bank details.
  const audit = JSON.stringify((await s.api('/audit?kind=financial')).value); assert.ok(audit.includes('payments.checkout') && audit.includes('payments.stripe.receipt'))
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM pl_payment_events').first()).n, 5)
 } finally { await f.mf.dispose() }
})
