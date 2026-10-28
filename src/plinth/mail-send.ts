import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { auditStatement } from './audit'
import { requireJobManager } from './auth'
import { company } from './company'
import { clientEmail } from './job-customers'
import { mailKinds, oneLine, optionalNotice, plain, replyAddress, type MailKind, type MailStatus } from './mail-model'
import { suppression } from './mail-store'
import { find, need, stamp, type Actor, type Input, type Job } from './model'
import { readClock, transaction } from './store'
import { recipientGuards, checkWarrantySend } from './warranty-store'

const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
const html = (text: string) => `<pre style="font-family:inherit;white-space:pre-wrap">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`
interface Composed { subject: string; text: string }
/** The message each business kind sends, built from the job's own current records so the thread never carries an invented figure. */
function compose(job: Job, kind: MailKind, input: Input): Composed {
 if (kind === 'selection_request' || kind === 'selection_reminder') {
  const selection = find(job.selections ?? [], String(input.selection_id)), revision = selection.revisions.at(-1)!
  need(revision.status === 'presented', 'Present the selection to the client before requesting a decision', 409, 'selection_state')
  const options = revision.options.map(o => `- ${o.name} (${usd(o.price_cents)}); supplier ${o.supplier}`).join('\n')
  const lead = kind === 'selection_request' ? 'Your decision is needed' : 'A reminder: your decision is still needed'
  return { subject: `${lead}: ${revision.room} / ${revision.category} by ${revision.decision_on}`, text: `${lead} on ${job.name}.\n${revision.room} / ${revision.category}\nDecision date: ${revision.decision_on}\nAllowance: ${usd(revision.allowance_cents)}\n\nOptions:\n${options}\n\nOpen your signed-in Plinth client portal to review and sign. Reply to this email with questions or files; the reply joins this job's thread.` }
 }
 if (kind === 'proposal') {
  const quote = find(job.quotes, String(input.quote_id)); need(quote.status !== 'superseded', 'That proposal revision was superseded', 409, 'quote_state')
  return { subject: `Proposal revision ${quote.revision} for ${job.name}`, text: `Proposal revision ${quote.revision} for ${job.name}.\nTotal: ${usd(quote.total_cents)} across ${quote.lines.length} line${quote.lines.length === 1 ? '' : 's'}.\n\nOpen your signed-in Plinth client portal to review the exact priced scope. Reply to this email with questions or files; the reply joins this job's thread.` }
 }
 need(kind === 'update' || kind === 'message' || kind === 'reminder', 'Send invoices from the invoice screen', 400, 'mail_kind')
 return { subject: oneLine(plain(input.subject, 'Subject', 200)), text: plain(input.body, 'Message', 20_000) }
}
export const statusOf = (result: { status: string }): { status: MailStatus; label: string } => result.status === 'accepted' ? { status: 'accepted', label: 'Accepted by the mail provider; delivery is not confirmed' }
 : result.status === 'development' ? { status: 'development', label: 'Development mail suppressed; nothing was sent to the client' }
 : result.status === 'rejected' || result.status === 'rate_limited' ? { status: 'refused', label: 'The provider refused this message; no automatic resend' }
 : { status: 'unknown', label: 'Send reserved; provider outcome unknown. No automatic resend.' }
/** One durable row per attempt, written before the provider is called. Optional notices to an unsubscribed mailbox are recorded as suppressed and never sent. */
export async function sendJobMail(env: Bindings, actor: Actor, job: Job, input: Input) {
 requireJobManager(actor)
 const kind = String(input.kind) as MailKind
 if (kind as string === 'note') return addNote(env.DB, actor, job, plain(input.body, 'Note', 20_000))
 need(Object.hasOwn(mailKinds, kind), 'Unknown message kind', 400, 'mail_kind')
 const email = String(input.to ?? job.client_email).trim().toLowerCase()
 need(await clientEmail(env.DB, job, email), 'That recipient is not a current client contact of this job', 403, 'recipient')
 const { subject, text } = compose(job, kind, input), required = mailKinds[kind].required, id = crypto.randomUUID(), now = new Date().toISOString()
 const suppressed = required ? null : await suppression(env.DB, email)
 const row = { id, job_id: job.id, direction: 'out', visibility: 'client', kind, required: required ? 1 : 0, counterparty: email, subject, body: text, by_id: actor.id, by_name: actor.name, created_at: now }
 const insert = (status: MailStatus, label: string) => env.DB.prepare('INSERT INTO pl_mail_messages(id,job_id,direction,visibility,kind,required,counterparty,subject,body,status,label,by_id,by_name,created_at,status_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(row.id, row.job_id, row.direction, row.visibility, row.kind, row.required, row.counterparty, row.subject, row.body, status, label, row.by_id, row.by_name, row.created_at, row.created_at)
 const audit = { kind: 'send' as const, action: 'mail.send', subject_kind: 'mail', subject_id: id, job_id: job.id, detail: { mail_kind: kind, required } }
 if (suppressed) {
  await transaction(env.DB, actor, null, [insert('suppressed', `Not sent: the recipient ${suppressed.reason === 'unsubscribed' ? 'unsubscribed from' : 'is suppressed for'} optional notices`)], undefined, { ...audit, action: 'mail.suppressed' })
  return id
 }
 const guards = await recipientGuards(env.DB, job, { kind: 'client', email })
 need(guards, 'The recipient no longer has current access to this job', 403, 'recipient')
 const clock = await readClock(env.DB)
 await transaction(env.DB, actor, null, [...guards, insert('unknown', 'Send reserved; provider outcome unknown. No automatic resend.')], clock, audit)
 let outcome: { status: MailStatus; label: string } = statusOf({ status: 'uncertain' }), providerId: string | null = null
 const sender = operatorMail(env)
 if (!sender || !env.MAIL_FROM) outcome = { status: 'unconfigured', label: 'Mail is not configured; nothing was sent' }
 else {
  try {
   await checkWarrantySend(env.DB, job, await readClock(env.DB), guards, actor)
   const builder = (await company(env.DB))?.name ?? 'Your builder', reply = await replyAddress(env, id, email)
   const optional = required ? null : await optionalNotice(env, email), body = `${builder}\n\n${text}${optional?.text ?? ''}`
   const result = await sender.send({ deliveryId: id, from: env.MAIL_FROM, to: [email], ...(reply ? { replyTo: reply } : {}), subject, text: body, html: html(body), headers: {}, ...(optional?.unsubscribe ? { unsubscribe: optional.unsubscribe } : {}) })
   outcome = statusOf(result); if ('providerMessageId' in result && result.providerMessageId) providerId = String(result.providerMessageId)
  } catch { outcome = { status: "unknown", label: "Send reserved; provider outcome unknown. No automatic resend." } }
 }
 await finishSend(env.DB, actor, job.id, id, outcome, providerId)
 return id
}
/** An unattended finish only moves a still-unknown reservation; a verified provider event that arrived first is never overwritten. */
export async function finishSend(db: D1Database, actor: Actor, jobId: string, id: string, outcome: { status: MailStatus; label: string }, providerId: string | null) {
 await db.batch([
  db.prepare("UPDATE pl_mail_messages SET status=?,label=?,status_at=?,provider_message_id=COALESCE(?,provider_message_id) WHERE id=? AND status='unknown'").bind(outcome.status, outcome.label, new Date().toISOString(), providerId, id),
  auditStatement(db, actor, { kind: 'send', action: 'mail.send_outcome', subject_kind: 'mail', subject_id: id, job_id: jobId, detail: { status: outcome.status } }),
 ])
}
async function addNote(db: D1Database, actor: Actor, job: Job, body: string) {
 const id = crypto.randomUUID(), now = new Date().toISOString(), by = stamp(actor)
 await transaction(db, actor, null, [db.prepare("INSERT INTO pl_mail_messages(id,job_id,direction,visibility,kind,required,counterparty,subject,body,status,label,by_id,by_name,created_at,status_at) VALUES(?,?,'note','private','note',0,?,?,?,'note','Private note: office only, never emailed',?,?,?,?)").bind(id, job.id, '', 'Private note', body, by.id, by.name, now, now)], undefined, { kind: 'record', action: 'mail.note', subject_kind: 'mail', subject_id: id, job_id: job.id })
 return id
}
