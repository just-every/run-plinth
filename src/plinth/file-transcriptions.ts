import { requireManager } from './auth'
import { digest } from './attachments'
import { need, stamp, type Actor, type Input, type Job, type Stamp } from './model'
import type { DecisionHit } from './decision-search'
import { transaction } from './store'

export interface FileTranscription { revision: number; text: string; checksum: string; supplied_by: Stamp }
type Row = Omit<FileTranscription, 'supplied_by'> & { supplied_by: string }
/** Resolve the exact source through its current parent projection before calling. */
export async function fileTranscriptions(db: D1Database, jobId: string, source: string, checksum: string): Promise<FileTranscription[]> {
 const rows = await db.prepare('SELECT revision,text,checksum,supplied_by FROM pl_file_transcriptions WHERE job_id=? AND source=? AND checksum=? ORDER BY revision').bind(jobId, source, checksum).all<Row>()
 return rows.results.map(row => ({ ...row, supplied_by: JSON.parse(row.supplied_by) }))
}
/** Search reads only the current revision; earlier human revisions remain in custody. */
export async function latestFileTranscription(db: D1Database, jobId: string, source: string, checksum: string): Promise<FileTranscription | undefined> {
 const row = await db.prepare('SELECT revision,text,checksum,supplied_by FROM pl_file_transcriptions WHERE job_id=? AND source=? AND checksum=? ORDER BY revision DESC LIMIT 1').bind(jobId, source, checksum).first<Row>()
 return row ? { ...row, supplied_by: JSON.parse(row.supplied_by) } : undefined
}
export function transcriptionAuthority(actor: Actor) {
 requireManager(actor)
 need(!actor.permissions && actor.session_id, 'A signed-in owner or administrator must review supplied text', 403, 'forbidden')
}
function original(sources: DecisionHit[], source: unknown) {
 const hit = sources.find(hit => hit.source === source && hit.source.startsWith('files:') && hit.file_checksum)
 need(hit, 'Original file not found', 404, 'not_found')
 return hit
}
/** The full review binds the exact human text, original, author, job and previous revision. */
export async function transcriptionPreview(db: D1Database, job: Job, actor: Actor, input: Input, sources: DecisionHit[]) {
 transcriptionAuthority(actor)
 need(input.expected_version === job.version, 'Job changed. Reload before reviewing.', 409, 'stale_version')
 const hit = original(sources, input.source)
 need(input.checksum === hit.file_checksum, 'Original file changed. Review its exact checksum.', 409, 'document_changed')
 need(typeof input.text === 'string' && input.text.trim().length > 0 && input.text.length <= 100_000 && !input.text.includes('\0'), 'Supply between 1 and 100,000 characters of text without null characters')
 const previous = await latestFileTranscription(db, job.id, hit.source, hit.file_checksum!)
 const review = { job_id: job.id, source: hit.source, title: hit.title, checksum: hit.file_checksum!, expected_version: job.version, previous_revision: previous?.revision ?? 0, text: input.text, reviewed_by: actor.id, extraction: hit.extraction }
 return { ...review, digest: await digest(new TextEncoder().encode(JSON.stringify(review))) }
}
export async function saveTranscription(db: D1Database, job: Job, actor: Actor, input: Input, sources: DecisionHit[], clock: number) {
 const review = await transcriptionPreview(db, job, actor, input, sources)
 need(input.confirm === true && input.digest === review.digest, 'Review the complete supplied text and confirm this exact original before saving.', 409, 'review_required')
 const supplied_by = stamp(actor), revision = review.previous_revision + 1
 const next = { ...job, version: job.version + 1 }, data = JSON.stringify(next)
 need(data.length <= 8_000_000, 'Job history is too large')
 await transaction(db, actor, job, [
  db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN COALESCE((SELECT MAX(revision) FROM pl_file_transcriptions WHERE job_id=? AND source=?),0)=? THEN 1 ELSE 0 END').bind(job.id, review.source, review.previous_revision),
  db.prepare('INSERT INTO pl_file_transcriptions(job_id,source,checksum,revision,text,supplied_by) VALUES(?,?,?,?,?,?)').bind(job.id, review.source, review.checksum, revision, review.text, JSON.stringify(supplied_by)),
  db.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(next.version, data, job.id, job.version),
 ], clock, { kind: 'record', action: 'file.transcription', subject_kind: 'document', subject_id: review.source, job_id: job.id, version_before: job.version, version_after: next.version, detail: { revision, checksum: review.checksum } })
 return { revision, text: review.text, checksum: review.checksum, supplied_by, version: next.version }
}
/** Raw revision lookup never supplies its own authority. */
export async function readTranscriptions(db: D1Database, job: Job, source: string | null, sources: DecisionHit[]) {
 const hit = original(sources, source)
 return { source: hit.source, checksum: hit.file_checksum, extraction: hit.extraction, revisions: await fileTranscriptions(db, job.id, hit.source, hit.file_checksum!) }
}
