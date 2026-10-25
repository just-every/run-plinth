import { active, type ConnectorEvent, type Subscription } from './connector-state'
import { need } from './model'
import type { Bindings } from '../auth.server'

/** Replays sign the same reference identity with the current installation key. */
export async function sendReferences(env: Bindings, row: Subscription, event: ConnectorEvent, fence: (current: Subscription) => Promise<void>) {
 const payload = JSON.stringify({api_version: '1', id: event.id, job_id: event.job_id, job_version: event.job_version, type: event.type, subject_id: event.subject_id, created_at: event.created_at}), timestamp = String(Math.floor(Date.now()/1000))
 const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(row.secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
 const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp+'.'+payload)))].map(n => n.toString(16).padStart(2, '0')).join('')
 let code: number | null = null, status = 'unknown'
 try {
  const current = await env.DB.prepare('SELECT * FROM pl_connector_subscriptions WHERE id=?').bind(row.id).first<Subscription>()
  need(current && current.generation === row.generation, 'Receiver changed', 409, 'stale_grant')
  await active(env.DB, current); await fence(current)
  const response = await fetch(row.receiver, {method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: {'content-type': 'application/json', 'plinth-event-id': event.id, 'plinth-signature': `t=${timestamp},v1=${signature}`}, body: payload})
  code = response.status; status = response.ok ? 'accepted' : 'failed'; await response.body?.cancel()
 } catch { status = 'unknown' }
 return {status, http_status: code}
}
