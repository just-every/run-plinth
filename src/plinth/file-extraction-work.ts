import { actorPredicate, requireOwner } from './auth'
import { digest } from './attachments'
import { extractPdfTextStep } from './file-text'
import { need, type Actor, type Input, type Job } from './model'
import { transaction } from './store'
import { auditStatement, automation } from './audit'

type Work = { file_id: string; job_id: string; checksum: string; version: number; state: 'queued' | 'complete' | 'no_text' | 'failed'; method: string; progress: number; total: number | null; error: string | null; updated_at: string }
type Page = { page: number; text: string; text_checksum: string }
const method = 'PDF embedded text'
const reviewSql = `EXISTS(SELECT 1 FROM pl_file_extraction_reviews r JOIN oa_operators o ON o.id=r.owner_id WHERE r.file_id=w.file_id AND r.checksum=w.checksum AND o.version=r.owner_version AND o.status='active' AND o.role='owner')`
const sourceSql = `EXISTS(SELECT 1 FROM pl_mail_files f JOIN pl_mail_messages m ON m.id=f.message_id JOIN pl_jobs j ON j.id=f.job_id WHERE f.id=w.file_id AND f.job_id=w.job_id AND f.checksum=w.checksum AND m.kind='captured' AND m.visibility='private')`
const workOf = (db: D1Database, id: string) => db.prepare('SELECT * FROM pl_file_extraction_work WHERE file_id=?').bind(id).first<Work>()

/** Enqueued in the same custody transaction, without parsing or adopting supplied text. */
export function enqueueFileExtraction(db: D1Database, actor: Actor, job: Job, files: { id: string; mime: string; checksum: string }[]) {
 if (actor.role !== 'owner') return []
 return files.filter(f => f.mime.toLowerCase().split(';')[0]!.trim() === 'application/pdf').flatMap(f => [
  db.prepare("INSERT INTO pl_file_extraction_work(file_id,job_id,checksum,state,method,updated_at) VALUES(?,?,?,'queued',?,?)").bind(f.id, job.id, f.checksum, method, new Date().toISOString()),
  db.prepare('INSERT INTO pl_file_extraction_reviews(file_id,checksum,owner_id,owner_version) VALUES(?,?,?,?)').bind(f.id, f.checksum, actor.id, actor.version),
 ])
}
async function reviewed(db: D1Database, id: string) {
 return !!await db.prepare(`SELECT w.file_id FROM pl_file_extraction_work w WHERE w.file_id=? AND ${reviewSql}`).bind(id).first()
}
export async function fileExtractionSummary(db: D1Database, work: Work) {
 return { status: ['complete', 'no_text'].includes(work.state) || await reviewed(db, work.file_id) ? work.state : 'review_required', method: work.method, progress: work.progress, total: work.total, version: work.version, checksum: work.checksum, ...(work.error ? { detail: work.error } : {}) }
}
/** Only the already authorized parent projection may call this reader. */
export async function extractedMailText(db: D1Database, fileId: string, checksum: string) {
 const work = await workOf(db, fileId)
 if (!work) return null
 need(work.checksum === checksum, 'Original file integrity check failed', 503, 'document_integrity')
 const pages = (await db.prepare('SELECT page,text,text_checksum FROM pl_file_extraction_pages WHERE file_id=? AND checksum=? ORDER BY page').bind(fileId, checksum).all<Page>()).results
 need(pages.length === work.progress, 'Extraction checkpoint integrity check failed', 503, 'document_integrity')
 for (const [i, page] of pages.entries()) need(page.page === i + 1 && await digest(new TextEncoder().encode(page.text)) === page.text_checksum, 'Extraction checkpoint integrity check failed', 503, 'document_integrity')
 // Recovered text is readable through its parent; continuing work needs new authority.
 return { text: pages.map(p => p.text).join('\n'), extraction: await fileExtractionSummary(db, work) }
}
async function advance(db: D1Database, work: Work, actor?: Actor) {
 const file = await db.prepare(`SELECT f.bytes,f.size FROM pl_mail_files f JOIN pl_file_extraction_work w ON w.file_id=f.id WHERE w.file_id=? AND ${sourceSql} AND ${reviewSql}`).bind(work.file_id).first<{ bytes: ArrayBuffer; size: number }>()
 need(file, 'Extraction authority or source is no longer available', 409, 'review_required')
 const bytes = new Uint8Array(file.bytes)
 const valid = bytes.length === file.size && await digest(bytes) === work.checksum
 const step = valid ? await extractPdfTextStep(bytes, work.progress) : { pages: [], total: work.total, complete: false, error: 'Original file integrity check failed' }
 const pages = await Promise.all(step.pages.map(async p => ({ ...p, checksum: await digest(new TextEncoder().encode(p.text)) })))
 const anyText = pages.some(p => p.text.trim()) || !!await db.prepare("SELECT page FROM pl_file_extraction_pages WHERE file_id=? AND length(trim(text))>0 LIMIT 1").bind(work.file_id).first()
 const state = step.error ? 'failed' : step.complete ? anyText ? 'complete' : 'no_text' : 'queued'
 const writes = [
  db.prepare(`INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_file_extraction_work w WHERE w.file_id=? AND w.version=? AND w.state='queued' AND ${sourceSql} AND ${reviewSql}) THEN 1 ELSE 0 END`).bind(work.file_id, work.version),
  ...(actor ? [db.prepare(`INSERT INTO pl_guard(ok) SELECT CASE WHEN ${actorPredicate(actor).sql} THEN 1 ELSE 0 END`).bind(...actorPredicate(actor).params)] : []),
  ...pages.map(p => db.prepare('INSERT INTO pl_file_extraction_pages(file_id,checksum,page,text,text_checksum) VALUES(?,?,?,?,?)').bind(work.file_id, work.checksum, p.page, p.text, p.checksum)),
  db.prepare('UPDATE pl_file_extraction_work SET version=version+1,state=?,progress=?,total=?,error=?,updated_at=? WHERE file_id=?').bind(state, work.progress + pages.length, step.total, step.error ?? null, new Date().toISOString(), work.file_id),
  auditStatement(db, automation('file-extraction', 'Native PDF extraction'), { kind: 'automation', action: 'files.extract', job_id: work.job_id, subject_kind: 'file', subject_id: work.file_id, detail: { progress: work.progress + pages.length, state } }),
  db.prepare('UPDATE pl_clock SET version=version+1 WHERE id=1'), db.prepare('DELETE FROM pl_guard'),
 ]
 try { await db.batch(writes) } catch (error) {
  if (/CHECK constraint failed|UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(String(error))) need(false, 'Extraction checkpoint or authority changed; refresh before continuing', 409, 'conflict')
  throw error
 }
}
/** One bounded slice per scheduled invocation; duplicate invocations cannot append twice. */
export async function dispatchFileExtraction(db: D1Database) {
 const work = await db.prepare(`SELECT w.* FROM pl_file_extraction_work w WHERE w.state='queued' AND ${reviewSql} AND ${sourceSql} ORDER BY w.updated_at,w.file_id LIMIT 1`).first<Work>()
 if (!work) return
 try { await advance(db, work) } catch (error) { if (!(error instanceof Error && 'status' in error && error.status === 409)) throw error }
}
export async function fileExtractionResponse(request: Request, db: D1Database, actor: Actor, job: Job, fileId: string, body: (r: Request) => Promise<Input>) {
 requireOwner(actor)
 const work = await workOf(db, fileId)
 need(work && work.job_id === job.id, 'Extraction work not found', 404, 'not_found')
 if (request.method === 'POST') {
  const input = await body(request)
  need(input.expected_version === work.version, 'Extraction changed; refresh before continuing', 409, 'conflict')
  if (input.action === 'review') {
   need(input.confirm === true && input.checksum === work.checksum, 'Review the exact original before enabling recovered extraction', 400, 'review_required')
   await transaction(db, actor, job, [
    db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_file_extraction_work WHERE file_id=? AND version=?) THEN 1 ELSE 0 END').bind(fileId, work.version),
    db.prepare('INSERT INTO pl_file_extraction_reviews(file_id,checksum,owner_id,owner_version) VALUES(?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET checksum=excluded.checksum,owner_id=excluded.owner_id,owner_version=excluded.owner_version').bind(fileId, work.checksum, actor.id, actor.version),
    db.prepare('UPDATE pl_file_extraction_work SET version=version+1 WHERE file_id=? AND version=?').bind(fileId, work.version),
   ], undefined, { action: 'files.extraction.review', job_id: job.id, subject_kind: 'file', subject_id: fileId })
  } else {
   need(await reviewed(db, fileId), 'Restored work needs destination-owner review', 409, 'review_required')
   if (input.action === 'retry') {
    need(work.state === 'failed', 'Only failed extraction can retry', 409, 'conflict')
    await transaction(db, actor, job, [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_file_extraction_work WHERE file_id=? AND version=?) THEN 1 ELSE 0 END').bind(fileId, work.version), db.prepare("UPDATE pl_file_extraction_work SET state='queued',error=NULL,version=version+1 WHERE file_id=? AND version=?").bind(fileId, work.version)])
   } else {
    need(input.action === 'continue' && work.state === 'queued', 'No queued extraction to continue', 409, 'conflict')
    await advance(db, work, actor)
   }
  }
 } else need(request.method === 'GET', 'Unknown extraction method', 405, 'method')
 return Response.json({ extraction: await fileExtractionSummary(db, (await workOf(db, fileId))!) }, { headers: { 'cache-control': 'private, no-store' } })
}
