import { actorPredicate, requireOwner } from './auth.ts'
import { need, type Actor, type Job } from './model.ts'
import { retireImportedJob } from './import-retirement.ts'
import { canonicalJson } from '../modules/import-kit/src/d1/index.ts'

/** The job, its files, import custody and restore fence disappear together.
 * A native erasure marker prevents importing this job ID again. */
export async function eraseJob(db: D1Database, actor: Actor, job: Job) {
  requireOwner(actor)
  const row = await db.prepare('SELECT data,version FROM pl_jobs WHERE id=?').bind(job.id).first<{ data: string; version: number }>()
  need(row && row.version === job.version && canonicalJson(JSON.parse(row.data)) === canonicalJson(job), 'Job changed. Reload before erasing.', 409, 'conflict')
  const current = actorPredicate(actor)
  return retireImportedJob(db, actor, job, [
    { sql: `INSERT INTO pl_guard(ok) SELECT CASE WHEN (${current.sql}) AND EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=? AND data=?) THEN 1 ELSE 0 END`, params: [...current.params, job.id, job.version, row.data] },
    { sql: 'DELETE FROM pl_attachments WHERE job_id=?', params: [job.id] },
    { sql: 'DELETE FROM pl_lien_waiver_files WHERE job_id=?', params: [job.id] },
    { sql: 'DELETE FROM pl_jobs WHERE id=?', params: [job.id] },
    { sql: "INSERT INTO pl_erased_jobs(job_id,erased_at) VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))", params: [job.id] },
    { sql: 'UPDATE pl_clock SET version=version+1 WHERE id=1' },
    { sql: 'DELETE FROM pl_guard' },
  ])
}
