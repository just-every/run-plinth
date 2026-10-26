import { useEffect, useState } from 'react'
import type { Invoice, InvoiceTaxLine } from '../plinth/invoice-model'
import type { PaymentAttempt } from '../plinth/pay-model'
import type { JobProps } from './job'
import { api, cents, Download, Field, Form, money } from './shared'

type Props = Pick<JobProps, 'job' | 'mutate'> & { invoice: Invoice; office: boolean }
type Kind = 'credit' | 'debit' | 'void' | 'write-off' | 'refund'
type Review = {
 kind: Kind; version: number; operation_id: string; reason: string; description?: string
 amount_cents: number; tax_cents?: number; dispute_reference?: string; attempt_id?: string
 lines?: { invoice_line_id: string; amount_cents: number }[]
}
const names: Record<Kind, string> = { credit: 'credit document', debit: 'debit document', void: 'invoice void', 'write-off': 'residual write-off', refund: 'Stripe refund' }
const positive = (value: FormDataEntryValue | null) => { const amount = cents(value); if (amount <= 0) throw new Error('Enter an amount greater than zero.'); return amount }
const movement = (invoice: Invoice, line: InvoiceTaxLine) => (invoice.corrections ?? []).flatMap(c => c.document.lines).filter(l => l.invoice_line_id === line.id).reduce((total, l) => ({ gross: total.gross + l.gross_cents, tax: total.tax + l.tax_cents }), { gross: line.gross_cents, tax: line.tax_cents })
const sourceKey = (line: InvoiceTaxLine) => JSON.stringify([line.source_id, line.source_revision, line.source_line_id ?? null])
function totalMoney(values: number[]) {
 const total = values.reduce((n, value) => n + value, 0)
 if (!Number.isSafeInteger(total) || Math.abs(total) > 1_000_000_000_000) throw new Error('Money total exceeds supported range.')
 return total
}
function proportionalTax(amount: number, tax: number, gross: number) {
 if (gross <= 0 || tax < 0 || tax > gross || amount < 0) throw new Error('The original reviewed line cannot support this correction.')
 return totalMoney([Number((2n * BigInt(amount) * BigInt(tax) + BigInt(gross)) / (2n * BigInt(gross)))])
}
function correctionTax(job: Props['job'], invoice: Invoice, lines: NonNullable<Review['lines']>, kind: 'credit' | 'debit') {
 const pending: InvoiceTaxLine[] = []
 for (const change of lines) {
  const line = invoice.issued!.lines.find(l => l.id === change.invoice_line_id)!, amount = change.amount_cents
  let tax: number
  if (kind === 'credit') {
   const earlier = (invoice.corrections ?? []).flatMap(c => c.document.lines).filter(l => l.invoice_line_id === line.id)
   if (line.gross_cents < 0 || amount > movement(invoice, line).gross) throw new Error('A credit cannot exceed the remaining original line value.')
   let remaining = amount
   const taxes: number[] = []
   for (const lot of [line, ...earlier.filter(l => l.gross_cents > 0)]) {
    if (!remaining || !lot.gross_cents) continue
    const consumed = totalMoney(earlier.flatMap(l => l.tax_allocations ?? []).filter(a => a.lot_id === lot.id).map(a => a.gross_cents))
    const take = Math.min(remaining, totalMoney([lot.gross_cents, -consumed]))
    if (take <= 0) continue
    taxes.push(proportionalTax(totalMoney([consumed, take]), lot.tax_cents, lot.gross_cents) - proportionalTax(consumed, lot.tax_cents, lot.gross_cents))
    remaining -= take
   }
   if (remaining !== 0) throw new Error('Original tax allocation history does not reconcile.')
   tax = -totalMoney(taxes)
  } else {
   const allocated = (job.invoices ?? []).filter(i => i.issued && (i.kind === 'deposit') === (invoice.kind === 'deposit') && (invoice.kind !== 'cost_plus' || i.id === invoice.id)).flatMap(i => i.issued!.lines.filter(l => sourceKey(l) === sourceKey(line)).map(l => movement(i, l)))
   const remainingGross = totalMoney([line.reviewed_source_gross_cents, -totalMoney(allocated.map(a => a.gross))])
   const remainingTax = totalMoney([line.reviewed_source_tax_cents, -totalMoney(allocated.map(a => a.tax))])
   const prior = pending.filter(l => sourceKey(l) === sourceKey(line)), after = totalMoney([totalMoney(prior.map(l => l.gross_cents)), amount])
   if (line.gross_cents < 0 || remainingGross <= 0 || after > remainingGross) throw new Error('Debit exceeds the remaining human-reviewed source value.')
   tax = proportionalTax(after, remainingTax, remainingGross) - totalMoney(prior.map(l => l.tax_cents))
  }
  pending.push({ ...line, gross_cents: kind === 'credit' ? -amount : amount, tax_cents: tax })
 }
 return totalMoney(pending.map(l => l.tax_cents))
}

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
 const credit = Math.max(0, -invoice.balance!.due_cents)
 async function load() {
  setError('')
  try { const result = await api(`/jobs/${job.id}/payments`); setAttempts(result.attempts) }
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
    prepare({ kind: 'refund', version: job.version, operation_id: crypto.randomUUID(), attempt_id: attempt.id, amount_cents: amount, reason: String(f.get('reason')) })
   }}><label>Settled Stripe payment<select name="attempt_id">{eligible.map(a => <option key={a.id} value={a.id}>{a.payment_intent_id ?? a.id} · {money(a.amount_cents - a.reversed_cents)} available</option>)}</select></label><Field name="amount" label="Refund amount (USD)" inputMode="decimal" /><Field name="reason" label="Private refund reason" /></Form> : <p>No settled Stripe payment is available for this invoice.</p>)}</>}
 </details>
}

export function InvoiceCorrections({ job, invoice, office, mutate }: Props) {
 const [review, setReview] = useState<Review>(), [kind, setKind] = useState<'credit' | 'debit'>('credit'), [notice, setNotice] = useState('')
 const issued = invoice.issued, balance = invoice.balance!, voided = invoice.corrections?.some(c => c.document.kind === 'void')
 const correctionLines = issued?.lines.filter(l => l.gross_cents >= 0 && (l.gross_cents > 0 || l.reviewed_source_gross_cents > 0)) ?? []
 const canCorrect = issued && issued.withheld_cents === 0 && !voided
 const canVoid = canCorrect && invoice.receipts.length === 0 && invoice.deposit_applications.length === 0 && !(invoice.write_offs?.length) && !(job.invoices ?? []).some(i => i.deposit_applications.some(a => a.deposit_invoice_id === invoice.id)) && issued.lines.some(l => movement(invoice, l).gross > 0)
 useEffect(() => { setReview(undefined) }, [invoice.id])
 return <><CorrectionDocuments invoice={invoice} job={job} office={office} />
  {office && issued && <details><summary>Corrections and refunds</summary>
   {notice && <p role="status">{notice}</p>}
   {review ? <section aria-label="Review invoice correction"><h4>Review {names[review.kind]}</h4><p>Original invoice {invoice.number} · {invoice.description}</p>
    {review.description && <p>Public description: {review.description}</p>}<p>Private reason: {review.reason}</p>{review.dispute_reference && <p>Dispute reference: {review.dispute_reference}</p>}
    {review.attempt_id && <p>Stripe payment: {review.attempt_id}</p>}
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
     setReview({ kind, version: job.version, operation_id: crypto.randomUUID(), description: String(f.get('description')), reason: String(f.get('reason')), lines, amount_cents: kind === 'credit' ? -amount : amount, tax_cents: correctionTax(job, invoice, lines, kind) })
    }}><label>Correction type<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="credit">Credit document</option><option value="debit">Debit document</option></select></label><Field name="description" label="Public correction description" /><Field name="reason" label="Private correction reason" />
     <p>Enter gross amounts including sales tax. Leave unchanged lines empty. Sales tax follows the original reviewed lines.</p>
     {correctionLines.map(l => <div key={l.id}><p>{l.description} · {money(movement(invoice, l).gross)} current line value</p><Field name={l.id} label={'Correction amount for ' + l.description + ' (USD)'} inputMode="decimal" required={false} /></div>)}
    </Form> : <p>{voided ? 'This invoice was voided by a linked credit.' : 'Resolve retained value separately before issuing a correction document.'}</p>}
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
