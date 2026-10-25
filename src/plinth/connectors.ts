import { grantReceiver, revokeGrant } from './connector-grants'
import { active, activeCredentialSql, instant, publicSubscription, type Subscription } from './connector-state'
import { sendReferences } from './connector-send'
import { apiLimit } from './api-limits'
import { publicReceiver } from './connector-receiver'
import { requireOwner } from './auth'
import { connectorEventTypes } from './connector-events'
import { jobOf, transaction } from './store'
import { need, text, type Actor, type Input } from './model'
import type { Bindings } from '../auth.server'

const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'cache-control': 'no-store'}})
const secret = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('')
export async function connectorsResponse(request: Request, env: Bindings, actor: Actor, parts: string[], body: (r: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[0] !== 'connections') return null
 requireOwner(actor)
 const db = env.DB, method = request.method
 await apiLimit(db, actor)
 if (parts.length === 1 && method === 'GET') {
  const rows = await db.prepare(`SELECT s.*,(SELECT MIN(d.retry_at) FROM pl_connector_deliveries d WHERE d.subscription_id=s.id AND d.status IN ('failed','unknown') AND s.paused_at IS NULL AND s.grant_revoked_at IS NULL AND s.revoked_at IS NULL AND s.grant_expires_at>? AND NOT EXISTS(SELECT 1 FROM pl_connector_deliveries newer WHERE newer.subscription_id=s.id AND newer.event_id=d.event_id AND newer.rowid>d.rowid) AND NOT EXISTS(SELECT 1 FROM pl_connector_deliveries ok WHERE ok.subscription_id=s.id AND ok.event_id=d.event_id AND ok.status='accepted')) AS next_retry_at FROM pl_connector_subscriptions s WHERE operator_id=? ORDER BY id`).bind(instant(), actor.id).all<Subscription>()
  return json({subscriptions: rows.results.map(publicSubscription)})
 }
 if (parts.length === 1 && method === 'POST') {
  const input = await body(request)
  need(input.confirm === true, 'Explicit approval of the receiver and disclosed reference fields is required')
  const credentialId = text(input.credential_id, 'credential_id', 200), jobIds = input.job_ids, types = input.event_types
  need(Array.isArray(jobIds) && jobIds.length > 0 && jobIds.length <= 100 && jobIds.every(id => typeof id === 'string'), 'Choose 1 to 100 job IDs')
  need(Array.isArray(types) && types.length > 0 && types.length <= connectorEventTypes.length && types.every(type => connectorEventTypes.includes(type)), 'Choose supported event types')
  for (const id of jobIds) await jobOf(db, actor, id)
  const row = {id: crypto.randomUUID(), operator_id: actor.id, operator_version: actor.version, credential_id: credentialId, receiver: await publicReceiver(env, input.receiver), job_ids: JSON.stringify([...new Set(jobIds)]), event_types: JSON.stringify([...new Set(types)]), secret: secret(), generation: 1, revoked_at: null, created_at: instant()} as Subscription
  await active(db, row)
  await transaction(db, actor, null, [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS('+activeCredentialSql+') THEN 1 ELSE 0 END').bind(credentialId, actor.id, actor.version, Date.now()), db.prepare('INSERT INTO pl_connector_subscriptions(id,operator_id,operator_version,credential_id,receiver,job_ids,event_types,secret,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(row.id, row.operator_id, row.operator_version, row.credential_id, row.receiver, row.job_ids, row.event_types, row.secret, row.created_at)], undefined, {kind: 'permission', action: 'connector.consent', subject_id: row.id})
  return json({subscription: publicSubscription((await db.prepare('SELECT * FROM pl_connector_subscriptions WHERE id=?').bind(row.id).first<Subscription>())!), signing_key: row.secret}, 201)
 }
 const row = await db.prepare('SELECT * FROM pl_connector_subscriptions WHERE id=? AND operator_id=?').bind(parts[1] ?? '', actor.id).first<Subscription>()
 need(row, 'Connection not found', 404, 'not_found')
 if (parts.length === 3 && parts[2] === 'revoke' && method === 'POST') {
  await body(request)
  await transaction(db, actor, null, [db.prepare("UPDATE pl_connector_subscriptions SET revoked_at=COALESCE(revoked_at,?),secret='' WHERE id=?").bind(new Date().toISOString(), row.id)], undefined, {kind: 'permission', action: 'connector.revoke', subject_id: row.id})
  return json({revoked: true})
 }
 if (parts.length === 3 && parts[2] === 'deliveries' && method === 'GET') {
  const after = new URL(request.url).searchParams.get('after') ?? ''
  const rows = await db.prepare('SELECT * FROM pl_connector_deliveries WHERE subscription_id=? AND id>? ORDER BY id LIMIT 51').bind(row.id, after).all()
  const page = rows.results.slice(0, 50)
  return json({deliveries: page, next: rows.results.length > 50 ? page.at(-1)!.id : null})
 }
 if (parts.length === 4 && parts[2] === 'grant' && parts[3] === 'revoke' && method === 'POST') {
  await body(request); await revokeGrant(db, actor, row); return json({revoked: true})
 }
 await active(db, row)
 if (parts.length === 3 && parts[2] === 'grant' && method === 'POST') return json({subscription: await grantReceiver(env, actor, row, await body(request))})
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
 if (parts.length === 4 && parts[2] === 'deliver' && method === 'POST') {
  const input = await body(request)
  need(input.confirm === true, 'Explicit consent is required for each outbound attempt')
  await publicReceiver(env, row.receiver)
  const event = await db.prepare('SELECT * FROM pl_connector_events WHERE id=?').bind(parts[3]).first<{id: string; job_id: string; job_version: number; type: string; subject_id: string | null; created_at: string}>()
  need(event && JSON.parse(row.job_ids).includes(event.job_id) && JSON.parse(row.event_types).includes(event.type), 'Event not available to this receiver', 404, 'not_found')
  await jobOf(db, actor, event.job_id)
  const attempt = crypto.randomUUID(), started = new Date().toISOString()
  await transaction(db, actor, null, [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS('+activeCredentialSql+') AND EXISTS(SELECT 1 FROM pl_connector_subscriptions WHERE id=? AND generation=? AND revoked_at IS NULL) THEN 1 ELSE 0 END').bind(row.credential_id, row.operator_id, row.operator_version, Date.now(), row.id, row.generation), db.prepare("UPDATE pl_connector_deliveries SET status='unknown',finished_at=? WHERE subscription_id=? AND status='sending' AND started_at<?").bind(started, row.id, new Date(Date.now()-60_000).toISOString()), db.prepare("INSERT INTO pl_connector_deliveries(id,subscription_id,event_id,generation,started_at,status) VALUES(?,?,?,?,?,'sending')").bind(attempt, row.id, event.id, row.generation, started)], undefined, {kind: 'send', action: 'connector.attempt', subject_id: row.id, detail: {event_id: event.id, attempt_id: attempt, consent: true}})
  const {status, http_status: code} = await sendReferences(env, row, event, async () => { await jobOf(db, actor, event.job_id) })
  await db.prepare('UPDATE pl_connector_deliveries SET status=?,http_status=?,finished_at=? WHERE id=?').bind(status, code, new Date().toISOString(), attempt).run()
  return json({event_id: event.id, attempt_id: attempt, status, http_status: code})
 }
 return json({error: 'not_found'}, 404)
}
