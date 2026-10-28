import { requireJobManager } from './auth'
import { decisionFiles, decisionDownload } from './decision-files'
import { active, find, need, stamp, text, type Actor, type Input, type Job } from './model'
import { day } from './purchase-order-model'
import { clientSelections, selectionRevision, type SelectionDecision } from './selection-model'
import { revisionWithProducts } from './selections'

/** Conservative default: no delegated signers, automatic acceptance, outbound reminder or order; exact assigned-client and builder review. */
export async function selectionDecision(db:D1Database,job:Job,actor:Actor,input:Input,id:string,action:string){
 active(job);need(actor.role!=='agent','A person must record a decision',403,'human_required')
 const selection=find(job.selections??[],id),revision=find(selection.revisions,text(input.revision_id,'revision_id',100)),current=selection.revisions.at(-1)!
 need(revision===current,'Review the latest selection revision',409,'revision')
 if(action==='substitute'){
  requireJobManager(actor);const option=find(revision.options,text(input.option_id,'Unavailable option',100)),next=revisionWithProducts(job,input,actor,current.revision+1)
  const impact=input.date_impact_days;need(typeof impact==='number'&&Number.isInteger(impact)&&Math.abs(impact)<=3650,'Date impact must be whole calendar days within 3650')
  next.substitution={previous_revision_id:revision.id,previous_option:structuredClone(option),unavailable_reason:text(input.unavailable_reason,'Unavailability evidence',2000),previous_available_on:day(input.previous_available_on,'Previous availability'),available_on:day(input.available_on,'Substitute availability'),specification_comparison:text(input.specification_comparison,'Specification comparison',4000),date_impact_days:impact,proposed_by:stamp(actor)}
  selection.revisions.push(next);return {record:selection,writes:[]}
 }
 need(['reminder','dispute','withdraw'].includes(action),'Unknown decision action',404,'not_found')
 need(revision.status!=='draft','Present the decision before recording an outcome',409,'decision_state')
 if(action==='dispute')need(actor.role==='member'&&actor.client_job_id===job.id,'The assigned client must dispute this decision',403,'client_required')
 else requireJobManager(actor)
 if(action==='reminder')need(revision.status==='presented','Only pending decisions need a reminder',409,'decision_state')
 need(!selection.decisions?.some(d=>d.revision_id===revision.id&&['dispute','withdraw'].includes(d.kind)),'This outcome is retained; prepare a replacement revision',409,'decision_held')
 const event:SelectionDecision={id:crypto.randomUUID(),revision_id:revision.id,kind:action as SelectionDecision['kind'],reason:text(input.reason,'Decision reason',4000),by:stamp(actor),attachments:[]}
 const files=await decisionFiles(db,job,event.id,input.attachments);event.attachments=files.attachments;(selection.decisions??=[]).push(event)
 return {record:selection,writes:files.writes}
}
export async function selectionDecisionFile(db:D1Database,job:Job,actor:Actor,id:string){need(actor.role!=='agent','A person downloads decision originals',403,'human_required');const selections=actor.role==='member'?clientSelections(job):job.selections??[];return decisionDownload(db,job,selections.flatMap(s=>s.decisions?.flatMap(d=>d.attachments)??[]),id)}
