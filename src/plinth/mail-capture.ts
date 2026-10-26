import { mailText } from './mail-content'
import { normalizeInbound } from '../mail.events.mjs'
import { requireJobManager } from './auth'
import { digest } from './attachments'
import { mailLimits } from './mail-model'
import { need, text, type Actor, type Input, type Job } from './model'
import { transaction } from './store'

/** Explicit office custody of an original email. Capture is private and never sends or verifies the sender. */
export async function captureJobMail(db: D1Database, actor: Actor, job: Job, input: Input) {
 requireJobManager(actor)
 need(!actor.permissions && actor.session_id && !actor.credential_id, 'A currently authorized office person captures private correspondence', 403, 'human_required')
 need(input.confirm === true, 'Confirm this original email belongs in the private job record')
 const encoded = text(input.original_base64, 'Original email', 13_981_016)
 need(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded), 'Original email must be canonical base64')
 let raw: string
 try { raw = atob(encoded) } catch { need(false, 'Original email must be canonical base64') }
 need(btoa(raw!) === encoded, 'Original email must be canonical base64')
 const bytes = Uint8Array.from(raw!, c => c.charCodeAt(0))
 need(bytes.length > 0 && bytes.length <= mailLimits.maxRawBytes, 'Original email exceeds the size limit')
 const mail = await normalizeInbound({ provider: 'cloudflare', message: { from: undefined, to: undefined, headers: new Headers(), raw: new Blob([bytes]).stream(), rawSize: bytes.length } }, mailLimits)
 need(mail.from && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.from), 'Original email needs a sender mailbox')
 const id = crypto.randomUUID(), now = new Date().toISOString(), checksum = await digest(bytes)
 const existing = await db.prepare('SELECT message_id FROM pl_mail_originals WHERE job_id=? AND checksum=?').bind(job.id, checksum).first<{ message_id: string }>()
 need(!existing, 'This original email is already captured on the job', 409, 'mail_duplicate')
 const files = await Promise.all(mail.attachments.map(async (a, n) => ({ id: crypto.randomUUID(), name: a.filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || `attachment-${n + 1}`, mime: a.contentType || 'application/octet-stream', bytes: a.content, checksum: await digest(a.content) })))
 const writes = [
  db.prepare("INSERT INTO pl_mail_messages(id,job_id,direction,visibility,kind,required,counterparty,subject,body,status,label,message_id,sender_check,by_id,by_name,created_at,status_at) VALUES(?,?,'in','private','captured',0,?,?,?,'received','Original email captured by office; sender not independently verified',?,'office capture',?,?,?,?)").bind(id, job.id, mail.from.toLowerCase(), mail.subject.slice(0, 300), (mail.text ?? mailText(mail.html ?? '')).slice(0, 100_000), mail.messageId, actor.id, actor.name, now, now),
  db.prepare('INSERT INTO pl_mail_originals(message_id,job_id,checksum,size,bytes) VALUES(?,?,?,?,?)').bind(id, job.id, checksum, bytes.length, bytes),
  ...files.map(f => db.prepare('INSERT INTO pl_mail_files(id,message_id,job_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?,?)').bind(f.id, id, job.id, f.name, f.mime, f.checksum, f.bytes.length, f.bytes)),
 ]
 await transaction(db, actor, job, writes, undefined, { kind: 'record', action: 'mail.capture', subject_kind: 'mail', subject_id: id, job_id: job.id, detail: { attachments: files.length } })
 return id
}
