import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { resolve, join } from 'node:path'
import { chromium } from '@playwright/test'
import { installedWorker } from './installed-worker.mjs'
import { providerEdge } from './provider-edge.mjs'
import { nativeSignIn } from './native-signin.mjs'
import { requireStatus } from './diagnostics.mjs'

const name = process.argv[2]
assert.ok(['invoice-corrections', 'cost-billing', 'settlements', 'meetings', 'portfolio', 'report-packets', 'bid-follow-up', 'satisfaction', 'plans'].includes(name), 'Choose an installed product journey')
assert.equal(process.env.HOME, userInfo().homedir, 'Browser-driving Node uses the real account HOME')
const shots = resolve(process.env.PLINTH_SCREENSHOTS_ROOT ?? 'artifacts/installed', name)
await mkdir(shots, { recursive: true })
const scratch = await mkdtemp(join(tmpdir(), 'synthetic-plinth-'))
let provider, worker, browser, journey
const signal = value => { if (journey?.pid) { try { process.kill(-journey.pid, value) } catch (error) { if (error.code !== 'ESRCH') throw error } } }
const stop = () => signal('SIGTERM')
process.once('SIGTERM', stop); process.once('SIGINT', stop)
try {
 provider = await providerEdge()
 worker = await installedWorker(provider.outboundService, ['settlements','portfolio','report-packets','bid-follow-up'].includes(name) ? {now: Date.parse('2026-10-27T15:00:00Z')} : {})
 const ownerState = join(scratch, 'owner.json'), clientState = join(scratch, 'client.json')
 Object.assign(process.env, {
  PLINTH_URL: worker.origin, PLINTH_STATE: ownerState, PLINTH_CLIENT_STATE: clientState,
  PLINTH_PROVIDER_EDGE_URL: provider.url, PLINTH_EMAIL_URL: worker.origin,
  PLINTH_MAIL_OUTCOME: 'Accepted by the mail provider; delivery is not confirmed', PLINTH_SCREENSHOTS: shots,
 })
 browser = await chromium.launch({ headless: true, executablePath:process.env.PLINTH_CHROMIUM_PATH,args: ['--use-mock-keychain', '--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])] })
 const owner = await browser.newContext(), page = await owner.newPage()
 const post = (path, data) => owner.request.post(worker.origin + path, { maxRedirects: 0, headers: { origin: worker.origin }, data })
 await requireStatus(await post('/auth/bootstrap', { token: worker.bindings.SETUP_TOKEN, displayName: 'Synthetic Plinth builder', returnTo: '/app' }), 303, 'Native installation bootstrap', worker)
 // Sign out the bootstrap session; prove the ordinary native email confirmation.
 await requireStatus(await post('/auth/signout', {}), 204, 'Native sign-out', worker)
 await requireStatus(await post('/auth/magic-link', { email: worker.bindings.OWNER_EMAIL, returnTo: '/app' }), 202, 'Native sign-in email', worker)
 await nativeSignIn(page, worker.bindings.OWNER_EMAIL)
 await page.goto(worker.origin + '/app')
 assert.equal(new URL(page.url()).pathname, '/setup', 'Fresh installation requires native owner setup')
 await page.getByLabel('Your name', { exact: true }).fill('Synthetic Plinth builder')
 await page.getByRole('checkbox').check()
 await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
 await page.waitForURL('**/app')
 await owner.storageState({ path: ownerState })
 await requireStatus(await post('/auth/invite', { email: 'client@dev.localhost', displayName: 'Synthetic Plinth client', role: 'member', returnTo: '/app' }), 202, 'Native client invitation', worker)
 const client = await browser.newContext(), clientPage = await client.newPage()
 await nativeSignIn(clientPage, 'client@dev.localhost')
 await client.storageState({ path: clientState })
 await browser.close(); browser = undefined
 console.log(`Installed ${name}: emitted Worker, migrated D1, native email sign-in; provider boundary is synthetic`)
 for(const journeyName of name==='plans'?['plans','submittals']:[name]){
 journey = spawn(process.execPath, [`tests/journeys/${journeyName}.mjs`], { env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
 // Assertion stacks must never disclose a native confirmation URL or token.
 const redact = line => line.replace(/https?:\/\/[^\s"'<>]*\/auth\/confirm[^\s"'<>]*/g, '[native confirmation withheld]').replace(/(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, '[provider secret withheld]')
 for (const stream of [journey.stdout, journey.stderr]) {
  let pending = ''
  stream.on('data', chunk => { const lines = (pending + chunk.toString()).split('\n'); pending = lines.pop(); for (const line of lines) console.log(redact(line)) })
  stream.on('end', () => { if (pending) console.log(redact(pending)) })
 }
 const timeout = setTimeout(() => { console.error('Installed journey exceeded twenty minutes'); signal('SIGTERM'); setTimeout(() => signal('SIGKILL'), 5000).unref() }, 20 * 60_000)
 try {
  const code = await new Promise((resolve, reject) => { journey.once('error', reject); journey.once('exit', resolve) })
  assert.equal(code, 0, `Installed ${journeyName} journey passed at 1440 and 390`)
 } finally { clearTimeout(timeout); signal('SIGKILL'); journey = undefined }
 }
} finally {
 signal('SIGKILL')
 await browser?.close()
 await worker?.close()
 await provider?.close()
 await rm(scratch, { recursive: true, force: true })
 process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop)
}
