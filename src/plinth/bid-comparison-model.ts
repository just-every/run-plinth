import type {Stamp} from './model'
import type {BidJob,BidLine,BidResponse} from './bid-model'

export type BidSourceReference = {kind:'price_line';cost_code:string} | {kind:'attachment';attachment_id:string;checksum:string;locator:string}
export interface BidComparedLine {
 cost_code:string;quantity:string|null;unit:string|null;allowance_cents:number|null;tax_cents:number|null;scope:'included'|'missing'|'unclear';original_note:string
 normalized_cents:number;normalization_note:string;evidence:BidSourceReference[]
}
export interface BidReview {
 id:string;candidate_id:string;lines:BidComparedLine[];duration_days:number|null;alternates:{description:string;amount_cents:number|null;note:string}[];exclusions:string;note:string;by:Stamp
 total_cents:number
}
export interface BidCandidate {id:string;invitation_id:string;vendor_id:string;vendor_name:string;contact_id:string;response:BidResponse}
export interface BidComparison {
 id:string;package_id:string;plan_revision_id:string;title:string;scope:string;trade:string;lines:BidLine[];candidates:BidCandidate[];reviews:BidReview[];prepared_by:Stamp
}
export interface BidCostAdjustment {
 id:string;source_key:string;kind:'award'|'cancellation';award_id:string;comparison_id:string;reason:string;by:Stamp
 lines:{cost_code:string;previous_cents:number;allocation_cents:number;commitment_cents:number;delta_cents:number;current_cents:number}[]
}
export interface BidComparisonAward {
 id:string;package_id:string;comparison_id:string;candidate_id:string;review_id:string;subcontract_id:string;amount_cents:number;decision:string;terms_reference:string;by:Stamp;cost_adjustment_id:string
 cancelled?:{reason:string;by:Stamp;cost_adjustment_id:string}
}
export type BidComparisonJob = BidJob & {bid_comparisons?:BidComparison[];bid_cost_adjustments?:BidCostAdjustment[];bid_comparison_awards?:BidComparisonAward[]}
export interface BidComparisonSource {
 id:string;version:number;name:string;packages:{id:string;title:string;revision_id:string;response_count:number}[];comparisons:(BidComparison & {flags:{candidate_id:string;items:string[]}[]})[];awards:BidComparisonAward[];cost_budget:BidCostBudget
 commitments:{id:string;vendor_name:string;scope:string;amount_cents?:number;status?:string}[]
}
export interface BidCostBudget {source_budget_id:string|null;codes:{cost_code:string;frozen_cost_cents:number|null;current_cost_cents:number|null;adjustment_cents:number}[];adjustments:BidCostAdjustment[]}
