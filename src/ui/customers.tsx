import { useEffect, useState } from 'react'
import type { Customer } from '../plinth/customer-model'
import { api, Field, Form } from './shared'
import { Page } from './shell'
import { CustomerDetail } from './customer-detail'

export function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState('')
  async function refresh() { const result = await api('/customers'); setCustomers(result.customers) }
  useEffect(() => { refresh().catch(e => setError(e.message)) }, [])
  const customer = customers.find(c => c.id === selected)
  return <Page title="Customers & properties" lead="Keep each customer's contacts and sites together across their jobs.">
    {error && <p role="alert">{error}</p>}
    <section className="card"><h2>Add a customer</h2><Form submit="Create customer" action={async f => { const result = await api('/customers', {name:f.get('name'),kind:f.get('kind'),external_id:f.get('external_id')}); await refresh(); setSelected(result.customer.id) }}><div className="fields"><Field label="Customer name" name="name" /><label>Customer type<select aria-label="Customer type" name="kind"><option value="household">Household</option><option value="business">Business</option><option value="person">Person</option></select></label><Field name="external_id" label="Customer external reference" required={false} /></div></Form></section>
    <section className="card"><h2>Customers</h2>{customers.length === 0 ? <p>No customers yet.</p> : <div className="button-row">{customers.map(c => <button className="danger-button" key={c.id} aria-pressed={selected===c.id} onClick={() => setSelected(c.id)}>{c.name}</button>)}</div>}</section>
    {customer && <CustomerDetail key={customer.id+':'+customer.version} customer={customer} changed={refresh} />}
  </Page>
}
