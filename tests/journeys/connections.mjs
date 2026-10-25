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
 const consent = {credential_id: credential.id, receiver: 'https://example.com/plinth-events', job_ids: [job.id], event_types: ['job.updated'], confirm: true}
 const connection = await post('/connections', consent)
 const events = (await (await context.request.get(base+`/api/plinth/connections/${connection.subscription.id}/events`)).json()).events
 assert.ok(events.length)
 // Browser proof records the refused attempt; positive signed sends use the permitted receiver edge in domain.test.mjs.
 const denied = await context.request.post(base+`/api/plinth/connections/${connection.subscription.id}/deliver/${events[0].id}`, {headers: {origin: base}, data: {confirm: false}})
 assert.equal(denied.status(), 400)
 await post(`/connections/${connection.subscription.id}/revoke`)
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
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.screenshot({path: `${shots}/INT-009-audit-${width}.png`, fullPage: true, animations: 'disabled'})
  if (width === 390) {
   await page.locator('.table-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth })
   await page.screenshot({path: `${shots}/INT-009-audit-owner-${width}.png`, fullPage: true, animations: 'disabled'})
  }
 }
 const history = (await (await context.request.get(base+'/api/plinth/audit?action=connector.attempt')).json()).events
 assert.equal(history.length, 0, 'No unconsented outbound attempt was created')
 await context.close()
 console.log('INT-009 PASS: installed generated-client draft and approval refusal, owner receiver consent and revoke, unconsented send refusal, audit history and icon tooltips at 1440 and 390')
} finally { await browser.close() }
