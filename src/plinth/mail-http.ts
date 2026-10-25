import type { Bindings } from '../auth.server'
import { thread } from './mail-store'
import { sendJobMail } from './mail-send'
import { need, type Actor, type Input, type Job } from './model'

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
/** The job thread. The page, the file and the send each check the signed-in person's current authority; a client reaches only client messages addressed to them. */
export async function jobMailResponse(request: Request, env: Bindings, actor: Actor, job: Job, parts: string[], body: (r: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[2] !== 'correspondence') return null
 need(actor.role !== 'agent', 'A person reads job correspondence', 403, 'human_required')
 if (parts.length === 3 && request.method === 'GET') return json({ messages: await thread(env.DB, job.id, actor) })
 if (parts.length === 3 && request.method === 'POST') { const id = await sendJobMail(env, actor, job, await body(request)); return json({ id, messages: await thread(env.DB, job.id, actor) }, 201) }
 if (parts.length === 5 && parts[3] === 'files' && request.method === 'GET') {
  const file = await env.DB.prepare('SELECT f.name,f.mime,f.bytes,m.visibility,m.counterparty FROM pl_mail_files f JOIN pl_mail_messages m ON m.id=f.message_id WHERE f.id=? AND f.job_id=?').bind(parts[4], job.id).first<{ name: string; mime: string; bytes: number[]; visibility: string; counterparty: string }>()
  need(file && (actor.role !== 'member' || file.visibility === 'client' && file.counterparty === actor.email.toLowerCase()), 'File not found', 404, 'not_found')
  // Sender-supplied bytes are never rendered by this origin: always a download, never the sender's declared type.
  return new Response(new Uint8Array(file.bytes), { headers: { ...headers, 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${file.name.replace(/[^\w. -]/g, '_')}"`, 'content-security-policy': "default-src 'none'; sandbox" } })
 }
 need(false, 'Unknown correspondence route', 404, 'not_found')
}
