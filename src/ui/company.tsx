import { useEffect, useState } from 'react'
import type { Company } from '../plinth/company'
import type { CurrencyTotal } from '../plinth/currency-report'
import { api, Field, Form, money } from './shared'

/** Company setup: USD business, default IANA job time zone, US address and phone. */
export function CompanySetup() {
  const [company, setCompany] = useState<Company | null>(), [error, setError] = useState('')
  useEffect(() => { api('/company').then(r => setCompany(r.company)).catch(e => setError(e.message)) }, [])
  if (company === undefined) return error ? <p role="alert" className="error">{error}</p> : null
  const a = company?.address
  return <section className="card narrow" aria-labelledby="company-title"><h2 id="company-title">Company setup</h2>
    <p className="card-lead">New jobs, estimates, costs and billing are in USD. New jobs start in this time zone; each job keeps its own.{company && <> Phone {company.phone_display} · {company.time_zone}</>}</p>
    <Form reset={false} submit="Save company setup" action={async f => { const r = await api('/company', { expected_version: company?.version ?? 0, name: f.get('name'), time_zone: f.get('time_zone'), phone: f.get('phone'), address: { line1: f.get('line1'), line2: f.get('line2'), city: f.get('city'), state: f.get('state'), zip: f.get('zip') } }, 'PUT'); setCompany(r.company) }}>
      <div className="fields"><Field name="name" label="Company name" defaultValue={company?.name ?? ''} /><Field name="time_zone" label="Time zone (IANA)" placeholder="America/Chicago" defaultValue={company?.time_zone ?? ''} /><Field name="phone" label="Phone" type="tel" placeholder="(512) 555-0142" defaultValue={company?.phone_display ?? ''} />
        <Field name="line1" label="Street address" defaultValue={a?.line1 ?? ''} /><Field name="line2" label="Address line 2" required={false} defaultValue={a?.line2 ?? ''} /><Field name="city" label="City" defaultValue={a?.city ?? ''} /><Field name="state" label="State" maxLength={2} placeholder="TX" defaultValue={a?.state ?? ''} /><Field name="zip" label="ZIP code" inputMode="numeric" placeholder="78701" defaultValue={a?.zip ?? ''} /></div>
    </Form></section>
}
/** One line per currency: historical AUD jobs are reported apart from USD, never added in. */
export function CurrencyTotals({ totals }: { totals: CurrencyTotal[] }) {
  if (!totals.length) return null
  return <section className="card" aria-labelledby="currency-totals"><h2 id="currency-totals">Totals by currency</h2><ul className="rows">{totals.map(t => <li className="row" key={t.currency}><div className="row-main"><h3>{t.currency}{t.historical ? ' · historical' : ''}</h3><p className="muted">{t.jobs} job{t.jobs === 1 ? '' : 's'} · contracts {money(t.contract_cents, t.currency)} · open quotes {money(t.quoted_cents, t.currency)} · billed {money(t.billed_cents, t.currency)}</p></div></li>)}</ul></section>
}
