import { costLedger } from './cost-ledger'
import { currencyOf, sum, type Job } from './model'
import { scheduleVariance } from './schedule-baseline-model'
import type { ReportColumn, ReportValues } from './report-field-model'

export const portfolioColumns: ReportColumn[] = [
 ['original_budget','Original cost budget','money'],['revised_budget','Revised cost budget','money'],
 ['committed','Committed cost','money'],['actual','Posted actual cost','money'],['forecast','Forecast final cost','money'],
 ['margin','Forecast margin','money'],['billed','Earned billings','money'],['collected','Collections','money'],['backlog','Unbilled sold revenue','money'],
 ['slippage','Maximum schedule slippage (minutes)','number'],['open_decisions','Open decisions','number'],
 ['as_of','Current report date (UTC)','date'],['forecast_stale','Forecast requires review','boolean'],
].map(([id,name,type])=>({id:'portfolio.'+id,name:name!,type:type as ReportColumn['type']}))

/** Current committed source totals. Unknown economics stay unknown rather than becoming zero. */
export function portfolioValues(job: Job): ReportValues {
 const ledger=costLedger(job),currency=currencyOf(job),rows=ledger.rows
 const nullable=(values:(number|null)[])=>values.length&&values.every(n=>n!==null)?sum(values as number[]):null
 const original=nullable(rows.map(r=>r.original_estimate_cents)),revised=nullable(rows.map(r=>r.approved_budget_cents))
 const forecast=ledger.forecast,contract=job.budgets?.at(-1)?.contract_cents??null
 const billed=ledger.totals.client_billed_cents!,collected=ledger.totals.client_collected_cents!
 const values:Record<string,number|null>={original_budget:original,revised_budget:revised,committed:ledger.totals.commitment_cents!,actual:ledger.totals.posted_actual_cents!,forecast:forecast?.final_cents??null,margin:forecast?.margin_cents??null,billed,collected,backlog:contract===null?null:sum([contract,-billed])}
 const result:ReportValues=Object.fromEntries(Object.entries(values).map(([key,value])=>['portfolio.'+key,value===null?null:{currency,amount_cents:value}]))
 const variance=scheduleVariance(job).filter(v=>v.status!=='cancelled').map(v=>v.forecast_finish_variance_minutes).filter((n):n is number=>n!==null)
 result['portfolio.slippage']=variance.length?Math.max(0,...variance):null
 result['portfolio.open_decisions']=(job.selections??[]).filter(s=>s.revisions.at(-1)?.status==='presented').length+job.variations.filter(v=>v.status==='draft').length+(job.rfis??[]).filter(r=>!r.resolved).length
 result['portfolio.as_of']=new Date().toISOString().slice(0,10)
 result['portfolio.forecast_stale']=forecast?forecast.stale??false:null
 return result
}
