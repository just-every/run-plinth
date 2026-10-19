import { useEffect, useState } from 'react'
import type { Vendor } from '../plinth/vendor-model'
import { currentQualification } from '../plinth/vendor-model'
import type { JobProps } from './job'
import { Action, api, cents, Field, Form, money } from './shared'

/** Awarded scopes on this job. Office-only: client job responses never include them. */
export function Subcontracts({ job, manager, mutate }: JobProps) {
  const [vendors, setVendors] = useState<Vendor[]>([])
  useEffect(() => { if (manager) api('/vendors').then(r => setVendors(r.vendors)).catch(() => setVendors([])) }, [manager])
  const qualified = vendors.flatMap(v => v.trades.filter(t => currentQualification(v, t)?.status === 'qualified').map(t => ({ v, t })))
  return <section className="card" aria-labelledby="subcontracts-title"><div className="card-head"><h2 id="subcontracts-title">Subcontract awards</h2></div>
    {!(job.subcontracts ?? []).length ? <p className="empty">No scopes awarded yet.</p> : <ul className="rows">{job.subcontracts!.map(s => <li className="row" key={s.id}><div className="row-main"><strong>{s.vendor_name} · {s.trade}</strong><span>{s.scope}</span><span>Awarded {s.awarded_on} by {s.awarded_by.name} · {s.status === 'released' ? `Released by ${s.released_by?.name}` : s.status === 'on_hold' ? 'On hold' : 'Awaiting release'}</span>{!!s.compliance?.holds.length && <span className="is-late">Holds: {s.compliance.holds.map(h => `${h.kind.replace('_', ' ')} ${h.problem.replace('_', ' ')}`).join('; ')}</span>}{!!s.compliance?.flags.length && <span>Flags: {s.compliance.flags.map(h => `${h.kind.replace('_', ' ')} ${h.problem.replace('_', ' ')}`).join('; ')}</span>}{s.lien && <span>Lien waivers ({s.lien.state}): {(s.draws ?? []).length ? (s.draws ?? []).map(d => `Draw ${d.number} through ${d.through_date} ${d.payment ? `paid ${d.payment.paid_on}` : 'unpaid'}; ${s.lien!.parties.map(p => { const w = d.waivers.find(x => x.party_id === p.id && x.kind === (d.payment ? 'unconditional' : 'conditional')); return `${p.name} (tier ${p.tier}) ${d.payment ? 'unconditional' : 'conditional'} ${w?.status ?? 'not requested'}` }).join(', ')}`).join(' · ') : 'no draws yet'}</span>}{manager && s.status !== 'released' && <Action action={() => mutate(`/subcontracts/${s.id}/release`)}>Release scope</Action>}</div>{s.amount_cents !== undefined && <div className="row-end"><strong className="amount">{money(s.amount_cents, job.currency)}</strong></div>}</li>)}</ul>}
    {manager && (qualified.length ? <Form submit="Award scope" action={async f => { const [vendor_id, trade] = String(f.get('pick')).split('|'); const v = vendors.find(x => x.id === vendor_id)!; await mutate('/subcontracts', { vendor_id, trade, scope: f.get('scope'), awarded_on: f.get('awarded_on'), contact_ids: v.contacts.map(c => c.id), ...(f.get('amount') ? { amount_cents: cents(f.get('amount')) } : {}) }) }}>
      <div className="fields"><label>Qualified company and trade<select name="pick">{qualified.map(({ v, t }) => <option key={v.id + t} value={`${v.id}|${t}`}>{v.name} · {t}</option>)}</select></label><Field name="scope" label="Scope awarded" /><Field name="awarded_on" label="Award date" type="date" /><Field name="amount" label="Award amount (USD)" inputMode="decimal" required={false} /></div>
    </Form> : <p className="hint">Qualify a company for a trade under Subcontractors before awarding a scope.</p>)}
  </section>
}
