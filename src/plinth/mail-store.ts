import { auditStatement, automation } from './audit'
import type { Actor } from './model'
import { mailRank, type MailMessage, type MailStatus } from './mail-model'

type Row = Omit<MailMessage, 'required' | 'files'> & { required: number }
const columns = 'id,job_id,direction,visibility,kind,required,counterparty,subject,body,status,label,provider_message_id,reply_to_id,sender_check,by_id,by_name,created_at,status_at'
/** The job thread, oldest first. A client sees only client-visible messages addressed to their own mailbox; private notes never leave the office. */
export async function thread(db: D1Database, jobId: string, viewer: Actor): Promise<MailMessage[]> {
 const client = viewer.role === 'member'
 const rows = await db.prepare(`SELECT ${columns} FROM pl_mail_messages WHERE job_id=?${client ? " AND visibility='client' AND counterparty=?" : ''} ORDER BY created_at,rowid`).bind(...(client ? [jobId, viewer.email.toLowerCase()] : [jobId])).all<Row>()
 const files = await db.prepare('SELECT id,message_id,name,mime,size FROM pl_mail_files WHERE job_id=? ORDER BY rowid').bind(jobId).all<{ id: string; message_id: string; name: string; mime: string; size: number }>()
 return rows.results.map(row => ({ ...row, required: row.required === 1, files: files.results.filter(f => f.message_id === row.id).map(({ id, name, mime, size }) => ({ id, name, mime, size })) }))
}
export async function suppression(db: D1Database, email: string) { return db.prepare('SELECT reason,source,at FROM pl_mail_suppressions WHERE email=?').bind(email.toLowerCase()).first<{ reason: string; source: string; at: string }>() }
/** Suppression keeps its strongest reason and is only ever added here: no automatic notice undoes a recipient's choice. */
export function suppress(db: D1Database, email: string, reason: 'unsubscribed' | 'complained' | 'bounced', source: string) {
 return db.prepare("INSERT INTO pl_mail_suppressions(email,reason,source,at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET reason=CASE WHEN pl_mail_suppressions.reason='complained' THEN 'complained' WHEN excluded.reason='complained' THEN 'complained' WHEN pl_mail_suppressions.reason='unsubscribed' THEN 'unsubscribed' ELSE excluded.reason END").bind(email.toLowerCase(), reason, source, new Date().toISOString())
}
const labels: Partial<Record<MailStatus, string>> = { delivered: 'Delivered to the recipient mail server; this is not proof it was read', bounced: 'Bounced: the address could not receive it', complained: 'The recipient marked it as spam; optional notices to this address are suppressed', unsubscribed: 'The recipient unsubscribed from optional notices', deferred: 'Delayed by the recipient mail server; the provider is retrying', accepted: 'Accepted by the mail provider; delivery is not confirmed' }
/** Apply one verified provider event to its message: forward-only, idempotent, and audited under the named automation. */
export function applyDelivery(db: D1Database, messageId: string, jobId: string, status: Exclude<MailStatus, 'unknown'>, providerMessageId: string | undefined, eventType: string, at: number) {
 return {
  update: db.prepare("UPDATE pl_mail_messages SET status=?,label=?,status_at=?,provider_message_id=COALESCE(provider_message_id,?) WHERE id=? AND direction='out' AND CASE status WHEN 'unknown' THEN 0 WHEN 'accepted' THEN 1 WHEN 'deferred' THEN 2 WHEN 'delivered' THEN 3 WHEN 'unsubscribed' THEN 4 WHEN 'bounced' THEN 5 WHEN 'complained' THEN 6 ELSE -1 END < ?").bind(status, labels[status] ?? status, new Date(at).toISOString(), providerMessageId ?? null, messageId, mailRank[status] ?? 0),
  audit: auditStatement(db, automation('mail-events', 'Signed mail delivery events'), { kind: 'automation', action: 'mail.event', subject_kind: 'mail', subject_id: messageId, job_id: jobId, detail: { event: eventType, status } }),
 }
}
export async function messageOf(db: D1Database, id: string) { return db.prepare(`SELECT ${columns} FROM pl_mail_messages WHERE id=?`).bind(id).first<Row>() }
/** An attempt another door already holds (an invoice, a warranty reminder) also appears on the job thread under its own id, so provider events and the thread agree. Idempotent. */
export async function mirrorSend(db: D1Database, r: { id: string; job_id: string; kind: string; required: boolean; to: string; visibility: 'client' | 'private'; subject: string; text: string; status: MailStatus; label: string; provider_message_id?: string | undefined }) {
 const now = new Date().toISOString()
 try {
  await db.prepare("INSERT OR IGNORE INTO pl_mail_messages(id,job_id,direction,visibility,kind,required,counterparty,subject,body,status,label,provider_message_id,by_id,by_name,created_at,status_at) VALUES(?,?,'out',?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(r.id, r.job_id, r.visibility, r.kind, r.required ? 1 : 0, r.to.toLowerCase(), r.subject, r.text, r.status, r.label, r.provider_message_id ?? null, 'system', 'Plinth', now, now).run()
 } catch { /* The job may have been erased meanwhile; the attempt's own record is authoritative. */ }
}
