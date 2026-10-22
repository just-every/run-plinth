import {requireJobManager,visible} from './auth'
import {clientAccess} from './job-customers'
import {need,stamp,text,type Actor,type Input,type Job} from './model'
import {finalizeWarrantyCase} from './warranties'
import type {WarrantyCase} from './warranty-model'
import type {WarrantyNoRepairResolution} from './warranty-service-model'
import {officeAuthority} from './warranty-store'

/** The service route supplies the current native session and commits with its job/auth clock fence. */
export async function noRepairAction(db:D1Database,job:Job,actor:Actor,item:WarrantyCase,input:Input,action:string,portal:boolean):Promise<boolean>{
 if(!['withdraw-client','resolve-no-repair','acknowledge-not-covered'].includes(action))return false
 need(item.service,'Only a client service request supports this closure path',409,'service_required')
 need(item.status==='open','The closed service history is immutable',409,'immutable')
 const service=item.service,by=stamp(actor),reason=text(input.reason,'Action statement or reason',4000)
 if(action==='withdraw-client'){
  need(!portal&&actor.role==='member'&&await clientAccess(db,job,actor.email),'Only an assigned client withdraws a request',403,'client_required')
  need(!service.withdrawal,'The client withdrawal statement is immutable',409,'immutable')
  service.withdrawal={id:crypto.randomUUID(),by,statement:reason}
  return true
 }
 if(action==='resolve-no-repair'){
  requireJobManager(actor);visible(actor,job)
  need(!portal&&await officeAuthority(db,job,actor.id,true),'Current office authority required',403,'forbidden')
  const resolutions=service.no_repair_resolutions??[]
  need(resolutions.length<100,'The builder resolution history limit has been reached')
  let resolution:WarrantyNoRepairResolution
  if(service.withdrawal){
   resolution={id:crypto.randomUUID(),by,reason,basis:'withdrawal',withdrawal_id:service.withdrawal.id}
  }else{
   const review=item.reviews.at(-1)
   need(review?.decision==='not_covered','The latest coverage decision must be not covered, or the client must withdraw',409,'coverage_required')
   need(input.review_id===review.id,'Resolve the exact latest coverage decision',409,'review_changed')
   resolution={id:crypto.randomUUID(),by,reason,basis:'not_covered',review_id:review.id}
  }
  service.no_repair_resolutions=[...resolutions,resolution]
  if(resolution.basis==='withdrawal')finalizeWarrantyCase(job,actor,item,{reason,evidence_reference:'Client withdrawal '+resolution.withdrawal_id+'; builder resolution '+resolution.id,withdrawal_id:resolution.withdrawal_id,resolution_id:resolution.id})
  return true
 }
 need(!portal&&actor.role==='member'&&await clientAccess(db,job,actor.email),'Only an assigned client acknowledges a not-covered resolution',403,'client_required')
 const review=item.reviews.at(-1),resolution=service.no_repair_resolutions?.at(-1)
 need(review?.decision==='not_covered','The latest coverage decision must be not covered',409,'coverage_required')
 need(resolution?.basis==='not_covered'&&resolution.review_id===review.id,'The builder must resolve the latest not-covered decision first',409,'builder_resolution')
 need(input.review_id===review.id&&input.resolution_id===resolution.id,'Acknowledge the exact current coverage decision and builder resolution',409,'resolution_changed')
 service.not_covered_acknowledgment={by,review_id:review.id,resolution_id:resolution.id,statement:reason}
 finalizeWarrantyCase(job,actor,item,{reason,evidence_reference:'Not-covered review '+review.id+'; builder resolution '+resolution.id,review_id:review.id,resolution_id:resolution.id})
 return true
}
