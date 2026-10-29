import { cents, need, object, recordApproval, stamp, sum, text, type Actor, type Input, type Job } from './model'
import { costs, costCode, digest, type CostForecast } from './cost-model'
import { actualEntries, costLedger } from './cost-ledger'
import { localDate } from './remittances'
export const forecastThousandths=(value:unknown,name:string)=>{const s=String(value);need(/^\d{1,9}(\.\d{1,3})?$/.test(s),`${name} requires a nonnegative decimal with up to three places`);const [n,f='']=s.split('.');return BigInt(n!)*1000n+BigInt(f.padEnd(3,'0'))}
/** Productivity prices unbought labor only; open procurement commitments enter exactly once. */
export async function previewCostForecast(job:Job,actor:Actor,input:Input):Promise<CostForecast>{
 const ledger=costLedger(job),rows=input.codes
 need(Array.isArray(rows)&&rows.length>0&&rows.length<=100,'Provide one to 100 code assumptions')
 const assumptions=rows.map(value=>{const a=object(value),cost_code=text(a.cost_code,'cost_code',80),source=ledger.rows.find(r=>r.cost_code===cost_code)!,remaining=forecastThousandths(a.remaining_quantity,'remaining_quantity'),minutes=forecastThousandths(a.minutes_per_unit,'minutes_per_unit'),rate=cents(a.labor_hour_cents,'labor_hour_cents'),numerator=remaining*minutes*BigInt(rate),denominator=60_000_000n,labor=cents(Number((numerator*2n+denominator)/(2n*denominator)))
  need(source,'Choose a code present in the current ledger',409,'cost_code')
  const committed=cents(a.outstanding_commitment_cents,'outstanding_commitment_cents');need(committed===source.open_commitment_cents&&committed>=0,'Review the current unconsumed commitments exactly; consumed costs cannot enter again',409,'cost_forecast_stale')
  const pending=cents(a.pending_change_cents??0,'pending_change_cents',true);need(!pending||input.scenario==='pending','Pending cost needs an explicit pending scenario')
  const unbought=cents(a.unbought_cents,'unbought_cents'),risk=cents(a.risk_cents,'risk_cents'),remaining_cents=sum([labor,committed,unbought,risk,pending]);need(remaining_cents>=0,'Remaining cost cannot be negative')
  return {cost_code,remaining_quantity:String(a.remaining_quantity),minutes_per_unit:String(a.minutes_per_unit),labor_hour_cents:rate,labor_cents:labor,outstanding_commitment_cents:committed,unbought_cents:unbought,risk_cents:risk,pending_change_cents:pending,remaining_cents,reference:text(a.reference,'Assumption source',2000)}
 })
 need(new Set(assumptions.map(a=>a.cost_code)).size===assumptions.length,'A code appears once per forecast')
 need(ledger.rows.every(r=>assumptions.some(a=>a.cost_code===r.cost_code)),'Every current cost code requires a reviewed assumption',409,'cost_forecast_incomplete')
 const codes=assumptions.map(a=>{const source=ledger.rows.find(r=>r.cost_code===a.cost_code)!,revenue=job.budgets!.at(-1)!.codes.find(c=>c.cost_code===a.cost_code)?.revenue_cents??0,final=sum([source.posted_actual_cents,a.remaining_cents]);return {cost_code:a.cost_code,actual_cents:source.posted_actual_cents,remaining_cents:a.remaining_cents,final_cents:final,revenue_cents:revenue,margin_cents:sum([revenue,-final]),variance_cents:source.approved_budget_cents===null?null:sum([final,-source.approved_budget_cents])}})
 const row:CostForecast={id:crypto.randomUUID(),source_version:job.version+1,prepared_by:stamp(actor),as_of:localDate(input.as_of,'as_of'),source_digest:await digest({budgets:job.budgets,orders:job.orders,entries:actualEntries(job),sources:costs(job).sources,subcontracts:job.subcontracts,bid_cost_adjustments:job.bid_cost_adjustments,variations:job.variations,schedule_actuals:job.schedule_actuals}),assumptions:{scenario:input.scenario==='pending'?'pending':'approved',codes:assumptions,source_as_of:text(input.source_as_of,'Source freshness reference',2000),label:'Unbought labor productivity, remaining commitments, unbought materials and risk are separate; no consumed commitment is re-added'},codes,final_cents:sum(codes.map(c=>c.final_cents)),remaining_cents:sum(codes.map(c=>c.remaining_cents)),revenue_cents:sum(codes.map(c=>c.revenue_cents)),margin_cents:sum(codes.map(c=>c.margin_cents))}
 return row
}
export async function forecastAction(job:Job,actor:Actor,input:Input):Promise<CostForecast>{
 const row=await previewCostForecast(job,actor,input)
 costs(job).forecasts.push(row);recordApproval(job,actor,'cost.forecast', {id:row.id,prepared_by:row.prepared_by},row);return row
}
