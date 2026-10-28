import { find, need, object, recordApproval, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'
import { planLink, type PlanSet, type PlanSheet } from './plan-model'

export interface DrawingRegion { text:string; x:number; y:number; width:number; height:number; confidence:number }
export interface DrawingProposal { id:string; sheet_id:string; checksum:string; page:number; text:string; regions:DrawingRegion[]; number:string; name:string; by:Stamp }
export interface DrawingReview { id:string; proposal_id:string; sheet_id:string; checksum:string; page:number; number:string; name:string; text:string; by:Stamp }
export interface DrawingLink { id:string; from_review:string; to_set:string; to_review:string; label:string; x:number; y:number; width:number; height:number; by:Stamp }
export interface DrawingState { proposals:DrawingProposal[]; reviews:DrawingReview[]; links:DrawingLink[] }
export const drawingOffice=(actor:Actor)=>!actor.permissions&&['owner','admin','project_manager'].includes(actor.role)
export function requireDrawingOffice(actor:Actor){need(drawingOffice(actor),'Current office drawing review authority required',403,'forbidden')}
export const latestReview=(set:PlanSet,sheetId:string)=>set.drawing_review?.reviews.findLast(r=>r.sheet_id===sheetId)
const source=(set:PlanSet,id:string,checksum?:unknown)=>{const sheet=find(set.sheets,id);need(set.approved_by,'Approve the exact source set first',409,'unapproved');if(checksum!==undefined)need(checksum===sheet.document.checksum,'The source checksum changed',409,'drawing_source');return sheet}
function region(raw:unknown,sheet:PlanSheet):DrawingRegion{
 const v=object(raw)
 for(const k of ['x','y','width','height','confidence'])need(typeof v[k]==='number'&&Number.isFinite(v[k]),'Supply finite source coordinates and confidence')
 need((v.x as number)>=0&&(v.y as number)>=0&&(v.width as number)>0&&(v.height as number)>0&&(v.x as number)+(v.width as number)<=sheet.width+.01&&(v.y as number)+(v.height as number)<=sheet.height+.01,'Keep the region within the exact source page')
 need((v.confidence as number)>=0&&(v.confidence as number)<=100,'Confidence must be between zero and one hundred')
 return {text:text(v.text,'Recognized region',4000),x:v.x as number,y:v.y as number,width:v.width as number,height:v.height as number,confidence:v.confidence as number}
}
export function drawingLink(job:Job,actor:Actor,setId:string,linkId:string){
 requireDrawingOffice(actor)
 const set=find(job.plan_sets??[],setId),link=find(set.drawing_review?.links??[],linkId),from=find(set.drawing_review?.reviews??[],link.from_review),toSet=find(job.plan_sets??[],link.to_set),to=find(toSet.drawing_review?.reviews??[],link.to_review)
 source(set,from.sheet_id,from.checksum);source(toSet,to.sheet_id,to.checksum)
 need(latestReview(set,from.sheet_id)?.id===from.id&&latestReview(toSet,to.sheet_id)?.id===to.id,'A linked review changed; review a new link',409,'drawing_stale')
 return {link,from,to,href:planLink(job.id,toSet.id,to.sheet_id)}
}
export function drawingSearch(job:Job,actor:Actor,query:string){
 requireDrawingOffice(actor);need(query.trim().length>0&&query.length<=200,'Enter up to 200 search characters')
 const hits=[]
 for(const set of job.plan_sets??[])for(const sheet of set.sheets){
  const review=latestReview(set,sheet.id);if(!review)continue
  const annotations=set.annotations.filter(a=>a.sheet_id===sheet.id)
  if([review.number,review.name,review.text,...annotations.map(a=>a.text)].join('\n').toLowerCase().includes(query.toLowerCase()))hits.push({set_id:set.id,sheet_id:sheet.id,revision:sheet.revision,review,annotations,href:planLink(job.id,set.id,sheet.id)})
 }
 return {results:hits,count:hits.length}
}
export function drawingAction(job:Job,actor:Actor,input:Input,set:PlanSet,verb:string){
 requireDrawingOffice(actor)
 const state=set.drawing_review??={proposals:[],reviews:[],links:[]}
 need(state.proposals.length+state.reviews.length+state.links.length<1500,'This set has reached its drawing review limit')
 if(verb==='recognition-propose'){
  const sheet=source(set,text(input.sheet_id,'Source sheet',100),input.checksum)
  need(input.checksum===sheet.document.checksum,'Bind recognition to the original checksum',409,'drawing_source')
  need(input.page===sheet.page,'Recognition must name the exact source page',409,'drawing_source')
  need(Array.isArray(input.regions)&&input.regions.length>0&&input.regions.length<=500,'Supply one to five hundred recognized source regions')
  const proposal:DrawingProposal={id:crypto.randomUUID(),sheet_id:sheet.id,checksum:sheet.document.checksum,page:sheet.page,text:text(input.text,'Recognized text',100000),number:text(input.number,'Proposed sheet number',80),name:text(input.name,'Proposed sheet name',200),regions:input.regions.map(v=>region(v,sheet)),by:stamp(actor)}
  state.proposals.push(proposal);return proposal
 }
 need(input.confirm===true,'Explicitly approve this exact review or detail link')
 if(verb==='recognition-review'){
  const proposal=find(state.proposals,text(input.proposal_id,'Recognition proposal',100));source(set,proposal.sheet_id,proposal.checksum)
  const previous=latestReview(set,proposal.sheet_id)
  need((input.previous_review_id??null)===(previous?.id??null),'The drawing review changed',409,'drawing_stale')
  const review:DrawingReview={id:crypto.randomUUID(),proposal_id:proposal.id,sheet_id:proposal.sheet_id,checksum:proposal.checksum,page:proposal.page,number:text(input.number,'Reviewed sheet number',80),name:text(input.name,'Reviewed sheet name',200),text:text(input.text,'Reviewed text',100000),by:stamp(actor)}
  state.reviews.push(review);recordApproval(job,actor,'plans.recognition',{id:review.id,prepared_by:proposal.by},review);return review
 }
 if(verb==='detail-link'){
  const from=find(state.reviews,text(input.from_review,'Source review',100)),toSet=find(job.plan_sets??[],text(input.to_set,'Target set',100)),to=find(toSet.drawing_review?.reviews??[],text(input.to_review,'Target review',100))
  const sheet=source(set,from.sheet_id,from.checksum);source(toSet,to.sheet_id,to.checksum)
  need(from.sheet_id!==to.sheet_id,'Choose another reviewed sheet')
  need(latestReview(set,from.sheet_id)?.id===from.id&&latestReview(toSet,to.sheet_id)?.id===to.id,'A linked review changed',409,'drawing_stale')
  const area=region({...input,text:input.label,confidence:100},sheet)
  const existing=state.links.find(l=>l.from_review===from.id&&l.to_review===to.id&&l.label===area.text&&l.x===area.x&&l.y===area.y&&l.width===area.width&&l.height===area.height)
  if(existing)return existing
  const link:DrawingLink={id:crypto.randomUUID(),from_review:from.id,to_set:toSet.id,to_review:to.id,label:area.text,x:area.x,y:area.y,width:area.width,height:area.height,by:stamp(actor)}
  state.links.push(link);recordApproval(job,actor,'plans.detail-link',{id:link.id,prepared_by:from.by},{link,from,to});return link
 }
 need(false,'Unknown drawing review action',404,'not_found')
}
