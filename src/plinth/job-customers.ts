import { getCustomer } from './customers'
import { requireManager, privateWorkbookDraft } from './auth'
import { need, stamp, text, type Actor, type Input, type Job } from './model'

/** The original client remains authorized alongside explicitly granted contact identities. */
export async function clientAccess(db: D1Database, job: Job, email: string): Promise<boolean> {
  if (privateWorkbookDraft(job)) return false
  if (job.client_email === email.toLowerCase()) return true
  if (!job.customer_id || !job.client_contact_ids?.length) return false
  const customer = await getCustomer(db, job.customer_id)
  return customer.contacts.some(c => job.client_contact_ids!.includes(c.id) && c.email === email.toLowerCase())
}

export async function linkCustomer(db: D1Database, job: Job, actor: Actor, input: Input) {
  requireManager(actor)
  const customer = await getCustomer(db, text(input.customer_id, 'customer_id', 100))
  const property = customer.properties.find(p => p.id === input.property_id)
  need(property, 'Choose a property belonging to this customer')
  need(Array.isArray(input.client_contact_ids) && input.client_contact_ids.length <= 200, 'Choose authorized client contacts')
  const ids = input.client_contact_ids.map(id => text(id, 'client_contact_id', 100))
  need(new Set(ids).size === ids.length && ids.every(id => customer.contacts.some(c => c.id === id && c.email)), 'Every authorized contact must belong to this customer and have an email')
  const before = { customer_id: job.customer_id, property_id: job.property_id, client_contact_ids: job.client_contact_ids ?? [], address: job.address }
  // Preserve each job's original site snapshot when only its people are changed.
  if (job.customer_id !== customer.id || job.property_id !== property.id) job.address = property.address
  job.customer_id = customer.id
  job.property_id = property.id
  job.client_contact_ids = ids
  const by = stamp(actor)
  job.approvals.push({id:crypto.randomUUID(),kind:'client.contacts',subject_id:job.id,revision:job.version,prepared_by:by,approved_by:by,decision:'approved',snapshot:{before,after:{customer_id:customer.id,property_id:property.id,client_contact_ids:ids,address:job.address}}})
  return customer
}
