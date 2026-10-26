import { digest } from './attachments'
import { extractFileText, type FileText } from './file-text'
import { need } from './model'
import { latestFileTranscription } from './file-transcriptions'
import type { DecisionHit } from './decision-search'

export interface SearchFile { id: string; name: string; href: string; mime?: string; checksum?: string; base64?: string; table?: 'pl_attachments' | 'pl_mail_files' }
/** Call only after the parent projection has granted this exact original. */
export async function searchableFile(db: D1Database, jobId: string, parent: DecisionHit, file: SearchFile): Promise<DecisionHit> {
 let bytes: Uint8Array, mime = file.mime ?? '', checksum = file.checksum
 if (file.base64 !== undefined) bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0))
 else {
  const table = file.table ?? 'pl_attachments'
  const row = await db.prepare(`SELECT bytes,mime,checksum,size FROM ${table} WHERE id=? AND job_id=?`).bind(file.id, jobId).first<{ bytes: ArrayBuffer; mime: string; checksum: string; size: number }>()
  need(row, 'Original file is missing', 503, 'document_missing')
  need(!file.checksum || file.checksum === row.checksum, 'Original file integrity check failed', 503, 'document_integrity')
  bytes = new Uint8Array(row.bytes); mime = row.mime; checksum = row.checksum
  need(bytes.length === row.size, 'Original file integrity check failed', 503, 'document_integrity')
 }
 need(checksum && await digest(bytes) === checksum, 'Original file integrity check failed', 503, 'document_integrity')
 const extraction: FileText = await extractFileText(bytes, mime)
 const supplied = await latestFileTranscription(db, jobId, 'files:' + file.id, checksum)
 return { ...parent, source: 'files:' + file.id, title: file.name, text: [extraction.text, ...(supplied ? ['Human-supplied transcription:\n' + supplied.text] : [])].filter(Boolean).join('\n\n'), file_checksum: checksum, ...(supplied ? { transcription: { revision: supplied.revision, supplied_by: supplied.supplied_by } } : {}), href: parent.href.replace(/source=[^&]+/, 'source=' + encodeURIComponent('files:' + file.id)), files: [{ name: file.name, href: file.href }], extraction: { status: extraction.status, ...(extraction.detail ? { detail: extraction.detail } : {}) } }
}
