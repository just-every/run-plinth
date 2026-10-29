import { actorPredicate, requireOwner } from './auth.ts'
import { need, type Actor, type Job } from './model.ts'
import { retireImportedJob } from './import-retirement.ts'
import { canonicalJson } from '../modules/import-kit/src/d1/index.ts'
import { auditSql, jobRef } from './audit.ts'
import { heldSql, requireNoHold } from './holds.ts'

/** The job, its files, import custody and restore fence disappear together.
 * A native erasure marker prevents importing this job ID again. */
export async function eraseJob(db: D1Database, actor: Actor, job: Job) {
  requireOwner(actor)
  await requireNoHold(db, actor, 'job', job.id)
  // A shared analysis is also evidence of its other selected jobs.
  const linked = (await db.prepare('SELECT DISTINCT job_id FROM pl_learning_sources WHERE packet_id IN (SELECT packet_id FROM pl_learning_sources WHERE job_id=?)').bind(job.id).all<{job_id:string}>()).results
  for (const source of linked) if (source.job_id !== job.id) await requireNoHold(db, actor, 'job', source.job_id)
  const row = await db.prepare('SELECT data,version FROM pl_jobs WHERE id=?').bind(job.id).first<{ data: string; version: number }>()
  need(row && row.version === job.version && canonicalJson(JSON.parse(row.data)) === canonicalJson(job), 'Job changed. Reload before erasing.', 409, 'conflict')
  const current = actorPredicate(actor), held = heldSql('job', job.id), audit = auditSql(actor, { kind: 'erasure', action: 'jobs.erase', subject_kind: 'job', subject_id: job.id, job_id: job.id, version_before: job.version, before_ref: await jobRef(row.data), detail: { erased: ['job record', 'photos and documents', 'correspondence and its files', 'import custody'] } })
  return retireImportedJob(db, actor, job, [
    { sql: `INSERT INTO pl_guard(ok) SELECT CASE WHEN (${current.sql}) AND EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=? AND data=?) AND NOT ${held.sql} THEN 1 ELSE 0 END`, params: [...current.params, job.id, job.version, row.data, ...held.params] },
    audit,
    // Remove closeout content from MCP replay and person approval stores before the job disappears.
    { sql: `DELETE FROM agent_door_calls WHERE json_extract(outcome,'$.result.record.job_id')=? OR json_extract(outcome,'$.approval.id') IN (SELECT id FROM agent_door_approvals WHERE json_extract(saved,'$.tool') IN ('plinth.closeout.read','plinth.closeout.followup') AND json_extract(saved,'$.args.job_id')=?)`, params: [job.id,job.id] },
    { sql: `DELETE FROM agent_door_approvals WHERE json_extract(saved,'$.tool') IN ('plinth.closeout.read','plinth.closeout.followup') AND json_extract(saved,'$.args.job_id')=?`, params: [job.id] },
    { sql: `DELETE FROM agent_door_reviews WHERE json_extract(saved,'$.tool') IN ('plinth.closeout.read','plinth.closeout.followup') AND json_extract(saved,'$.summary.target.id') IN (SELECT json_extract(value,'$.id') FROM json_each(?, '$.agent_closeout'))`, params: [row.data] },
    { sql: "DELETE FROM rer_mail_event_receipts WHERE event_namespace='job-mail' AND json_extract(event_json,'$.deliveryId') IN (SELECT id FROM pl_mail_messages WHERE job_id=?)", params: [job.id] },
    { sql: "DELETE FROM rer_mail_event_states WHERE event_namespace='job-mail' AND provider_message_id IN (SELECT provider_message_id FROM pl_mail_messages WHERE job_id=? AND provider_message_id IS NOT NULL)", params: [job.id] },
    { sql: 'DELETE FROM pl_payment_events WHERE attempt_id IN (SELECT id FROM pl_payment_attempts WHERE job_id=?)', params: [job.id] },
    { sql: 'DELETE FROM pl_file_transcriptions WHERE job_id=?', params: [job.id] },
    { sql: 'DELETE FROM pl_decision_metadata WHERE job_id=?', params: [job.id] },
    { sql: 'DELETE FROM pl_mail_originals WHERE job_id=?', params: [job.id] },
    { sql: 'DELETE FROM pl_mail_files WHERE job_id=?', params: [job.id] },
    { sql: 'DELETE FROM pl_mail_messages WHERE job_id=?', params: [job.id] },
    { sql: 'DELETE FROM pl_attachments WHERE job_id=?', params: [job.id] },
    { sql: 'DELETE FROM pl_lien_waiver_files WHERE job_id=?', params: [job.id] },
    { sql: 'DELETE FROM pl_jobs WHERE id=?', params: [job.id] },
    { sql: "INSERT INTO pl_erased_jobs(job_id,erased_at) VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))", params: [job.id] },
    { sql: 'UPDATE pl_clock SET version=version+1 WHERE id=1' },
    { sql: 'DELETE FROM pl_guard' },
  ])
}
