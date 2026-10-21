import { scheduleVariance } from './schedule-baseline-model'
import { jobs } from './store'
import { currencyOf, need, type Actor, type Job } from './model'
import type { Customer } from './customer-model'
import type { Vendor } from './vendor-model'
import type { ReportColumn, ReportFieldDefinition, ReportRecordScope, ReportValues } from './report-field-model'
import type { ReportRecord } from './report-query'

export interface FieldRecord extends ReportRecord { stage: string; job_id?: string; version: number }
export const financialId = (jobId: string, kind: string, id: string) => `${jobId}:${kind}:${id}`
export async function reportRecords(db: D1Database, actor: Actor, scope: ReportRecordScope): Promise<FieldRecord[]> {
 need(actor.role !== 'project_manager' || scope === 'job', 'Project managers query assigned jobs only', 403, 'forbidden')
 const saved = (await db.prepare('SELECT record_id,version,stage,data FROM pl_report_values WHERE record_scope=?').bind(scope).all<{record_id:string;version:number;stage:string;data:string}>()).results
 const values = new Map(saved.map(s => [s.record_id, s]))
 const attach = (r: Omit<FieldRecord,'version'>): FieldRecord => { const saved = values.get(r.id); return { ...r, stage: saved?.stage ?? r.stage, version: saved?.version ?? 0, values: { ...r.values, 'native.custom_stage':saved?.stage??null, ...JSON.parse(saved?.data ?? '{}') as ReportValues } } }
 if (scope === 'customer' || scope === 'vendor') {
  const rows = (await db.prepare(scope === 'customer' ? 'SELECT data FROM pl_customers' : 'SELECT data FROM pl_vendors').all<{data:string}>()).results
  return rows.map(row => { const r = JSON.parse(row.data) as Customer | Vendor; return attach({ id:r.id, record_scope:scope, label:r.name, stage:r.kind, values:{ 'native.kind':r.kind } }) })
 }
 const all = (await jobs(db)).filter(j => actor.role !== 'project_manager' || actor.team!.job_ids.includes(j.id))
 if (scope === 'job') return all.map(j => attach({ id:j.id, job_id:j.id, record_scope:scope, label:j.name, currency:currencyOf(j), stage:j.status, values:{ 'native.stage':j.status, 'native.delayed':j.schedule_baselines?.length ? scheduleVariance(j).some(v => (v.forecast_finish_variance_minutes ?? 0) > 0) : null, 'native.contract':{ amount_cents:(j.quotes.find(q=>q.status==='accepted')?.total_cents ?? 0)+j.variations.filter(v=>v.status==='approved').reduce((n,v)=>n+v.amount_cents,0),currency:currencyOf(j) } } }))
 return all.flatMap(j => [
  ...j.quotes.map(q=>({id:q.id,kind:'quote',label:`${j.name}: quote ${q.revision}`,stage:q.status,amount:q.total_cents})),
  ...j.orders.map(o=>({id:o.id,kind:'order',label:`${j.name}: ${o.description}`,stage:o.status,amount:o.amount_cents})),
  ...(j.remittances??[]).map(r=>({id:r.id,kind:'remittance',label:`${j.name}: ${r.reference}`,stage:r.returned?'returned':'recorded',amount:r.amount_cents})),
  ...(j.invoices??[]).map(i=>({id:i.id,kind:'invoice',label:`${j.name}: ${i.description}`,stage:i.status,amount:i.amount_cents})),
  ...j.claims.map(c=>({id:c.id,kind:'claim',label:`${j.name}: ${c.description}`,stage:c.status,amount:c.reconciliation.current_cents})),
  ...j.variations.map(v=>({id:v.id,kind:'variation',label:`${j.name}: ${v.description}`,stage:v.status,amount:v.amount_cents})),
  ...(j.subcontracts ?? []).flatMap(s=>(s.draws??[]).map(d=>({id:d.id,kind:'subcontract_draw',label:`${j.name}: ${s.vendor_name} draw ${d.number}`,stage:d.payment?'payment_recorded':'requested',amount:d.amount_cents}))),
  ...(j.subcontracts ?? []).map(s=>({id:s.id,kind:'subcontract',label:`${j.name}: ${s.vendor_name}`,stage:s.status??'not_recorded',amount:s.amount_cents ?? null})),
 ].map(r=>attach({id:financialId(j.id,r.kind,r.id),job_id:j.id,record_scope:'financial',label:r.label,currency:currencyOf(j),stage:r.stage,values:{'native.kind':r.kind,'native.stage':r.stage,'native.amount':r.amount===null?null:{amount_cents:r.amount,currency:currencyOf(j)}}})))
}
export function reportColumns(definitions: ReportFieldDefinition[], scope: ReportRecordScope): ReportColumn[] {
 const native:ReportColumn[] = scope === 'job' ? [{id:'native.stage',name:'Job status',type:'text'},{id:'native.delayed',name:'Delayed against baseline',type:'boolean'},{id:'native.contract',name:'Contract',type:'money'}] : scope === 'financial' ? [{id:'native.kind',name:'Record kind',type:'text'},{id:'native.stage',name:'Record status',type:'text'},{id:'native.amount',name:'Amount',type:'money'}] : [{id:'native.kind',name:'Record kind',type:'text'}]
 return [...native,{id:'native.custom_stage',name:'Custom stage',type:'text'},...definitions.filter(d=>d.record_scope===scope)]
}
