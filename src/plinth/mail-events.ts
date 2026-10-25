import { createD1EventStore, createDeliveryEventIntake, type DeliveryEvent } from '../mail.events.mjs'
import type { Bindings } from '../auth.server'
import { auditStatement, automation } from './audit'
import { unsubscribeEmail } from './mail-model'
import { applyDelivery, messageOf, suppress } from './mail-store'
import type { MailStatus } from './mail-model'

const noStore = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' }
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: noStore })
const MAX = 1024 * 1024
async function bounded(request: Request) {
 const reader = request.body?.getReader(); if (!reader) return new Uint8Array()
 const chunks: Uint8Array[] = []; let size = 0
 for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX) { await reader.cancel(); return null } chunks.push(value) }
 const all = new Uint8Array(size); let at = 0; for (const c of chunks) { all.set(c, at); at += c.length }
 return all
}
type Seen = DeliveryEvent
/** Public, signature-gated: the provider's signed event webhook. Every event must name a message this installation sent and only that message's own recipient. */
async function events(request: Request, env: Bindings) {
 if (!env.MAIL_EVENT_KEY || (env.MAIL_PROVIDER !== 'sendgrid' && env.MAIL_PROVIDER !== 'resend')) return reply(503, { error: 'events_unconfigured', message: 'Signed delivery events are not configured' })
 const rawBody = await bounded(request); if (!rawBody) return reply(413, { error: 'too_large', message: 'Event body too large' })
 const seen: Seen[] = []
 const intake = createDeliveryEventIntake({
  provider: env.MAIL_PROVIDER!, tenantId: 'plinth', eventNamespace: 'job-mail', key: env.MAIL_EVENT_KEY!, store: createD1EventStore({ db: env.DB }),
  authorize: async (event) => {
   const message = event.deliveryId ? await messageOf(env.DB, event.deliveryId) : null
   if (!message || message.direction !== 'out' || !event.recipients.length || !event.recipients.every(r => r.toLowerCase() === message.counterparty)) return false
   seen.push(event); return true
  },
 })
 let results: { eventId: string; outcome: string }[]
 try { results = await intake.ingestWebhook({ rawBody, headers: request.headers }) } catch (error) {
  const code = (error as { code?: string }).code ?? 'event_rejected'
  return reply(code === 'event_identity_conflict' ? 409 : 400, { error: code, message: 'The event batch was refused and nothing was stored' })
 }
 // Effects follow the durable receipt and are idempotent, so a retry after a crash applies what a stored receipt did not.
 const stored = new Set(results.filter(r => r.outcome === 'stored').map(r => r.eventId))
 for (const event of seen) {
  const message = (await messageOf(env.DB, event.deliveryId!))!, email = message.counterparty, writes: D1PreparedStatement[] = [], first = stored.has(event.eventId)
  const status = event.status === 'rejected' || event.status === 'failed' ? 'bounced' : event.status as MailStatus | null
  if (event.type === 'unsubscribe' || event.type === 'group_unsubscribe') {
   writes.push(suppress(env.DB, email, 'unsubscribed', 'provider-event'), applyDelivery(env.DB, message.id, message.job_id, 'unsubscribed', event.providerMessageId, event.type, event.occurredAt).update)
  } else if (status) {
   if (status === 'complained') writes.push(suppress(env.DB, email, 'complained', 'provider-event'))
   if (status === 'bounced' && event.type === 'bounce') writes.push(suppress(env.DB, email, 'bounced', 'provider-event'))
   writes.push(applyDelivery(env.DB, message.id, message.job_id, status as Exclude<MailStatus, 'unknown'>, event.providerMessageId, event.type, event.occurredAt).update)
  }
  if (first && writes.length) writes.push(auditStatement(env.DB, automation('mail-events', 'Signed mail delivery events'), { kind: 'automation', action: 'mail.event', subject_kind: 'mail', subject_id: message.id, job_id: message.job_id, detail: { event: event.type } }))
  if (writes.length) await env.DB.batch(writes)
 }
 return reply(200, { received: results.length, stored: stored.size })
}
const page = (title: string, body: string, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px/1.5 system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">${title}</h1>${body}`, { status, headers: { ...noStore, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" } })
/** A signed link names one mailbox. GET only explains; a POST (the mail client's one-click or the button) records the unsubscribe from optional notices. */
async function unsubscribe(request: Request, env: Bindings, token: string) {
 const email = await unsubscribeEmail(env, token)
 if (!email) return page('This link is not valid', '<p>The unsubscribe link is invalid or incomplete.</p>', 404)
 if (request.method === 'GET') return page('Unsubscribe from optional notices', `<p>Stop optional notices (reminders and updates) sent by this builder to ${email.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}. Required messages about your invoices, proposals and decisions will still arrive.</p><form method="post"><button style="font:inherit;padding:.5rem 1rem">Unsubscribe</button></form>`)
 if (request.method !== 'POST') return page('Method not allowed', '', 405)
 await env.DB.batch([suppress(env.DB, email, 'unsubscribed', 'recipient-link'), auditStatement(env.DB, automation('mail-unsubscribe', 'Recipient unsubscribe link'), { kind: 'automation', action: 'mail.unsubscribe', subject_kind: 'mail' })])
 return page('You are unsubscribed', '<p>Optional notices from this builder to this address are stopped. Required messages about your invoices, proposals and decisions will still arrive.</p>')
}
export async function mailPublicResponse(request: Request, env: Bindings): Promise<Response | null> {
 const parts = new URL(request.url).pathname.slice('/api/plinth/'.length).split('/').filter(Boolean)
 if (parts[0] !== 'mail') return null
 if (parts[1] === 'events' && parts.length === 2 && request.method === 'POST') return events(request, env)
 if (parts[1] === 'unsubscribe' && parts.length === 3) return unsubscribe(request, env, parts[2]!)
 return null
}
