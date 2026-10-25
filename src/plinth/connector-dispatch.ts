import type { Bindings } from '../auth.server'
import { auditStatement, automation } from './audit'
import { active, activeCredentialSql, instant, standingScope, type ConnectorEvent, type Subscription } from './connector-state'
import { publicReceiver } from './connector-receiver'
import { sendReferences } from './connector-send'

const runner = automation('connector-delivery', 'Standing receiver delivery')
const retryAt = (failures: number) => new Date(Date.now() + 60_000 * 2 ** Math.min(failures - 1, 5)).toISOString()
const capSql = "(SELECT COUNT(*) FROM pl_connector_deliveries WHERE subscription_id=s.id AND mode='standing' AND started_at>?)<s.grant_rate_cap"
const hourAgo = () => new Date(Date.now() - 3_600_000).toISOString()
function liveSql() {
 return "s.grant_id=? AND s.revoked_at IS NULL AND s.grant_revoked_at IS NULL AND s.paused_at IS NULL AND s.grant_expires_at>? AND s.generation=? AND s.grant_payload_class='references'"
}

/** Interrupted sends are indeterminate and retry with the same event identity. */
async function expireLease(db: D1Database, row: Subscription) {
 const stale = await db.prepare("SELECT id FROM pl_connector_deliveries WHERE subscription_id=? AND status='sending' AND started_at<?").bind(row.id, new Date(Date.now() - 60_000).toISOString()).first<{id: string}>()
 if (!stale) return
 const paused = row.failure_count + 1 >= 3, at = instant()
 await db.batch([
  db.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_connector_deliveries WHERE id=? AND status='sending' AND started_at<?) AND EXISTS(SELECT 1 FROM pl_connector_subscriptions WHERE id=? AND grant_id=? AND failure_count=?) THEN 1 ELSE 0 END").bind(stale.id, new Date(Date.now() - 60_000).toISOString(), row.id, row.grant_id, row.failure_count),
  db.prepare("UPDATE pl_connector_deliveries SET status='unknown',finished_at=?,retry_at=? WHERE id=? AND status='sending'").bind(at, paused ? null : retryAt(row.failure_count + 1), stale.id),
  db.prepare('UPDATE pl_connector_subscriptions SET failure_count=failure_count+1,paused_at=?,pause_reason=? WHERE id=?').bind(paused ? at : null, paused ? 'Repeated delivery failures; renew the standing grant after checking the receiver' : null, row.id),
  auditStatement(db, runner, {kind: 'automation', action: paused ? 'connector.pause' : 'connector.interrupted', subject_id: row.id, detail: {grant_id: row.grant_id, attempt_id: stale.id}}),
  db.prepare('DELETE FROM pl_guard'),
 ])
}
async function nextEvent(db: D1Database, row: Subscription) {
 return db.prepare(`SELECT e.* FROM pl_connector_events e JOIN pl_connector_event_order q ON q.event_id=e.id JOIN pl_jobs j ON j.id=e.job_id
 WHERE q.sequence>? AND e.job_id IN (SELECT value FROM json_each(?)) AND e.type IN (SELECT value FROM json_each(?))
 AND e.type IN (SELECT value FROM json_each(?))
 AND NOT EXISTS(SELECT 1 FROM pl_connector_deliveries d WHERE d.subscription_id=? AND d.event_id=e.id AND d.status='accepted')
 AND NOT EXISTS(SELECT 1 FROM pl_connector_deliveries d WHERE d.subscription_id=? AND d.event_id=e.id AND (d.status='sending' OR d.retry_at>?))
 ORDER BY q.sequence LIMIT 1`).bind(row.grant_after, row.job_ids, row.event_types, row.grant_event_types, row.id, row.id, instant()).first<ConnectorEvent>()
}
async function dispatchOne(env: Bindings, row: Subscription) {
 const db = env.DB
 await active(db, row); standingScope(row)
 await expireLease(db, row)
 row = (await db.prepare('SELECT * FROM pl_connector_subscriptions WHERE id=?').bind(row.id).first<Subscription>())!
 standingScope(row)
 const event = await nextEvent(db, row)
 if (!event) return
 await publicReceiver(env, row.receiver)
 const attempt = crypto.randomUUID(), at = instant()
 // The lease, current authority, grant scope and rolling cap commit with audited consent.
 await db.batch([
  db.prepare(`INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(${activeCredentialSql}) AND EXISTS(
   SELECT 1 FROM pl_connector_subscriptions s JOIN pl_connector_events e ON e.id=? JOIN pl_connector_event_order q ON q.event_id=e.id JOIN pl_jobs j ON j.id=e.job_id
   WHERE s.id=? AND ${liveSql()} AND q.sequence>s.grant_after
   AND e.job_id IN (SELECT value FROM json_each(s.job_ids)) AND e.type IN (SELECT value FROM json_each(s.event_types))
   AND e.type IN (SELECT value FROM json_each(s.grant_event_types)) AND ${capSql}
   AND NOT EXISTS(SELECT 1 FROM pl_connector_deliveries d WHERE d.subscription_id=s.id AND d.event_id=e.id AND (d.status='accepted' OR d.retry_at>?))
  ) THEN 1 ELSE 0 END`).bind(row.credential_id, row.operator_id, row.operator_version, Date.now(), event.id, row.id, row.grant_id, at, row.generation, hourAgo(), at),
  db.prepare("INSERT INTO pl_connector_deliveries(id,subscription_id,event_id,generation,started_at,status,consent_grant_id,mode) VALUES(?,?,?,?,?,'sending',?,'standing')").bind(attempt, row.id, event.id, row.generation, at, row.grant_id),
  auditStatement(db, runner, {kind: 'send', action: 'connector.attempt', subject_id: row.id, detail: {event_id: event.id, attempt_id: attempt, consent: true, grant_id: row.grant_id, consent_owner_id: row.operator_id}}),
  db.prepare('DELETE FROM pl_guard'),
 ])
 const result = await sendReferences(env, row, event, async current => {
  standingScope(current, event)
  if (current.grant_id !== row.grant_id || !await db.prepare('SELECT id FROM pl_jobs WHERE id=?').bind(event.job_id).first()) throw Error('Standing grant or job changed')
 })
 const accepted = result.status === 'accepted', failures = accepted ? 0 : row.failure_count + 1, paused = failures >= 3, finished = instant()
 await db.batch([
  db.prepare('UPDATE pl_connector_deliveries SET status=?,http_status=?,finished_at=?,retry_at=? WHERE id=?').bind(result.status, result.http_status, finished, !accepted && !paused ? retryAt(failures) : null, attempt),
  db.prepare('UPDATE pl_connector_subscriptions SET failure_count=?,paused_at=?,pause_reason=? WHERE id=? AND grant_id=?').bind(failures, paused ? finished : null, paused ? 'Repeated delivery failures; renew the standing grant after checking the receiver' : null, row.id, row.grant_id),
  ...(paused ? [auditStatement(db, runner, {kind: 'automation', action: 'connector.pause', subject_id: row.id, detail: {grant_id: row.grant_id, attempt_id: attempt, event_id: event.id}})] : []),
 ])
}

/** Trusted scheduler only; no caller can turn a bearer credential into a dispatcher. */
export async function dispatchConnectors(env: Bindings) {
 const rows = await env.DB.prepare(`SELECT s.* FROM pl_connector_subscriptions s WHERE s.grant_id IS NOT NULL AND s.revoked_at IS NULL
 AND s.grant_revoked_at IS NULL AND s.paused_at IS NULL AND s.grant_expires_at>? AND ${capSql}
 AND EXISTS(SELECT 1 FROM pl_connector_events e JOIN pl_connector_event_order q ON q.event_id=e.id WHERE q.sequence>s.grant_after AND e.job_id IN (SELECT value FROM json_each(s.job_ids))
 AND e.type IN (SELECT value FROM json_each(s.grant_event_types)) AND NOT EXISTS(SELECT 1 FROM pl_connector_deliveries d WHERE d.subscription_id=s.id AND d.event_id=e.id AND d.status='accepted')
 AND NOT EXISTS(SELECT 1 FROM pl_connector_deliveries d WHERE d.subscription_id=s.id AND d.event_id=e.id AND (d.retry_at>? OR d.status='sending' AND d.started_at>?)))
 ORDER BY s.id LIMIT 25`).bind(instant(), hourAgo(), instant(), new Date(Date.now() - 60_000).toISOString()).all<Subscription>()
 for (const row of rows.results) {
  try { await dispatchOne(env, row) } catch (error) {
   // Revocation, an occupied lease or a changed grant denies this attempt without outbound work.
   if (!/CHECK constraint failed|UNIQUE constraint failed|FOREIGN KEY constraint failed|Standing receiver grant|Receiver grant|Receiver must|Receiver origin/.test(String(error))) throw error
  }
 }
}
