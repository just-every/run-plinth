import { find, need, object, stamp, text, type Actor, type Input, type Stamp } from './model'
import { nanp } from './us-conventions'
/** A phone written as a US number also carries its E.164 form; any other number stays exactly as written. */
const phoneE164 = (phone: string) => { const e164 = phone ? nanp(phone) : null; return e164 ? { phone_e164: e164 } : {} }

export interface CustomerContact {
 id: string
 name: string
 email: string
 phone: string
 phone_e164?: string
 preferences: string
 external_id: string
}
export interface CustomerProperty { id: string; label: string; address: string }
export interface CustomerHistory {
 id: string
 kind: 'customer.created' | 'customer.updated' | 'contact.created' | 'contact.updated' | 'property.created' | 'property.updated' | 'contact.note'
 actor: Stamp
 subject_id: string
 before?: unknown
 after: unknown
}
export interface Customer {
 id: string
 version: number
 kind: 'household' | 'business' | 'person'
 name: string
 external_id: string
 owner_contact_ids: string[]
 billing_contact_ids: string[]
 contacts: CustomerContact[]
 properties: CustomerProperty[]
 history: CustomerHistory[]
}

function optionalText(value: unknown, name: string, max: number): string {
 if(value === undefined || value === '') return ''
 return text(value,name,max)
}
function identity(value: unknown): string {
 return value === undefined ? crypto.randomUUID() : text(value,'id',100)
}
function kind(value: unknown): Customer['kind'] {
 need(value === 'household' || value === 'business' || value === 'person','kind must be household, business, or person')
 return value
}
function contact(input: Input, previous?: CustomerContact): CustomerContact {
 if(previous) need(input.id === undefined || input.id === previous.id,'Contact id cannot change')
 const values = {...previous,...input}
 const email = optionalText(values.email,'email',254).toLowerCase()
 need(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Provide a valid contact email')
 return {id:previous?.id ?? identity(input.id),name:text(values.name,'name',200),email,
  phone:optionalText(values.phone,'phone',100),...phoneE164(optionalText(values.phone,'phone',100)),preferences:optionalText(values.preferences,'preferences',4000),
  external_id:optionalText(values.external_id,'external_id',500)}
}
function property(input: Input, previous?: CustomerProperty): CustomerProperty {
 if(previous) need(input.id === undefined || input.id === previous.id,'Property id cannot change')
 const values = {...previous,...input}
 return {id:previous?.id ?? identity(input.id),label:text(values.label,'label',200),address:text(values.address,'address',1000)}
}
function records<T extends {id:string}>(value: unknown, name: string, parse: (input:Input)=>T): T[] {
 if(value === undefined) return []
 need(Array.isArray(value) && value.length <= 200,`${name} must contain at most 200 records`)
 const result = value.map(row=>parse(object(row)))
 need(new Set(result.map(row=>row.id)).size === result.length,`${name} ids must be unique`)
 return result
}
function references(value: unknown, name: string, contacts: CustomerContact[]): string[] {
 need(Array.isArray(value) && value.length <= 200,`${name} must be a list of at most 200 contact ids`)
 const ids = value.map(id=>text(id,name,100))
 need(new Set(ids).size === ids.length,`${name} must not contain duplicate ids`)
 need(ids.every(id=>contacts.some(row=>row.id === id)),`${name} must reference this customer's contacts`)
 return ids
}
function metadata(customer: Customer) {
 const {id,kind,name,external_id,owner_contact_ids,billing_contact_ids} = customer
 return {id,kind,name,external_id,owner_contact_ids:[...owner_contact_ids],billing_contact_ids:[...billing_contact_ids]}
}
function history(customer: Customer, actor: Actor, kind: CustomerHistory['kind'], subject: string, after: unknown, before?: unknown) {
 customer.history.push({id:crypto.randomUUID(),kind,actor:stamp(actor),subject_id:subject,
  ...(before === undefined ? {} : {before:structuredClone(before)}),after:structuredClone(after)})
}
export function createCustomer(input: Input, actor: Actor): Customer {
 const contacts = records(input.contacts,'contacts',contact)
 const customer: Customer = {id:crypto.randomUUID(),version:1,kind:kind(input.kind),name:text(input.name,'name',200),
  external_id:optionalText(input.external_id,'external_id',500),contacts,properties:records(input.properties,'properties',property),
  owner_contact_ids:references(input.owner_contact_ids === undefined ? [] : input.owner_contact_ids,'owner_contact_ids',contacts),
  billing_contact_ids:references(input.billing_contact_ids === undefined ? [] : input.billing_contact_ids,'billing_contact_ids',contacts),history:[]}
 history(customer,actor,'customer.created',customer.id,{...metadata(customer),contacts:customer.contacts,properties:customer.properties})
 return customer
}
export function updateCustomer(customer: Customer, input: Input, actor: Actor) {
 need(input.id === undefined || input.id === customer.id,'Customer id cannot change')
 need(input.contacts === undefined && input.properties === undefined,'Edit contacts and properties through their individual routes')
 const before = metadata(customer)
 if(input.kind !== undefined) customer.kind = kind(input.kind)
 if(input.name !== undefined) customer.name = text(input.name,'name',200)
 if(input.external_id !== undefined) customer.external_id = optionalText(input.external_id,'external_id',500)
 customer.owner_contact_ids = references(input.owner_contact_ids === undefined ? customer.owner_contact_ids : input.owner_contact_ids,'owner_contact_ids',customer.contacts)
 customer.billing_contact_ids = references(input.billing_contact_ids === undefined ? customer.billing_contact_ids : input.billing_contact_ids,'billing_contact_ids',customer.contacts)
 history(customer,actor,'customer.updated',customer.id,metadata(customer),before)
 return customer
}
export function editContact(customer: Customer, input: Input, actor: Actor, id?: string): CustomerContact {
 const previous = id === undefined ? undefined : find(customer.contacts,id)
 need(previous || customer.contacts.length < 200,'A customer supports at most 200 contacts')
 const next = contact(input,previous)
 need(previous || !customer.contacts.some(row=>row.id === next.id),'Contact id already exists',409,'conflict')
 history(customer,actor,previous ? 'contact.updated' : 'contact.created',next.id,next,previous)
 if(previous) customer.contacts[customer.contacts.indexOf(previous)] = next
 else customer.contacts.push(next)
 return next
}
export function editProperty(customer: Customer, input: Input, actor: Actor, id?: string): CustomerProperty {
 const previous = id === undefined ? undefined : find(customer.properties,id)
 need(previous || customer.properties.length < 200,'A customer supports at most 200 properties')
 const next = property(input,previous)
 need(previous || !customer.properties.some(row=>row.id === next.id),'Property id already exists',409,'conflict')
 history(customer,actor,previous ? 'property.updated' : 'property.created',next.id,next,previous)
 if(previous) customer.properties[customer.properties.indexOf(previous)] = next
 else customer.properties.push(next)
 return next
}

export function contactNote(customer: Customer, input: Input, actor: Actor, id: string) {
 const contact = find(customer.contacts,id)
 const note = {contact_id:contact.id,note:text(input.note,'note',4000)}
 history(customer,actor,'contact.note',contact.id,note)
 return note
}
