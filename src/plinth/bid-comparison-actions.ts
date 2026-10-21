import {requireManager} from './auth'
import {awardSubcontract} from './subcontracts'
import {bidContact} from './bid-access'
import {active,cents,find,need,object,recordApproval,stamp,text,usdOnly,type Actor,type Input} from './model'
import {bidAdjustCosts,bidReverseCosts} from './bid-comparison-budget'
import {bidComparisonFlags,currentBidComparison,reviewBidComparison} from './bid-comparison-review'
import type {BidComparison,BidComparisonAward,BidComparisonJob} from './bid-comparison-model'

function cancel(job:BidComparisonJob,actor:Actor,award:BidComparisonAward,reason:string){
 need(!award.cancelled,'Award already cancelled',409,'immutable');const scope=find(job.subcontracts??[],award.subcontract_id)
 need(scope.status!=='released'&&!scope.draws?.length&&!scope.retainage&&!job.orders.some(o=>o.source?.kind==='award'&&o.source.subcontract_id===scope.id),'Only an unreleased commitment without orders, draws or retainage can be cancelled here. Settle started work and financial obligations before replacement.',409,'bid_award_in_use')
 const reversal=bidReverseCosts(job,actor,award,reason),by=stamp(actor)
 // Parent integrates cancelled into the existing subcontract lifecycle; original award terms are retained.
 Object.assign(scope,{status:'cancelled',bid_cancellation:{reason,by,award_id:award.id}})
 award.cancelled={reason,by,cost_adjustment_id:reversal.id};recordApproval(job,actor,'bid.award.cancel',{id:award.id,prepared_by:award.by},award);return award
}
export async function bidComparisonAction(db:D1Database,job:BidComparisonJob,actor:Actor,input:Input,id?:string,action?:string){
 requireManager(actor);usdOnly(job)
 const writes:D1PreparedStatement[]=[]
 if(!id){
  need((job.bid_comparisons?.length??0)<100,'At most 100 comparisons per job');const bid=find(job.bids??[],text(input.package_id,'Bid package',100)),revision=bid.revisions.at(-1)!
  need(bid.published_by,'Publish a bid package before comparing responses',409,'bid_draft')
  const candidates=bid.invitations.flatMap(i=>{const response=i.responses.filter(r=>r.revision_id===revision.id).at(-1);return response?[{id:crypto.randomUUID(),invitation_id:i.id,vendor_id:i.vendor_id,vendor_name:i.vendor_name,contact_id:i.contact_id,response:structuredClone(response)}]:[]})
  need(candidates.length>=2,'Receive at least two responses to the same current plan revision',409,'bid_comparison_responses')
  const row:BidComparison={id:crypto.randomUUID(),package_id:bid.id,plan_revision_id:revision.id,title:text(input.title,'Comparison title',300),scope:bid.scope,trade:bid.trade,lines:structuredClone(bid.lines),candidates,reviews:[],prepared_by:stamp(actor)};(job.bid_comparisons??=[]).push(row);return {record:row,writes}
 }
 const comparison=find(job.bid_comparisons??[],id)
 if(action==='review'){reviewBidComparison(comparison,actor,input);return {record:comparison,writes}}
 if(action==='cancel'){const award=find(job.bid_comparison_awards??[],text(input.award_id,'Award',100));need(award.comparison_id===comparison.id,'Award does not belong to this comparison');need(input.confirm===true&&input.subcontract_id===award.subcontract_id,'Explicitly confirm cancellation of this exact commitment');cancel(job,actor,award,text(input.reason,'Cancellation reason',4000));return {record:comparison,writes}}
 need(action==='award'||action==='replace','Unknown comparison action',404,'not_found');active(job)
 const bid=currentBidComparison(job,comparison),candidate=find(comparison.candidates,text(input.candidate_id,'Selected candidate',100)),invite=find(bid.invitations,candidate.invitation_id)
 need(!invite.revoked_by&&!invite.decline&&await bidContact(db,job,bid,invite),'The selected invitation, qualification or contact scope is no longer current',409,'bid_award_contact')
 const source=invite.responses.at(-1);need(source?.id===candidate.response.id&&JSON.stringify(source)===JSON.stringify(candidate.response),'The selected source response changed; prepare a new comparison',409,'bid_comparison_stale')
 const review=comparison.reviews.filter(r=>r.candidate_id===candidate.id).at(-1);need(review&&review.id===input.review_id,'Select the current reviewed normalization',409,'bid_review')
 need(comparison.candidates.every(c=>comparison.reviews.some(r=>r.candidate_id===c.id)),'Review every compared candidate before awarding',409,'bid_review')
 need(input.confirm===true&&input.amount_cents===candidate.response.total_cents,'Restate and approve the selected original bid amount; normalized figures do not change contractual prices',409,'bid_award_amount')
 const flags=bidComparisonFlags(comparison,candidate,review);need(!flags.length||input.acknowledge_missing_scope===true,'Explicitly acknowledge the selected bid’s missing or unclear scope',409,'bid_missing_scope')
 const previous=(job.bid_comparison_awards??[]).find(a=>a.package_id===bid.id&&!a.cancelled)
 if(action==='replace'){need(previous&&input.replaces_award_id===previous.id,'Select the exact active award being replaced',409,'bid_award_exists');cancel(job,actor,previous,text(input.replacement_reason,'Replacement / cancellation reason',4000))}
 else need(!previous,'This package already has an active award; explicitly replace or cancel it',409,'bid_award_exists')
 const decision=text(input.decision,'Award decision and scope reasoning',8000),terms=text(input.terms_reference,'Award terms / source reference',4000)
 need(Array.isArray(input.budget_allocations),'Review the budget allocation replaced by each awarded cost code')
 const allocations=input.budget_allocations.map(raw=>{const a=object(raw);return {cost_code:text(a.cost_code,'Budget cost code',40),amount_cents:cents(a.amount_cents,'Budget allocation being replaced'),expected_cost_cents:cents(a.expected_cost_cents,'Reviewed current internal code cost')}})
 const award:BidComparisonAward={id:crypto.randomUUID(),package_id:bid.id,comparison_id:comparison.id,candidate_id:candidate.id,review_id:review.id,subcontract_id:'',amount_cents:candidate.response.total_cents,decision,terms_reference:terms,by:stamp(actor),cost_adjustment_id:''}
 const adjustment=bidAdjustCosts(job,actor,award,candidate.response.items,allocations,decision)
 const granted=await awardSubcontract(db,job,actor,{vendor_id:candidate.vendor_id,trade:bid.trade,contact_ids:[candidate.contact_id],awarded_on:input.awarded_on,scope:text(input.award_scope,'Reviewed award scope',2000),amount_cents:award.amount_cents})
 award.subcontract_id=granted.row.id;Object.assign(granted.row,{bid_comparison_award_id:award.id});writes.push(...granted.writes);(job.bid_comparison_awards??=[]).push(award)
 recordApproval(job,actor,'bid.award',{id:award.id,prepared_by:comparison.prepared_by},{award,comparison_id:comparison.id,source_response:candidate.response,review,cost_adjustment:adjustment,missing_scope_flags:flags});return {record:comparison,writes}
}
