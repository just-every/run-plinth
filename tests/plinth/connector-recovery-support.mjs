import assert from 'node:assert/strict'
import {createFixture} from './helpers.mjs'
import {createClient} from '../../src/plinth/api-client.mjs'

/** Real CLI-restored database and native receiving-owner sign-in. */
export async function proveConnectorRecovery(destination, oldCookie, expected, revokedId, oldCredential, oldKey, receivingEmail = ['builder','example.com'].join('@')) {
 const received = [], f = await createFixture({persistTo: destination, ownerCookie: oldCookie, webhookReceiver: async request => { received.push(await request.text()); return new Response(null, {status: 202}) }})
 try {
  const confirmMail = async cookie => {
   const url = new URL(f.messages.at(-1).text.match(/https?:\/\/[^\s<>]+/g).find(value => new URL(value).pathname === '/auth/confirm'))
   const response = await f.request('/auth/confirm', {method: 'POST', cookie, body: {token: url.searchParams.get('token')}})
   assert.equal(response.status, 303)
   return response.headers.get('set-cookie')?.split(';')[0] ?? cookie
  }
  assert.equal((await f.request('/api/plinth/connections/recovery', {cookie: oldCookie})).status, 401, 'Source sessions cannot read restored bindings')
  assert.equal((await f.request('/auth/magic-link', {method: 'POST', body: {email: receivingEmail}})).status, 202)
  const owner = await confirmMail()
  const post = (path, body) => f.json(path, {method: 'POST', cookie: owner, body})
  const pending = await f.json('/api/plinth/connections/recovery', {cookie: owner})
  assert.equal(pending.status, 200)
  const client = createClient({origin: f.origin, cookie: owner, fetch: (url, init) => f.mf.dispatchFetch(url, init)})
  assert.deepEqual(await client.listConnectionRecovery(), pending.value, 'Generated versioned recovery and native recovery agree')
  assert.ok((await client.listConnectionRecovery({after: expected.id})).bindings.every(row => row.id > expected.id))
  assert.deepEqual(pending.value.bindings.find(row => row.id === expected.id), expected)
  assert.ok(pending.value.bindings.find(row => row.id === revokedId).revoked_at)
  assert.deepEqual((await f.json('/api/plinth/connections', {cookie: owner})).value.subscriptions, [])
  await f.scheduled(Date.now()); assert.equal(received.length, 0, 'Restoring the binding never restores standing consent')
  const input = {recovery_id: expected.id, receiver: expected.receiver_origin+'/new-endpoint', job_ids: expected.job_ids, event_types: expected.event_types, confirm: true, credential_id: oldCredential}
  assert.equal((await post('/api/plinth/connections', input)).status, 403, 'Source credentials do not authorize the destination')
  assert.equal((await f.request('/auth/step-up', {method: 'POST', cookie: owner, body: {action: 'credentials:mint', returnTo: '/app'}})).status, 202)
  await confirmMail(owner)
  const minted = await post('/api/plinth/agent-credentials', {expires_in_seconds: 3600})
  assert.equal(minted.status, 201); input.credential_id = minted.value.credential.id
  for (const change of [{confirm: false}, {job_ids: []}, {event_types: ['change.approved']}, {recovery_id: revokedId}, {receiver: 'https://unconfigured.example/events'}]) {
   const denied = await post('/api/plinth/connections', {...input, ...change})
   assert.ok(denied.status >= 400 && denied.status < 500, JSON.stringify(denied.value))
   assert.equal((await f.json('/api/plinth/connections', {cookie: owner})).value.subscriptions.length, 0)
  }
  const result = await post('/api/plinth/connections', input)
  assert.equal(result.status, 201, JSON.stringify(result.value))
  assert.equal(result.value.subscription.id, expected.id)
  assert.equal(result.value.subscription.receiver, input.receiver)
  assert.notEqual(result.value.signing_key, oldKey)
  assert.equal(result.value.subscription.grant_id, null)
  assert.equal(result.value.subscription.credential_id, input.credential_id)
  assert.ok(!(await f.json('/api/plinth/connections/recovery', {cookie: owner})).value.bindings.some(row => row.id === expected.id))
  const duplicate = await post('/api/plinth/connections', input)
  assert.ok(duplicate.status >= 400 && duplicate.status < 500, 'Repeated restoration cannot create a duplicate receiver')
  await f.scheduled(Date.now()); assert.equal(received.length, 0, 'Explicit receiver recovery still requires separate standing consent')
 } finally { await f.close() }
}
