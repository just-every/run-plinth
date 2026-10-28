import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { decisionDownload } from './decision-files'
import { deliveryPermissions } from './delivery-permissions'
import { optionalNotice } from './mail-model'
import { suppression } from './mail-store'
import { find, need, recordApproval, stamp, type Actor, type Input, type Job } from './model'
import { readClock, saveJob } from './store'
import { submittalCommitment, type SubmittalNotice } from './submittal-model'
import { currentReviewer, submittalAccess } from './submittals'
import { checkWarrantySend, loadWarrantyJob, saveWarrantyJob } from './warranty-store'

/** Explicit owner disclosure of one completed cycle to its existing PO supplier. Never a procurement release. */
async function eligible(env: Bindings, job: Job, actor: Actor, id: string, input: Input) {
 submittalAccess(actor, job)
 need(actor.role === 'owner' && actor.session_id && !actor.credential_id, 'Only the signed-in owner notifies a supplier', 403, 'forbidden')
 const row = find(job.submittals ?? [], id), cycle = row.cycles.at(-1)!, order = find(job.orders, row.order_id)
 need(input.cycle_id === cycle.id && input.product_reference === cycle.product_reference, 'Notify only the current exact vendor version', 409, 'submittal_version')
 need(cycle.decision, 'Complete the review before notifying the supplier', 409, 'submittal_unreviewed')
 await currentReviewer(env.DB, job, cycle)
 need(order.status !== 'cancelled', 'The commitment was cancelled', 409, 'order_state')
 need(cycle.commitment === submittalCommitment(order, true), 'Commitment terms changed; review a new cycle before notifying the supplier', 409, 'submittal_mismatch')
 need(order.vendor_email && input.to === order.vendor_email, 'Confirm the existing purchase order supplier email', 409, 'recipient')
 const guards = await deliveryPermissions(env.DB, job, order.vendor_email, 'documents', true)
 need(guards, 'The supplier recipient no longer has access', 403, 'recipient')
 need(!await suppression(env.DB, order.vendor_email), 'Supplier mail is suppressed; use an authorized alternative channel', 409, 'mail_suppressed')
 return { row, cycle, order, guards }
}

export async function sendSubmittalNotice(env: Bindings, previous: Job, actor: Actor, id: string, input: Input, clock: number) {
 const { row, cycle, order, guards } = await eligible(env, previous, actor, id, input)
 need(input.confirm === true, 'Confirm sharing this disposition, comments, annotations and exact originals with the supplier')
 need(!(row.notices ?? []).some(n => n.cycle_id === cycle.id && n.status !== 'refused' && n.status !== 'development'), 'This cycle already has a send attempt; reconcile the recorded outcome without resending', 409, 'mail_reserved')
 const sender = operatorMail(env)
 need(sender && env.MAIL_FROM, 'Supplier mail is not configured; nothing was sent', 409, 'mail_unconfigured')
 const attachments = []
 for (const file of cycle.attachments) {
  const original = await decisionDownload(env.DB, previous, cycle.attachments, file.id)
  attachments.push({ filename: file.name, contentType: file.mime, content: new Uint8Array(await original.arrayBuffer()) })
 }
 const outcomeName = cycle.decision!.disposition.replaceAll('_', ' ')
 const subject = `Submittal ${outcomeName}: ${row.title} (cycle ${cycle.revision})`
 const body = [previous.name, `Supplier: ${order.supplier}`, `Commitment: ${order.description}`, `Vendor product: ${cycle.product_reference}`, `Required review date: ${cycle.required_on}`, `Specified scope: ${cycle.specified_scope}`, `Deviation: ${cycle.deviation || 'None declared'}`, `Disposition: ${outcomeName}`, `Reviewer: ${cycle.decision!.by.name}`, `Review comments: ${cycle.decision!.comment}`, ...cycle.annotations.map(a => `Annotation on ${find(cycle.attachments, a.file_id).name}, page ${a.page}: ${a.text} (${a.by.name})`), '', 'The exact reviewed originals are attached. This notice does not issue an order or authorize procurement.'].join('\n')
 const notice: SubmittalNotice = { id: crypto.randomUUID(), cycle_id: cycle.id, to: order.vendor_email!, by: stamp(actor), subject, body, status: 'unknown', label: 'Provider outcome unknown; reconcile with the supplier before any further action' }
 const reserved = structuredClone(previous)
 ;(find(reserved.submittals!, id).notices ??= []).push(notice)
 recordApproval(reserved, actor, 'submittal.notify', { id: row.id, prepared_by: cycle.submitted_by, revision: cycle.revision }, notice)
 await saveJob(env.DB, actor, previous, reserved, guards, clock)
 const outcome = { ...notice }
 let called = false
 try {
  const seen = await readClock(env.DB), latest = await loadWarrantyJob(env.DB, previous.id)
  need(latest, 'The job was erased', 404, 'not_found')
  const current = await eligible(env, latest, actor, id, input), optional = await optionalNotice(env, notice.to)
  await checkWarrantySend(env.DB, latest, seen, current.guards, actor)
  const text = body + optional.text
  called = true
  const message = { deliveryId: notice.id, from: env.MAIL_FROM, to: [notice.to], replyTo: actor.email, subject, text, html: '<pre>' + text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') + '</pre>', headers: {}, attachments, ...(optional.unsubscribe ? { unsubscribe: optional.unsubscribe } : {}) }
  const result = await sender.send(message)
  if (result.status === 'accepted') { outcome.status = 'accepted'; outcome.label = 'Accepted by the mail provider; delivery is not confirmed'; outcome.provider_message_id = result.providerMessageId ?? undefined }
  else if (result.status === 'development') { outcome.status = 'development'; outcome.label = 'Development mail suppressed; nothing sent to the supplier' }
  else if (result.status === 'rejected' || result.status === 'rate_limited') { outcome.status = 'refused'; outcome.label = 'Provider refused the notice; nothing accepted. A new explicit owner send is required.' }
 } catch {
  if (!called) { outcome.status = 'refused'; outcome.label = 'Authority, recipient or review changed; nothing sent' }
 }
 // Update only a surviving reservation. Provider completion cannot recreate an erased job.
 for (let retry = 0; retry < 3; retry++) {
  const seen = await readClock(env.DB), latest = await loadWarrantyJob(env.DB, previous.id)
  if (!latest) return null
  const finished = structuredClone(latest), stored = find(finished.submittals ?? [], id).notices?.find(n => n.id === notice.id)
  need(stored, 'The reserved notice is unavailable', 409, 'mail_reserved')
  Object.assign(stored, outcome)
  try { await saveWarrantyJob(env.DB, latest, finished, seen); return finished } catch (error) { if (retry === 2) throw error }
 }
 return null
}
