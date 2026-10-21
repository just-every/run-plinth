import {find,need,stamp,sum,type Actor} from './model'
import type {BidComparisonAward,BidComparisonJob,BidCostAdjustment,BidCostBudget} from './bid-comparison-model'

/** Internal cost plan overlays source-keyed approved adjustments; client selling/billing revisions stay frozen. */
export function bidCostBudget(job:BidComparisonJob):BidCostBudget {
 const budget=job.budgets?.at(-1),adjustments=job.bid_cost_adjustments??[]
 return {source_budget_id:budget?.id??null,codes:(budget?.codes??[]).map(code=>{const delta=sum(adjustments.flatMap(a=>a.lines.filter(l=>l.cost_code===code.cost_code).map(l=>l.delta_cents)));return {cost_code:code.cost_code,frozen_cost_cents:code.cost_cents,current_cost_cents:code.cost_cents===null?null:sum([code.cost_cents,delta]),adjustment_cents:delta}}),adjustments}
}
export function bidAdjustCosts(job:BidComparisonJob,actor:Actor,award:BidComparisonAward,items:{cost_code:string;amount_cents:number}[],allocations:{cost_code:string;amount_cents:number;expected_cost_cents:number}[],reason:string){
 const budget=bidCostBudget(job);need(budget.source_budget_id,'Accept a costed quote before awarding a bid',409,'bid_budget')
 need(new Set(items.map(i=>i.cost_code)).size===items.length,'Award cost codes must be unique')
 need(allocations.length===items.length&&new Set(allocations.map(a=>a.cost_code)).size===items.length&&allocations.every(a=>items.some(i=>i.cost_code===a.cost_code)),'Review the existing budget allocation for every awarded cost code')
 const lines=items.map(item=>{const code=budget.codes.find(c=>c.cost_code===item.cost_code);need(code&&code.current_cost_cents!==null,'The internal budget must have a known cost for every awarded code; record costed source economics first',409,'bid_budget_unknown');const allocation=allocations.find(a=>a.cost_code===item.cost_code)!;need(allocation.expected_cost_cents===code.current_cost_cents,'The reviewed internal cost baseline changed',409,'bid_budget_stale');need(allocation.amount_cents<=code.current_cost_cents,'The package allocation exceeds the current internal code cost',409,'bid_budget_allocation');const delta=sum([item.amount_cents,-allocation.amount_cents]);return {cost_code:item.cost_code,previous_cents:code.current_cost_cents,allocation_cents:allocation.amount_cents,commitment_cents:item.amount_cents,delta_cents:delta,current_cents:sum([code.current_cost_cents,delta])}})
 const adjustment:BidCostAdjustment={id:crypto.randomUUID(),source_key:'bid-award:'+award.id,kind:'award',award_id:award.id,comparison_id:award.comparison_id,reason,by:stamp(actor),lines}
 need(!(job.bid_cost_adjustments??[]).some(a=>a.source_key===adjustment.source_key),'Award already adjusted the cost budget',409,'immutable');(job.bid_cost_adjustments??=[]).push(adjustment);award.cost_adjustment_id=adjustment.id;return adjustment
}
export function bidReverseCosts(job:BidComparisonJob,actor:Actor,award:BidComparisonAward,reason:string){
 const original=find(job.bid_cost_adjustments??[],award.cost_adjustment_id),current=bidCostBudget(job)
 const lines=original.lines.map(line=>{const code=current.codes.find(c=>c.cost_code===line.cost_code);need(code&&code.current_cost_cents!==null,'Current internal code cost is unknown; settle the cost plan before cancelling',409,'bid_budget_unknown');const next=sum([code.current_cost_cents,-line.delta_cents]);need(next>=0,'The revised cost budget cannot absorb this reversal; settle the cost plan first',409,'bid_budget_allocation');return {...line,previous_cents:code.current_cost_cents,delta_cents:-line.delta_cents,current_cents:next}})
 const reversal:BidCostAdjustment={id:crypto.randomUUID(),source_key:'bid-cancel:'+award.id,kind:'cancellation',award_id:award.id,comparison_id:award.comparison_id,reason,by:stamp(actor),lines}
 need(!(job.bid_cost_adjustments??[]).some(a=>a.source_key===reversal.source_key),'Award cancellation already adjusted the cost budget',409,'immutable');(job.bid_cost_adjustments??=[]).push(reversal);return reversal
}
