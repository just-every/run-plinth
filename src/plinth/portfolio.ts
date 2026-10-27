import type { PortfolioScope } from './portfolio-scope'
import { costLedger } from './cost-ledger'
import { currencyOf, sum, type Job } from './model'
import { scheduleVariance } from './schedule-baseline-model'
import type { ReportColumn, ReportValues } from './report-field-model'

export const portfolioColumns: ReportColumn[] = [
 ['original_budget','Original cost budget','money'],['revised_budget','Revised cost budget','money'],
 ['committed','Committed cost','money'],['actual','Posted actual cost','money'],['forecast','Forecast final cost','money'],
 ['margin','Forecast margin','money'],['billed','Earned billings','money'],['collected','Collections','money'],['backlog','Unbilled sold revenue','money'],
 ['slippage','Maximum schedule slippage (minutes)','number'],['open_decisions','Open decisions','number'],
 ['as_of','Report as-of date (UTC)','date'],['forecast_stale','Forecast requires review','boolean'],
].map(([id,name,type])=>({id:'portfolio.'+id,name:name!,type:type as ReportColumn['type']}))

/** Current committed source totals. Unknown economics stay unknown rather than becoming zero. */
export function portfolioSources(job:Job,selection?:PortfolioScope){
 const ledger=costLedger(job),dated=(date:string|null|undefined)=>!selection?.source_from&&!selection?.source_to||!!date&&(!selection?.source_from||date>=selection.source_from)&&(!selection?.source_to||date<=selection.source_to)
 const rows=ledger.rows.filter(r=>!selection?.cost_code||r.cost_code===selection.cost_code).map(row=>{
  const sources={...row.sources,actual:row.sources.actual.filter(r=>dated(r.dated_on)),procurement:row.sources.procurement.filter(r=>dated(r.dated_on)),billing:row.sources.billing.filter(r=>dated(r.dated_on)),budgets:row.sources.budgets.filter(r=>dated(job.budgets?.find(b=>b.id===r.id)?.recorded_by.at.slice(0,10)))}
  return {...row,original_estimate_cents:sources.budgets.find(b=>b.revision===job.budgets?.[0]?.revision)?.code?.cost_cents??null,approved_budget_cents:sources.budgets.some(b=>b.id===job.budgets?.at(-1)?.id)?row.approved_budget_cents:null,
   commitment_cents:sum(sources.procurement.filter(r=>r.kind==='commitment').map(r=>r.amount_cents)),posted_actual_cents:sum(sources.actual.map(r=>r.amount_cents)),
   client_billed_cents:sum(sources.billing.filter(r=>r.kind==='billed').map(r=>r.amount_cents)),client_collected_cents:sum(sources.billing.filter(r=>r.kind==='collected').map(r=>r.amount_cents)),sources}
 })
 const forecast=ledger.forecast&&dated(ledger.forecast.as_of)?{...ledger.forecast,codes:(ledger.forecast.codes??[]).filter(c=>!selection?.cost_code||c.cost_code===selection.cost_code)}:null
 return {...ledger,rows,forecast}
}
export function portfolioValues(job: Job,selection?:PortfolioScope,asOf=new Date(Date.now()).toISOString()): ReportValues {
 const ledger=portfolioSources(job,selection),currency=currencyOf(job),rows=ledger.rows
 const nullable=(values:(number|null)[])=>values.length&&values.every(n=>n!==null)?sum(values as number[]):null
 const original=nullable(rows.map(r=>r.original_estimate_cents)),revised=nullable(rows.map(r=>r.approved_budget_cents))
 const forecast=ledger.forecast,budget=job.budgets?.at(-1),contract=budget&&rows.some(r=>r.sources.budgets.some(b=>b.id===budget.id))?sum(budget.codes.filter(c=>rows.some(r=>r.cost_code===c.cost_code)).map(c=>c.revenue_cents)):!selection?.cost_code&&!selection?.source_from&&!selection?.source_to?sum([job.quotes.find(q=>q.status==='accepted')?.total_cents??0,...job.variations.filter(v=>v.status==='approved').map(v=>v.amount_cents)]):null
 const billed=sum(rows.map(r=>r.client_billed_cents)),collected=sum(rows.map(r=>r.client_collected_cents))
 const final=forecast?sum(forecast.codes.map(c=>c.final_cents)):null,margin=forecast?sum(forecast.codes.map(c=>c.margin_cents)):null
 const values:Record<string,number|null>={original_budget:original,revised_budget:revised,committed:sum(rows.map(r=>r.commitment_cents)),actual:sum(rows.map(r=>r.posted_actual_cents)),forecast:final,margin,billed,collected,backlog:contract===null?null:sum([contract,-billed])}
 const result:ReportValues=Object.fromEntries(Object.entries(values).map(([key,value])=>['portfolio.'+key,value===null?null:{currency,amount_cents:value}]))
 const variance=portfolioScheduleSources(job,selection).map(v=>v.forecast_finish_variance_minutes).filter((n):n is number=>n!==null)
 result['portfolio.slippage']=variance.length?Math.max(0,...variance):null
 result['portfolio.open_decisions']=portfolioDecisionSources(job,selection).length
 result['portfolio.as_of']=asOf.slice(0,10)
 result['native.contract']=contract===null?null:{currency,amount_cents:contract}
 result['portfolio.forecast_stale']=forecast?forecast.stale??false:null
 return result
}

const sourceDate=(date:string,selection?:PortfolioScope)=>(!selection?.source_from||date>=selection.source_from)&&(!selection?.source_to||date<=selection.source_to)
export function portfolioScheduleSources(job:Job,selection?:PortfolioScope){
 return scheduleVariance(job).filter(v=>v.status!=='cancelled'&&sourceDate(v.forecast_start.slice(0,10),selection)&&(!selection?.trade||job.schedules.find(s=>s.id===v.task_id)?.trade.toLocaleLowerCase('en-US')===selection.trade.toLocaleLowerCase('en-US')))
}
export function portfolioDecisionSources(job:Job,selection?:PortfolioScope){
 const rows=[
  ...(job.selections??[]).flatMap(s=>{const r=s.revisions.at(-1);return r?.status==='presented'?[{kind:'selection',id:s.id,cost_code:r.cost_code,dated_on:r.prepared_by.at.slice(0,10)}]:[]}),
  ...job.variations.filter(v=>v.status==='draft').map(v=>({kind:'variation',id:v.id,cost_code:v.pricing?.base_lines.map(l=>l.cost_code??'Unassigned').join(',')??'Unassigned',dated_on:v.prepared_by.at.slice(0,10)})),
  ...(job.rfis??[]).filter(r=>!r.resolved).map(r=>({kind:'rfi',id:r.id,cost_code:r.cost_code??'Unassigned',dated_on:r.by.at.slice(0,10)}))
 ]
 return rows.filter(r=>sourceDate(r.dated_on,selection)&&(!selection?.cost_code||r.cost_code.split(',').includes(selection.cost_code)))
}
