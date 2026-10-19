import { useEffect, useState } from 'react'
import type { Vendor } from '../plinth/vendor-model'
import { currentQualification } from '../plinth/vendor-model'
import type { JobProps } from './job'
import { api, cents, Field, Form, money } from './shared'

/** Awarded scopes on this job. Office-only: client job responses never include them. */
export function Subcontracts({ job, manager, mutate }: JobProps) {
  const [vendors, setVendors] = useState<Vendor[]>([])
  useEffect(() => { if (manager) api('/vendors').then(r => setVendors(r.vendors)).catch(() => setVendors([])) }, [manager])
  const qualified = vendors.flatMap(v => v.trades.filter(t => currentQualification(v, t)?.status === 'qualified').map(t => ({ v, t })))
  return <section className="card" aria-labelledby="subcontracts-title"><div className="card-head"><h2 id="subcontracts-title">Subcontract awards</h2></div>
    {!(job.subcontracts ?? []).length ? <p className="empty">No scopes awarded yet.</p> : <ul className="rows">{job.subcontracts!.map(s => <li className="row" key={s.id}><div className="row-main"><strong>{s.vendor_name} · {s.trade}</strong><span>{s.scope}</span><span>Awarded {s.awarded_on} by {s.awarded_by.name}</span></div>{s.amount_cents !== undefined && <div className="row-end"><strong className="amount">{money(s.amount_cents, job.currency)}</strong></div>}</li>)}</ul>}
    {manager && (qualified.length ? <Form submit="Award scope" action={async f => { const [vendor_id, trade] = String(f.get('pick')).split('|'); const v = vendors.find(x => x.id === vendor_id)!; await mutate('/subcontracts', { vendor_id, trade, scope: f.get('scope'), awarded_on: f.get('awarded_on'), contact_ids: v.contacts.map(c => c.id), ...(f.get('amount') ? { amount_cents: cents(f.get('amount')) } : {}) }) }}>
      <div className="fields"><label>Qualified company and trade<select name="pick">{qualified.map(({ v, t }) => <option key={v.id + t} value={`${v.id}|${t}`}>{v.name} · {t}</option>)}</select></label><Field name="scope" label="Scope awarded" /><Field name="awarded_on" label="Award date" type="date" /><Field name="amount" label="Award amount (USD)" inputMode="decimal" required={false} /></div>
    </Form> : <p className="hint">Qualify a company for a trade under Subcontractors before awarding a scope.</p>)}
  </section>
}
