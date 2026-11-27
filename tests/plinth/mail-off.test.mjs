import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from './helpers.mjs'
import { ownerSigninDigest } from '../../src/modules/operator-auth/owner-signin-grant.mjs'

test('mail off refuses sign-in email without provider contact, and the owner enters through a rer signin link', async () => {
 const f = await createFixture({ mailProvider: 'none' })
 try {
  const refused = await f.request('/auth/magic-link', { method: 'POST', body: { email: 'builder@example.com' } })
  assert.equal(refused.status, 503)
  assert.deepEqual(f.messages, [])
  // `rer signin` writes this row through the D1 API with the deployment's Cloudflare credentials.
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'), now = Date.now()
  const owner = await f.db.prepare("SELECT id, version FROM oa_operators WHERE role='owner'").first()
  await f.db.prepare('INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at) VALUES(?,?,?,?,?,?)')
   .bind(crypto.randomUUID(), await ownerSigninDigest(token), owner.id, owner.version, now, now + 600_000).run()
  const entered = await f.request('/auth/owner-signin', { method: 'POST', body: { token } })
  assert.equal(entered.status, 303)
  const cookie = entered.headers.getSetCookie().map(line => line.split(';')[0]).join('; ')
  const session = await f.json('/auth/session', { cookie })
  assert.equal(session.status, 200)
  assert.equal(session.value.operator.email, 'builder@example.com')
 } finally { await f.close() }
})
