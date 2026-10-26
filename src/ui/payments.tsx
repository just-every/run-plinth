import { useEffect, useState } from 'react'
import type { JobProps } from './job'
import type { Invoice } from '../plinth/invoice-model'
import type { PaymentAttempt } from '../plinth/pay-model'
import { Action, Badge, dateTime, Form, api, money } from './shared'

type Attempt = Partial<PaymentAttempt> & Pick<PaymentAttempt, 'id' | 'invoice_id' | 'amount_cents' | 'status' | 'label' | 'created_at'> & { livemode?: boolean | number | null }
type Payments = { enabled: boolean; statement: string; attempts: Attempt[]; refunds?: {id:string;attempt_id:string;amount_cents:number;status:string;provider_id:string|null}[] }
function usePayments(jobId: string, version: number) {
 const [state, setState] = useState<Payments>(), [error, setError] = useState('')
 const load = () => api(`/jobs/${jobId}/payments`).then(setState).catch(e => setError(e.message))
 useEffect(() => { load() }, [jobId, version])
 return { state, error, load }
}
const mode = (a: Attempt) => Number(a.livemode) === 1 ? 'Live' : 'Test mode'
/** PAY-001: the client leaves for Stripe's hosted page after confirming the exact authorization; the invoice is credited only by Stripe's signed event. */
export function PayInvoice({ job, invoice }: { job: JobProps['job']; invoice: Invoice }) {
 const { state, error } = usePayments(job.id, job.version), due = invoice.balance!.due_cents, mine = state?.attempts.filter(a => a.invoice_id === invoice.id) ?? [], latest = mine[0]
 const returned = new URLSearchParams(window.location.search)
 if (!state?.enabled || due <= 0) return error ? <p role="alert" className="error">{error}</p> : null
 return <section className="side-section" aria-label={`Pay invoice ${invoice.number}`}><h3>Pay this invoice</h3>
  <p>{state.statement}</p>
  {returned.get('paid') === latest?.id && <p role="status" className="notice">You returned from Stripe. This invoice is credited when Stripe confirms the payment.</p>}
  {latest?.settlement_state === 'unresolved' && <p role="status" className="notice">{latest.label} Ask the office to reconcile this instruction before paying again.</p>}
  {latest?.status === 'processing' && <p role="status" className="notice">{latest.label}</p>}
  {latest && ['failed', 'review'].includes(latest.status) && <p className="notice">{latest.label}</p>}
  {latest?.status !== 'processing' && latest?.settlement_state !== 'unresolved' && <Form submit={`Pay ${money(due)} with card or bank`} reset={false} action={async f => { const r = await api(`/jobs/${job.id}/payments`, { invoice_id: invoice.id, confirm: f.get('confirm') === 'on' }); window.location.assign(r.url) }}>
   <label><input type="checkbox" name="confirm" required />I authorize payment of {money(due)} for invoice {invoice.number} by card or US bank account through Stripe. My card or bank details are entered on Stripe’s page and never reach Plinth.</label>
  </Form>}
 </section>
}
/** The office's record of every instruction with its processor references and the fee Stripe reported. */
export function PaymentHistory({ job, manager, mutate, role }: Pick<JobProps, 'job' | 'manager' | 'mutate' | 'role'>) {
 const { state, error, load } = usePayments(job.id, job.version), rows = state?.attempts ?? []
 if (!state?.enabled && rows.length === 0) return null
 const number = (id: string) => (job.invoices ?? []).find(i => i.id === id)?.number ?? 'Invoice'
 return <section className="side-section"><h3>Online payments</h3>
  <p className="card-lead">Card, Apple Pay, Google Pay and US bank payments through Stripe. Stripe holds the funds and the card or bank details; Plinth records the processor references.</p>
  {error && <p role="alert" className="error">{error}</p>}
  {rows.length === 0 ? <p className="muted">No online payment started yet.</p> : <div className="invoice-table-scroll"><table className="invoice-table"><thead><tr>{['Invoice', 'Amount', 'Status', 'Method', ...(manager ? ['Stripe fee', 'Processor reference'] : []), 'Updated'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
   <tbody>{rows.map(a => <tr key={a.id}><td>{number(a.invoice_id)}</td><td>{money(a.amount_cents)}</td><td><Badge status={a.settlement_state ?? a.status}>{(a.settlement_state ?? a.status).replace('_', ' ')}</Badge> <span className="muted">{mode(a)}</span></td><td>{a.method ? `${a.method === 'us_bank_account' ? 'US bank' : 'Card'}${a.wallet ? ` · ${a.wallet.replace('_', ' ')}` : ''}` : 'Not chosen yet'}</td>{manager && <><td>{a.fee_cents == null ? 'Not reported' : money(a.fee_cents)}</td><td>{a.payment_intent_id ?? a.session_id ?? '—'}</td></>}<td>{dateTime(a.updated_at ?? a.created_at)}<p className="muted">{a.label}</p>{manager && state?.refunds?.filter(r => r.attempt_id === a.id).map(r => <p key={r.id}>Refund {money(r.amount_cents)} · {r.status} · {r.provider_id ?? r.id}</p>)}{(role === 'owner' || role === 'admin') && <Action action={async () => { await mutate(`/payments/${a.id}/reconcile`, {}); await load() }}>Reconcile with Stripe</Action>}</td></tr>)}</tbody></table></div>}
 </section>
}
