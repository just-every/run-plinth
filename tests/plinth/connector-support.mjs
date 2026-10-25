import assert from 'node:assert/strict'
import {createFixture, createActiveJob} from './helpers.mjs'

/** All setup crosses native authenticated business doors; only the receiver and DNS are edge fakes. */
export async function connectorFixture(options = {}) {
 const received = []
 const f = await createFixture({webhookReceiver: async request => {
  received.push({url: request.url, raw: await request.text(), signature: request.headers.get('plinth-signature')})
  return options.receive ? options.receive(request, f) : new Response(null, {status: 202})
 }, ...options})
 try {
  const job = await createActiveJob(f, 'Maple Street kitchen')
  await f.agent()
  const credential = (await f.json('/api/plinth/agent-credentials', {cookie: f.owner})).value.credentials[0]
  const post = (path, body = {}, cookie = f.owner, token) => f.json('/api/plinth'+path, {method: 'POST', body, cookie, token})
  const consent = {credential_id: credential.id, receiver: 'https://synthetic-plinth.example/events', job_ids: [job.id], event_types: ['job.updated'], confirm: true}
  const create = async (changes = {}) => {
   const result = await post('/connections', {...consent, ...changes})
   assert.equal(result.status, 201, JSON.stringify(result.value)); return result.value
  }
  const connection = await create()
  const events = (await f.json(`/api/plinth/connections/${connection.subscription.id}/events`, {cookie: f.owner})).value.events
  assert.ok(events.length)
  return {...f, received, job, credential, post, consent, create, connection, event: events[0], deliver: (id = connection.subscription.id, body = {confirm: true}, cookie = f.owner, token) => post(`/connections/${id}/deliver/${events[0].id}`, body, cookie, token)}
 } catch (error) { await f.close(); throw error }
}
