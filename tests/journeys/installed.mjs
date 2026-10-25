// Run one committed journey against a fresh disposable installation, without publishing dev keys.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'

const names = process.argv.slice(2), name = names.join('-')
assert.ok(names.length && names.every(name => ['cost-billing','punch','handover','bids','todos','bid-comparison','portal-rights','role-field','audit','role-custom','field-day','connections'].includes(name)), 'Choose punch, handover, bids, todos, bid-comparison, portal-rights, role-field, audit, role-custom field-day or connections')
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
async function ready() {
 let base, ownerOpen
 for (const deadline=Date.now()+660_000;Date.now()<deadline;) {
  base = [...output.matchAll(/RER_READY\s+(https?:\/\/\S+)/g)].at(-1)?.[1]
  ownerOpen = [...output.matchAll(/RER_OPEN\s+(https?:\/\/\S+)/g)].at(-1)?.[1]
  if(base && ownerOpen) break
  if(exited) throw new Error('rer dev stopped before ready: '+output.replace(/https?:\/\/\S+/g,'[local URL]').slice(-3000))
  await delay(1000)
 }
 assert.ok(base && ownerOpen, 'The real rer installation becomes ready within eleven minutes')
 return {base,ownerOpen}
}
async function stop() {
 signal('SIGTERM')
 for(let n=0;n<20 && !exited;n++)await delay(1000)
 if(!exited) { signal('SIGKILL');await delay(1000) }
}
try {
 let {base,ownerOpen} = await ready()
 if (names.includes('connections')) {
  // This disposable receiver origin is installation configuration, never a production default.
  await stop()
  await appendFile('.dev.vars', '\nPLINTH_WEBHOOK_ORIGINS="https://example.com"\n')
  start(); ({base,ownerOpen} = await ready())
 }
 const client = new URL(ownerOpen), fragment = new URLSearchParams(client.hash.slice(1))
 assert.ok(fragment.has('rer-dev'), 'The synthetic installation supplies its own native local dev entrance')
 fragment.set('as','client');fragment.set('next','/auth/dev/enter?as=client&returnTo=/app');client.hash=fragment.toString()
 const env = {...process.env,HOME:userInfo().homedir,PLINTH_URL:base,PLINTH_SITE:[...output.matchAll(/RER_SITE\s+(https?:\/\/\S+)/g)].at(-1)?.[1],PLINTH_OWNER_OPEN:ownerOpen,PLINTH_CLIENT_OPEN:client.href,PLINTH_SCREENSHOTS:screenshots}
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
