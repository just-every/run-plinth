import type { Attachment, Job, Stamp } from './model'
import type { WarrantyCase } from './warranty-model'
import type { WarrantyService } from './warranty-service-model'

const by=(s:Stamp)=>({name:s.name,role:s.role,at:s.at})
const same=(a:Stamp,b:Stamp|undefined)=>!!b&&a.id===b.id&&a.at===b.at
/** Legacy records have no visit reference; their exact action stamp identifies the retained visit. */
function companyHistory(service:WarrantyService,entry:WarrantyService['history'][number],company:string) {
 if(['requested','acknowledge-owner','acknowledge-client','withdraw-client','resolve-no-repair','acknowledge-not-covered'].includes(entry.kind))return true
 if(entry.kind==='assign')return entry.subcontract_id?entry.subcontract_id===company:same(entry.by,service.assignment?.by)
 const visit=entry.visit_id?service.visits.find(v=>v.id===entry.visit_id):service.visits.find(v=>entry.kind==='book'?same(entry.by,v.booked_by):entry.kind==='submit'?same(entry.by,v.submission?.by):entry.kind==='review'?same(entry.by,v.review?.by):false)
 return visit?.assignment.subcontract_id===company
}
export function serviceOriginals(item:WarrantyCase,company?:string):Attachment[] {
 const service=item.service!
 return [...service.attachments,...service.visits.filter(v=>!company||v.assignment.subcontract_id===company).flatMap(v=>v.submission?.attachments??[])]
}
/** Explicit external projection: internal identifiers and directory identities never travel by spread. */
export function shownServiceCase(job:Job,item:WarrantyCase,office:boolean,company?:string) {
 if(office)return item
 const s=item.service!
 return {id:item.id,component_id:item.component_id,description:item.description,reported_on:item.reported_on,status:item.status,
  service:{requested_by:by(s.requested_by),availability:s.availability,attachments:s.attachments,
   ownership:s.ownership?{by:by(s.ownership.by),statement:s.ownership.statement}:undefined,
   assignment:s.assignment?{by:by(s.assignment.by),reason:s.assignment.reason}:undefined,
   visits:s.visits.map(v=>{
    if(company&&v.assignment.subcontract_id!==company)return {start:v.start,end:v.end,review:v.review?{accepted:v.review.accepted,reason:v.review.reason}:undefined}
    const task=job.schedules.find(t=>t.id===v.task_id)
    return {id:v.id,start:v.start,end:v.end,booked_by:by(v.booked_by),appointment:task?{start:task.start,end:task.end,status:task.status}:undefined,
     submission:v.submission?{by:by(v.submission.by),statement:v.submission.statement,attachments:v.submission.attachments}:undefined,
     review:v.review?{by:by(v.review.by),accepted:v.review.accepted,reason:v.review.reason}:undefined}
   }),
   client_acknowledgment:s.client_acknowledgment?{by:by(s.client_acknowledgment.by),visit_id:s.client_acknowledgment.visit_id,statement:s.client_acknowledgment.statement}:undefined,
   withdrawal:s.withdrawal?{id:s.withdrawal.id,by:by(s.withdrawal.by),statement:s.withdrawal.statement}:undefined,
   no_repair_resolutions:s.no_repair_resolutions?.map(r=>({id:r.id,by:by(r.by),reason:r.reason,basis:r.basis,review_id:r.review_id,withdrawal_id:r.withdrawal_id})),
   not_covered_acknowledgment:s.not_covered_acknowledgment?{by:by(s.not_covered_acknowledgment.by),review_id:s.not_covered_acknowledgment.review_id,resolution_id:s.not_covered_acknowledgment.resolution_id,statement:s.not_covered_acknowledgment.statement}:undefined,
   history:s.history.filter(h=>!company||companyHistory(s,h,company)).map(h=>({kind:h.kind,by:by(h.by),reason:h.reason}))},
  reviews:item.reviews.map(r=>({id:r.id,decision:r.decision,reason:r.reason,reviewed_by:by(r.reviewed_by)})),
  closure:item.closure?{reason:item.closure.reason,closed_by:by(item.closure.closed_by)}:undefined}
}
