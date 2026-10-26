import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createFixture } from './helpers.mjs'

const SECRET = 'synthetic-plinth-webhook-secret-1'
/** Stripe at the network edge: hosted checkout sessions and the processor's own record of each payment. */
function stripeEdge() {
 const edge = { sessions: [], intents: new Map(), disputes: [], refunds: [], loseResponse: false, refundStatus: 'succeeded', loseRefundResponse: false, calls: [], handler: async request => {
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
   if (request.method === 'GET') return Response.json({data:edge.refunds})
   const form = new URLSearchParams(await request.text()), pi = edge.intents.get(form.get('payment_intent')), amount=Number(form.get('amount'))
   const refund={id:`synthetic-plinth-refund-${edge.refunds.length+1}`,status:edge.refundStatus,amount,payment_intent:pi.id,metadata:{plinth_refund:form.get('metadata[plinth_refund]')}}
   edge.refunds.push(refund);if(edge.failAfterRefund)edge.failIntentOnce=true;if(refund.status==='succeeded')pi.latest_charge.amount_refunded=(pi.latest_charge.amount_refunded??0)+amount;pi.latest_charge.refunds={data:edge.refunds};return edge.loseRefundResponse?new Response(null,{status:502}):Response.json(refund)
  }
  const intent = edge.intents.get(url.pathname.split('/').pop())
  if (request.method === 'GET' && intent) {const own=edge.sessions.find(s=>s.payment_intent===intent.id);if(own&&!intent.metadata)intent.metadata={plinth_attempt:own.form.get('client_reference_id')};if(edge.failIntentOnce){edge.failIntentOnce=false;return new Response(null,{status:502})}const hook=edge.onIntent;edge.onIntent=null;if(hook)await hook();return Response.json(intent)}
  return new Response('unexpected', { status: 500 })
 } }
 return edge
}
const intent = (id, amount, { type = 'card', wallet = null, fee = 100 } = {}) => ({ id, status: 'succeeded', amount, amount_received: amount, currency: 'usd', livemode: false, latest_charge: { id: `synthetic-plinth-charge-${id}`, amount, payment_method_details: { type, ...(type === 'card' ? { card: { wallet: wallet ? { type: wallet } : null } } : {}) }, balance_transaction: { fee } } })

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
  job=(await api(`/jobs/${job.id}`)).value.job
  let r = await api(`/jobs/${job.id}/invoices`, { method: 'POST', body: { expected_version: job.version, kind: 'deposit', description: label, amount_cents: amount, recipient_email: 'client@example.com', due_on: '2026-11-15', terms: 'Card or bank transfer through the hosted checkout' } }); assert.equal(r.status, 200, JSON.stringify(r.value))
  const id = r.value.record.id; job = r.value.job
  r = await api(`/jobs/${job.id}/invoices/${id}/issue`, { method: 'POST', body: { expected_version: job.version } }); assert.equal(r.status, 200); job = r.value.job
  return id
 }
 const pay = (invoice_id, o = {}) => api(`/jobs/${job.id}/payments`, { method: 'POST', cookie: client, body: { invoice_id, confirm: true }, ...o })
 const event = (type, session, extra = {}, id = `evt_synthetic_${Math.random().toString(36).slice(2)}`) => {if(!session.payment_intent&&extra.payment_intent)session.payment_intent=extra.payment_intent;return ({ id, type, livemode: false, data: { object: { id: session.id, client_reference_id: session.form.get('client_reference_id'), currency: 'usd', amount_total: Number(session.form.get('line_items[0][price_data][unit_amount]')), payment_status: 'paid', ...extra } } })}
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
  edge.intents.set('synthetic-plinth-foreign-intent-1',intent('synthetic-plinth-foreign-intent-1',200_000));assert.equal((await s.send(s.event('checkout.session.completed',session,{payment_intent:'synthetic-plinth-foreign-intent-1'}))).status,400,'A valid signature cannot attach an unrelated payment without the instruction metadata')
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
  job = await s.read()
  r = await s.api(`/jobs/${job.id}/invoices/${card}/return-receipt`, { method: 'POST', body: { expected_version: job.version, receipt_id: receipt.id, amount_cents: 1, returned_on: '2026-10-27', reference: 'synthetic-return-1', reason: 'x', confirm: true } }); assert.equal(r.value.error, 'processor_receipt')
  // An eligible wallet is the same checkout; the processor reports which wallet paid.
  r = await s.pay(wallet); assert.equal(r.status, 201); const walletSession = edge.sessions.at(-1); edge.intents.set('pi_synthetic_wallet', intent('pi_synthetic_wallet', 150_000, { wallet: 'apple_pay', fee: 74 }))
  assert.equal((await s.send(s.event('checkout.session.completed', walletSession, { payment_intent: 'pi_synthetic_wallet' }))).status, 200)
  const walletAttempt = (await s.attempts()).find(a => a.invoice_id === wallet); assert.deepEqual([walletAttempt.status, walletAttempt.method, walletAttempt.wallet], ['paid', 'card', 'apple_pay'])
  // Bank transfer is processing until the processor confirms; a second instruction waits, and only the settled event credits the invoice.
  r = await s.pay(bank); const bankSession = edge.sessions.at(-1); edge.intents.set('pi_synthetic_ach', {...intent('pi_synthetic_ach',100_000,{type:'us_bank_account'}),status:'processing',amount_received:0}); assert.equal((await s.send(s.event('checkout.session.completed', bankSession, { payment_intent: 'pi_synthetic_ach', payment_status: 'unpaid' }))).status, 200)
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
 } finally { await f.mf.dispose() }
})

// Processor state can change after an invoice was paid; every trigger reads the current provider record.
test('Settlement reconciliation preserves original receipts through returns, disputes, stale events and uncertain checkout responses', async () => {
 const s=await setup(),{f,edge}=s
 try {
  const bank=await s.draw(100_000,'Cabinet ACH draw'),card=await s.draw(200_000,'Card draw'),unknown=await s.draw(50_000,'Uncertain checkout')
  await s.pay(bank);const bs=edge.sessions.at(-1);bs.payment_intent='synthetic-plinth-bank-1'
  const pi=intent(bs.payment_intent,100_000,{type:'us_bank_account'});pi.status='requires_action';pi.amount_received=0;edge.intents.set(pi.id,pi)
  const completed=s.event('checkout.session.completed',bs,{payment_intent:pi.id,payment_status:'unpaid'})
  assert.equal((await s.send(completed)).status,200)
  assert.equal((await s.attempts()).find(a=>a.invoice_id===bank).settlement_state,'processing');assert.equal((await s.read()).invoices.find(i=>i.id===bank).balance.due_cents,100_000)
  pi.status='succeeded';pi.amount_received=100_000
  const success=s.event('checkout.session.async_payment_succeeded',bs,{payment_intent:pi.id})
  assert.equal((await s.send(success)).status,200)
  assert.equal((await s.read()).invoices.find(i=>i.id===bank).balance.due_cents,0)
  pi.latest_charge.dispute={id:'synthetic-plinth-return-1',amount:100_000,status:'lost',reason:'insufficient_funds'}
  const returned={id:'synthetic-plinth-event-return',type:'charge.dispute.created',livemode:false,data:{object:{id:'synthetic-plinth-return-1',payment_intent:pi.id}}}
  assert.equal((await s.send(returned,{secret:'synthetic-plinth-forged'})).status,400)
  assert.equal((await s.read()).invoices.find(i=>i.id===bank).balance.due_cents,0)
  assert.equal((await s.send(returned)).status,200);assert.equal((await (await s.send(returned)).json()).duplicate,true)
  assert.equal((await s.send({...success,id:'synthetic-plinth-stale-settlement'})).status,200)
  let row=(await s.read()).invoices.find(i=>i.id===bank)
  assert.deepEqual([row.receipts.length,row.receipts[0].amount_cents,row.receipts[1].amount_cents,row.balance.due_cents],[2,100_000,-100_000,100_000])
  assert.equal((await s.attempts()).find(a=>a.invoice_id===bank).settlement_state,'ach_returned')
  await s.pay(card);const cs=edge.sessions.at(-1);cs.payment_intent='synthetic-plinth-card-1';const cp=intent(cs.payment_intent,200_000);edge.intents.set(cp.id,cp)
  assert.equal((await s.send(s.event('checkout.session.completed',cs,{payment_intent:cp.id}))).status,200)
  cp.latest_charge.dispute={id:'synthetic-plinth-dispute-1',amount:75_000,status:'needs_response'}
  const attempt=(await s.attempts()).find(a=>a.invoice_id===card),reconcile=o=>s.api(`/jobs/${s.job().id}/payments/${attempt.id}/reconcile`,{method:'POST',body:{},...o})
  for (const who of [{cookie:s.client},{cookie:s.foreign},{cookie:undefined,token:s.agent}]) assert.ok([403,404].includes((await reconcile(who)).status))
  assert.equal((await reconcile()).status,200)
  row=(await s.read()).invoices.find(i=>i.id===card);assert.equal(row.balance.due_cents,75_000);assert.equal((await s.attempts()).find(a=>a.id===attempt.id).settlement_state,'disputed')
  assert.equal((await s.api(`/jobs/${s.job().id}/payments/${attempt.id}/refund`,{method:'POST',body:{expected_version:(await s.read()).version,operation_id:'synthetic-plinth-disputed-refund-1',amount_cents:1,reason:'Must refuse disputed funds',confirm:true}})).value.error,'refund_funds');assert.equal(edge.refunds.length,0)
  // A later win restores only previously disputed cents, never a second whole receipt.
  cp.latest_charge.dispute.status='won';assert.equal((await reconcile()).status,200)
  row=(await s.read()).invoices.find(i=>i.id===card);assert.equal(row.balance.due_cents,0);assert.deepEqual(row.receipts.map(r=>r.amount_cents),[200_000,-75_000,75_000])
  // A linked issued credit authorizes only that amount of processor refund; replay never sends twice.
  let current=await s.read();row=current.invoices.find(i=>i.id===card);const original=structuredClone(row.issued)
  const refundBody={expected_version:current.version,operation_id:'synthetic-plinth-refund-operation-1',amount_cents:25_000,reason:'Customer approved reduced scope',confirm:true}
  const refund=body=>s.api(`/jobs/${current.id}/payments/${attempt.id}/refund`,{method:'POST',body})
  assert.equal((await refund(refundBody)).value.error,'refund_credit');assert.equal(edge.refunds.length,0)
  let correction=await s.api(`/jobs/${current.id}/invoices/${card}/credit`,{method:'POST',body:{expected_version:current.version,operation_id:'synthetic-plinth-credit-operation-1',description:'Credit for reduced scope',reason:'Reviewed reduction',confirm:true,lines:[{invoice_line_id:row.issued.lines[0].id,amount_cents:25_000}]}})
  assert.equal(correction.status,200,JSON.stringify(correction.value));refundBody.expected_version=correction.value.job.version
  const result=await refund(refundBody);assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(edge.refunds.length,1)
  assert.equal((await refund(refundBody)).value.reused,true);assert.equal(edge.refunds.length,1)
  assert.equal((await refund({...refundBody,amount_cents:26_000})).value.error,'refund_conflict')
  current=await s.read();row=current.invoices.find(i=>i.id===card);assert.equal(row.balance.due_cents,0);assert.equal(row.balance.received_cents,175_000);assert.deepEqual(row.issued,original)
  for(const receipt of row.receipts){assert.equal(receipt.accounting_entries.reduce((n,e)=>n+e.debit_cents-e.credit_cents,0),0);assert.ok(receipt.accounting_entries.some(e=>e.account==='stripe_clearing'))}
  assert.equal((await s.attempts()).find(a=>a.id===attempt.id).settlement_state,'refunded')
  current=await s.read();row=current.invoices.find(i=>i.id===card)
  correction=await s.api(`/jobs/${current.id}/invoices/${card}/credit`,{method:'POST',body:{expected_version:current.version,operation_id:'synthetic-plinth-credit-operation-2',description:'Further agreed scope credit',reason:'Reviewed reduction',confirm:true,lines:[{invoice_line_id:row.issued.lines[0].id,amount_cents:10_000}]}});assert.equal(correction.status,200)
  const uncertainRefund={...refundBody,operation_id:'synthetic-plinth-refund-operation-2',amount_cents:10_000,expected_version:correction.value.job.version}
  edge.loseRefundResponse=true;edge.refundStatus='pending';assert.equal((await refund(uncertainRefund)).status,502)
  assert.equal((await refund(uncertainRefund)).value.reused,true);assert.equal(edge.refunds.length,2,'Lost refund response reconciles existing instruction without another send')
  assert.equal((await s.read()).invoices.find(i=>i.id===card).balance.due_cents,-10_000,'Pending refund does not falsely remove settled funds')
  edge.refunds.at(-1).status='succeeded';cp.latest_charge.amount_refunded+=10_000;edge.loseRefundResponse=false
  assert.equal((await reconcile()).status,200);assert.equal((await s.read()).invoices.find(i=>i.id===card).balance.due_cents,0)
  const paymentHistory=await s.api(`/jobs/${current.id}/payments`);assert.equal(paymentHistory.value.refunds.find(r=>r.id===uncertainRefund.operation_id).status,'succeeded');assert.equal((await s.api(`/jobs/${current.id}/payments`,{cookie:s.client})).value.refunds,undefined)

  edge.loseResponse=true;let release;edge.holdCheckout=new Promise(resolve=>release=resolve);const sent=new Promise(resolve=>edge.onCheckout=resolve),inFlight=s.pay(unknown);await sent
  assert.equal((await s.pay(unknown)).value.error,'payment_unresolved','A concurrent checkout never replaces an instruction awaiting a provider response');release();assert.equal((await inFlight).status,502);edge.holdCheckout=null;edge.onCheckout=null;const us=edge.sessions.at(-1),u=(await s.attempts()).find(a=>a.invoice_id===unknown)
  assert.equal(u.settlement_state,'unresolved');assert.equal((await s.pay(unknown)).value.error,'payment_unresolved');assert.equal(edge.sessions.filter(x=>x.form.get('client_reference_id')===u.id).length,1)
  edge.loseResponse=false
  assert.equal((await s.api(`/jobs/${s.job().id}/payments/${u.id}/reconcile`,{method:'POST',body:{}})).status,200)
  assert.equal((await s.pay(unknown)).value.url,`https://checkout.stripe.test/c/pay/${us.id}`)
  us.status='expired';assert.equal((await s.api(`/jobs/${s.job().id}/payments/${u.id}/reconcile`,{method:'POST',body:{}})).status,200)
  assert.equal((await s.attempts()).find(a=>a.id===u.id).settlement_state,'canceled')
  assert.equal((await s.read()).invoices.find(i=>i.id===unknown).balance.due_cents,50_000)
  const mixed=await s.draw(50_000,'Mixed staff and Stripe receipt draw');let mixedJob=await s.read()
  assert.equal((await s.api(`/jobs/${mixedJob.id}/invoices/${mixed}/receipt`,{method:'POST',body:{expected_version:mixedJob.version,amount_cents:40_000,received_on:'2026-10-26',reference:'synthetic-plinth-mixed-staff-1',method:'bank',confirm:true}})).status,200)
  await s.pay(mixed);const ms=edge.sessions.at(-1);ms.payment_intent='synthetic-plinth-mixed-intent-1';edge.intents.set(ms.payment_intent,intent(ms.payment_intent,10_000));const missingEventAttempt=(await s.attempts()).find(a=>a.invoice_id===mixed);assert.equal((await s.api(`/jobs/${mixedJob.id}/payments/${missingEventAttempt.id}/reconcile`,{method:'POST',body:{}})).status,200)
  mixedJob=await s.read();const mi=mixedJob.invoices.find(i=>i.id===mixed);assert.equal(mi.receipts.at(-1).processor.confirmation,'provider_record');const ma=(await s.attempts()).find(a=>a.invoice_id===mixed)
  const mc=await s.api(`/jobs/${mixedJob.id}/invoices/${mixed}/credit`,{method:'POST',body:{expected_version:mixedJob.version,operation_id:'synthetic-plinth-mixed-credit-1',description:'Agreed mixed-source credit',reason:'Reviewed reduction',confirm:true,lines:[{invoice_line_id:mi.issued.lines[0].id,amount_cents:40_000}]}});assert.equal(mc.status,200)
  edge.refundStatus='pending';const mixedBody={expected_version:mc.value.job.version,operation_id:'synthetic-plinth-mixed-refund-1',amount_cents:8_000,reason:'Return only settled Stripe funds',confirm:true},mixedRefund=body=>s.api(`/jobs/${mixedJob.id}/payments/${ma.id}/refund`,{method:'POST',body})
  assert.equal((await mixedRefund(mixedBody)).status,200);const mixedRefundCount=edge.refunds.length
  assert.equal((await mixedRefund({...mixedBody,expected_version:(await s.read()).version,operation_id:'synthetic-plinth-mixed-refund-2'})).value.error,'refund_funds','Pending instructions reserve their own settled payment even when other receipts fund invoice credit');assert.equal(edge.refunds.length,mixedRefundCount)
  current=await s.read();row=current.invoices.find(i=>i.id===card)
  correction=await s.api(`/jobs/${current.id}/invoices/${card}/credit`,{method:'POST',body:{expected_version:current.version,operation_id:'synthetic-plinth-credit-operation-3',description:'Final approved scope credit',reason:'Reviewed reduction',confirm:true,lines:[{invoice_line_id:row.issued.lines[0].id,amount_cents:1_000}]}});assert.equal(correction.status,200)
  const expectedRefundCount=edge.refunds.length+1
  edge.refundStatus='succeeded';edge.failAfterRefund=true
  const ledgerGap={...refundBody,operation_id:'synthetic-plinth-refund-ledger-gap-1',amount_cents:1_000,expected_version:correction.value.job.version}
  assert.equal((await refund(ledgerGap)).status,502);edge.failAfterRefund=false
  assert.equal((await refund({...ledgerGap,operation_id:'synthetic-plinth-refund-ledger-gap-2'})).value.error,'refund_credit','A provider-confirmed refund reserves customer credit until its ledger update commits')
  assert.equal(edge.refunds.length,expectedRefundCount);assert.equal((await reconcile()).status,200)
  current=await s.read();row=current.invoices.find(i=>i.id===card);assert.equal(row.balance.due_cents,0)
  correction=await s.api(`/jobs/${current.id}/invoices/${card}/credit`,{method:'POST',body:{expected_version:current.version,operation_id:'synthetic-plinth-credit-operation-4',description:'Additional approved credit',reason:'Reviewed reduction',confirm:true,lines:[{invoice_line_id:row.issued.lines[0].id,amount_cents:1_000}]}});assert.equal(correction.status,200)
  let signedOut;edge.onIntent=async()=>{signedOut=await f.request('/auth/signout',{method:'POST',cookie:f.owner,body:{}})}
  const revoked=await refund({...refundBody,operation_id:'synthetic-plinth-refund-operation-3',amount_cents:1_000,expected_version:correction.value.job.version})
  assert.equal(signedOut.status,204);assert.equal(revoked.status,401,'A session revoked during the Stripe read cannot send a refund');assert.equal(edge.refunds.length,expectedRefundCount)
  assert.equal((await s.api(`/jobs/${current.id}`,{cookie:s.client})).value.job.invoices.find(i=>i.id===card).balance.due_cents,-1_000)

 }finally{await f.mf.dispose()}
})
