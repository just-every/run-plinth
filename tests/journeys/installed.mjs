// Run one committed journey against a fresh disposable installation, without publishing dev keys.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from '@playwright/test'

const name = process.argv[2]
assert.ok(['punch','handover','bids','todos'].includes(name), 'Choose punch, handover, bids or todos')
assert.ok(!existsSync('.dev.vars') && !existsSync('.wrangler/state'), 'Use a fresh disposable checkout; this runner never resets an existing installation')
const screenshotRoot = join(homedir(), '.cache', 'plinth-journeys')
await mkdir(screenshotRoot, {recursive:true})
const screenshots = await mkdtemp(join(screenshotRoot, `plinth-${name}-screens-`))
const socket = createServer(); await new Promise((resolve,reject) => { socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve) })
const port = socket.address().port; await new Promise(resolve => socket.close(resolve))
const rer = resolve('node_modules/@runeditrun/rer/global/rer.mjs')
const child = spawn(process.execPath, [rer,'dev','--foreground','--non-interactive','--host','127.0.0.1','--port',String(port)], { detached: true, stdio: ['ignore','pipe','pipe'] })
let output = '', exited = false
const collect = chunk => { output = (output + chunk.toString()).slice(-2_000_000) }
child.stdout.on('data',collect);child.stderr.on('data',collect);child.once('exit',()=>{exited=true})
const delay = ms => new Promise(resolve => setTimeout(resolve,ms))
function signal(sig) { try { process.kill(-child.pid,sig) } catch(error) { if(error.code!=='ESRCH')throw error } }
try {
 let base, ownerOpen
 for (const deadline=Date.now()+660_000;Date.now()<deadline;) {
  base = [...output.matchAll(/RER_READY\s+(https?:\/\/\S+)/g)].at(-1)?.[1]
  ownerOpen = [...output.matchAll(/RER_OPEN\s+(https?:\/\/\S+)/g)].at(-1)?.[1]
  if(base && ownerOpen) break
  if(exited) throw new Error('rer dev stopped before ready: '+output.replace(/https?:\/\/\S+/g,'[local URL]').slice(-3000))
  await delay(1000)
 }
 assert.ok(base && ownerOpen, 'The real rer installation becomes ready within eleven minutes')
 const client = new URL(ownerOpen), fragment = new URLSearchParams(client.hash.slice(1))
 assert.ok(fragment.has('rer-dev'), 'The synthetic installation supplies its own native local dev entrance')
 fragment.set('as','client');fragment.set('next','/auth/dev/enter?as=client&returnTo=/app');client.hash=fragment.toString()
 const env = {...process.env,PLINTH_URL:base,PLINTH_OWNER_OPEN:ownerOpen,PLINTH_CLIENT_OPEN:client.href,PLINTH_SCREENSHOTS:screenshots}
 const browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {
  const context = await browser.newContext(), page = await context.newPage()
  await page.goto(ownerOpen);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'));await page.goto(base+'/app')
  if(new URL(page.url()).pathname==='/setup') {
   await page.getByLabel('Your name',{exact:true}).fill('Morgan Mason, builder')
   await page.getByRole('checkbox',{name:'I confirm this owner account is ready to use.'}).check()
   await page.getByRole('button',{name:'Finish setup',exact:true}).click();await page.waitForURL('**/app')
  }
  await context.close()
 } finally { await browser.close() }
 console.log('Fresh synthetic installation ready; private sign-in links withheld')
 const journey = spawn(process.execPath,[`tests/journeys/${name}.mjs`],{env,stdio:'inherit'})
 const result = await new Promise((resolve,reject)=>{journey.once('error',reject);journey.once('exit',code=>resolve(code))})
 assert.equal(result,0,'The installed public journey passes')
 console.log('PLINTH_SCREENSHOTS='+screenshots)
} finally {
 signal('SIGTERM')
 for(let n=0;n<20 && !exited;n++)await delay(1000)
 if(!exited) { signal('SIGKILL');await delay(1000) }
}
