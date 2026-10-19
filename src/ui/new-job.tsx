import { useEffect, useState, type RefObject } from 'react'
import type { Customer } from '../plinth/customer-model'
import { api, Field, Form } from './shared'
import { CustomerChoice } from './job-customer'

export function NewJob({create,onCreated,onOpen}: {create:RefObject<HTMLElement|null>;onCreated:()=>Promise<void>;onOpen:(id:string)=>void}) {
  const [customers,setCustomers]=useState<Customer[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState('')
  useEffect(()=>{api('/customers').then(r=>setCustomers(r.customers)).catch(e=>setError(e.message))},[])
  return <section className="card create-job" ref={create}><h2>Create a job</h2>{error&&<p role="alert">{error}</p>}<Form submit="Create job" action={async f=>{const result=await api('/jobs',{name:f.get('name'),client_email:f.get('email'),address:f.get('address')||'',...(f.get('time_zone')?{time_zone:f.get('time_zone')}:{}),...(selected?{customer_id:selected,property_id:f.get('property_id'),client_contact_ids:f.getAll('client_contact_ids')}:{})});await onCreated();onOpen(result.job.id)}}>
    <div className="fields"><Field name="name" label="Job name" placeholder="Hartley kitchen remodel" maxLength={160} /><Field name="email" label="Client email" type="email" /><Field name="address" label="Site address" required={false} maxLength={300} /><Field name="time_zone" label="Job time zone (IANA)" required={false} placeholder="Company default" />
    {customers.length>0&&<details style={{gridColumn:'1 / -1'}}><summary>Use an existing customer and property</summary><CustomerChoice customers={customers} selected={selected} onSelect={setSelected}/></details>}</div>
  </Form></section>
}
