import type { CustomerContact } from '../plinth/customer-model'
import { Field, Form } from './shared'

export function ContactEditor({contact,save}: {contact?:CustomerContact;save:(body:Record<string,unknown>)=>Promise<void>}) {
  return <Form submit={contact?'Save contact':'Add contact'} reset={!contact} action={async f=>save(Object.fromEntries(['name','email','phone','preferences','external_id'].map(k=>[k,f.get(k)])))}>
    <div className="fields"><Field label="Contact name" name="name" defaultValue={contact?.name} /><Field label="Contact email" name="email" type="email" required={false} defaultValue={contact?.email} /><Field label="Contact phone" name="phone" type="tel" required={false} defaultValue={contact?.phone} /><Field label="Contact external reference" name="external_id" required={false} defaultValue={contact?.external_id} /></div>
    <label>Contact preferences<textarea name="preferences" defaultValue={contact?.preferences} rows={2} /></label>
  </Form>
}
