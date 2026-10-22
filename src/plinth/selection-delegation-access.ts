import { clientAccess } from './job-customers'
import { getCustomer } from './customers'
import { decisionHeld, type Selection } from './selection-model'
import { portalEnabled } from './portal-policy'
import { need, type Actor, type Job } from './model'
import type { SelectionDelegation } from './selection-delegation-model'
import type { Vendor } from './vendor-model'

export async function nativeSelectionPerson(db:D1Database,email:string) {
 return db.prepare("SELECT id,email,display_name,version FROM oa_operators WHERE lower(email)=? AND role='member' AND status='active'").bind(email.toLowerCase()).first<{id:string;email:string;display_name:string;version:number}>()
}
/** Company identity is excluded even before release or while an award is held. */
async function companyContact(db:D1Database,job:Job,email:string) {
 const ids=new Set([...(job.subcontracts??[]).map(s=>s.vendor_id),...(job.bids??[]).flatMap(b=>b.invitations.map(i=>i.vendor_id))])
 for(const id of ids){const row=await db.prepare('SELECT data FROM pl_vendors WHERE id=?').bind(id).first<{data:string}>();if(row&&(JSON.parse(row.data) as Vendor).contacts.some(c=>c.email.toLowerCase()===email))return true}
 return (job.trade_invitations??[]).some(i=>i.email===email)
}
export async function selectionDelegate(db:D1Database,job:Job,contactId:string) {
 if(!job.customer_id)return null
 const customer=await getCustomer(db,job.customer_id),contact=customer.contacts.find(c=>c.id===contactId)
 if(!contact?.email||await clientAccess(db,job,contact.email)||await companyContact(db,job,contact.email))return null
 const person=await nativeSelectionPerson(db,contact.email)
 return person?{contact,person}:null
}
export async function delegationInvalid(db:D1Database,job:Job,selection:Selection,grant:SelectionDelegation) {
 if(job.status!=='active'||!portalEnabled(job,'client','selections'))return 'Job or client selections are unavailable'
 if(job.customer_id!==grant.customer_id)return 'The linked customer changed'
 const delegator=await nativeSelectionPerson(db,grant.delegator_email),delegate=await selectionDelegate(db,job,grant.contact_id)
 if(!delegator||delegator.id!==grant.delegated_by.id||delegator.version!==grant.delegator_version||!await clientAccess(db,job,grant.delegator_email))return 'The delegating client no longer has the recorded authority'
 if(!delegate||delegate.person.id!==grant.delegate.id||delegate.person.version!==grant.delegate_version||delegate.person.email.toLowerCase()!==grant.delegate_email)return 'The delegate no longer has the recorded identity and authority'
 const revision=selection.revisions.find(r=>r.id===grant.revision_id)
 if(grant.status==='used')return revision?.signature?.delegation?.delegation_id===grant.id?undefined:'The delegated signature is unavailable'
 if(revision!==selection.revisions.at(-1)||revision?.status!=='presented'||decisionHeld(selection,grant.revision_id))return 'The exact presented revision is no longer awaiting a decision'
 return undefined
}
export async function voidSelectionDelegations(db:D1Database,job:Job,selection:Selection) {
 let changed=false
 for(const grant of selection.delegations??[]){if(grant.status!=='active')continue;const reason=await delegationInvalid(db,job,selection,grant);if(reason){grant.status='void';grant.voided={at:new Date().toISOString(),reason};changed=true}}
 return changed
}
/** Cross-person account changes are fenced in the same D1 batch as the signature. */
export function delegationGuards(db:D1Database,grant:SelectionDelegation) {
 return [[grant.delegated_by.id,grant.delegator_version],[grant.delegate.id,grant.delegate_version]].map(([id,version])=>db.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND role='member' AND status='active') THEN 1 ELSE 0 END").bind(id,version))
}
export async function requireSelectionClient(db:D1Database,job:Job,actor:Actor) {
 need(actor.role==='member'&&await clientAccess(db,job,actor.email),'An assigned client contact must manage a signing delegation',403,'client_required')
}
