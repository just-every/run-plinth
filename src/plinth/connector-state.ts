import { need } from './model'

export type Subscription = {
 id: string; operator_id: string; operator_version: number; credential_id: string; receiver: string
 job_ids: string; event_types: string; secret: string; generation: number; revoked_at: string | null; created_at: string
 grant_id: string | null; grant_origin: string | null; grant_event_types: string | null; grant_payload_class: string | null
 grant_rate_cap: number | null; grant_expires_at: string | null; grant_revoked_at: string | null; grant_after: number
 paused_at: string | null; pause_reason: string | null; failure_count: number
}
export type ConnectorEvent = {id: string; job_id: string; job_version: number; type: string; subject_id: string | null; created_at: string}
export const instant = () => new Date(Date.now()).toISOString()
export const publicSubscription = ({secret: omitted, ...row}: Subscription) => ({...row, job_ids: JSON.parse(row.job_ids), event_types: JSON.parse(row.event_types), grant_event_types: row.grant_event_types ? JSON.parse(row.grant_event_types) : []})
export const activeCredentialSql = "SELECT c.id FROM oa_credentials c JOIN oa_operators o ON o.id=c.operator_id WHERE c.id=? AND o.id=? AND o.version=? AND c.operator_version=o.version AND o.role='owner' AND o.status='active' AND c.revoked_at IS NULL AND c.expires_at>?"
export async function active(db: D1Database, row: Subscription) {
 need(!row.revoked_at && await db.prepare(activeCredentialSql).bind(row.credential_id, row.operator_id, row.operator_version, Date.now()).first(), 'Receiver grant is no longer current', 403, 'stale_grant')
}
export function standingScope(row: Subscription, event?: ConnectorEvent) {
 need(row.grant_id && !row.grant_revoked_at && !row.paused_at && row.grant_expires_at! > instant() && row.grant_origin === new URL(row.receiver).origin && row.grant_payload_class === 'references', 'Standing receiver grant is unavailable', 403, 'stale_grant')
 if (event) need(JSON.parse(row.job_ids).includes(event.job_id) && JSON.parse(row.event_types).includes(event.type) && JSON.parse(row.grant_event_types!).includes(event.type), 'Event outside standing grant', 403, 'stale_grant')
}
