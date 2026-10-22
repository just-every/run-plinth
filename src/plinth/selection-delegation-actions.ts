import { getCustomer } from './customers'
import { active, find, need, recordApproval, stamp, text, type Actor, type Input, type Job } from './model'
import { requirePortalFeature } from './portal-policy'
import { delegationGuards, delegationInvalid, requireSelectionClient, selectionDelegate, voidSelectionDelegations } from './selection-delegation-access'
import type { Selection } from './selection-model'
import { delegationProof, type SelectionDelegation } from './selection-delegation-model'

export async function delegationChoices(db:D1Database,job:Job,actor:Actor,selection:Selection) {
 await requireSelectionClient(db,job,actor);requirePortalFeature(job,'client','selections');active(job)
 const changed=await voidSelectionDelegations(db,job,selection),candidates=[]
 if(job.customer_id)for(const contact of (await getCustomer(db,job.customer_id)).contacts)if(await selectionDelegate(db,job,contact.id))candidates.push({id:contact.id,name:contact.name})
 return {changed,candidates,delegations:(selection.delegations??[]).map(delegationProof)}
}
export async function selectionDelegationAction(db:D1Database,job:Job,actor:Actor,input:Input,selection:Selection,revokeId?:string) {
 await requireSelectionClient(db,job,actor);requirePortalFeature(job,'client','selections');active(job)
 await voidSelectionDelegations(db,job,selection)
 let grant:SelectionDelegation,writes:D1PreparedStatement[]=[]
 if(revokeId){
  grant=find(selection.delegations??[],revokeId);need(grant.status==='active','Only an unused live delegation can be revoked; signatures are retained',409,'delegation_state')
  grant.status='revoked';grant.revocation={by:stamp(actor),reason:text(input.reason,'Revocation reason',2000)}
 }else{
  const revision=find(selection.revisions,text(input.revision_id,'Exact revision',100))
  need(revision===selection.revisions.at(-1)&&revision.status==='presented','Delegate only the current presented revision',409,'revision')
  need(!(selection.delegations??[]).some(d=>d.revision_id===revision.id&&d.status==='active'),'This revision already has a live delegation',409,'delegation_exists')
  need(job.customer_id,'Link this job to its customer before delegating',409,'customer_required')
  const eligible=await selectionDelegate(db,job,text(input.contact_id,'Existing customer contact',100));need(eligible,'Choose an active eligible contact from this job customer',403,'delegate_required')
  need(input.confirm===true,'Confirm delegation of this exact revision')
  need((selection.delegations??[]).length<200,'Selection delegation history limit reached')
  grant={id:crypto.randomUUID(),revision_id:revision.id,customer_id:job.customer_id,contact_id:eligible.contact.id,delegated_by:stamp(actor),delegator_email:actor.email.toLowerCase(),delegator_version:actor.version,delegate:{id:eligible.person.id,name:eligible.person.display_name,role:'member',at:new Date().toISOString()},delegate_email:eligible.person.email.toLowerCase(),delegate_version:eligible.person.version,statement:text(input.statement,'Delegating statement',2000),status:'active'}
  need(!await delegationInvalid(db,job,selection,grant),'The exact revision or signing authority changed',409,'delegation_void')
  ;(selection.delegations??=[]).push(grant);writes=delegationGuards(db,grant)
 }
 recordApproval(job,actor,'selection.delegation.'+(revokeId?'revoke':'create'),{id:grant.id,prepared_by:grant.delegated_by},{selection_id:selection.id,...delegationProof(grant)})
 return {grant,writes}
}
