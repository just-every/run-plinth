// Run one committed journey against a fresh disposable installation, without publishing dev keys.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { takeoffPlan } from '../fixtures/takeoff-plan.mjs'

async function runInstalled() {
const names = process.argv.slice(2), name = names.join('-')
assert.ok(names.length && names.every(name => ['cost-billing','punch','handover','bids','todos','bid-comparison','portal-rights','role-field','audit','role-custom','field-day','connections','correspondence','payments'].includes(name)), 'Choose punch, handover, bids, todos, bid-comparison, portal-rights, role-field, audit, role-custom, field-day, connections, correspondence or payments')
assert.ok(!existsSync('.dev.vars') && !existsSync('.wrangler/state'), 'Use a fresh disposable checkout; this runner never resets an existing installation')
const screenshotRoot = process.env.PLINTH_SCREENSHOTS_ROOT ?? join(homedir(), '.cache', 'plinth-journeys')
await mkdir(screenshotRoot, {recursive:true})
const screenshots = await mkdtemp(join(screenshotRoot, `plinth-${name}-screens-`))
const socket = createServer(); await new Promise((resolve,reject) => { socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve) })
const port = socket.address().port; await new Promise(resolve => socket.close(resolve))
const rer = resolve('node_modules/@runeditrun/rer/global/rer.mjs')
let child, output = '', exited = false
const start = () => {
 output = ''; exited = false
 child = spawn(process.execPath, [rer,'dev','--foreground','--non-interactive','--host','127.0.0.1','--port',String(port)], {detached:true,stdio:['ignore','pipe','pipe']})
 const collect = chunk => { output = (output + chunk.toString()).slice(-2_000_000) }
 child.stdout.on('data',collect); child.stderr.on('data',collect); child.once('exit',()=>{exited=true})
}
start()
const delay = ms => new Promise(resolve => setTimeout(resolve,ms))
function signal(sig) { try { process.kill(-child.pid,sig) } catch(error) { if(error.code!=='ESRCH')throw error } }
async function waitForRuntime() {
 let base, ownerOpen
 for (const deadline=Date.now()+660_000;Date.now()<deadline;) {
  base = [...output.matchAll(/RER_READY\s+(https?:\/\/\S+)/g)].at(-1)?.[1]
  ownerOpen = [...output.matchAll(/RER_OPEN\s+(https?:\/\/\S+)/g)].at(-1)?.[1]
  if(base && ownerOpen) break
  if(exited) throw new Error('rer dev stopped before ready: '+output.replace(/https?:\/\/\S+/g,'[local URL]').slice(-3000))
  await delay(1000)
 }
 assert.ok(base && ownerOpen, 'The real rer installation becomes ready within eleven minutes')
 const clean = output.replace(/\x1b\[[0-9;]*m/g, '')
 const runtimePort = [...clean.matchAll(/Local:\s+http:\/\/127\.0\.0\.1:(\d+)/g)].at(-1)?.[1]
 return {base,ownerOpen,schedulerOrigin:runtimePort ? `http://127.0.0.1:${runtimePort}` : undefined}
}
async function stop() {
 signal('SIGTERM')
 for(let n=0;n<20 && !exited;n++)await delay(1000)
 if(!exited) { signal('SIGKILL');await delay(1000) }
}
try {
 let {base,ownerOpen,schedulerOrigin} = await waitForRuntime()
 if (names.includes('connections')) {
  // This disposable receiver origin is installation configuration, never a production default.
  await stop()
  await appendFile('.dev.vars', '\nPLINTH_WEBHOOK_ORIGINS="https://example.com"\n')
  start(); ({base,ownerOpen,schedulerOrigin} = await waitForRuntime())
 }
 if (names.includes('payments')) {
  // Disposable synthetic Stripe settings turn the hosted-checkout screens on; no provider call is made.
  await stop()
  await appendFile('.dev.vars', '\nSTRIPE_SECRET_KEY="synthetic-plinth-stripe-secret-1"\nSTRIPE_WEBHOOK_SECRET="synthetic-plinth-webhook-secret-1"\n')
  start(); ({base,ownerOpen,schedulerOrigin} = await waitForRuntime())
 }
 const client = new URL(ownerOpen), fragment = new URLSearchParams(client.hash.slice(1))
 assert.ok(fragment.has('rer-dev'), 'The synthetic installation supplies its own native local dev entrance')
 fragment.set('as','client');fragment.set('next','/auth/dev/enter?as=client&returnTo=/app');client.hash=fragment.toString()
 const env = {...process.env,HOME:userInfo().homedir,PLINTH_URL:base,PLINTH_SCHEDULER_URL:schedulerOrigin,PLINTH_SITE:[...output.matchAll(/RER_SITE\s+(https?:\/\/\S+)/g)].at(-1)?.[1],PLINTH_OWNER_OPEN:ownerOpen,PLINTH_CLIENT_OPEN:client.href,PLINTH_SCREENSHOTS:screenshots}
 const bootstrap=spawn(process.execPath,['tests/journeys/installed-signin.mjs'],{env,stdio:'inherit'})
 const ready=await new Promise((resolve,reject)=>{bootstrap.once('error',reject);bootstrap.once('exit',code=>resolve(code))})
 assert.equal(ready,0,'The native setup browser uses the real HOME and completes')
 console.log('Fresh synthetic installation ready; private sign-in links withheld')
 for (const name of names) {
  const journey = spawn(process.execPath,[`tests/journeys/${name}.mjs`],{env,stdio:'inherit'})
  const result = await new Promise((resolve,reject)=>{journey.once('error',reject);journey.once('exit',code=>resolve(code))})
  assert.equal(result,0,'The installed public journey passes: '+name)
 }
 console.log('PLINTH_SCREENSHOTS='+screenshots)
} finally { await stop() }

}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runInstalled()

// Shared public-door probes extend the existing installed owner journeys.
export async function captureOffice(page, shots, name, target) {
 for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 1100 })
  if (target) await target.scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits ' + width)
  await page.screenshot({ path: `${shots}/OPS-001-${name}-${width}.png`, animations: 'disabled' })
 }
 await page.setViewportSize({ width: 1440, height: 1100 })
}

export async function failedRequest(page, url, method) {
 let attempts = 0
 const delay = 700
 const handler = async route => {
  if (route.request().method() !== method) return route.continue()
  attempts++
  await new Promise(resolve => setTimeout(resolve, delay))
  if (attempts === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'The connection is unavailable. Try again.' }) })
  else await route.continue()
 }
 await page.route(url, handler)
 return { delay, attempts: () => attempts, close: () => page.unroute(url, handler) }
}

async function describedError(control) {
 await expect(control).toHaveAttribute('aria-invalid', 'true')
 const description = await control.evaluate(element => element.getAttribute('aria-describedby')?.split(' ').map(id => document.getElementById(id)?.textContent).join(' '))
 assert.ok(description?.trim(), 'The invalid field exposes a readable error through its accessibility description')
 await expect(control).toBeFocused()
}

export async function officeRecovery({ page, context, base, email, shots }) {
 await page.setViewportSize({ width: 1440, height: 1100 })
 const readFailure = await failedRequest(page, '**/api/plinth/jobs', 'GET'), began = Date.now()
 await page.goto(base + '/app')
 await expect(page.getByRole('region', { name: 'Opening workspace', exact: true }).getByRole('status')).toContainText('seconds elapsed')
 await expect(page.getByRole('alert')).toContainText('No empty or up-to-date result is confirmed')
 await expect(page.getByText('No jobs shared yet', { exact: true })).toHaveCount(0)
 const retry = page.getByRole('button', { name: 'Retry opening workspace', exact: true })
 await retry.focus(); await page.keyboard.press('Enter')
 await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible()
 await readFailure.close()
 console.log(JSON.stringify({ office: 'jobs read failure and keyboard retry', elapsed_ms: Date.now() - began, delayed_ms: readFailure.delay }))
 const form = page.getByRole('form', { name: 'Create job', exact: true })
 await form.getByRole('button', { name: 'Create job', exact: true }).click()
 await describedError(form.getByLabel('Job name', { exact: true }))
 const name = 'Synthetic Plinth office renovation with a long household and project name — kitchen, laundry, accessible entry and rear extension'
 const address = '2480 Maple Street — rear building, kitchen and laundry delivery entrance, Burlington'
 await form.getByLabel('Job name', { exact: true }).fill(name)
 await page.keyboard.press('Tab')
 await expect(form.getByLabel('Client email', { exact: true })).toBeFocused()
 await page.keyboard.type(email)
 await form.getByLabel('Site address', { exact: true }).fill(address)
 await form.getByLabel('Job time zone (IANA)', { exact: true }).fill('America/New_York')
 const ax = await context.newCDPSession(page), tree = await ax.send('Accessibility.getFullAXTree')
 assert.ok(tree.nodes.some(node => node.role?.value === 'textbox' && node.name?.value === 'Job name'), 'Browser accessibility tree exposes the labelled job field')
 await ax.detach()
 const createFailure = await failedRequest(page, '**/api/plinth/jobs', 'POST')
 await form.getByRole('button', { name: 'Create job', exact: true }).click()
 await expect(form.getByRole('status')).toContainText('seconds elapsed')
 await expect(form.getByRole('alert')).toBeFocused()
 await expect(form.getByLabel('Job name', { exact: true })).toHaveValue(name)
 await expect(form.getByLabel('Client email', { exact: true })).toHaveValue(email)
 await expect(form.getByLabel('Site address', { exact: true })).toHaveValue(address)
 await expect(form.getByLabel('Job time zone (IANA)', { exact: true })).toHaveValue('America/New_York')
 const stored = await (await context.request.get(base + '/api/plinth/jobs')).json()
 assert.ok(!stored.jobs.some(job => job.name === name), 'Refused create leaves no acknowledged job')
 await captureOffice(page, shots, 'jobs-retained-draft', form)
 await page.setViewportSize({ width: 390, height: 1100 })
 const menu = page.getByRole('button', { name: 'Open menu', exact: true })
 await menu.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab')
 await expect(menu).toBeFocused()
 assert.equal(await menu.evaluate(element => getComputedStyle(element, '::after').visibility), 'visible', 'Icon tooltip appears immediately on keyboard focus')
 await page.keyboard.press('Enter')
 const close = page.getByRole('button', { name: 'Close menu', exact: true })
 await expect(close).toBeFocused()
 const brand = page.getByRole('dialog', { name: 'Workspace', exact: true }).locator('.lockup')
 await page.keyboard.press('Shift+Tab'); await expect(brand).toBeFocused()
 await page.keyboard.press('Shift+Tab')
 await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused()
 await page.keyboard.press('Tab'); await expect(brand).toBeFocused()
 await page.keyboard.press('Tab'); await expect(close).toBeFocused()
 await page.keyboard.press('Escape')
 await expect(menu).toBeFocused()
 await expect(page.getByRole('dialog', { name: 'Workspace', exact: true })).toHaveCount(0)
 await page.setViewportSize({ width: 1440, height: 1100 })
 await form.getByRole('button', { name: 'Create job', exact: true }).focus(); await page.keyboard.press('Enter')
 const heading = page.getByRole('heading', { name, exact: true })
 await expect(heading).toBeFocused()
 await createFailure.close()
 const savedId = new URL(page.url()).searchParams.get('job')
 await page.reload(); await expect(heading).toBeVisible()
 const saved = (await (await context.request.get(base + '/api/plinth/jobs/' + savedId)).json()).job
 assert.equal(saved.name, name); assert.equal(saved.address, address); assert.equal(saved.client_email, email); assert.equal(saved.time_zone, 'America/New_York')

 const jobFailure = await failedRequest(page, '**/api/plinth/jobs/' + savedId, 'GET')
 await page.reload()
 await expect(page.getByRole('region', { name: 'Opening job', exact: true }).getByRole('status')).toContainText('seconds elapsed')
 await expect(page.getByRole('button', { name: 'Retry opening job', exact: true })).toBeVisible()
 await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0)
 await page.getByRole('button', { name: 'Retry opening job', exact: true }).focus(); await page.keyboard.press('Enter')
 await expect(heading).toBeFocused()
 await jobFailure.close()

 const searchFailure = await failedRequest(page, '**/api/plinth/search?*', 'GET')
 await page.getByRole('searchbox', { name: 'Search jobs', exact: true }).fill('Synthetic Plinth office')
 await expect(page.getByRole('button', { name: 'Retry searching jobs', exact: true })).toBeVisible()
 await expect(page.getByRole('heading', { name: /No jobs match/ })).toHaveCount(0)
 await page.getByRole('button', { name: 'Retry searching jobs', exact: true }).focus(); await page.keyboard.press('Enter')
 await expect(page.getByRole('list', { name: 'Jobs', exact: true }).getByRole('button', { name: new RegExp(name.slice(0, 35)) })).toBeVisible()
 await searchFailure.close()
 await page.getByRole('button', { name: 'Clear search', exact: true }).click()
 console.log('OPS-001 Jobs PASS: failed reads and saves, retained draft, keyboard retry and drawer recovery, accessibility tree and reload of every acknowledged field')
}

export async function officeSearch({ page, base, job, section, shots }) {
 await page.setViewportSize({ width: 1440, height: 1100 })
 await page.goto(`${base}/app?job=${job.id}&tab=${section}`)
 await expect(page.getByRole('heading', { name: job.name, exact: true })).toBeFocused()
 const search = page.getByRole('searchbox', { name: 'Search jobs', exact: true })
 await search.focus()
 await page.keyboard.type('Maple', { delay: 100 })
 await expect(search).toHaveValue('Maple')
 await expect(search).toBeFocused()
 const result = page.getByRole('list', { name: 'Jobs', exact: true }).getByRole('button').filter({ hasText: job.name })
 await expect(result).toBeVisible()
 await expect(page.getByRole('button', { name: section, exact: true })).toHaveCount(0)
 await captureOffice(page, shots, section.toLowerCase() + '-search-keeps-focus', search)
 await search.press('Backspace')
 await expect(search).toHaveValue('Mapl')
 await expect(search).toBeFocused()
 await result.focus()
 await page.keyboard.press('Enter')
 await expect(page.getByRole('heading', { name: job.name, exact: true })).toBeFocused()
 await expect(search).toHaveValue('')
 await page.goto(`${base}/app?job=${job.id}&tab=${section}`)
 console.log('OPS-001 ' + section + ' search PASS: keyboard typing and editing retain focus, matching job opens with heading focus')
}

export async function uploadRecovery({ page, context, base, jobId, shots }) {
 await page.getByText('Drawing takeoff', { exact: true }).click()
 const panel = page.getByText('Drawing takeoff', { exact: true }).locator('..')
 const upload = panel.getByText('Upload drawing', { exact: true }).locator('..')
 await upload.locator('summary').click()
 const form = upload.getByRole('form', { name: 'Upload drawing sheet', exact: true }), bytes = takeoffPlan()
 await form.getByLabel('Drawing sheet name', { exact: true }).fill('Synthetic Plinth kitchen and laundry original')
 await form.getByLabel('PDF drawing', { exact: true }).setInputFiles({ name: 'synthetic-plinth-1.pdf', mimeType: 'application/pdf', buffer: bytes })
 await expect(form.getByText('2 pages in this PDF.', { exact: false })).toBeVisible()
 await expect(form.getByText('Source coordinates:', { exact: false })).toBeVisible()
 const slow = await context.newCDPSession(page)
 await slow.send('Network.enable')
 await slow.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 180000, uploadThroughput: 60000 })
 const failure = await failedRequest(page, '**/api/plinth/jobs/' + jobId + '/takeoff', 'POST')
 let start = Date.now()
 await form.getByRole('button', { name: 'Upload drawing sheet', exact: true }).click()
 await expect(form.getByRole('status')).toContainText('seconds elapsed')
 await expect(form.getByRole('alert')).toBeFocused()
 await expect(form.getByLabel('Drawing sheet name', { exact: true })).toHaveValue('Synthetic Plinth kitchen and laundry original')
 assert.equal(await form.getByLabel('PDF drawing', { exact: true }).evaluate(element => element.files[0]?.name), 'synthetic-plinth-1.pdf')
 assert.equal(((await (await context.request.get(base + '/api/plinth/jobs/' + jobId)).json()).job.takeoff ?? []).length, 0)
 await captureOffice(page, shots, 'quote-upload-retry', form)
 const failedMs = Date.now() - start
 start = Date.now()
 await form.getByRole('button', { name: 'Upload drawing sheet', exact: true }).focus(); await page.keyboard.press('Enter')
 await expect(form.getByRole('status')).toHaveText('Saved.')
 await expect(form.getByRole('timer', { name: 'Request duration', exact: true })).toContainText('seconds')
 await expect(form.getByRole('button', { name: 'Upload drawing sheet', exact: true })).toBeFocused()
 await failure.close()
 const savedMs = Date.now() - start
 await slow.detach()
 await page.reload()
 await page.getByText('Drawing takeoff', { exact: true }).click()
 const original = page.getByRole('link', { name: 'Download original PDF · synthetic-plinth-1.pdf', exact: true })
 await expect(original).toBeVisible()
 const downloaded = await context.request.get(new URL(await original.getAttribute('href'), base).href)
 assert.ok(downloaded.ok()); assert.deepEqual(await downloaded.body(), bytes, 'The acknowledged upload keeps the identical original after reload')
 console.log(JSON.stringify({ office: 'failed and successful PDF upload under browser network throttling', failed_ms: failedMs, saved_ms: savedMs, bytes: bytes.length, latency_ms: 80 }))
}
