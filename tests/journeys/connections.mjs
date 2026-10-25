import assert from 'node:assert/strict'
import {mkdir, readFile} from 'node:fs/promises'
import {createHmac} from 'node:crypto'
import {chromium, expect} from '@playwright/test'
import {createActiveJob} from '../plinth/helpers.mjs'
import {createClient} from '../../src/plinth/api-client.mjs'

const base = process.env.PLINTH_URL, entrance = process.env.PLINTH_OWNER_OPEN, shots = process.env.PLINTH_SCREENSHOTS
assert.ok(base && entrance && shots && new URL(entrance).origin === base && ['127.0.0.1','localhost'].includes(new URL(base).hostname), 'Use only this disposable local installation')
await mkdir(shots, {recursive: true})
const browser = await chromium.launch({headless: true, args: ['--use-mock-keychain', '--password-store=basic']})
try {
 const context = await browser.newContext(), page = await context.newPage()
 await page.goto(entrance); await page.waitForURL(url => !url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/__dev/'))
 if (new URL(page.url()).pathname === '/setup') {
  await page.getByLabel('Your name', {exact: true}).fill('Maple Street builder')
  await page.getByRole('checkbox', {name: 'I confirm this owner account is ready to use.'}).check()
  await page.getByRole('button', {name: 'Finish setup', exact: true}).click(); await page.waitForURL('**/app')
 }
 // This checkout's generated local secret proves the documented CLI entrance; no real profile is read.
 const vars = await readFile('.dev.vars', 'utf8')
 const match = vars.match(/^SESSION_SECRET=(.*)$/m); assert.ok(match)
 const sessionSecret = match[1].trim().replace(/^"|"$/g, '')
 const proof = createHmac('sha256', sessionSecret).update('local-cli\0sign-in').digest('hex')
 const session = await context.request.post(base+'/auth/local/cli-session', {headers: {origin: base, 'x-rer-local-cli': proof}, data: {returnTo: '/app'}, maxRedirects: 0})
 assert.equal(session.status(), 303)
 const post = async (path, body = {}) => {
  const response = await context.request.post(base+'/api/plinth'+path, {headers: {origin: base}, data: body})
  assert.ok(response.ok(), path+' returned '+response.status()); return response.json()
 }
 const f = {owner: 'synthetic-owner', json: async (path, {method = 'GET', body} = {}) => {
  const response = await context.request.fetch(base+path, {method, headers: {origin: base}, ...(body === undefined ? {} : {data: body})})
  return {status: response.status(), value: await response.json()}
 }}
 const job = await createActiveJob(f, 'Maple Street kitchen', 'synthetic-plinth-4@dev.localhost', 2450000)
 const minted = await post('/agent-credentials', {expires_in_seconds: 3600})
 const client = createClient({origin: base, token: minted.credential.token})
 let after, found = false
 do { const result = await client.pageJobs({limit: 2, after}); found ||= result.jobs.some(row => row.id === job.id); after = result.next } while (after)
 assert.ok(found)
 const draft = await client.prepareChange({job_id: job.id, 'Idempotency-Key': 'synthetic-plinth-journey-'+job.id, body: {expected_version: job.version, description: 'Reviewed cabinet finish draft', amount_cents: 45000}})
 await assert.rejects(client.approveChange({job_id: job.id, change_id: draft.draft.id, body: {expected_version: draft.job.version}}), error => error.status === 403)
 const credential = (await (await context.request.get(base+'/api/plinth/agent-credentials')).json()).credentials.find(row => !row.revoked_at)
 await page.setViewportSize({width: 1440, height: 1000})
 await page.reload()
 await page.getByRole('button', {name: 'People & access', exact: true}).click()
 const settings = page.getByRole('region', {name: 'Connections', exact: true})
 await settings.locator(':scope > details > summary').click()
 await expect(settings.getByRole('button', {name: 'Refresh connections', exact: true})).toBeVisible()
 const create = settings.locator('.connection-create')
 if (!await create.evaluate(el => el.open)) await create.locator('summary').click()
 const receiver = 'https://example.com/synthetic-plinth-' + job.id
 await create.getByLabel('Receiver URL', {exact: true}).fill(receiver)
 await create.getByLabel('Owner credential', {exact: true}).selectOption(minted.credential.id)
 await create.getByRole('checkbox', {name: job.name, exact: true}).check()
 await create.getByRole('checkbox', {name: 'I approve this receiver and the selected reference fields.', exact: true}).check()
 const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/plinth/connections' && response.request().method() === 'POST')
 await create.getByRole('button', {name: 'Create receiver', exact: true}).click()
 const response = await created; assert.equal(response.status(), 201)
 const connection = await response.json()
 await settings.getByRole('button', {name: 'Dismiss key', exact: true}).click()
 const record = settings.locator('.connection-record').filter({hasText: receiver})
 await record.locator(':scope > summary').click()
 await expect(record.getByRole('heading', {name: 'Delivery history', exact: true})).toBeVisible()
 const localExpiry = ms => { const date = new Date(ms); return new Date(ms - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19) }
 const grant = async expires => {
  const form = record.locator('.connection-grant')
  if (!await form.evaluate(el => el.open)) await form.locator('summary').click()
  await form.getByLabel('Attempts per rolling hour', {exact: true}).fill('10')
  await form.getByLabel('Grant expiry (your local time)', {exact: true}).fill(localExpiry(expires))
  await form.getByRole('checkbox', {name: 'I authorize scheduled delivery to this origin for these events, reference fields, rate cap and expiry.', exact: true}).check()
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/plinth/connections/${connection.subscription.id}/grant` && response.request().method() === 'POST')
  await form.getByRole('button', {name: 'Approve standing grant', exact: true}).click()
  assert.equal((await saved).status(), 200)
  await expect(record.getByText('Standing grant active', {exact: true})).toBeVisible()
  await form.locator('summary').click()
 }
 const capture = async state => {
  for (const width of [1440, 390]) {
   await page.setViewportSize({width, height: 1000})
   await record.scrollIntoViewIfNeeded()
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Connections fits ' + width)
   await page.screenshot({path: `${shots}/INT-014-${state}-${width}.png`, fullPage: true, animations: 'disabled'})
  }
 }
 await grant(Date.now() + 8_000)
 await expect(record.getByText('10 attempts per rolling hour', {exact: true})).toBeVisible()
 await capture('standing-grant')
 await page.waitForTimeout(8_100)
 await settings.getByRole('button', {name: 'Refresh connections', exact: true}).click()
 await expect(record.getByText('Standing grant expired', {exact: true})).toBeVisible()
 await capture('expired')
 await grant(Date.now() + 3_600_000)
 const security = record.locator('.connection-security')
 await security.locator('summary').click()
 const rotated = page.waitForResponse(response => new URL(response.url()).pathname === `/api/plinth/connections/${connection.subscription.id}/rotate`)
 await security.getByRole('button', {name: 'Rotate signing key', exact: true}).click()
 assert.equal((await rotated).status(), 200)
 await expect(record.getByText('2', {exact: true})).toBeVisible()
 await security.getByRole('button', {name: 'Dismiss key', exact: true}).click()
 await security.locator('summary').click()
 await client.prepareChange({job_id: job.id, 'Idempotency-Key': 'synthetic-plinth-standing-' + job.id, body: {expected_version: draft.job.version, description: 'Synthetic receiver delivery reference', amount_cents: 10000}})
 const scheduled = await context.request.get(base + '/cdn-cgi/handler/scheduled?cron=0+*+*+*+*')
 assert.equal(scheduled.status(), 200, 'Local scheduled entry runs the real dispatcher')
 const deliveryRows = (await (await context.request.get(base + `/api/plinth/connections/${connection.subscription.id}/deliveries`)).json()).deliveries
 assert.ok(deliveryRows.length, 'Scheduled grant creates a real delivery attempt')
 assert.ok(deliveryRows.some(row => row.mode === 'standing' && row.consent_grant_id), 'Attempt names its standing consent')
 await record.getByRole('button', {name: 'Refresh history', exact: true}).click()
 await expect(record.locator('.connection-attempts > li')).toHaveCount(deliveryRows.length)
 await capture('delivery-history')
 for (let retry = 0; retry < 2; retry++) {
  const history = (await (await context.request.get(base + `/api/plinth/connections/${connection.subscription.id}/deliveries`)).json()).deliveries
  const due = Math.max(...history.filter(row => row.retry_at).map(row => Date.parse(row.retry_at)))
  assert.ok(Number.isFinite(due), 'Failed receiver publishes its retry due time')
  let remaining = due - Date.now() + 250
  while (remaining > 0) { const wait = Math.min(remaining, 30_000); await page.waitForTimeout(wait); remaining = due - Date.now() + 250 }
  assert.equal((await context.request.get(base + '/cdn-cgi/handler/scheduled?cron=0+*+*+*+*')).status(), 200)
 }
 await settings.getByRole('button', {name: 'Refresh connections', exact: true}).click()
 await record.getByRole('button', {name: 'Refresh history', exact: true}).click()
 await expect(record.locator(':scope > summary').getByText('Delivery paused', {exact: true})).toBeVisible()
 await expect(record.locator('.connection-attempts > li')).toHaveCount(3)
 await capture('paused')
 const stopped = await context.request.get(base + '/cdn-cgi/handler/scheduled?cron=0+*+*+*+*')
 assert.equal(stopped.status(), 200)
 const pausedLog = (await (await context.request.get(base + `/api/plinth/connections/${connection.subscription.id}/deliveries`)).json()).deliveries
 assert.equal(pausedLog.length, 3, 'Pause prevents any later outbound attempt')
 const events = (await (await context.request.get(base+`/api/plinth/connections/${connection.subscription.id}/events`)).json()).events
 assert.ok(events.length)
 // Refused consent never creates an attempt. Positive signed delivery uses the real receiver edge in domain.test.mjs.
 const denied = await context.request.post(base+`/api/plinth/connections/${connection.subscription.id}/deliver/${events[0].id}`, {headers: {origin: base}, data: {confirm: false}})
 assert.equal(denied.status(), 400)
 await record.getByRole('button', {name: 'Revoke standing grant', exact: true}).click()
 await expect(record.getByText('Standing grant revoked', {exact: true})).toBeVisible()
 await record.getByRole('button', {name: 'Refresh history', exact: true}).click()
 await expect(record.locator('.connection-attempts > li')).toHaveCount(3)
 await capture('grant-revoked')
 await security.locator('summary').click()
 await security.getByRole('checkbox', {name: 'I want to revoke this receiver and stop all further deliveries.', exact: true}).check()
 await security.getByRole('button', {name: 'Revoke receiver', exact: true}).click()
 await expect(record.getByText('Receiver revoked', {exact: true})).toBeVisible()
 const retained = page.waitForResponse(response => new URL(response.url()).pathname === `/api/plinth/connections/${connection.subscription.id}/deliveries`)
 await record.getByRole('button', {name: 'Refresh history', exact: true}).click()
 assert.equal((await retained).status(), 200)
 await capture('receiver-revoked')
 await page.setViewportSize({width: 1440, height: 1000})
 await page.reload()
 const initialAudit = page.waitForResponse(response => new URL(response.url()).pathname === '/api/plinth/audit' && !new URL(response.url()).searchParams.has('q'))
 await page.getByRole('button', {name: 'Audit history', exact: true}).click(); assert.equal((await initialAudit).status(), 200)
 await expect(page.getByRole('table')).toBeVisible()
 await page.getByLabel('Search', {exact: true}).fill(connection.subscription.id)
 const filtered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/plinth/audit' && new URL(response.url()).searchParams.get('q') === connection.subscription.id)
 await page.getByRole('button', {name: 'Search history', exact: true}).click(); assert.equal((await filtered).status(), 200)
 await expect(page.getByText('connector.consent', {exact: true})).toHaveCount(1)
 await expect(page.getByText('connector.revoke', {exact: true})).toHaveCount(1)
 await expect(page.getByText('connector.consent', {exact: true})).toBeVisible(); await expect(page.getByText('connector.revoke', {exact: true})).toBeVisible()
 const auditRows = (await (await context.request.get(base+'/api/plinth/audit?q='+connection.subscription.id)).json()).events
 for (const width of [1440,390]) {
  await page.setViewportSize({width, height: 1000}); await page.evaluate(() => scrollTo(0,0))
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), 'Audit history fits '+width)
  const checkTooltip = async control => {
   const tip = await control.getAttribute('data-tip'); assert.ok(tip && tip.trim().split(/\s+/).length >= 2)
   await control.hover(); await page.waitForTimeout(450)
   assert.equal(await control.evaluate(el => getComputedStyle(el, '::after').opacity), '1')
   await page.mouse.move(250,800); await control.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
   assert.equal(await control.evaluate(el => getComputedStyle(el, '::after').opacity), '1')
  }
  if (width === 390) {
   const menu = page.getByRole('button', {name: 'Open menu', exact: true})
   await expect(menu).toBeVisible(); await checkTooltip(menu); await menu.click()
   const close = page.getByRole('button', {name: 'Close menu', exact: true})
   await expect(close).toBeInViewport(); await checkTooltip(close); await close.click()
   await expect(close).not.toBeInViewport(); await checkTooltip(menu)
  }
  await expect(page.getByText('connector.consent', {exact: true})).toHaveCount(1)
  await expect(page.getByText('connector.revoke', {exact: true})).toHaveCount(1)
  await expect(page.locator('tbody tr')).toHaveCount(auditRows.length)
  await page.screenshot({path: `${shots}/INT-009-audit-${width}.png`, fullPage: true, animations: 'disabled'})
  if (width === 390) {
   await page.locator('.table-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth })
   await page.screenshot({path: `${shots}/INT-009-audit-owner-${width}.png`, fullPage: true, animations: 'disabled'})
  }
 }
 const history = (await (await context.request.get(base+'/api/plinth/audit?action=connector.attempt')).json()).events
 assert.ok(history.some(row => row.subject_id === connection.subscription.id), 'Standing-consent outbound attempt is audited')
 await context.close()
 console.log('INT-009 and INT-014 PASS: installed generated-client draft and approval refusal; owner receiver creation, standing grant, failure pause, real expiry, renewal, key rotation, grant and receiver revocation, retained delivery history, refused unconsented send, audit history and tooltips at 1440 and 390')
} finally { await browser.close() }
