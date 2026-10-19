import type { Customer } from '../plinth/customer-model'
import { api, dateTime, Field, Form } from './shared'
import { ContactEditor } from './customer-editors'

export function CustomerDetail({customer,changed}: {customer:Customer;changed:()=>Promise<void>}) {
  const save = async (path:string, body:Record<string,unknown>) => { await api('/customers/'+customer.id+path,{...body,expected_version:customer.version}); await changed() }
  return <div className="stack">
    <section className="card"><h2>{customer.name}</h2><p>{customer.kind} · external reference {customer.external_id || 'not recorded'}</p>
      <Form submit="Save customer roles" reset={false} action={async f => save('',{name:f.get('name'),kind:f.get('kind'),external_id:f.get('external_id'),owner_contact_ids:f.getAll('owners'),billing_contact_ids:f.getAll('billing')})}>
        <div className="fields"><Field label="Customer display name" name="name" defaultValue={customer.name} /><label>Customer kind<select aria-label="Customer kind" name="kind" defaultValue={customer.kind}><option value="household">Household</option><option value="business">Business</option><option value="person">Person</option></select></label><Field label="Customer reference" name="external_id" required={false} defaultValue={customer.external_id} /></div>
        <h3>Owners / decision makers</h3>{customer.contacts.map(c => <label className="button-row" key={c.id}><input type="checkbox" name="owners" value={c.id} defaultChecked={customer.owner_contact_ids.includes(c.id)} />{c.name}</label>)}
        <h3>Billing contacts</h3>{customer.contacts.map(c => <label className="button-row" key={c.id}><input type="checkbox" name="billing" value={c.id} defaultChecked={customer.billing_contact_ids.includes(c.id)} />{c.name}</label>)}
      </Form>
    </section>
    <section className="card"><h2>Contacts</h2>{customer.contacts.map(c => <details key={c.id}><summary>{c.name} · {c.email || 'No email'}</summary><ContactEditor contact={c} save={body=>save('/contacts/'+c.id,body)} /><Form submit="Add contact history note" action={async f=>save('/contacts/'+c.id+'/notes',{note:f.get('note')})}><label>Contact history note<textarea name="note" required rows={2} /></label></Form></details>)}
      <h3>Add contact</h3><ContactEditor save={body=>save('/contacts',body)} />
    </section>
    <section className="card"><h2>Properties</h2>{customer.properties.map(p => <details key={p.id}><summary>{p.label} · {p.address}</summary><Form submit="Save property" reset={false} action={async f=>save('/properties/'+p.id,{label:f.get('label'),address:f.get('address')})}><Field label="Property name" name="label" defaultValue={p.label} /><Field label="Property address" name="address" defaultValue={p.address} /></Form></details>)}
      <h3>Add property</h3><Form submit="Add property" action={async f=>save('/properties',{label:f.get('label'),address:f.get('address')})}><div className="fields"><Field label="Property name" name="label" /><Field label="Property address" name="address" /></div></Form>
    </section>
    <section className="card"><h2>Contact & site history</h2><ol className="rows">{[...customer.history].reverse().map(h => <li key={h.id} className="row"><div className="row-main"><strong>{h.kind.replaceAll('.',' ')}</strong><span>{h.actor.name} · {dateTime(h.actor.at)}</span><details><summary>Changed record</summary><pre>{JSON.stringify({before:h.before,after:h.after},null,2)}</pre></details></div></li>)}</ol></section>
  </div>
}
