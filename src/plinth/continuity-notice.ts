import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { requireOwner } from './auth'
import { find, need, stamp, text, type Actor, type Input, type Job } from './model'
import { jobOf, readClock, saveJob } from './store'
import { checkWarrantySend, officeAuthority, recipientGuards } from './warranty-store'
import type { WarrantyRecipient } from './warranty-model'

/** Owner approval names the email channel and one current job recipient. Nothing sends on approval or resume. */
export async function sendContinuityNotice(env: Bindings, previous: Job, actor: Actor, id: string, input: Input, clock: number) {
 requireOwner(actor)
 need(input.channel === 'email' && input.confirm === true, 'The owner must explicitly approve this email channel and recipient')
 const email = text(input.email, 'Recipient email', 254).toLowerCase()
 const person = await env.DB.prepare("SELECT id,role FROM oa_operators WHERE lower(email)=? AND status='active'").bind(email).first<{ id: string; role: string }>()
 need(person, 'Choose a currently active person assigned to this job', 403, 'recipient')
 const office = await officeAuthority(env.DB, previous, person.id, true)
 const recipient: WarrantyRecipient = office ? { kind: 'office', email, operator_id: person.id } : { kind: 'client', email }
 const guards = await recipientGuards(env.DB, previous, recipient)
 need(guards, 'Recipient no longer has access to this job', 403, 'recipient')
 const next = structuredClone(previous), row = find(next.continuity ?? [], id)
 need(!(row.notices ?? []).some(n => n.recipient_id === person.id), 'This event already has a reserved email for this recipient; inspect its outcome before contacting them separately', 409, 'notice_reserved')
 need((row.notices?.length ?? 0) < 100, 'Review the event notice history before adding more recipients')
 const attempt: NonNullable<typeof row.notices>[number] = { id: crypto.randomUUID(), recipient_id: person.id, email, channel: 'email', approved_by: stamp(actor), status: 'unknown', label: 'Reserved; outcome unknown. This email will not be sent again by continuation.' }
 ;(row.notices ??= []).push(attempt)
 await saveJob(env.DB, actor, previous, next, guards, clock)
 try {
  const latest = await jobOf(env.DB, actor, next.id), currentGuards = await recipientGuards(env.DB, latest, recipient)
  if (!currentGuards) { attempt.status = 'cancelled'; attempt.label = 'Access changed; nothing was sent' }
  else {
   await checkWarrantySend(env.DB, latest, await readClock(env.DB), currentGuards, actor)
   const sender = operatorMail(env)
   if (!sender || !env.MAIL_FROM) { attempt.status = 'unconfigured'; attempt.label = 'Mail is not configured; nothing was sent' }
   else {
    const body = `An accepted sale or approved change has been recorded for ${latest.name}. Open your Plinth workspace to review the records available to you. This notice does not approve a schedule, order or progress application.`
    const result = await sender.send({ deliveryId: attempt.id, from: env.MAIL_FROM, to: [email], headers: {}, subject: 'Plinth: approved job update', text: body, html: `<p>${body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` })
    if (result.status === 'accepted') { attempt.status = 'accepted'; attempt.label = 'Accepted by the mail provider; delivery is not confirmed'; if (result.providerMessageId) attempt.provider_message_id = result.providerMessageId }
    else if (result.status === 'development') { attempt.status = 'development'; attempt.label = 'Development mail suppressed; no external message was sent' }
    else if (result.status === 'rejected' || result.status === 'rate_limited') { attempt.status = 'refused'; attempt.label = 'Provider refused the email; no automatic resend' }
   }
  }
 } catch { /* An external outcome may be unknown. The durable reservation prevents replay. */ }
 const latest = await jobOf(env.DB, actor, next.id), outcome = structuredClone(latest)
 const stored = find(find(outcome.continuity ?? [], id).notices ?? [], attempt.id)
 Object.assign(stored, attempt)
 await saveJob(env.DB, actor, latest, outcome, [], await readClock(env.DB))
 return outcome
}
