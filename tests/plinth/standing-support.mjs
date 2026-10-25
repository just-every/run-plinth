import assert from 'node:assert/strict'
import {connectorFixture} from './connector-support.mjs'

/** Business setup uses HTTP; time advances at the Worker environment edge. */
export async function standingFixture(options = {}) {
 let now = Date.now()
 const f = await connectorFixture({...options, now})
 const connection = options.eventTypes ? await f.create({event_types: options.eventTypes}) : f.connection
 const id = connection.subscription.id
 const advance = async (milliseconds = 1000) => { now += milliseconds; await f.setNow(now) }
 const scheduled = () => f.scheduled(now)
 const grantBody = (changes = {}) => ({confirm: true, origin: 'https://synthetic-plinth.example', event_types: ['job.updated'], payload_class: 'references', rate_cap: 20, expires_at: new Date(now + 30 * 60_000).toISOString(), ...changes})
 const grant = async (changes = {}) => {
  const result = await f.post(`/connections/${id}/grant`, grantBody(changes))
  assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.value))
  return result.value.subscription
 }
 const update = async (jobId = f.job.id) => {
  const current = (await f.json(`/api/plinth/jobs/${jobId}`, {cookie: f.owner})).value.job
  const result = await f.post(`/jobs/${jobId}/variations`, {expected_version: current.version, description: 'Synthetic reviewed additional work', amount_cents: 12500})
  assert.equal(result.status, 200, JSON.stringify(result.value))
  return result.value
 }
 const history = async () => {
  const result = await f.json(`/api/plinth/connections/${id}/deliveries`, {cookie: f.owner})
  assert.equal(result.status, 200, JSON.stringify(result.value))
  return result.value.deliveries
 }
 const subscription = async () => {
  const result = await f.json('/api/plinth/connections', {cookie: f.owner})
  assert.equal(result.status, 200, JSON.stringify(result.value))
  return result.value.subscriptions.find(row => row.id === id)
 }
 return {...f, connection, id, advance, scheduled, grantBody, grant, update, history, subscription}
}
