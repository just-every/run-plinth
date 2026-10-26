import { useEffect, useState } from 'react'
import { correctionLines as priceCorrectionLines, movements as movement } from '../plinth/invoice-correction-pricing'
import type { Invoice } from '../plinth/invoice-model'
import type { PaymentAttempt } from '../plinth/pay-model'
import type { JobProps } from './job'
import { api, cents, Download, Field, Form, money } from './shared'

type Props = Pick<JobProps, 'job' | 'mutate'> & { invoice: Invoice; office: boolean }
type Kind = 'credit' | 'debit' | 'void' | 'write-off' | 'refund'
type Review = {
 kind: Kind; version: number; operation_id: string; reason: string; description?: string
 amount_cents: number; tax_cents?: number; dispute_reference?: string; attempt_id?: string
 lines?: { invoice_line_id: string; amount_cents: number }[]
 posting_period?: string; adjustment_reference?: string
}
const names: Record<Kind, string> = { credit: 'credit document', debit: 'debit document', void: 'invoice void', 'write-off': 'residual write-off', refund: 'Stripe refund' }
const positive = (value: FormDataEntryValue | null) => { const amount = cents(value); if (amount <= 0) throw new Error('Enter an amount greater than zero.'); return amount }
function CorrectionDocuments({ invoice, job, office }: Omit<Props, 'mutate'>) {
 return <>{(invoice.corrections ?? []).map(c => {
  const d = c.document
  return <details className="record" key={c.id}><summary>{d.number} · {d.kind === 'void' ? 'Void credit' : d.kind === 'credit' ? 'Credit' : 'Debit'} · {money(d.gross_cents)}</summary>
   <p>{d.description}</p><p>Linked to original invoice {d.original_invoice_number}. Issued by {d.issued_by.name}. {d.label}.</p>
   <dl className="reconciliation">{[['Subtotal', d.subtotal_cents], ['Sales tax', d.tax_cents], ['Document total', d.gross_cents]].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{money(value as number)}</dd></div>)}</dl>
   {d.lines.map(l => <p key={l.id}>{l.description} · {money(l.gross_cents)} including {money(l.tax_cents)} sales tax</p>)}
   <div className="button-row"><a href={`/api/plinth/jobs/${job.id}/invoices/${invoice.id}/document.html`} target="_blank" rel="noreferrer">Open linked original invoice</a><Download filename={d.number + '.json'} data={JSON.stringify(d, null, 2)} label="Download correction document" /></div>
   {office && <><p>Private reason: {c.reason}</p><details><summary>Correction accounting entries</summary>{d.accounting_entries.map((e, n) => <p key={n}>{e.account.replaceAll('_', ' ')} · Debit {money(e.debit_cents)} · Credit {money(e.credit_cents)}</p>)}</details></>}
  </details>
 })}{office && (invoice.write_offs ?? []).map(w => <details className="record" key={w.id}><summary>Disputed residual written off · {money(w.amount_cents)}</summary><p>Private reason: {w.reason}</p><p>Dispute reference: {w.dispute_reference}</p><p>{w.recorded_by.name} · {w.label}.</p>{w.accounting_entries.map((e, n) => <p key={n}>{e.account.replaceAll('_', ' ')} · Debit {money(e.debit_cents)} · Credit {money(e.credit_cents)}</p>)}</details>)}</>
}

function RefundPreparation({ job, invoice, prepare }: Pick<Props, 'job' | 'invoice'> & { prepare: (review: Review) => void }) {
 const [attempts, setAttempts] = useState<PaymentAttempt[]>(), [error, setError] = useState('')
 const [posting, setPosting] = useState<{source_on:string;closed:boolean}>()
 const credit = Math.max(0, -invoice.balance!.due_cents)
 async function load() {
  setError('')
  try { const result = await api(`/jobs/${job.id}/payments`); setAttempts(result.attempts); setPosting(result.refund_posting) }
  catch (e) { setError(e instanceof Error ? e.message : 'Could not load Stripe payments.') }
 }
 useEffect(() => { if (attempts) void load() }, [job.id, job.version])
 const eligible = attempts?.filter(a => a.invoice_id === invoice.id && ['paid', 'review'].includes(a.status) && ['settled', 'refunded'].includes(a.settlement_state) && a.amount_cents > a.reversed_cents) ?? []
 return <details onToggle={event => { if (event.currentTarget.open && !attempts) void load() }}><summary>Refund a Stripe payment</summary>
  <p>A linked credit must leave customer credit before a refund. Stripe rechecks settled funds and your current authority before moving funds.</p>
  {credit === 0 ? <p>No customer credit available to refund.</p> : <><p>Customer credit available: {money(credit)}.</p>{error && <p role="alert" className="error">{error}</p>}{!attempts && !error && <p role="status">Loading Stripe payments…</p>}{error && <button type="button" onClick={() => void load()}>Reload Stripe payments</button>}
   {attempts && (eligible.length ? <Form submit="Review Stripe refund" action={async f => {
    const attempt = eligible.find(a => a.id === f.get('attempt_id')), amount = positive(f.get('amount'))
    if (!attempt || amount > Math.min(credit, attempt.amount_cents - attempt.reversed_cents)) throw new Error('Refund only available customer credit within this settled payment.')
    prepare({ kind: 'refund', version: job.version, operation_id: crypto.randomUUID(), attempt_id: attempt.id, amount_cents: amount, reason: String(f.get('reason')), ...(posting?.closed ? {posting_period:String(f.get('posting_period')),adjustment_reference:String(f.get('adjustment_reference'))} : {}) })
   }}><label>Settled Stripe payment<select name="attempt_id">{eligible.map(a => <option key={a.id} value={a.id}>{a.payment_intent_id ?? a.id} · {money(a.amount_cents - a.reversed_cents)} available</option>)}</select></label><Field name="amount" label="Refund amount (USD)" inputMode="decimal" /><Field name="reason" label="Private refund reason" />{posting?.closed && <><p>The source date {posting.source_on} is in a closed accounting period. Retain that date and choose an open period for the adjustment.</p><Field name="posting_period" label="Open posting period" type="month" /><Field name="adjustment_reference" label="Adjustment evidence" /></>}</Form> : <p>No settled Stripe payment is available for this invoice.</p>)}</>}
 </details>
}

export function InvoiceCorrections({ job, invoice, office, mutate }: Props) {
 const [review, setReview] = useState<Review>(), [kind, setKind] = useState<'credit' | 'debit'>('credit'), [notice, setNotice] = useState('')
 const issued = invoice.issued, balance = invoice.balance!, voided = invoice.corrections?.some(c => c.document.kind === 'void')
 const correctionLines = issued?.lines.filter(l => l.gross_cents !== 0 || l.reviewed_source_gross_cents !== 0) ?? []
 const canCorrect = issued && !voided
 const canVoid = canCorrect && invoice.receipts.length === 0 && invoice.deposit_applications.length === 0 && !(invoice.write_offs?.length) && !(job.invoices ?? []).some(i => i.deposit_applications.some(a => a.deposit_invoice_id === invoice.id)) && issued.lines.some(l => movement(invoice, l).gross > 0)
 useEffect(() => { setReview(undefined) }, [invoice.id])
 return <><CorrectionDocuments invoice={invoice} job={job} office={office} />
  {office && issued && <details><summary>Corrections and refunds</summary>
   {notice && <p role="status">{notice}</p>}
   {review ? <section aria-label="Review invoice correction"><h4>Review {names[review.kind]}</h4><p>Original invoice {invoice.number} · {invoice.description}</p>
    {review.description && <p>Public description: {review.description}</p>}<p>Private reason: {review.reason}</p>{review.dispute_reference && <p>Dispute reference: {review.dispute_reference}</p>}
    {review.attempt_id && <p>Stripe payment: {review.attempt_id}</p>}
    {review.posting_period && <p>Open posting period: {review.posting_period}. Adjustment evidence: {review.adjustment_reference}.</p>}
    {review.lines?.map(l => <p key={l.invoice_line_id}>{issued.lines.find(original => original.id === l.invoice_line_id)?.description} · {money(l.amount_cents)}</p>)}
    <dl className="reconciliation"><div><dt>{review.kind === 'refund' ? 'Funds to refund' : review.kind === 'write-off' ? 'Residual to write off' : 'Document total'}</dt><dd>{money(review.amount_cents)}</dd></div>{review.tax_cents !== undefined && <div><dt>Sales tax adjustment</dt><dd>{money(review.tax_cents)}</dd></div>}</dl>
    <p>{review.kind === 'refund' ? 'This authorizes Stripe to return funds. A completed processor instruction cannot be edited.' : review.kind === 'write-off' ? 'This records bad debt without receiving funds or reversing sales tax. The original invoice stays fixed.' : 'This issues an immutable linked document. The original invoice and its terms stay fixed. No funds move.'}</p>
    <Form submit={'Confirm ' + names[review.kind]} reset={false} action={async f => {
     if (job.version !== review.version) throw new Error('The job changed. Go back and review the current invoice before confirming.')
     const { kind: action, version, tax_cents: _tax, attempt_id, ...body } = review
     const path = action === 'refund' ? `/payments/${attempt_id}/refund` : `/invoices/${invoice.id}/${action}`
     const { amount_cents, ...details } = body
     const result = await mutate(path, { ...details, ...(action === 'write-off' || action === 'refund' ? { amount_cents } : {}), expected_version: version, confirm: f.get('confirm') === 'on' })
     setNotice(action === 'refund' ? `Stripe refund instruction recorded. Processor status: ${result.refund.status}.` : 'Final invoice decision recorded.')
     setReview(undefined)
    }}><label><input name="confirm" type="checkbox" required />I reviewed this exact {names[review.kind]} and approve it as final.</label></Form>
    <button type="button" className="secondary" onClick={() => setReview(undefined)}>Back to correction fields</button>
   </section> : <>
    {canCorrect ? <Form submit="Review correction document" action={async f => {
     const lines = correctionLines.filter(l => String(f.get(l.id) ?? '').trim()).map(l => ({ invoice_line_id: l.id, amount_cents: positive(f.get(l.id)) }))
     if (!lines.length) throw new Error('Enter a positive gross correction amount on at least one original line.')
     const amount = lines.reduce((total, l) => total + l.amount_cents, 0)
     if (!Number.isSafeInteger(amount)) throw new Error('Correction amount is too large.')
     setReview({ kind, version: job.version, operation_id: crypto.randomUUID(), description: String(f.get('description')), reason: String(f.get('reason')), lines, amount_cents: kind === 'credit' ? -amount : amount, tax_cents: priceCorrectionLines(job, invoice, lines, kind).reduce((n, l) => n + l.tax_cents, 0) })
    }}><label>Correction type<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="credit">Credit document</option><option value="debit">Debit document</option></select></label><Field name="description" label="Public correction description" /><Field name="reason" label="Private correction reason" />
     <p>Enter gross amounts including sales tax. Leave unchanged lines empty. Sales tax follows the original reviewed lines. Withholding and evidence-based release terms stay fixed; a correction cannot consume an unreleased hold.</p>
     {correctionLines.map(l => <div key={l.id}><p>{l.description} · {money(movement(invoice, l).gross)} current line value</p><Field name={l.id} label={'Correction amount for ' + l.description + ' (USD)'} inputMode="decimal" required={false} /></div>)}
    </Form> : <p>{voided ? 'This invoice was voided by a linked credit.' : 'Issue the invoice before correcting it.'}</p>}
    {canVoid && <details><summary>Void this invoice</summary><Form submit="Review invoice void" action={async f => setReview({ kind: 'void', version: job.version, operation_id: crypto.randomUUID(), description: String(f.get('description')), reason: String(f.get('reason')), amount_cents: -issued.lines.reduce((n, l) => n + movement(invoice, l).gross, 0), tax_cents: -issued.lines.reduce((n, l) => n + movement(invoice, l).tax, 0) })}><Field name="description" label="Public void description" /><Field name="reason" label="Private void reason" /></Form></details>}
    {!voided && invoice.kind !== 'deposit' && balance.due_cents > 0 && <details><summary>Write off a disputed residual</summary><Form submit="Review residual write-off" action={async f => {
     const amount = positive(f.get('amount')); if (amount > balance.due_cents) throw new Error('Write off only the separate unpaid residual.')
     setReview({ kind: 'write-off', version: job.version, operation_id: crypto.randomUUID(), amount_cents: amount, reason: String(f.get('reason')), dispute_reference: String(f.get('dispute_reference')) })
    }}><Field name="amount" label="Write-off amount (USD)" inputMode="decimal" /><Field name="reason" label="Private write-off reason" /><Field name="dispute_reference" label="Private dispute reference" /></Form></details>}
    <RefundPreparation job={job} invoice={invoice} prepare={setReview} />
   </>}
  </details>}
 </>
}
