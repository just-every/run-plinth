import { find, need, object, stamp, text, type Actor, type Input, type Job } from './model'
import { costs } from './cost-model'
import { fieldConfig } from './report-store'
import { actualEntries } from './cost-ledger'
import { financialId, reportColumns } from './report-records'
import { parseFieldValues, requireFieldsAtStage } from './report-field-model'
import { parseReportView, queryReport, type ReportView } from './report-query'
/** New costs inherit the existing financial schema in an explicitly job-scoped report door. */
export async function costRecords(db:D1Database,job:Job){
 const state=costs(job),config=await fieldConfig(db)
 const rows=[...state.bills.map(b=>({id:b.id,kind:'cost_bill',label:b.reference,stage:b.status,amount:(b.kind==='credit'?-1:1)*b.amount_cents})),...state.sources.map(s=>({id:s.id,kind:'cost_'+s.kind,label:s.reference,stage:s.approved_by?'approved':'draft',amount:s.amount_cents})),...state.forecasts.map(f=>({id:f.id,kind:'cost_forecast',label:f.as_of+' forecast',stage:'recorded',amount:f.final_cents})),...(state.periods??[]).map(p=>({id:p.id,kind:'cost_period',label:p.period+' close',stage:'closed',amount:actualEntries(job).filter(e=>e.period===p.period).reduce((n,e)=>n+e.amount_cents,0)}))]
 const records=rows.map(r=>{const saved=state.record_fields?.[r.id];return {id:financialId(job.id,r.kind,r.id),local_id:r.id,job_id:job.id,record_scope:'financial' as const,label:r.label,currency:'USD' as const,stage:saved?.stage??r.stage,values:{'native.kind':r.kind,'native.stage':r.stage,'native.custom_stage':saved?.stage??null,'native.amount':{currency:'USD' as const,amount_cents:r.amount},...saved?.values}}})
 return {job_id:job.id,records,columns:reportColumns(config.fields,'financial'),fields:config.fields.filter(f=>f.record_scope==='financial')}
}
export async function costFields(db:D1Database,job:Job,id:string,input:Input,stage?:string){
 const config=await fieldConfig(db),saved=costs(job).record_fields?.[id],values=parseFieldValues(input.custom_fields??{},config.fields,'financial','USD',saved?.values??{})
 const nextStage=stage??text(input.stage??saved?.stage??'draft','Custom stage',80);requireFieldsAtStage(config.fields,'financial',nextStage,values)
 ;(costs(job).record_fields??={})[id]={values,stage:nextStage};return {id,values,stage:nextStage}
}
export async function costQuery(db:D1Database,job:Job,actor:Actor,input:Input){const source=await costRecords(db,job),view=parseReportView(input,source.columns,actor.id);need(view.scope.record_scope==='financial','Cost reports use financial record scope');return {job_id:job.id,report:queryReport(source.records,source.columns,view)}}
export async function costView(db:D1Database,job:Job,actor:Actor,input:Input){const source=await costRecords(db,job),view=parseReportView(input,source.columns,actor.id);need(view.scope.record_scope==='financial','Cost views use financial scope');queryReport(source.records,source.columns,view);need(!(costs(job).views??[]).some(v=>v.id===view.id),'View id already exists',409,'immutable');(costs(job).views??=[]).push(view);return view}
export async function runCostView(db:D1Database,job:Job,actor:Actor,id:string){const view=find(costs(job).views??[],id);need(view.sharing==='shared'||view.created_by===actor.id,'View not found',404,'not_found');return {...await costQuery(db,job,actor,view as unknown as Input),view}}
