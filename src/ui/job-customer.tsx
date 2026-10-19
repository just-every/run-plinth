import { useEffect, useState } from 'react'
import type { Customer } from '../plinth/customer-model'
import type { JobProps } from './job'
import { api, Form } from './shared'

export function CustomerChoice({customers,selected,onSelect,propertyId,contactIds}: {customers:Customer[];selected:string;onSelect:(id:string)=>void;propertyId?:string;contactIds?:string[]}) {
  const customer=customers.find(c=>c.id===selected)
  return <><label>Existing customer<select aria-label="Existing customer" name="customer_id" value={selected} onChange={e=>onSelect(e.target.value)}><option value="">Choose customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {customer && <div key={customer.id}><label>Customer property<select aria-label="Customer property" name="property_id" required defaultValue={propertyId??customer.properties[0]?.id}>{customer.properties.map(p=><option key={p.id} value={p.id}>{p.label} · {p.address}</option>)}</select></label><h3>Authorized client contacts</h3><p>These contacts can read this job and approve its change orders. The original client email stays authorized.</p>{customer.contacts.filter(c=>c.email).map(c=><label className="button-row" key={c.id}><input type="checkbox" name="client_contact_ids" value={c.id} defaultChecked={contactIds?.includes(c.id)??false} />{c.name} · {c.email}</label>)}</div>}
  </>
}
export function JobCustomer({job,mutate}:JobProps) {
  const [customers,setCustomers]=useState<Customer[]>([]),[selected,setSelected]=useState(job.customer_id??''),[error,setError]=useState('')
  useEffect(()=>{api('/customers').then(r=>setCustomers(r.customers)).catch(e=>setError(e.message))},[])
  const current=customers.find(c=>c.id===job.customer_id)
  return <section className="card"><h2>Customer & site</h2>{error&&<p role="alert">{error}</p>}
    {current&&<><p>{current.name} · {current.properties.find(p=>p.id===job.property_id)?.label}</p><p>Job site snapshot: {job.address}</p><p>Billing contacts: {current.contacts.filter(c=>current.billing_contact_ids.includes(c.id)).map(c=>c.name+' · '+c.email).join(', ')||'None recorded'}</p></>}
    <p>Manage reusable contacts, billing roles and property history in Customers. Changing a property address preserves this job's site snapshot.</p>
    <Form submit="Save job customer & contacts" reset={false} action={async f=>mutate('/customer',{customer_id:f.get('customer_id'),property_id:f.get('property_id'),client_contact_ids:f.getAll('client_contact_ids')})}>
      <CustomerChoice customers={customers} selected={selected} onSelect={setSelected} propertyId={job.property_id} contactIds={job.client_contact_ids} />
    </Form>
  </section>
}
