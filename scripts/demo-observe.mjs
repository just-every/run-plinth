// Test-host observations stay in run-demo, where the deployment token lives.
// Retain only demo events, never request headers, cookies, bodies or addresses.
import { appendFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
// Trace sockets need protocol pings while no visitors are using the host.
const WebSocket = createRequire(realpathSync(new URL('../node_modules/wrangler/package.json', import.meta.url)))('ws')

const [mode, output] = process.argv.slice(2)
if (!['quiet', 'cohort'].includes(mode) || !output) throw Error('Use quiet|cohort and an output path')
const account = process.env.CLOUDFLARE_ACCOUNT_ID
if (account !== 'b20c0ca9cab0c2b70e13d7cf724b89bd') throw Error('RunEditRun account required')
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/plinth-demo-test--demo/tails`
const headers = { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' }
const response = await fetch(endpoint, { method: 'POST', headers, body: '{}' })
const value = await response.json()
if (!response.ok || !value.success) throw Error(`Cannot observe test host: ${response.status}`)
const tail = value.result, socket = new WebSocket(tail.url, 'trace-v1')
socket.binaryType = 'arraybuffer'
const record = row => appendFileSync(output, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n')
let admitted = 0, disconnected = false, stopping = false, ping, timer, failed, lastPong = Date.now(), pongs = 0
socket.on('pong', () => { lastPong = Date.now(); pongs++ })
socket.addEventListener('message', message => {
 const event = JSON.parse(typeof message.data === 'string' ? message.data : new TextDecoder().decode(message.data))
 for (const log of event.logs ?? []) for (const part of log.message ?? []) {
  if (typeof part !== 'string') continue
  let item; try { item = JSON.parse(part) } catch { continue }
  if (!String(item.event ?? '').startsWith('demo_')) continue
  if (item.event === 'demo_admitted') admitted++
  record({ event: item })
 }
})
socket.addEventListener('close', () => {
 if (!stopping) { disconnected = true; failed?.(Error('Test-host observation was interrupted')) }
})
try {
 await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(Error('Test-host observer disconnected')), { once: true }) })
 ping = setInterval(() => {
  if (Date.now() - lastPong > 30_000) return socket.terminate()
  if (socket.readyState === WebSocket.OPEN) socket.ping('wrangler tail ping')
 }, 10_000)
 record({ mode, state: 'observing' })
 console.log(`Observing ${mode} test-host window`)
 await new Promise((resolve, reject) => {
  failed = reject
  timer = setTimeout(resolve, mode === 'quiet' ? 900_000 : 420_000)
 })
 record({ mode, state: 'complete', admitted, disconnected, pongs })
 if (disconnected) throw Error('Observation window was interrupted')
 if (mode === 'quiet' && admitted) throw Error('Test host admitted a visitor during the quiet window; wait for those demos to expire')
 console.log(`${mode} window complete: ${admitted} admissions`)
} finally {
 stopping = true; clearInterval(ping); clearTimeout(timer); socket.close()
 const removed = await fetch(endpoint + '/' + tail.id, { method: 'DELETE', headers, signal: AbortSignal.timeout(15_000) })
 if (!removed.ok) throw Error(`Cannot remove observer: ${removed.status}`)
}

process.exit(0)
