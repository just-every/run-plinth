import { queuedEntrypoint } from '@runeditrun/rer/queued-entry'
const queued = await queuedEntrypoint(import.meta.url, 'verify:email-link'); if (queued !== null) process.exit(queued)
// Ordinary email authentication against the emitted Worker. Only the paid
// provider boundary is fake; local development mail is silently suppressed.
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'

const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`, owner = 'owner@example.test', messages = []
const bindings = { AUTH_LOCAL: 'true', AUTH_ORIGIN: origin, OWNER_EMAIL: owner, SESSION_SECRET: randomBytes(32).toString('hex'), SETUP_TOKEN: randomBytes(32).toString('hex'), MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'test-provider-edge-only', MAIL_FROM: 'auth@example.test' }
const mf = new Miniflare(convertV4MiniflareOptions({
  host: '127.0.0.1', port, modules: [{ type: 'ESModule', path: resolve('dist/server/index.js') }, ...(await readdir('dist/server/assets')).filter(f => f.endsWith('.js')).map(f => ({ type: 'ESModule', path: resolve('dist/server/assets/' + f) }))], modulesRoot: resolve('dist/server'),
  compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], bindings,
  outboundService: async request => {
    assert.equal(request.url, 'https://api.resend.com/emails')
    messages.push(await request.json())
    return Response.json({ id: randomBytes(16).toString('hex') })
  },
}))
const post = (path, body, cookie) => fetch(origin + path, { method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
try {
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations/core')).filter(f => f.endsWith('.sql')).sort()) {
    const sql = unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).filter(s => s.replace(/--[^\n]*/g, '').trim())
    if (sql.length) await db.batch(sql.map(s => db.prepare(s)))
  }
  await mf.ready
  assert.equal((await post('/auth/bootstrap', { token: bindings.SETUP_TOKEN, displayName: 'Owner' })).status, 303, 'owner claimed')
  assert.equal((await post('/auth/magic-link', { email: owner })).status, 202, 'ordinary sign-in link accepted')
  const message = messages.find(m => m.to.includes(owner))
  assert.ok(message, 'configured provider receives the actual authentication mail')
  const link = new URL(message.text.match(/https?:\/\/[^\s<>]+/g).find(value => new URL(value).pathname === '/auth/confirm'))
  assert.equal(link.origin, origin)
  assert.equal((await fetch(link)).status, 200, 'confirmation page')
  const confirmed = await post('/auth/confirm', { token: link.searchParams.get('token') })
  assert.equal(confirmed.status, 303)
  const cookie = confirmed.headers.getSetCookie().map(line => line.split(';')[0]).join('; ')
  const session = await fetch(origin + '/auth/session', { headers: { cookie } })
  assert.equal(session.status, 200)
  assert.equal((await session.json()).operator.email, owner)
  console.log('Email-link sign-in passed against emitted Worker: bootstrap, provider delivery, confirmation, session')
} finally { await mf.dispose() }
