import { createServer } from 'node:net'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'
import { diagnostic } from './diagnostics.mjs'

// The same emitted entry and assets deployed by rer build; never the API-only test entry.
export async function installedWorker(outboundService, { now, persistTo } = {}) {
 const socket = createServer()
 await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve) })
 const port = socket.address().port
 await new Promise(resolve => socket.close(resolve))
 const origin = `http://127.0.0.1:${port}`
 const bindings = {
  AUTH_LOCAL: 'true', AUTH_ORIGIN: origin, OWNER_EMAIL: 'builder@example.com',
  SESSION_SECRET: 'synthetic-plinth-1-synthetic-plinth-1', SETUP_TOKEN: 'synthetic-plinth-2-synthetic-plinth-2',
  MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'synthetic-plinth-3', MAIL_FROM: 'builder@example.com', MAIL_REPLY_DOMAIN: 'synthetic-plinth.example',
  STRIPE_SECRET_KEY: 'synthetic-plinth-4', STRIPE_WEBHOOK_SECRET: 'synthetic-plinth-webhook-secret-1',
 }
 const errors = []
 const mf = new Miniflare({...convertV4MiniflareOptions({
  host: '127.0.0.1', port, unsafeTriggerHandlers: true, modulesRoot: resolve('dist/server'),
  modules: [...(now === undefined ? [] : [{ type: 'ESModule', path: resolve('dist/server/pinned-clock.mjs'), contents: `import worker from './index.js'; const NativeDate=Date; globalThis.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:[${Number(now)}]))} static now(){return ${Number(now)}} }; export default worker;` }]), { type: 'ESModule', path: resolve('dist/server/index.js') }, ...(await readdir('dist/server/assets')).filter(file => file.endsWith('.js')).map(file => ({ type: 'ESModule', path: resolve('dist/server/assets', file) }))],
  compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
  d1Databases: persistTo?{DB:'local-foundation-only'}:['DB'], ...(persistTo?{d1Persist:join(persistTo,'.wrangler/state/v3/d1')}:{}), bindings, outboundService,
  assets: { directory: resolve('dist/client'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } },
  handleUncaughtError: error => { errors.push(diagnostic(error.stack ?? error, bindings)); if (errors.length > 5) errors.shift() },
 }),...(persistTo?{resourcePersistencePath:join(persistTo,'.wrangler/state/v3')}:{})})
 try {
  const db = await mf.getD1Database('DB')
  if(!persistTo)for (const file of (await readdir('migrations/core')).filter(file => file.endsWith('.sql')).sort()) {
   const statements = unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).filter(sql => sql.replace(/--[^\n]*/g, '').trim())
   if (statements.length) await db.batch(statements.map(sql => db.prepare(sql)))
  }
  await mf.ready
  return { origin, bindings, diagnostics: () => [...errors], close: () => mf.dispose() }
 } catch (error) { await mf.dispose(); throw error }
}
