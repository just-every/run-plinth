import {requireManager} from './auth'
import {decisionFiles} from './decision-files'
import {day} from './purchase-order-model'
import {cents,find,need,object,stamp,sum,text,usdOnly,type Actor,type Input} from './model'
import {getVendor} from './vendors'
import {bidContact,requireBidInvite} from './bid-access'
import type {BidJob,BidLine,BidPackage,BidRevision} from './bid-model'

async function revision(db:D1Database,job:BidJob,actor:Actor,input:Input,number:number){
 const id=crypto.randomUUID(),files=await decisionFiles(db,job,id,input.plans)
 need(files.attachments.length,'Upload at least one exact plan original')
 const row:BidRevision={id,number,note:text(input.note,'Plan revision / addendum note',4000),due_on:day(input.due_on,'Bid due date'),plans:files.attachments,by:stamp(actor)}
 return {row,writes:files.writes}
}
function costCodes(value:unknown,bid:BidPackage){need(Array.isArray(value)&&value.length>0&&value.length<=100,'Choose scoped cost codes');const codes=value.map(c=>text(c,'Cost code',40));need(new Set(codes).size===codes.length&&codes.every(c=>bid.lines.some(l=>l.cost_code===c)),'Choose unique cost codes within this package');return codes}
export async function bidAction(db:D1Database,job:BidJob,actor:Actor,input:Input,id?:string,action?:string){
 if(!id){
  requireManager(actor);usdOnly(job);need((job.bids?.length??0)<100,'A job supports up to 100 bid packages');need(input.mode==='priced'||input.mode==='unpriced','Choose priced or unpriced')
  need(Array.isArray(input.lines)&&input.lines.length>0&&input.lines.length<=100,'Supply up to 100 scoped bid items')
  const codes=new Set(job.quotes.at(-1)?.lines.flatMap(l=>l.cost_code?[l.cost_code]:[])??[])
  const lines:BidLine[]=input.lines.map(value=>{const l=object(value),code=text(l.cost_code,'Cost code',40);need(codes.has(code),'Choose cost codes from the latest job estimate');return {cost_code:code,description:text(l.description,'Bid item scope',2000),...(input.mode==='priced'?{budget_cents:cents(l.budget_cents,'Reviewed package price')}: {})}})
  need(new Set(lines.map(l=>l.cost_code)).size===lines.length,'Each cost code appears once')
  const rev=await revision(db,job,actor,input,1),bid:BidPackage={id:crypto.randomUUID(),title:text(input.title,'Bid package title',300),trade:text(input.trade,'Qualified trade',80),scope:text(input.scope,'Package scope',8000),mode:input.mode,lines,revisions:[rev.row],prepared_by:stamp(actor),invitations:[]}
  ;(job.bids??=[]).push(bid);return {record:bid,writes:rev.writes}
 }
 const bid=find(job.bids??[],id),writes:D1PreparedStatement[]=[]
 if(['publish','invite','revoke','addendum','answer'].includes(action??'')){
  requireManager(actor)
  if(action==='publish'){need(!bid.published_by,'Package already published',409,'immutable');need(input.confirm===true&&input.revision_id===bid.revisions.at(-1)!.id,'Review and explicitly publish this exact plan revision');bid.published_by=stamp(actor)}
  else {
   need(bid.published_by,'Publish the package before inviting contacts or issuing addenda',409,'bid_draft')
   if(action==='invite'){
    need(input.confirm===true,'Explicitly invite this individual contact and selected cost codes')
    const vendor=await getVendor(db,text(input.vendor_id,'Qualified company',100)),contact=find(vendor.contacts,text(input.contact_id,'Company contact',100)),email=contact.email.toLowerCase(),pre_award=input.pre_award===true,subcontract_id=pre_award?undefined:text(input.subcontract_id,'Released company scope',100)
    need(!pre_award||input.subcontract_id===undefined,'A pre-award invitation cannot name an awarded scope')
    need(await bidContact(db,job,bid,{vendor_id:vendor.id,contact_id:contact.id,email,subcontract_id,...(pre_award?{pre_award:true as const}:{})}),'Bid access requires a qualified current company contact, an active member account and either an explicitly confirmed pre-award bid invitation or their own released company scope.',409,'bid_qualification')
    need(!bid.invitations.some(i=>!i.revoked_by&&(i.email===email||i.vendor_id===vendor.id)),'This contact or company is already invited',409,'bid_invited')
    bid.invitations.push({id:crypto.randomUUID(),subcontract_id,...(pre_award?{pre_award:true as const}:{}),vendor_id:vendor.id,vendor_name:vendor.name,contact_id:contact.id,email,contact_name:contact.name,cost_codes:costCodes(input.cost_codes,bid),by:stamp(actor),acknowledgments:[],questions:[],responses:[]})
   }else if(action==='revoke'){const invite=find(bid.invitations,text(input.invitation_id,'Invitation',100));need(!invite.revoked_by,'Invitation already revoked',409,'immutable');invite.revoked_by=stamp(actor)}
   else if(action==='addendum'){
    need(input.confirm===true&&input.revision_id===bid.revisions.at(-1)!.id,'Explicitly issue an addendum against the current revision',409,'bid_revision')
    const rev=await revision(db,job,actor,input,bid.revisions.length+1);need(bid.revisions.length<100,'At most 100 plan revisions');bid.revisions.push(rev.row);writes.push(...rev.writes)
   }else {
    const invite=find(bid.invitations,text(input.invitation_id,'Invitation',100)),question=find(invite.questions,text(input.question_id,'Question',100));need(!question.answer,'Question already answered',409,'immutable');question.answer={text:text(input.text,'Private answer',8000),by:stamp(actor)}
   }
  }
 }else{
  const invite=await requireBidInvite(db,job,bid,actor),current=bid.revisions.at(-1)!
  need(!invite.decline,'This invitation was declined',409,'bid_declined')
  need(input.revision_id===current.id,'Acknowledge and respond to the latest exact plan revision',409,'bid_revision')
  if(action==='acknowledge'){
   need(!invite.acknowledgments.some(a=>a.revision_id===current.id),'Revision already acknowledged',409,'immutable');invite.acknowledgments.push({revision_id:current.id,by:stamp(actor)})
  }else if(action==='question'){
   need(invite.questions.length<100,'At most 100 private questions');invite.questions.push({id:crypto.randomUUID(),text:text(input.text,'Private question',8000),by:stamp(actor)})
  }else if(action==='decline'){
   need(!invite.responses.length,'A received bid cannot be replaced by a decline',409,'bid_received');invite.decline={reason:text(input.reason,'Decline reason',4000),by:stamp(actor)}
  }else{
   need(action==='respond','Unknown bid action',404,'not_found');need(invite.acknowledgments.some(a=>a.revision_id===current.id),'Acknowledge the exact current plan revision first',409,'bid_acknowledgment')
   need(!invite.responses.some(r=>r.revision_id===current.id),'A response to this exact revision is already received',409,'immutable')
   need(Array.isArray(input.items)&&input.items.length===invite.cost_codes.length,'Price every invited cost code once')
   const items=input.items.map(value=>{const item=object(value);return {cost_code:text(item.cost_code,'Cost code',40),description:text(item.description,'Priced item description',2000),amount_cents:cents(item.amount_cents,'Bid item price')}})
   need(new Set(items.map(i=>i.cost_code)).size===items.length&&items.every(i=>invite.cost_codes.includes(i.cost_code)),'Price only your exact invited cost codes')
   const responseId=crypto.randomUUID(),files=await decisionFiles(db,job,responseId,input.attachments);writes.push(...files.writes)
   invite.responses.push({id:responseId,revision_id:current.id,items,total_cents:sum(items.map(i=>i.amount_cents)),exclusions:text(input.exclusions,'Exclusions',8000,true),attachments:files.attachments,by:stamp(actor)})
  }
 }
 return {record:bid,writes}
}
