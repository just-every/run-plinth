import { portfolioJobs, type PortfolioScope } from './portfolio-scope'
import { portfolioColumns, portfolioValues } from './portfolio'
import { scheduleVariance } from './schedule-baseline-model'
import { currencyOf, need, type Actor, type Job } from './model'
import type { Customer } from './customer-model'
import type { Vendor } from './vendor-model'
import type { ReportColumn, ReportFieldDefinition, ReportRecordScope, ReportValues } from './report-field-model'
import type { ReportRecord } from './report-query'
import type { Feature } from './role-model'

export interface FieldRecord extends ReportRecord { stage: string; job_id?: string; version: number }
export const financialId = (jobId: string, kind: string, id: string) => `${jobId}:${kind}:${id}`
const canView = (actor: Actor | undefined, feature: Feature) => !actor?.permissions || actor.permissions.matrix[feature].view
const hasFinancial = (actor: Actor | undefined) => !actor?.permissions || actor.permissions.financial
export function reportScopeAllowed(actor: Actor, scope: ReportRecordScope): boolean {
 if (!['owner', 'admin', 'project_manager'].includes(actor.role) || !canView(actor, 'reports')) return false
 if (actor.role === 'project_manager' && scope !== 'job') return false
 if (scope === 'customer' || scope === 'vendor') return canView(actor, 'company')
 if (scope === 'financial') return hasFinancial(actor) && (['estimates', 'orders', 'changes', 'invoices'] as Feature[]).some(feature => canView(actor, feature))
 return true
}
/** Strip values before they reach record reads, saved-view filters, totals or exports. */
export function reportRecordView(record: FieldRecord, columns: ReportColumn[]): FieldRecord {
 const allowed = new Set(columns.map(column => column.id))
 return { ...record, values: Object.fromEntries(Object.entries(record.values).filter(([id]) => allowed.has(id))) }
}
export async function reportRecords(db: D1Database, actor: Actor, scope: ReportRecordScope, definitions?: ReportFieldDefinition[],selection?:PortfolioScope): Promise<FieldRecord[]> {
 need(reportScopeAllowed(actor, scope), 'This report scope is unavailable', 403, 'forbidden')
 if (!definitions) {
  const config = await db.prepare('SELECT data FROM pl_report_config WHERE id=1').first<{data:string}>()
  definitions = JSON.parse(config?.data ?? '[]') as ReportFieldDefinition[]
 }
 const columns = reportColumns(definitions, scope, actor)
 const saved = (await db.prepare('SELECT record_id,version,stage,data FROM pl_report_values WHERE record_scope=?').bind(scope).all<{record_id:string;version:number;stage:string;data:string}>()).results
 const values = new Map(saved.map(s => [s.record_id, s]))
 const attach = (r: Omit<FieldRecord,'version'>): FieldRecord => { const saved = selection?.snapshot_id ? undefined : values.get(r.id); return reportRecordView({ ...r, stage: saved?.stage ?? r.stage, version: saved?.version ?? 0, values: { ...r.values, 'native.custom_stage':saved?.stage??null, ...JSON.parse(saved?.data ?? '{}') as ReportValues } }, columns) }
 if (scope === 'customer' || scope === 'vendor') {
  const rows = (await db.prepare(scope === 'customer' ? 'SELECT data FROM pl_customers' : 'SELECT data FROM pl_vendors').all<{data:string}>()).results
  return rows.map(row => { const r = JSON.parse(row.data) as Customer | Vendor; return attach({ id:r.id, record_scope:scope, label:r.name, stage:r.kind, values:{ 'native.kind':r.kind } }) })
 }
 const captured=await portfolioJobs(db,actor,selection),all=captured.map(r=>r.job)
 if (scope === 'job') return all.map(j => attach({ id:j.id, job_id:j.id, record_scope:scope, label:j.name, currency:currencyOf(j), stage:j.status, values:{ 'native.stage':j.status, 'native.delayed':j.schedule_baselines?.length ? scheduleVariance(j).some(v => (v.forecast_finish_variance_minutes ?? 0) > 0) : null, 'native.contract':{ amount_cents:(j.quotes.find(q=>q.status==='accepted')?.total_cents ?? 0)+j.variations.filter(v=>v.status==='approved').reduce((n,v)=>n+v.amount_cents,0),currency:currencyOf(j) },...portfolioValues(j,selection,captured.find(r=>r.job.id===j.id)!.captured_at) } }))
 return all.flatMap(j => [
  ...(canView(actor,'estimates') ? j.quotes : []).map(q=>({id:q.id,kind:'quote',label:`${j.name}: quote ${q.revision}`,stage:q.status,amount:q.total_cents})),
  ...(canView(actor,'orders') ? j.orders : []).map(o=>({id:o.id,kind:'order',label:`${j.name}: ${o.description}`,stage:o.status,amount:o.amount_cents})),
  ...(canView(actor,'invoices') ? j.remittances??[] : []).map(r=>({id:r.id,kind:'remittance',label:`${j.name}: ${r.reference}`,stage:r.returned?'returned':'recorded',amount:r.amount_cents})),
  ...(canView(actor,'invoices') ? j.invoices??[] : []).map(i=>({id:i.id,kind:'invoice',label:`${j.name}: ${i.description}`,stage:i.status,amount:i.amount_cents})),
  ...(canView(actor,'invoices') ? j.claims : []).map(c=>({id:c.id,kind:'claim',label:`${j.name}: ${c.description}`,stage:c.status,amount:c.reconciliation.current_cents})),
  ...(canView(actor,'changes') ? j.variations : []).map(v=>({id:v.id,kind:'variation',label:`${j.name}: ${v.description}`,stage:v.status,amount:v.amount_cents})),
  ...(canView(actor,'orders') ? j.subcontracts??[] : []).flatMap(s=>(s.draws??[]).map(d=>({id:d.id,kind:'subcontract_draw',label:`${j.name}: ${s.vendor_name} draw ${d.number}`,stage:d.payment?'payment_recorded':'requested',amount:d.amount_cents}))),
  ...(canView(actor,'orders') ? j.subcontracts??[] : []).map(s=>({id:s.id,kind:'subcontract',label:`${j.name}: ${s.vendor_name}`,stage:s.status??'not_recorded',amount:s.amount_cents ?? null})),
 ].map(r=>attach({id:financialId(j.id,r.kind,r.id),job_id:j.id,record_scope:'financial',label:r.label,currency:currencyOf(j),stage:r.stage,values:{'native.kind':r.kind,'native.stage':r.stage,'native.amount':r.amount===null?null:{amount_cents:r.amount,currency:currencyOf(j)}}})))
}
export function reportColumns(definitions: ReportFieldDefinition[], scope: ReportRecordScope, actor?: Actor): ReportColumn[] {
 const native:ReportColumn[] = scope === 'job' ? [{id:'native.stage',name:'Job status',type:'text'},{id:'native.delayed',name:'Delayed against baseline',type:'boolean'},{id:'native.contract',name:'Contract',type:'money'}] : scope === 'financial' ? [{id:'native.kind',name:'Record kind',type:'text'},{id:'native.stage',name:'Record status',type:'text'},{id:'native.amount',name:'Amount',type:'money'}] : [{id:'native.kind',name:'Record kind',type:'text'}]
 const columns: ReportColumn[] = [...native,...(scope==='job'?portfolioColumns:[]),{id:'native.custom_stage',name:'Custom stage',type:'text'},...definitions.filter(d=>d.record_scope===scope)]
 return columns.filter(column => {
  if (column.id.startsWith('portfolio.')) {
   if (column.id === 'portfolio.slippage') return canView(actor,'schedule')
   if (column.id === 'portfolio.as_of') return true
   if (column.id === 'portfolio.open_decisions') return hasFinancial(actor) && canView(actor,'selections') && canView(actor,'changes') && canView(actor,'documents')
   if (!hasFinancial(actor) || !(['budgets','estimates','changes','bills','orders','invoices'] as Feature[]).every(feature=>canView(actor,feature))) return false
  }
  if (column.type === 'money' && !hasFinancial(actor)) return false
  if (column.id === 'native.contract') return canView(actor,'budgets') && canView(actor,'estimates') && canView(actor,'changes')
  if (column.id === 'native.delayed') return canView(actor,'schedule')
  return true
 })
}
