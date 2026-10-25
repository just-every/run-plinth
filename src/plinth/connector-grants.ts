import { connectorEventTypes } from './connector-events'
import { activeCredentialSql, instant, publicSubscription, type Subscription } from './connector-state'
import { publicReceiver } from './connector-receiver'
import { transaction } from './store'
import { need, type Actor, type Input } from './model'
import type { Bindings } from '../auth.server'

/** Human owner consent authorizes only this receiver, bounded scope and future events. */
export async function grantReceiver(env: Bindings, actor: Actor, row: Subscription, input: Input) {
 const expires = typeof input.expires_at === 'string' ? Date.parse(input.expires_at) : NaN, types = input.event_types
 need(input.confirm === true, 'Explicit consent to unattended reference delivery is required')
 need(input.origin === new URL(row.receiver).origin, 'Grant origin must match the receiver')
 need(input.payload_class === 'references', 'Only reference payloads may be granted')
 need(Number.isFinite(expires) && expires > Date.now(), 'Choose a future grant expiry')
 need(Number.isSafeInteger(input.rate_cap) && Number(input.rate_cap) >= 1 && Number(input.rate_cap) <= 1000, 'Choose 1 to 1000 attempts per hour')
 need(Array.isArray(types) && types.length > 0 && types.length <= connectorEventTypes.length && types.every(type => typeof type === 'string' && JSON.parse(row.event_types).includes(type)), 'Choose event types within this receiver scope')
 await publicReceiver(env, row.receiver)
 const db = env.DB, grant = crypto.randomUUID(), expiry = new Date(expires).toISOString()
 await transaction(db, actor, null, [
  db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS('+activeCredentialSql+') AND EXISTS(SELECT 1 FROM pl_connector_subscriptions WHERE id=? AND generation=? AND revoked_at IS NULL) AND NOT EXISTS(SELECT 1 FROM pl_connector_deliveries WHERE subscription_id=? AND status=\'sending\') THEN 1 ELSE 0 END').bind(row.credential_id, row.operator_id, row.operator_version, Date.now(), row.id, row.generation, row.id),
  db.prepare(`UPDATE pl_connector_subscriptions SET grant_id=?,grant_origin=?,grant_event_types=?,grant_payload_class=?,grant_rate_cap=?,grant_expires_at=?,grant_revoked_at=NULL,grant_after=(SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='pl_connector_event_order'),0)),paused_at=NULL,pause_reason=NULL,failure_count=0 WHERE id=?`).bind(grant, input.origin, JSON.stringify([...new Set(types)]), 'references', input.rate_cap, expiry, row.id),
 ], undefined, {kind: 'permission', action: 'connector.grant', subject_id: row.id, detail: {grant_id: grant, origin: input.origin, event_types: types, payload_class: 'references', rate_cap: input.rate_cap, expires_at: expiry, consent: true}})
 return publicSubscription((await db.prepare('SELECT * FROM pl_connector_subscriptions WHERE id=?').bind(row.id).first<Subscription>())!)
}
export async function revokeGrant(db: D1Database, actor: Actor, row: Subscription) {
 await transaction(db, actor, null, [db.prepare('UPDATE pl_connector_subscriptions SET grant_revoked_at=COALESCE(grant_revoked_at,?) WHERE id=?').bind(instant(), row.id)], undefined, {kind: 'permission', action: 'connector.grant.revoke', subject_id: row.id, detail: {grant_id: row.grant_id}})
}
