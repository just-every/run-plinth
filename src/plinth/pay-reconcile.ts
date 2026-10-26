import type { Bindings } from '../auth.server'
import { auditStatement, automation, jobRef } from './audit'
import { invoiceBalance } from './invoices'
import { invoiceRows, type InvoiceReceipt, type InvoiceAccountingEntry } from './invoice-model'
import { attemptColumns, settledLabel, reconciledLabel, type PaymentAttempt, type SettlementState } from './pay-model'
import { stripeCall, type CheckoutSession, type PaymentIntent, type StripeDispute, type StripeRefund } from './pay-stripe'
import { DomainError, find, need, type Job, type Stamp } from './model'
import { readClock } from './store'
import { wallClock } from './time-zone'
import { postRefund, type RefundPosting } from './refund-posting'
import { loadWarrantyJob } from './warranty-store'

export const paymentAttempt = (db: D1Database, id: string) => db.prepare(`SELECT ${attemptColumns} FROM pl_payment_attempts WHERE id=?`).bind(id).first<PaymentAttempt>()
export interface PaymentFact { refunds?: StripeRefund[]; revision: number; state: SettlementState; intent: PaymentIntent | null; reversed: number; reference?: string; method: string; wallet: string | null; fee: number | null }
/** Read the current processor record, rather than ordering money by webhook arrival time. */
export async function paymentFact(env: Bindings, attempt: PaymentAttempt, session?: CheckoutSession): Promise<PaymentFact> {
 const intentId = session?.payment_intent ?? attempt.payment_intent_id
 if (!intentId) return { revision: attempt.revision, state: session?.status === 'expired' ? 'canceled' : 'initiated', intent: null, reversed: 0, method: 'unknown', wallet: null, fee: null }
 const intent = await stripeCall<PaymentIntent>(env, `/payment_intents/${encodeURIComponent(intentId)}?expand[]=latest_charge.balance_transaction`)
 need(intent.id === intentId && intent.currency === 'usd' && intent.amount === attempt.amount_cents && intent.livemode === (attempt.livemode === 1) && intent.metadata?.plinth_attempt === attempt.id, 'The processor payment does not match this instruction', 400, 'event_unauthorized')
 const pending = await env.DB.prepare("SELECT id FROM pl_payment_refunds WHERE attempt_id=? AND status IN ('unresolved','pending','requires_action')").bind(attempt.id).all<{id:string}>()
 const refundsFound = pending.results.length ? (await stripeCall<{data:StripeRefund[]}>(env, `/refunds?payment_intent=${encodeURIComponent(intent.id)}&limit=100`)).data : []
 const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
 const method = charge?.payment_method_details?.type ?? attempt.method ?? 'unknown', wallet = charge?.payment_method_details?.card?.wallet?.type ?? null
 const fee = charge && typeof charge.balance_transaction === 'object' ? charge.balance_transaction?.fee ?? null : null
 let dispute: StripeDispute | null = typeof charge?.dispute === 'object' ? charge.dispute : null
 if (typeof charge?.dispute === 'string') dispute = await stripeCall<StripeDispute>(env, `/disputes/${encodeURIComponent(charge.dispute)}`)
 else if (charge?.disputed && !dispute) dispute = (await stripeCall<{data: StripeDispute[]}>(env, `/disputes?payment_intent=${encodeURIComponent(intent.id)}&limit=100`)).data.find(d => d.status !== 'won' && d.status !== 'warning_closed') ?? null
 const activeDispute = dispute && !['won', 'warning_closed'].includes(dispute.status)
 const returned = method === 'us_bank_account' && (activeDispute || charge?.status === 'failed')
 const refunds = charge?.amount_refunded ?? 0
 need(Number.isSafeInteger(refunds) && refunds >= 0 && refunds <= attempt.amount_cents, 'Invalid processor refund amount', 502, 'payment_provider')
 const reversed = returned ? attempt.amount_cents : Math.min(attempt.amount_cents, refunds + (activeDispute ? dispute!.amount : 0))
 const state: SettlementState = returned ? 'ach_returned' : activeDispute ? 'disputed' : refunds > 0 ? 'refunded' : intent.status === 'succeeded' ? 'settled' : ['processing','requires_action','requires_confirmation'].includes(intent.status) ? 'processing' : intent.status === 'canceled' ? 'canceled' : 'failed'
 if (['settled', 'refunded', 'disputed', 'ach_returned'].includes(state) && intent.status === 'succeeded') need(intent.amount_received === attempt.amount_cents, 'The settled amount does not match the instruction', 400, 'event_unauthorized')
 return { refunds: refundsFound.filter(r => r.status !== 'succeeded' || refunds >= refundsFound.filter(item => item.status === 'succeeded').reduce((n,item) => n + item.amount, 0)), revision: attempt.revision, state, intent, reversed, reference: dispute?.id ?? charge?.refunds?.data.find(r => r.status === 'succeeded')?.id ?? charge?.id ?? intent.id, method, wallet, fee }
}
/** Every provider change appends receipts; original issues and settlement receipts are never rewritten. */
export async function applyPaymentFact(env: Bindings, id: string, fact: PaymentFact, event?: {id: string; type: string; digest: string}) {
 const source = automation(event ? 'stripe-events' : 'stripe-reconciliation', event ? 'Stripe signed events' : 'Stripe reconciliation')
 for (let n = 0; n < 3; n++) {
  const clock = await readClock(env.DB), current = await paymentAttempt(env.DB, id)
  need(current, 'Payment instruction no longer exists', 409, 'payment_job_gone')
  need(current.revision === fact.revision, 'Payment changed during provider reconciliation; fetch current Stripe records again', 409, 'conflict')
  const previous = await loadWarrantyJob(env.DB, current.job_id)
  need(previous, 'Payment job no longer exists', 409, 'payment_job_gone')
  const next = structuredClone(previous) as Job, invoice = find(invoiceRows(next), current.invoice_id), before = invoiceBalance(previous, find(invoiceRows(previous), current.invoice_id))
  const at = new Date().toISOString(), by: Stamp = { id: source.id, name: source.name, role: 'agent', at }, received_on = wallClock(Date.now(), next.time_zone ?? 'UTC').date
  const entries = (amount: number): InvoiceAccountingEntry[] => [{account:'stripe_clearing',debit_cents:Math.max(0,amount),credit_cents:Math.max(0,-amount)},{account:invoice.kind==='deposit'?'customer_deposits':'accounts_receivable',debit_cents:Math.max(0,-amount),credit_cents:Math.max(0,amount)}]
  const hasSettlement = !!current.receipt_id
  const settled = fact.intent?.status === 'succeeded' || hasSettlement
  let receiptId = current.receipt_id
  if (settled && !hasSettlement) {
   receiptId = crypto.randomUUID()
   const receipt: InvoiceReceipt = { id: receiptId, amount_cents: current.amount_cents, received_on, reference: fact.intent!.id, method: 'stripe', recorded_by: by, label: event ? settledLabel : reconciledLabel, accounting_entries: entries(current.amount_cents), processor: { confirmation: event ? 'signed_event' : 'provider_record', name: 'stripe', attempt_id: current.id, checkout_session_id: current.session_id!, payment_intent_id: fact.intent!.id, method: fact.method, wallet: fact.wallet, fee_cents: fact.fee, livemode: fact.intent!.livemode } }
   invoice.receipts.push(receipt)
  }
  // Dispute wins restore only the prior reversal; repeated facts have a zero delta.
  const delta = settled ? fact.reversed - current.reversed_cents : 0
  let remaining = delta
  if (delta > 0 && fact.state === 'refunded') for (const refund of fact.refunds ?? []) {
   if (refund.status !== 'succeeded' || !refund.metadata?.plinth_refund || invoice.receipts.some(r => r.processor_refund_id === refund.id)) continue
   const reservation = await env.DB.prepare('SELECT posting_json FROM pl_payment_refunds WHERE id=? AND attempt_id=?').bind(refund.metadata.plinth_refund, id).first<{posting_json: string | null}>()
   if (!reservation?.posting_json) continue
   need(refund.amount > 0 && refund.amount <= remaining, 'Processor refund does not match the remaining reversal', 409, 'refund_conflict')
   const posting = JSON.parse(reservation.posting_json) as RefundPosting, reversalId = crypto.randomUUID()
   postRefund(next, reversalId, posting)
   invoice.receipts.push({ id: reversalId, amount_cents: -refund.amount, received_on: posting.received_on, reference: refund.id, processor_refund_id: refund.id, refund_instruction_id: refund.metadata.plinth_refund, method: 'stripe', recorded_by: by, reversal_of: receiptId!, accounting_entries: entries(-refund.amount), label: 'Processor reversal reconciled against Stripe; original receipt preserved' })
   remaining -= refund.amount
  }
  if (remaining) invoice.receipts.push({ id: crypto.randomUUID(), amount_cents: -remaining, received_on, reference: `${fact.reference ?? fact.intent!.id}:${fact.state}:${fact.reversed}`, method: 'stripe', recorded_by: by, reversal_of: receiptId!, accounting_entries: entries(-remaining), label: 'Processor reversal reconciled against Stripe; original receipt preserved' })
  const review = !hasSettlement && settled && (current.status !== 'open' && current.status !== 'processing' || current.amount_cents > before.due_cents)
  const status = fact.state === 'processing' || fact.state === 'unresolved' ? 'processing' : fact.state === 'initiated' ? 'open' : fact.state === 'canceled' ? 'expired' : fact.state === 'failed' || fact.state === 'ach_returned' ? 'failed' : review ? 'review' : 'paid'
  const labels: Record<SettlementState, string> = { initiated: 'Checkout initiated; no settled funds recorded', processing: 'Bank payment processing; the invoice is not credited yet', settled: review ? 'Settled after the balance changed; office review required' : 'Settled against Stripe records; invoice credited', failed: 'Payment failed; no new settled funds', canceled: 'Payment canceled; no new settled funds', ach_returned: 'ACH returned by the bank; original settlement reversed and collection reopened', disputed: 'Card payment disputed; disputed funds removed from collections until resolved', refunded: 'Processor refund reconciled; refunded funds removed from collections', unresolved: 'Provider instruction unresolved; reconcile before another payment' }
  next.version = previous.version + 1
  const data = JSON.stringify(next), writes = [
   env.DB.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_clock WHERE id=1 AND version=?) THEN 1 ELSE 0 END').bind(clock),
   env.DB.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(previous.id, previous.version),
   env.DB.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(next.version, data, next.id, previous.version),
   env.DB.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_payment_attempts WHERE id=? AND revision=?) THEN 1 ELSE 0 END').bind(current.id, fact.revision),
   env.DB.prepare('UPDATE pl_payment_attempts SET revision=revision+1,status=?,settlement_state=?,label=?,payment_intent_id=COALESCE(?,payment_intent_id),method=?,wallet=?,fee_cents=?,receipt_id=?,reversed_cents=?,reconciled_at=?,updated_at=? WHERE id=?').bind(status, fact.state, labels[fact.state], fact.intent?.id ?? null, fact.method, fact.wallet, fact.fee, receiptId, settled ? fact.reversed : current.reversed_cents, at, at, current.id),
   auditStatement(env.DB, source, { kind: 'financial', action: hasSettlement ? 'payments.stripe.reconcile' : settled ? 'payments.stripe.receipt' : `payments.stripe.${fact.state}`, subject_kind: 'payment', subject_id: current.id, job_id: next.id, version_before: previous.version, version_after: next.version, before_ref: await jobRef(JSON.stringify(previous)), after_ref: await jobRef(data), detail: { state: fact.state, reversed_cents: fact.reversed, review } }),
  ]
  for (const refund of fact.refunds ?? []) if (refund.metadata?.plinth_refund) writes.push(env.DB.prepare('UPDATE pl_payment_refunds SET status=?,provider_id=? WHERE id=? AND attempt_id=?').bind(refund.status,refund.id,refund.metadata.plinth_refund,id))
  if (event) writes.push(env.DB.prepare('INSERT INTO pl_payment_events(id,type,attempt_id,digest,received_at) VALUES(?,?,?,?,?)').bind(event.id, event.type, id, event.digest, at))
  writes.push(env.DB.prepare('UPDATE pl_clock SET version=version+1 WHERE id=1'), env.DB.prepare('DELETE FROM pl_guard'))
  try { await env.DB.batch(writes); return await paymentAttempt(env.DB, id) } catch (error) {
   if (event && await env.DB.prepare('SELECT 1 FROM pl_payment_events WHERE id=?').bind(event.id).first()) return await paymentAttempt(env.DB, id)
   if (!/CHECK constraint failed|UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(String(error))) throw error
  }
 }
 throw new DomainError('conflict', 'The job changed while recording payment; reconcile again', 409)
}
/** Missing Checkout responses are resolved by listing real sessions; no second instruction is sent. */
export async function reconcilePayment(env: Bindings, attempt: PaymentAttempt) {
 let session: CheckoutSession | undefined
 if (attempt.session_id) session = await stripeCall<CheckoutSession>(env, `/checkout/sessions/${encodeURIComponent(attempt.session_id)}`)
 else {
  let cursor = ''
  for (;;) {
   const list = await stripeCall<{data: CheckoutSession[]; has_more: boolean}>(env, `/checkout/sessions?limit=100&created[gte]=${Math.floor(Date.parse(attempt.created_at) / 1000) - 60}${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`)
   session = list.data.find(s => s.client_reference_id === attempt.id && s.metadata?.plinth_attempt === attempt.id)
   if (session || !list.has_more) break
   need(list.data.length > 0, 'Stripe session listing could not be completed', 502, 'payment_provider'); cursor = list.data.at(-1)!.id
  }
  need(session, 'Stripe has not resolved this instruction; no new checkout is allowed', 409, 'payment_unresolved')
 }
 need(session.client_reference_id === attempt.id && session.amount_total === attempt.amount_cents && session.currency === 'usd', 'Stripe session does not match this instruction', 400, 'event_unauthorized')
 if (!attempt.session_id) {
  await env.DB.prepare('UPDATE pl_payment_attempts SET session_id=?,checkout_url=?,livemode=? WHERE id=? AND session_id IS NULL').bind(session.id, session.url, session.livemode ? 1 : 0, attempt.id).run()
  attempt = (await paymentAttempt(env.DB, attempt.id))!
 }
 return applyPaymentFact(env, attempt.id, await paymentFact(env, attempt, session))
}
