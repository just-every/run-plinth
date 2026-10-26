import { captureJobMail } from './mail-capture'
import { digest } from './attachments'
import type { Bindings } from '../auth.server'
import { thread } from './mail-store'
import { replyAddress } from './mail-model'
import { sendJobMail } from './mail-send'
import { need, type Actor, type Input, type Job } from './model'

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
/** The job thread. The page, the file and the send each check the signed-in person's current authority; a client reaches only client messages addressed to them. */
export async function jobMailResponse(request: Request, env: Bindings, actor: Actor, job: Job, parts: string[], body: (r: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[2] !== 'correspondence') return null
 need(actor.role !== 'agent', 'A person reads job correspondence', 403, 'human_required')
 if (parts.length === 3 && request.method === 'GET') { const messages=await thread(env.DB, job.id, actor); return json({ messages:await Promise.all(messages.map(async message=>({...message,...(message.direction==='out'?{reply_to:await replyAddress(env,message.id,message.counterparty)}:{})}))) }) }
 if (parts.length === 3 && request.method === 'POST') { const input = await body(request); const id = input.kind === 'capture' ? await captureJobMail(env.DB, actor, job, input) : await sendJobMail(env, actor, job, input); return json({ id, messages: await thread(env.DB, job.id, actor) }, 201) }
 if (parts.length === 5 && parts[4] === 'original' && request.method === 'GET') {
  const allowed = (await thread(env.DB, job.id, actor)).find(m => m.id === parts[3])
  need(allowed, 'Email not found', 404, 'not_found')
  const original = await env.DB.prepare('SELECT checksum,size,bytes FROM pl_mail_originals WHERE message_id=? AND job_id=?').bind(allowed.id, job.id).first<{ checksum: string; size: number; bytes: ArrayBuffer }>()
  need(original, 'Original email not found', 404, 'not_found')
  const bytes = new Uint8Array(original.bytes)
  need(bytes.length === original.size && await digest(bytes) === original.checksum, 'Original email integrity check failed', 503, 'document_integrity')
  return new Response(bytes, { headers: { ...headers, 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename=original-email.eml', 'content-security-policy': "default-src 'none'; sandbox" } })
 }
 if (parts.length === 5 && parts[3] === 'files' && request.method === 'GET') {
  const file = await env.DB.prepare('SELECT f.name,f.mime,f.bytes,f.checksum,f.size,m.visibility,m.counterparty FROM pl_mail_files f JOIN pl_mail_messages m ON m.id=f.message_id WHERE f.id=? AND f.job_id=?').bind(parts[4], job.id).first<{ name: string; mime: string; bytes: ArrayBuffer; checksum: string; size: number; visibility: string; counterparty: string }>()
  need(file && (actor.role !== 'member' || file.visibility === 'client' && file.counterparty === actor.email.toLowerCase()), 'File not found', 404, 'not_found')
  const bytes = new Uint8Array(file.bytes)
  need(bytes.length === file.size && await digest(bytes) === file.checksum, 'Original attachment integrity check failed', 503, 'document_integrity')
  // Sender-supplied bytes are never rendered by this origin: always a download, never the sender's declared type.
  return new Response(bytes, { headers: { ...headers, 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${file.name.replace(/[^\w. -]/g, '_')}"`, 'content-security-policy': "default-src 'none'; sandbox" } })
 }
 need(false, 'Unknown correspondence route', 404, 'not_found')
}
