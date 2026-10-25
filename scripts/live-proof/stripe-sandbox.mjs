// PAY-001 held-key sandbox receipt, Stripe test mode only. Run as: python3 briefs/_od08-env.py STRIPE_SECRET=STRIPE_US_TEST_SECRET_KEY -- node scripts/live-proof/stripe-sandbox.mjs <scratch directory>
// A disposable Worker runs the real Plinth code against real Stripe test mode: the app creates hosted Checkout, a headless browser pays on Stripe's page with Stripe's test card, the real signed-shape event is replayed to the webhook door under a local signing secret, and the invoice is credited. Booleans only are printed: no key, address or card detail.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { createFixture } from '../../tests/plinth/helpers.mjs'

const key = process.env.STRIPE_SECRET, scratch = process.argv[2]
assert.ok(key && scratch, 'Run through the held-key injector with a scratch directory')
await mkdir(scratch, { recursive: true })
const WEBHOOK = 'synthetic-plinth-webhook-secret-1'
const f = await createFixture({ stripeEdge: async request => fetch(request.url, { method: request.method, headers: request.headers, ...(request.method === 'POST' ? { body: await request.text() } : {}) }), stripeSecret: key })
const receipt = { clause: 'PAY-001', mode: 'Stripe test mode through the real Plinth Worker; card paid on Stripe hosted Checkout; no key, address or card detail recorded' }
const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
try {
 const client = await f.invite('synthetic-plinth-client@example.com', 'Alex Chen')
 const api = (path, o = {}) => f.json('/api/plinth' + path, { cookie: f.owner, ...o })
 let job = (await api('/jobs', { method: 'POST', body: { name: 'Sandbox framing draws', client_email: 'synthetic-plinth-client@example.com', address: '2480 Maple Street, Burlington, VT 05401', time_zone: 'America/New_York' } })).value.job
 const act = async (path, body = {}) => { const r = await api(`/jobs/${job.id}${path}`, { method: 'POST', body: { expected_version: job.version, ...body } }); assert.ok(r.status === 200, path + ' ' + r.status); if (r.value.job) job = r.value.job; return r }
 await act('/quotes', { lines: [{ id: 'material', description: 'Framing material', cost_code: '06-100', phase: 'Framing', category: 'material', quantity: '1', unit: 'job', unit_cents: 1000000, cost_unit_cents: 750000 }, { id: 'labor', description: 'Framing labor', cost_code: '06-200', phase: 'Framing', category: 'labor', quantity: '1', unit: 'job', unit_cents: 1000000, cost_unit_cents: 600000 }] })
 const rate = (await api('/pricing-rates', { method: 'POST', body: { jurisdiction: 'Human-reviewed fixture jurisdiction', kind: 'sales', percent: '10', effective_on: '2026-01-01', reference: 'Reviewed fixture', human_reviewed: true } })).value.rate
 const price = { basis: 'sell', as_of: '2026-10-21', rules: [], tax: { rate_id: rate.id, taxable_line_ids: ['material'], exemption_reference: 'Reviewed labor exemption' } }
 const preview = await act('/pricing/preview', price); await act('/pricing/apply', { ...price, digest: preview.value.preview.digest })
 await act(`/quotes/${job.quotes.at(-1).id}/accept`, { method: 'signed', evidence: 'Externally signed', schedule_choice: { kind: 'none', reason: 'Later' } }); await act('/sov', {})
 const invoice = async amount => { const r = await act('/invoices', { kind: 'deposit', description: `Sandbox draw ${amount}`, amount_cents: amount, recipient_email: 'synthetic-plinth-client@example.com', due_on: '2026-11-15', terms: 'Hosted checkout' }); await act(`/invoices/${r.value.record.id}/issue`); return r.value.record.id }
 const pay = id => f.json(`/api/plinth/jobs/${job.id}/payments`, { method: 'POST', cookie: client, body: { invoice_id: id, confirm: true } })
 const events = async type => (await (await fetch(`https://api.stripe.com/v1/events?type=${type}&limit=20`, { headers: { authorization: `Bearer ${key}` } })).json()).data
 const send = event => { const body = JSON.stringify(event), at = Math.floor(Date.now() / 1000); return fetch(f.origin + '/api/plinth/payments/stripe/events', { method: 'POST', body, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${at},v1=${createHmac('sha256', WEBHOOK).update(`${at}.${body}`).digest('hex')}` } }) }
 // Card: the app creates the real hosted session; the browser pays with Stripe's test card.
 const cardInvoice = await invoice(2500), started = await pay(cardInvoice)
 receipt.checkout_created = started.status === 201 && new URL(started.value.url).hostname === 'checkout.stripe.com'
 const page = await (await browser.newContext()).newPage()
 await page.goto(started.value.url, { waitUntil: 'domcontentloaded' })
 await page.getByText('US bank account', { exact: true }).waitFor({ timeout: 60_000 })
 receipt.hosted_page_offers_card = await page.getByText('Card', { exact: true }).count() > 0
 receipt.hosted_page_offers_bank = true
 if (!await page.locator('#cardNumber').isVisible()) await page.locator('#payment-method-label-card').click({ force: true })
 await page.waitForSelector('#cardNumber', { timeout: 60_000 })
 receipt.usd_only_no_currency_choice = await page.locator('text=/Choose currency/').count() === 0
 await page.selectOption('#billingCountry', 'US')
 if (await page.locator('#enableStripePass').count()) await page.uncheck('#enableStripePass')
 await page.fill('#cardNumber', '4242424242424242'); await page.fill('#cardExpiry', '12 / 34'); await page.fill('#cardCvc', '123'); await page.fill('#billingName', 'Alex Chen')
 if (await page.locator('#billingPostalCode').count()) await page.fill('#billingPostalCode', '05401')
 await page.locator('.SubmitButton').click()
 await page.waitForURL(url => url.origin === f.origin, { timeout: 120_000 })
 receipt.returned_to_plinth = true
 // The real completed event, replayed to the webhook door under the local signing secret.
 const attemptId = (await f.json(`/api/plinth/jobs/${job.id}/payments`, { cookie: f.owner })).value.attempts.find(a => a.invoice_id === cardInvoice).id
 let real
 for (let n = 0; n < 30 && !real; n++) { real = (await events('checkout.session.completed')).find(e => e.data.object.client_reference_id === attemptId); if (!real) await new Promise(r => setTimeout(r, 2000)) }
 receipt.real_completed_event_found = !!real
 const bad = await send({ ...real, id: 'evt_synthetic_forged', data: { object: { ...real.data.object, amount_total: 1 } } })
 receipt.forged_amount_refused = bad.status === 400
 const ok = await send(real); receipt.event_accepted = ok.status === 200
 const again = await send(real); receipt.duplicate_acknowledged_without_effect = (await again.json()).duplicate === true
 const after = (await f.json(`/api/plinth/jobs/${job.id}`, { cookie: f.owner })).value.job.invoices.find(i => i.id === cardInvoice), attempt = (await f.json(`/api/plinth/jobs/${job.id}/payments`, { cookie: f.owner })).value.attempts.find(a => a.id === attemptId)
 receipt.invoice_credited_once = after.receipts.length === 1 && after.balance.due_cents === 0 && after.receipts[0].amount_cents === 2500
 receipt.processor_references = !!after.receipts[0]?.processor?.payment_intent_id?.startsWith('pi_') && after.receipts[0].processor.checkout_session_id.startsWith('cs_')
 receipt.method = after.receipts[0]?.processor?.method; receipt.test_mode = after.receipts[0]?.processor?.livemode === false; receipt.fee_reported = typeof attempt.fee_cents === 'number'
 receipt.no_card_number_stored = !JSON.stringify([after, attempt]).includes('4242')

 // Bank transfer: Stripe's hosted Financial Connections test institution, then the processor settles asynchronously.
 job = (await api(`/jobs/${job.id}`)).value.job
 const bankInvoice = await invoice(2600), bankStart = await pay(bankInvoice), bank = {}
 const bp = await (await browser.newContext()).newPage()
 await bp.goto(bankStart.value.url, { waitUntil: 'domcontentloaded' })
 await bp.getByText('US bank account', { exact: true }).waitFor({ timeout: 60_000 })
 await bp.locator('#payment-method-label-us_bank_account').click({ force: true })
 await bp.getByLabel('Full name').fill('Alex Chen')
 await bp.getByText('Test (Non-OAuth)').click()
 const inModal = async fn => { for (const fr of bp.frames()) { if (!/js\.stripe\.com/.test(fr.url())) continue; const t = await fr.evaluate(() => document.body?.innerText ?? '').catch(() => ''); if (t && !/^Pay with/.test(t) && await fn(fr, t)) return true } return false }
 const press = re => inModal(async fr => { const b = fr.getByRole('button', { name: re }); if (await b.count()) { await b.first().click(); return true } return false })
 for (let n = 0; n < 12; n++) {
  await bp.waitForTimeout(5000)
  if (await bp.locator('text=/••••6789|Success.*6789/').count()) break
  await inModal(async (fr, t) => {
   if (/Sign up or log in/.test(t)) { await fr.locator('input[type=email]').first().fill('synthetic-plinth-client@example.com'); await fr.locator('input[type=tel]').first().fill('2015550123'); return press(/Continue|Sign up|Log in/i) }
   if (/Select account/.test(t)) { await fr.getByText(/^Success$/).first().click(); await bp.waitForTimeout(1500); return press(/Connect account|Confirm|Continue/i) }
   return press(/Agree and continue|Connect account|Confirm|Done|Continue/i)
  })
 }
 bank.account_connected = await bp.locator('text=/6789/').count() > 0
 await bp.locator('.SubmitButton').click()
 await bp.waitForURL(url => url.origin === f.origin, { timeout: 120_000 })
 bank.returned_to_plinth = true
 const bankAttempt = (await f.json(`/api/plinth/jobs/${job.id}/payments`, { cookie: f.owner })).value.attempts.find(a => a.invoice_id === bankInvoice).id
 let completed
 for (let n = 0; n < 30 && !completed; n++) { completed = (await events('checkout.session.completed')).find(e => e.data.object.client_reference_id === bankAttempt); if (!completed) await new Promise(r => setTimeout(r, 2000)) }
 bank.completed_event_unpaid = completed?.data.object.payment_status === 'unpaid'
 await send(completed)
 const processing = (await f.json(`/api/plinth/jobs/${job.id}/payments`, { cookie: f.owner })).value.attempts.find(a => a.id === bankAttempt)
 bank.processing_not_credited = processing.status === 'processing' && (await f.json(`/api/plinth/jobs/${job.id}`, { cookie: f.owner })).value.job.invoices.find(i => i.id === bankInvoice).balance.due_cents === 2600
 let settled
 for (let n = 0; n < 150 && !settled; n++) { settled = (await events('checkout.session.async_payment_succeeded')).find(e => e.data.object.client_reference_id === bankAttempt); if (!settled) await new Promise(r => setTimeout(r, 4000)) }
 bank.settled_event_found = !!settled
 if (settled) {
  bank.settled_event_accepted = (await send(settled)).status === 200
  const done = (await f.json(`/api/plinth/jobs/${job.id}`, { cookie: f.owner })).value.job.invoices.find(i => i.id === bankInvoice)
  bank.invoice_credited_once = done.receipts.length === 1 && done.balance.due_cents === 0
  bank.method = done.receipts[0]?.processor?.method; bank.test_mode = done.receipts[0]?.processor?.livemode === false
 }
 receipt.bank_transfer = bank
 console.log(JSON.stringify(receipt, null, 1))
} finally { await browser.close(); await f.mf.dispose() }
