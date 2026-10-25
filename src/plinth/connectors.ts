import { apiLimit } from './api-limits'
import { publicReceiver } from './connector-receiver'
import { requireOwner } from './auth'
import { connectorEventTypes } from './connector-events'
import { jobOf, transaction } from './store'
import { need, text, type Actor, type Input } from './model'
import type { Bindings } from '../auth.server'

const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'cache-control': 'no-store'}})
const secret = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('')
type Subscription = {id: string; operator_id: string; operator_version: number; credential_id: string; receiver: string; job_ids: string; event_types: string; secret: string; generation: number; revoked_at: string | null; created_at: string}
const publicSubscription = ({secret: omitted, ...row}: Subscription) => ({...row, job_ids: JSON.parse(row.job_ids), event_types: JSON.parse(row.event_types)})
const activeCredentialSql = "SELECT c.id FROM oa_credentials c JOIN oa_operators o ON o.id=c.operator_id WHERE c.id=? AND o.id=? AND o.version=? AND c.operator_version=o.version AND o.role='owner' AND o.status='active' AND c.revoked_at IS NULL AND c.expires_at>?"
async function active(db: D1Database, row: Subscription) {
 need(!row.revoked_at && await db.prepare(activeCredentialSql).bind(row.credential_id, row.operator_id, row.operator_version, Date.now()).first(), 'Receiver grant is no longer current', 403, 'stale_grant')
}
export async function connectorsResponse(request: Request, env: Bindings, actor: Actor, parts: string[], body: (r: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[0] !== 'connections') return null
 requireOwner(actor)
 const db = env.DB, method = request.method
 await apiLimit(db, actor)
 if (parts.length === 1 && method === 'GET') {
  const rows = await db.prepare('SELECT * FROM pl_connector_subscriptions WHERE operator_id=? ORDER BY id').bind(actor.id).all<Subscription>()
  return json({subscriptions: rows.results.map(publicSubscription)})
 }
 if (parts.length === 1 && method === 'POST') {
  const input = await body(request)
  need(input.confirm === true, 'Explicit approval of the receiver and disclosed reference fields is required')
  const credentialId = text(input.credential_id, 'credential_id', 200), jobIds = input.job_ids, types = input.event_types
  need(Array.isArray(jobIds) && jobIds.length > 0 && jobIds.length <= 100 && jobIds.every(id => typeof id === 'string'), 'Choose 1 to 100 job IDs')
  need(Array.isArray(types) && types.length > 0 && types.length <= connectorEventTypes.length && types.every(type => connectorEventTypes.includes(type)), 'Choose supported event types')
  for (const id of jobIds) await jobOf(db, actor, id)
  const row: Subscription = {id: crypto.randomUUID(), operator_id: actor.id, operator_version: actor.version, credential_id: credentialId, receiver: await publicReceiver(env, input.receiver), job_ids: JSON.stringify([...new Set(jobIds)]), event_types: JSON.stringify([...new Set(types)]), secret: secret(), generation: 1, revoked_at: null, created_at: new Date().toISOString()}
  await active(db, row)
  await transaction(db, actor, null, [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS('+activeCredentialSql+') THEN 1 ELSE 0 END').bind(credentialId, actor.id, actor.version, Date.now()), db.prepare('INSERT INTO pl_connector_subscriptions(id,operator_id,operator_version,credential_id,receiver,job_ids,event_types,secret,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(row.id, row.operator_id, row.operator_version, row.credential_id, row.receiver, row.job_ids, row.event_types, row.secret, row.created_at)], undefined, {kind: 'permission', action: 'connector.consent', subject_id: row.id})
  return json({subscription: publicSubscription(row), signing_key: row.secret}, 201)
 }
 const row = await db.prepare('SELECT * FROM pl_connector_subscriptions WHERE id=? AND operator_id=?').bind(parts[1] ?? '', actor.id).first<Subscription>()
 need(row, 'Connection not found', 404, 'not_found')
 if (parts.length === 3 && parts[2] === 'revoke' && method === 'POST') {
  await body(request)
  await transaction(db, actor, null, [db.prepare("UPDATE pl_connector_subscriptions SET revoked_at=COALESCE(revoked_at,?),secret='' WHERE id=?").bind(new Date().toISOString(), row.id)], undefined, {kind: 'permission', action: 'connector.revoke', subject_id: row.id})
  return json({revoked: true})
 }
 await active(db, row)
 if (parts.length === 3 && parts[2] === 'rotate' && method === 'POST') {
  const input = await body(request), key = secret(), credential = text(input.credential_id, 'credential_id', 200)
  await active(db, {...row, credential_id: credential})
  await transaction(db, actor, null, [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_connector_subscriptions WHERE id=? AND generation=? AND revoked_at IS NULL) THEN 1 ELSE 0 END').bind(row.id, row.generation), db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS('+activeCredentialSql+') THEN 1 ELSE 0 END').bind(credential, actor.id, actor.version, Date.now()), db.prepare('UPDATE pl_connector_subscriptions SET secret=?,credential_id=?,generation=generation+1 WHERE id=? AND generation=?').bind(key, credential, row.id, row.generation)], undefined, {kind: 'permission', action: 'connector.rotate', subject_id: row.id})
  return json({signing_key: key, generation: row.generation + 1})
 }
 if (parts.length === 3 && parts[2] === 'events' && method === 'GET') {
  const ids = JSON.parse(row.job_ids) as string[], types = JSON.parse(row.event_types) as string[]
  const url = new URL(request.url), after = Number(url.searchParams.get('after') ?? '0')
  need(Number.isSafeInteger(after) && after >= 0, 'after must be a nonnegative event sequence')
  const events = await db.prepare(`SELECT e.rowid AS sequence,e.* FROM pl_connector_events e JOIN pl_jobs j ON j.id=e.job_id WHERE e.rowid>? AND e.job_id IN (${ids.map(() => '?').join(',')}) AND e.type IN (${types.map(() => '?').join(',')}) ORDER BY e.rowid LIMIT 51`).bind(after, ...ids, ...types).all()
  const page = events.results.slice(0, 50)
  return json({events: page, next: events.results.length > 50 ? page.at(-1)!.sequence : null})
 }
 if (parts.length === 3 && parts[2] === 'deliveries' && method === 'GET') {
  const after = new URL(request.url).searchParams.get('after') ?? ''
  const rows = await db.prepare('SELECT * FROM pl_connector_deliveries WHERE subscription_id=? AND id>? ORDER BY id LIMIT 51').bind(row.id, after).all()
  const page = rows.results.slice(0, 50)
  return json({deliveries: page, next: rows.results.length > 50 ? page.at(-1)!.id : null})
 }
 if (parts.length === 4 && parts[2] === 'deliver' && method === 'POST') {
  const input = await body(request)
  need(input.confirm === true, 'Explicit consent is required for each outbound attempt')
  await publicReceiver(env, row.receiver)
  const event = await db.prepare('SELECT * FROM pl_connector_events WHERE id=?').bind(parts[3]).first<{id: string; job_id: string; job_version: number; type: string; subject_id: string | null; created_at: string}>()
  need(event && JSON.parse(row.job_ids).includes(event.job_id) && JSON.parse(row.event_types).includes(event.type), 'Event not available to this receiver', 404, 'not_found')
  await jobOf(db, actor, event.job_id)
  const attempt = crypto.randomUUID(), started = new Date().toISOString()
  await transaction(db, actor, null, [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS('+activeCredentialSql+') AND EXISTS(SELECT 1 FROM pl_connector_subscriptions WHERE id=? AND generation=? AND revoked_at IS NULL) THEN 1 ELSE 0 END').bind(row.credential_id, row.operator_id, row.operator_version, Date.now(), row.id, row.generation), db.prepare("UPDATE pl_connector_deliveries SET status='unknown',finished_at=? WHERE subscription_id=? AND status='sending' AND started_at<?").bind(started, row.id, new Date(Date.now()-60_000).toISOString()), db.prepare("INSERT INTO pl_connector_deliveries(id,subscription_id,event_id,generation,started_at,status) VALUES(?,?,?,?,?,'sending')").bind(attempt, row.id, event.id, row.generation, started)], undefined, {kind: 'send', action: 'connector.attempt', subject_id: row.id, detail: {event_id: event.id, attempt_id: attempt, consent: true}})
  const payload = JSON.stringify({api_version: '1', id: event.id, job_id: event.job_id, job_version: event.job_version, type: event.type, subject_id: event.subject_id, created_at: event.created_at}), timestamp = String(Math.floor(Date.now()/1000))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(row.secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp+'.'+payload)))].map(n => n.toString(16).padStart(2, '0')).join('')
  let code: number | null = null, status = 'unknown'
  try {
   // Recheck the live subscription and credential immediately before crossing the network edge.
   const current = await db.prepare('SELECT * FROM pl_connector_subscriptions WHERE id=?').bind(row.id).first<Subscription>()
   need(current && current.generation === row.generation, 'Receiver changed', 409, 'stale_grant'); await active(db, current)
   await jobOf(db, actor, event.job_id)
   const response = await fetch(row.receiver, {method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: {'content-type': 'application/json', 'plinth-event-id': event.id, 'plinth-signature': `t=${timestamp},v1=${signature}`}, body: payload})
   code = response.status; status = response.ok ? 'accepted' : 'failed'; await response.body?.cancel()
  } catch { status = 'unknown' }
  await db.prepare('UPDATE pl_connector_deliveries SET status=?,http_status=?,finished_at=? WHERE id=?').bind(status, code, new Date().toISOString(), attempt).run()
  return json({event_id: event.id, attempt_id: attempt, status, http_status: code})
 }
 return json({error: 'not_found'}, 404)
}
