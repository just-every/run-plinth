import { AccountingReview } from './accounting-review'
import { useEffect, useState } from 'react'
import type { CostBill } from '../plinth/cost-model'
import type { drawPacket } from '../plinth/cost-access'
import { api, Action, cents, Field, Form, money } from './shared'
import type { JobProps } from './job'
type Access = { owner: boolean; review: boolean; bills: boolean; create: boolean; edit: boolean; approve: boolean; packet: boolean }
export function FinancialAccess({ job, mutate }: JobProps) {
 const [access, setAccess] = useState<Access>(), [bills, setBills] = useState<CostBill[]>([]), [packet, setPacket] = useState<ReturnType<typeof drawPacket>>(), [error, setError] = useState('')
 const root = '/jobs/' + job.id + '/costs'
 const load = async () => { try { const a = await api(root + '/access'); setAccess(a); setBills(a.bills ? (await api(root + '/bills')).bills : []); setPacket(a.packet ? await api(root + '/draw-packet') : undefined); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load financial access') } }
 useEffect(() => { void load() }, [job.id, job.version])
 const save = async (path: string, body: Record<string, unknown>) => { await mutate('/costs' + path, body); await load() }
 return <div className="stack">{access && <AccountingReview job={job} owner={access.owner} reviewer={access.review} mutate={save}/>} {error && <p role="alert">{error}</p>}
  {access?.create && <section className="card narrow"><h2>Enter supplier bill</h2><p className="card-lead">Record the exact original and reviewed coding. The designated manager approves posting separately. No funds move.</p>
   <Form submit="Enter bill" action={async f => { const file = f.get('original') as File; if (!file?.size || file.size > 1048576) throw new Error('Choose an original up to 1 MB.'); const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (const b of bytes) binary += String.fromCharCode(b); await save('/bills', { vendor: f.get('vendor'), reference: f.get('reference'), dated_on: f.get('dated_on'), due_on: f.get('due_on'), period: f.get('period'), document: { name: file.name, mime: file.type, base64: btoa(binary) }, tax: { percent: '0', reference: f.get('tax_reference'), exemption_reference: f.get('tax_reference'), human_reviewed: true }, lines: [{ cost_code: f.get('cost_code'), description: f.get('description'), subtotal_cents: cents(f.get('amount')), taxable: false, matches: [] }] }) }}>
    <div className="fields"><Field label="Supplier" name="vendor"/><Field label="Invoice reference" name="reference"/><Field label="Invoice date" name="dated_on" type="date"/><Field label="Due date" name="due_on" type="date"/><Field label="Posting month" name="period" type="month"/><Field label="Cost code" name="cost_code"/><Field label="Bill amount (USD)" name="amount" inputMode="decimal"/><Field label="Description" name="description"/></div>
    <Field label="Evidence that this original has no tax" name="tax_reference"/><label>Exact original<input name="original" type="file" accept="application/pdf,image/png,image/jpeg" required/></label>
   </Form></section>}
  {access?.bills && <section className="card"><h2>Supplier bills</h2>{!bills.length && <p>No bills entered.</p>}{bills.map(b => <article className="record" key={b.id}><h3>{b.reference}</h3><p>{b.vendor} · {money(b.amount_cents)} · {b.status}</p><a href={'/api/plinth' + root + '/bills/' + b.id + '/original'}>Download exact bill original</a><ul>{b.lines.map(l => <li key={l.id}>{l.cost_code} · {l.description} · {money(l.amount_cents)}</li>)}</ul>
   {b.status === 'draft' && access.edit && <><Form submit="Recode bill" action={f => save('/bills/' + b.id + '/recode', { line_id: f.get('line_id'), cost_code: f.get('code'), reason: f.get('reason') })}><label>Bill line<select name="line_id">{b.lines.map(l => <option key={l.id} value={l.id}>{l.description}</option>)}</select></label><Field label="New cost code" name="code"/><Field label="Reason for recoding" name="reason"/></Form><Form submit="Record discrepancy review" action={f => save('/bills/' + b.id + '/review', { reason: f.get('review') })}><Field label="Receipt and coding review evidence" name="review"/></Form></>}
   {b.status === 'draft' && access.approve && <Action action={() => save('/bills/' + b.id + '/post', {})}>Approve bill posting</Action>}
  </article>)}</section>}
  {packet && <section className="card"><h2>Granted draw packet</h2><p className="card-lead">Read-only customer draw evidence for {packet.job_name}. Internal supplier originals and costs are excluded.</p><a href={'/api/plinth' + root + '/draw-packet'}>Download draw packet JSON</a>{!packet.applications.length && <p>No approved draw applications yet.</p>}{packet.applications.map(a => <article className="record" key={a.id}><h3>{a.description}</h3><p>Current draw {money(a.current_cents)} · {a.status}</p><ul>{a.lines?.map((l, i) => <li key={i}>{l.cost_code} · {l.description} · {money(l.current_cents)}<p>{l.evidence}</p></li>)}</ul></article>)}{packet.invoices.map(i => <p key={i.id}>{i.number} · {i.description} · due {i.due_on} · payable {money(i.payable_cents)}</p>)}</section>}
 </div>
}
