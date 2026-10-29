import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { stripeEdge, intent } from '../../tests/plinth/payment-fixture.mjs'

// Only external provider records live here. No application responses are replaced.
export async function providerEdge() {
 let refuseNext=false
 const messages = [], stripe = stripeEdge()
 const outboundService = async request => {
  if (new URL(request.url).origin === 'https://api.stripe.com') return stripe.handler(request)
  assert.equal(request.url, 'https://api.resend.com/emails', 'Unexpected Worker egress')
  assert.equal(request.method, 'POST')
  const message=await request.json();messages.push(message)
  if(refuseNext&&message.subject.startsWith('Your scheduled Plinth')){refuseNext=false;return Response.json({message:'Synthetic provider refusal'},{status:422})}
  return Response.json({ id: `synthetic-plinth-${messages.length}` })
 }
 const latest = email => messages.findLast(message => message.to.includes(email))
 const server = createServer(async (request, response) => {
  const reply = (status, value) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)) }
  try {
   const url = new URL(request.url, 'http://127.0.0.1')
   if (request.method === 'GET' && url.pathname === '/observations') return reply(200, { mail: messages.length, checkout: stripe.sessions.length, refunds: stripe.refunds.length })
   if (request.method === 'GET' && url.pathname === '/mail/latest') return reply(200, { message: latest(url.searchParams.get('email')) ?? null })
   assert.equal(request.method, 'POST')
   const chunks = []; for await (const chunk of request) chunks.push(chunk)
   const body = JSON.parse(Buffer.concat(chunks).toString())
   if(url.pathname==='/mail/refuse-next'){refuseNext=true;return reply(200,{configured:true})}
   if (url.pathname === '/auth/link') {
    const message = messages.findLast(message => message.to.includes(body.email) && /\/auth\/confirm\?/.test(message.text))
    const link = message?.text.match(/https?:\/\/[^\s<>]+/g)?.find(value => new URL(value).pathname === '/auth/confirm')
    return reply(link ? 200 : 404, link ? { url: link } : { error: 'native_mail_missing' })
   }
   assert.equal(url.pathname, '/settle')
   const session = stripe.sessions.find(session => session.id === body.session_id)
   assert.ok(session, 'Provider checkout session exists')
   const amount = Number(session.form.get('line_items[0][price_data][unit_amount]'))
   const id = `synthetic-plinth-${stripe.intents.size + 1}`
   session.payment_intent = id; session.payment_status = 'paid'; session.status = 'complete'
   const payment = intent(id, amount)
   payment.metadata = { plinth_attempt: session.form.get('client_reference_id') }
   if (body.dispute) {
    const dispute = { id: `synthetic-plinth-${stripe.disputes.length + 1}`, status: 'needs_response', amount, payment_intent: id, charge: payment.latest_charge.id, reason: 'fraudulent' }
    payment.latest_charge.disputed = true; payment.latest_charge.dispute = dispute
    stripe.disputes.push(dispute)
   }
   stripe.intents.set(id, payment)
   // Deliberately no webhook: the installed owner's reconciliation must read Stripe.
   return reply(200, { return_url: session.form.get('success_url').replace('{CHECKOUT_SESSION_ID}', session.id) })
  } catch { reply(400, { error: 'provider_fixture_request' }) }
 })
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
 return { outboundService, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}
