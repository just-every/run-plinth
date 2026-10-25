import type { Actor, Job } from './model'

export const connectorEventTypes = ['job.updated', 'financial.updated', 'decision.approved', 'change.approved'] as const
/** Event identities and the changed record commit together. Payloads contain references only. */
export function connectorEvents(db: D1Database, actor: Actor, job: Job): D1PreparedStatement[] {
 const path = actor.request?.path ?? '', subject = /\/(approve|accept|sign|issue)$/.test(path) ? path.split('/').at(-2)! : null, types: string[] = ['job.updated']
 if (/\/(variations|changes|invoices|claims|orders|remittances|costs|retainage)(\/|$)/.test(path)) types.push('financial.updated')
 if (/\/(approve|accept|sign|issue)$/.test(path)) types.push('decision.approved')
 if (/\/variations\/[^/]+\/approve$/.test(path)) types.push('change.approved')
 return types.flatMap(type => { const id = crypto.randomUUID(); return [db.prepare('INSERT INTO pl_connector_events(id,job_id,job_version,type,subject_id,created_at) VALUES(?,?,?,?,?,?)').bind(id, job.id, job.version, type, subject, new Date(Date.now()).toISOString()), db.prepare('INSERT INTO pl_connector_event_order(event_id) VALUES(?)').bind(id)] })
}
