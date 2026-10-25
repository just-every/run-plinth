import { normalizeInbound, type InboundMail } from '../mail.events.mjs'
import { runtimeBindings, type Bindings } from '../auth.server'
import { auditStatement, automation } from './audit'
import { clientAccess } from './job-customers'
import { mailLimits, parseReplyAddress, replyMatches } from './mail-model'
import { messageOf } from './mail-store'
import { loadWarrantyJob } from './warranty-store'

/** The Worker side of Cloudflare Email Routing. */
export interface RoutedEmail { from: string; to: string; headers: Headers; raw: ReadableStream; rawSize: number; setReject(reason: string): void }
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
const strip = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]*>/g, '').replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
const fileName = (name: string, n: number) => (name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120)) || `attachment-${n + 1}`
/** Authentication-Results from the receiving edge: any failing SPF, DKIM or DMARC verdict refuses the reply; the verdict is kept as evidence. */
function senderCheck(headers: Headers): { ok: boolean; verdict: string } {
 const verdicts = (headers.get('authentication-results') ?? '').toLowerCase().match(/\b(spf|dkim|dmarc)=(\w+)/g) ?? []
 return { ok: !verdicts.some(v => /=(fail|softfail|permerror)$/.test(v)), verdict: verdicts.length ? verdicts.join(' ').slice(0, 200) : 'not reported' }
}
async function refuse(env: Bindings, message: RoutedEmail, reason: string, jobId?: string) {
 await env.DB.batch([auditStatement(env.DB, automation('mail-inbound', 'Inbound job mail'), { kind: 'automation', action: 'mail.inbound.refused', subject_kind: 'mail', ...(jobId ? { job_id: jobId } : {}), detail: { reason } })])
 message.setReject(reason)
}
/** A reply joins its job thread only when it arrives at that message's own address, from its recipient, who still has client access. Nothing else is stored. */
export async function plinthEmail(message: RoutedEmail, original: Bindings): Promise<void> {
 const env = runtimeBindings(original)
 let mail: InboundMail
 try { mail = await normalizeInbound({ provider: 'cloudflare', message }, mailLimits) } catch { return refuse(env, message, 'The message could not be read or exceeds the size limits') }
 const address = [message.to, ...mail.to].map(a => parseReplyAddress(env, a))
 const token = (await Promise.all(address)).find(Boolean)
 const origin = token ? await messageOf(env.DB, token.messageId) : null
 if (!token || !origin || origin.direction !== 'out' || origin.visibility !== 'client') return refuse(env, message, 'Unknown reply address')
 const sender = mail.from.toLowerCase()
 if (!await replyMatches(env, origin.id, origin.counterparty, token.mac) || sender !== origin.counterparty) return refuse(env, message, 'This reply address does not accept mail from that sender', origin.job_id)
 const check = senderCheck(message.headers)
 if (!check.ok) return refuse(env, message, 'The sender failed authentication', origin.job_id)
 const job = await loadWarrantyJob(env.DB, origin.job_id)
 if (!job) return refuse(env, message, 'Unknown reply address')
 if (!await clientAccess(env.DB, job, sender)) return refuse(env, message, 'The sender no longer has access to this job', job.id)
 const id = crypto.randomUUID(), now = new Date().toISOString(), body = (mail.text ?? strip(mail.html ?? '')).trim().slice(0, 100_000)
 const files = await Promise.all(mail.attachments.map(async (a, n) => ({ id: crypto.randomUUID(), name: fileName(a.filename, n), mime: (a.contentType || 'application/octet-stream').slice(0, 100), checksum: hex(await crypto.subtle.digest('SHA-256', a.content as BufferSource)), bytes: a.content })))
 const writes = [
  env.DB.prepare("INSERT INTO pl_mail_messages(id,job_id,direction,visibility,kind,required,counterparty,subject,body,status,label,message_id,in_reply_to,reply_to_id,sender_check,by_id,by_name,created_at,status_at) VALUES(?,?,'in','client','reply',0,?,?,?,'received','Reply received by email',?,?,?,?,?,?,?,?)").bind(id, job.id, sender, mail.subject.slice(0, 300), body, mail.messageId, mail.inReplyTo, origin.id, check.verdict, 'inbound:' + sender, sender, now, now),
  ...files.map(f => env.DB.prepare('INSERT INTO pl_mail_files(id,message_id,job_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?,?)').bind(f.id, id, job.id, f.name, f.mime, f.checksum, f.bytes.length, f.bytes)),
  auditStatement(env.DB, automation('mail-inbound', 'Inbound job mail'), { kind: 'automation', action: 'mail.inbound', subject_kind: 'mail', subject_id: id, job_id: job.id, detail: { in_reply_to: origin.id, attachments: files.length, sender_check: check.verdict } }),
 ]
 try { await env.DB.batch(writes) } catch (error) {
  if (/UNIQUE constraint failed/.test(String(error))) return // the same Message-ID already joined this thread
  if (/FOREIGN KEY constraint failed|job_erased/.test(String(error))) return refuse(env, message, 'Unknown reply address')
  throw error
 }
}
