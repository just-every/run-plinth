import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { requireJobManager, visible } from './auth'
import { company } from './company'
import { DomainError, need, stamp, type Actor, type Job } from './model'
import { readClock } from './store'
import type { WarrantyPromise, WarrantyReminder, WarrantyReminderStatus } from './warranty-model'
import { nextWarrantyDue } from './warranty-schedule'
import { checkWarrantySend, finishWarrantyAttempt, loadWarrantyJob, promiseGuards, saveWarrantyJob } from './warranty-store'

export interface WarrantyDispatchOptions {
 jobId?: string; actor?: Actor
 /** Internal clock only: HTTP handlers must never copy request data into this field. */
 now?: number
}
export interface WarrantyDispatchResult {
 jobs_scanned: number; attempts: number; accepted: number; refused: number; unknown: number
 development: number; unconfigured: number; cancelled: number; conflicts: number
 promises_checked: number
 skipped: { job_id: string; promise_id?: string; reason: string }[]
 /** Durable scheduler cursor; another bounded call can continue, null means this sweep ended. */
 nextCursor: string | null
}
const PAGE = 20, CLAIMS = 20, CHECKS = 60
type Reservation = { job: Job; promise: WarrantyPromise; attempt: WarrantyReminder }
function conflict(error: unknown): boolean { return error instanceof DomainError && error.code === 'conflict' }

async function reserve(db: D1Database, jobId: string, promiseId: string, now: number, actor?: Actor): Promise<Reservation | { reason: string }> {
 const clock = await readClock(db), previous = await loadWarrantyJob(db, jobId)
 if (!previous) return { reason: 'The job is no longer available' }
 if (actor) visible(actor, previous)
 const promise = previous.warranties?.promises.find(p => p.id === promiseId)
 if (!promise) return { reason: 'The reminder agreement is no longer available' }
 const permitted = await promiseGuards(db, previous, promise)
 if (permitted.reason !== undefined) return { reason: permitted.reason }
 const due = nextWarrantyDue(promise, previous.warranties!.reminders, previous.time_zone ?? 'UTC', now)
 if (!due) return { reason: 'No unattempted occurrence is due at job-local 09:00' }
 if (previous.warranties!.reminders.length >= 4000) return { reason: 'The reminder history limit requires office review; nothing was sent' }
 const next = structuredClone(previous), current = next.warranties!.promises.find(p => p.id === promiseId)!
 const attempt: WarrantyReminder = {
  id: crypto.randomUUID(), promise_id: current.id, agreement_revision: current.revision, component_id: current.component_id,
  due_on: due, recipient_email: current.recipient.email, status: 'unknown', reserved_at: new Date(now).toISOString(),
  label: 'Reserved; provider outcome unknown. This occurrence will not be resent automatically',
  dispatched_by: actor ? { kind: 'person', by: stamp(actor) } : { kind: 'scheduler', configured_by: current.authority.id },
 }
 next.warranties!.reminders.push(attempt)
 // One batch compares job/clock and all native authorities before claiming this occurrence.
 await saveWarrantyJob(db, previous, next, clock, permitted.guards, actor)
 return { job: next, promise: current, attempt }
}
function message(reservation: Reservation, from: string, builder: string) {
 const { job, promise, attempt } = reservation, component = job.warranties!.components.find(c => c.id === promise.component_id)!
 const text = [
  `${builder}: maintenance reminder for ${job.name}.`, '',
  `Component: ${component.name}`, `Maintenance promise: ${promise.title}`,
  `Due date: ${attempt.due_on} (${job.time_zone ?? 'UTC'}; job-local calendar date).`, '',
  `This reminder follows your recorded reminder agreement. Please contact ${from} about arranging the work or changing the agreement.`,
 ].join('\n')
 const subject = `Maintenance reminder: ${job.name} / ${component.name} / ${attempt.due_on}`.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ')
 return { deliveryId: attempt.id, from, to: [attempt.recipient_email], replyTo: from, subject, text, html: `<pre style="font-family:inherit;white-space:pre-wrap">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`, headers: {} }
}
/** The reservation survives failures. No result, including unknown, is a license to repeat its provider call. */
async function send(env: Bindings, reservation: Reservation, now: number, actor?: Actor): Promise<WarrantyReminderStatus> {
 const { attempt } = reservation
 let status: WarrantyReminderStatus = 'unknown', label = 'Provider outcome unknown; this occurrence will not be resent automatically', provider_message_id: string | undefined
 try {
  const sender = operatorMail(env), builder = (await company(env.DB))?.name ?? 'Your builder'
  let cleared = false
  // Another occurrence may reserve or finish while these reads are in flight.
  // Refresh only the pre-send database fence; the provider is still called once.
  for (let check = 0; check < 5; check++) {
   const clock = await readClock(env.DB), latest = await loadWarrantyJob(env.DB, reservation.job.id)
   const surviving = latest?.warranties?.reminders.find(r => r.id === attempt.id)
   const promise = latest?.warranties?.promises.find(p => p.id === attempt.promise_id)
   if (!latest || !surviving || surviving.status !== 'unknown' || surviving.completed_at || !promise) return 'cancelled'
   const permitted = await promiseGuards(env.DB, latest, promise)
   if (permitted.reason !== undefined || promise.revision !== attempt.agreement_revision || attempt.due_on < promise.activated_on) {
    status = 'cancelled'; label = permitted.reason ?? 'The reminder agreement changed before the provider was called; nothing was sent'; break
   }
   if (actor) visible(actor, latest)
   try { await checkWarrantySend(env.DB, latest, clock, permitted.guards, actor); cleared = true; break }
   catch (error) { if (!conflict(error)) throw error }
  }
  if (!cleared && status !== 'cancelled') { status = 'cancelled'; label = 'Concurrent record changes prevented a send; nothing was sent. Review this occurrence with the office' }
  if (cleared) {
   if (!sender || !env.MAIL_FROM) {
    status = 'unconfigured'; label = 'Mail is not configured; this occurrence was not sent and will not be retried automatically'
   } else {
    const result = await sender.send(message(reservation, env.MAIL_FROM, builder))
    if (result.status === 'accepted') { status = 'accepted'; label = 'Accepted by the mail provider; delivery is not confirmed'; provider_message_id = result.providerMessageId ?? undefined }
    else if (result.status === 'development') { status = 'development'; label = 'Development mail was suppressed; no external message was sent' }
    else if (result.status === 'rejected' || result.status === 'rate_limited') { status = 'refused'; label = 'The mail provider refused this occurrence; it will not be retried automatically' }
   }
  }
 } catch (error) {
  if (conflict(error)) { status = 'cancelled'; label = 'The job or sending authority changed before the provider call; nothing was sent' }
  // Other exceptions may occur after provider acceptance. Keep the honest unknown outcome.
 }
 await finishWarrantyAttempt(env.DB, reservation.job.id, attempt.id, { status, label, ...(provider_message_id ? { provider_message_id } : {}) }, now)
 return status
}
function promiseOrder(job: Job, now: number): string[] {
 const state = job.warranties!
 const last = new Map<string, string>()
 for (const reminder of state.reminders) if ((last.get(reminder.promise_id) ?? '') < reminder.reserved_at) last.set(reminder.promise_id, reminder.reserved_at)
 const active = state.promises.filter(p => p.status === 'active')
 // Rotate ties each hour so a long list of revoked/not-yet-due recipients cannot hide later promises.
 const offset = active.length ? (Math.floor(now / 3_600_000) * CHECKS) % active.length : 0
 return [...active.slice(offset), ...active.slice(0, offset)].sort((a, b) => (last.get(a.id) ?? '').localeCompare(last.get(b.id) ?? '')).map(p => p.id)
}
/** Hourly controller may call up to eight pages / 45 seconds. The durable cursor preserves fairness between invocations. */
export async function dispatchWarrantyReminders(env: Bindings, options: WarrantyDispatchOptions = {}): Promise<WarrantyDispatchResult> {
 const now = options.now ?? Date.now(), actor = options.actor
 need(Number.isFinite(now) && Number.isFinite(new Date(now).getTime()), 'Invalid internal reminder clock')
 if (actor) { requireJobManager(actor); need(options.jobId, 'A human reminder dispatch must name its job') }
 const result: WarrantyDispatchResult = { jobs_scanned: 0, promises_checked: 0, attempts: 0, accepted: 0, refused: 0, unknown: 0, development: 0, unconfigured: 0, cancelled: 0, conflicts: 0, skipped: [], nextCursor: null }
 let cursor = 0
 if (!options.jobId) {
  const row = await env.DB.prepare('SELECT last_rowid FROM pl_warranty_scheduler WHERE id=1').first<{ last_rowid: number }>()
  need(row, 'The warranty scheduler cursor is unavailable', 409, 'scheduler_unavailable')
  cursor = row.last_rowid
 }
 const rows = options.jobId ? [{ id: options.jobId, rowid: 0 }] : (await env.DB.prepare("SELECT j.id,j.rowid AS rowid FROM pl_jobs j WHERE j.rowid>? AND EXISTS(SELECT 1 FROM json_each(j.data,'$.warranties.promises') p WHERE json_extract(p.value,'$.status')='active') ORDER BY j.rowid LIMIT ?").bind(cursor, PAGE).all<{ id: string; rowid: number }>()).results
 let visited = cursor, processed = 0
 for (const row of rows) {
  if (result.attempts >= CLAIMS || result.promises_checked >= CHECKS) break
  const job = await loadWarrantyJob(env.DB, row.id)
  visited = row.rowid; processed++; result.jobs_scanned++
  if (!job) { result.skipped.push({ job_id: row.id, reason: 'The job is no longer available' }); continue }
  if (actor) visible(actor, job)
  if (!job.warranties) continue
  for (const promiseId of promiseOrder(job, now)) {
   if (result.attempts >= CLAIMS || result.promises_checked >= CHECKS) break
   result.promises_checked++
   try {
    const reservation = await reserve(env.DB, job.id, promiseId, now, actor)
    if ('reason' in reservation) {
     if (result.skipped.length < 200) result.skipped.push({ job_id: job.id, promise_id: promiseId, reason: reservation.reason })
     continue
    }
    result.attempts++
    result[await send(env, reservation, now, actor)]++
   } catch (error) {
    if (!conflict(error)) throw error
    result.conflicts++
    if (result.skipped.length < 200) result.skipped.push({ job_id: job.id, promise_id: promiseId, reason: 'The job or reminder authority changed; nothing was claimed' })
   }
  }
 }
 if (!options.jobId) {
  const end = processed === rows.length && rows.length < PAGE
  const next = end ? 0 : visited
  // Cursor writes hold no authority over a job and carry no credential or private content.
  await env.DB.prepare('UPDATE pl_warranty_scheduler SET last_rowid=? WHERE id=1 AND last_rowid=?').bind(next, cursor).run()
  result.nextCursor = end ? null : String(next)
 }
 return result
}
