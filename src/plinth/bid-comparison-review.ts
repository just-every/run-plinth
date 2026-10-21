import {cents,find,need,object,stamp,sum,text,type Actor,type Input} from './model'
import type {BidCandidate,BidComparedLine,BidComparison,BidComparisonJob,BidReview,BidSourceReference} from './bid-comparison-model'

export function bidComparisonFlags(comparison:BidComparison,candidate:BidCandidate,review?:BidReview){return comparison.lines.flatMap(line=>{const original=candidate.response.items.find(i=>i.cost_code===line.cost_code),interpreted=review?.lines.find(l=>l.cost_code===line.cost_code);return [...(!original?[line.cost_code+': no original price line']:[]),...(!interpreted?[line.cost_code+': interpretation pending']:interpreted.scope!=='included'?[line.cost_code+': '+interpreted.scope]:[])]})}
export function currentBidComparison(job:BidComparisonJob,comparison:BidComparison){const bid=find(job.bids??[],comparison.package_id);need(bid.revisions.at(-1)?.id===comparison.plan_revision_id,'A newer plan revision needs a new comparison',409,'bid_comparison_stale');return bid}
function nullableCents(value:unknown,name:string){return value===null?null:cents(value,name)}
function evidence(value:unknown,candidate:BidCandidate):BidSourceReference[]{
 need(Array.isArray(value)&&value.length>0&&value.length<=10,'Reference at least one original price line or exact attachment for each interpretation')
 return value.map(raw=>{const ref=object(raw);if(ref.kind==='price_line'){const cost_code=text(ref.cost_code,'Original price-line cost code',40);need(candidate.response.items.some(i=>i.cost_code===cost_code),'Original price line not found');return {kind:'price_line' as const,cost_code}}
  need(ref.kind==='attachment','Reference an original price line or attachment');const file=find(candidate.response.attachments,text(ref.attachment_id,'Original attachment',100));need(ref.checksum===file.checksum,'Reference the exact original attachment checksum',409,'bid_evidence');return {kind:'attachment' as const,attachment_id:file.id,checksum:file.checksum,locator:text(ref.locator,'Original page / section',500)}
 })
}
export function reviewBidComparison(comparison:BidComparison,actor:Actor,input:Input){
 const candidate=find(comparison.candidates,text(input.candidate_id,'Candidate',100));need(input.confirm===true,'Confirm a person reviewed these interpretations against the referenced originals')
 need(input.response_id===candidate.response.id,'Review the exact original bid response',409,'bid_evidence')
 need(Array.isArray(input.lines)&&input.lines.length===comparison.lines.length,'Interpret and normalize every package code, including missing scope')
 const lines:BidComparedLine[]=input.lines.map(raw=>{const line=object(raw),cost_code=text(line.cost_code,'Cost code',40);need(comparison.lines.some(l=>l.cost_code===cost_code),'Choose a code in this comparison');need(['included','missing','unclear'].includes(String(line.scope)),'Record included, missing or unclear scope')
  const quantity=line.quantity===null?null:text(line.quantity,'Original quoted quantity',50);need(quantity===null||/^\d{1,12}(\.\d{1,6})?$/.test(quantity)&&Number(quantity)>0,'Original quantity must be positive, or explicitly not stated')
  const unit=line.unit===null?null:text(line.unit,'Original quoted unit',80);need((quantity===null)===(unit===null),'Record both original quantity and unit, or mark both not stated')
  return {cost_code,quantity,unit,allowance_cents:nullableCents(line.allowance_cents,'Original allowance'),tax_cents:nullableCents(line.tax_cents,'Original tax'),scope:line.scope as BidComparedLine['scope'],original_note:text(line.original_note,'Source interpretation / missing-scope note',4000),normalized_cents:cents(line.normalized_cents,'Normalized comparison amount'),normalization_note:text(line.normalization_note,'Normalization rationale',4000),evidence:evidence(line.evidence,candidate)}
 })
 need(new Set(lines.map(l=>l.cost_code)).size===lines.length,'Interpret each package code once')
 const duration=input.duration_days;need(duration===null||typeof duration==='number'&&Number.isSafeInteger(duration)&&duration>=0&&duration<=3650,'Duration must be whole days within 3650 or explicitly not stated')
 need(Array.isArray(input.alternates)&&input.alternates.length<=30,'Record up to 30 quoted alternates, or an empty list')
 const alternates=input.alternates.map(raw=>{const a=object(raw);return {description:text(a.description,'Original alternate',1000),amount_cents:nullableCents(a.amount_cents,'Quoted alternate amount'),note:text(a.note,'Alternate interpretation / source note',2000)}})
 const review:BidReview={id:crypto.randomUUID(),candidate_id:candidate.id,lines,duration_days:duration as number|null,alternates,exclusions:text(input.exclusions,'Reviewed exclusions / not stated',8000),note:text(input.note,'Review evidence and normalization basis',8000),by:stamp(actor),total_cents:sum(lines.map(l=>l.normalized_cents))}
 need(comparison.reviews.length<200,'At most 200 append-only comparison reviews');comparison.reviews.push(review);return review
}
