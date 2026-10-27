import { portfolioJobs, parsePortfolioScope, type PortfolioScope } from './portfolio-scope'
import { portfolioSources, portfolioValues, portfolioScheduleSources, portfolioDecisionSources } from './portfolio'
import { reportXlsx } from './report-xlsx'
import { need, object, text, type Actor, type Input } from './model'
import { readClock, transaction } from './store'
import { reportScope, type ReportRecordScope } from './report-field-model'
import { fieldConfig, reportAudit, saveField, saveValues } from './report-store'
import { reportColumns, reportRecords, reportScopeAllowed, type FieldRecord } from './report-records'
import { parseReportView, queryReport, reportCsv, type ReportView } from './report-query'
import { reportPdf } from './report-pdf'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
export async function reportsResponse(request:Request,db:D1Database,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>):Promise<Response|null> {
 if(parts[0]!=='reports')return null
 need(['owner','admin','project_manager'].includes(actor.role),'Custom fields, queries and exports are office-only',403,'forbidden')
 const method=request.method, url=new URL(request.url), config=await fieldConfig(db)
 need(!actor.permissions || actor.permissions.matrix.reports.view,'Reports are unavailable',403,'forbidden')
 const scopes = (['job','customer','vendor','financial'] as ReportRecordScope[]).filter(scope=>reportScopeAllowed(actor,scope))
 const fieldVisible=(field:typeof config.fields[number])=>scopes.includes(field.record_scope)&&reportColumns([field],field.record_scope,actor).some(column=>column.id===field.id)
 const visibleFields=config.fields.filter(fieldVisible)
 const allowedScope = (value: unknown) => { const scope=reportScope(value);need(scopes.includes(scope),'This report scope is unavailable',403,'forbidden');return scope }
 const records=new Map<ReportRecordScope,Promise<FieldRecord[]>>()
 const recordsFor=(scope:ReportRecordScope)=>{let found=records.get(scope);if(!found){found=reportRecords(db,actor,scope,config.fields);records.set(scope,found)}return found}
 const office=actor.role==='owner'||actor.role==='admin'
 const canCreate=!actor.permissions||actor.permissions.matrix.reports.create
 const canEdit=!actor.permissions||actor.permissions.matrix.reports.edit
 const checkSelection=(selection?:PortfolioScope)=>{need(!selection||!Object.keys(selection).length||reportColumns(visibleFields,'job',actor).some(c=>c.id==='portfolio.actual'),'Portfolio source selection requires financial visibility',403,'forbidden');need(!selection?.trade||reportColumns(visibleFields,'job',actor).some(c=>c.id==='native.delayed'),'Trade selection requires schedule visibility',403,'forbidden')}
 const run=async(view:ReportView)=>{checkSelection(view.portfolio);return queryReport(await reportRecords(db,actor,view.scope.record_scope,config.fields,view.portfolio),reportColumns(visibleFields,view.scope.record_scope,actor),view)}
 if(parts.length===2&&parts[1]==='snapshots'){
  need(reportColumns(visibleFields,'job',actor).some(c=>c.id==='portfolio.actual'),'Financial snapshots are unavailable',403,'forbidden')
  if(method==='GET'){
   const authorized=new Set((await recordsFor('job')).map(r=>r.id)),rows=(await db.prepare('SELECT snapshot_id,job_id,name,captured_at FROM pl_portfolio_snapshots ORDER BY captured_at DESC,rowid DESC').all<{snapshot_id:string;job_id:string;name:string;captured_at:string}>()).results
   const snapshots=[...new Map(rows.filter(r=>authorized.has(r.job_id)).map(r=>[r.snapshot_id,{id:r.snapshot_id,name:r.name,captured_at:r.captured_at}])).values()]
   const available=await portfolioJobs(db,actor),assigned=new Set(available.flatMap(r=>r.manager_ids))
   const people=(await db.prepare("SELECT id,display_name FROM oa_operators WHERE status='active'").all<{id:string;display_name:string}>()).results
   return json({snapshots,managers:people.filter(p=>assigned.has(p.id)).map(p=>({id:p.id,name:p.display_name}))})
  }
  need(method==='POST'&&office&&canCreate,'Only authorized owners and administrators capture portfolios',403,'forbidden')
  const clock=await readClock(db),input=await body(request),name=text(input.name,'Snapshot name',100),id=crypto.randomUUID(),captured_at=new Date(Date.now()).toISOString(),rows=await portfolioJobs(db,actor)
  need(rows.length,'Create a job before capturing a portfolio')
  await transaction(db,actor,null,[...rows.map(row=>db.prepare('INSERT INTO pl_portfolio_snapshots(snapshot_id,job_id,name,captured_at,data) VALUES(?,?,?,?,?)').bind(id,row.job.id,name,captured_at,JSON.stringify({...row,captured_at}))),reportAudit(db,actor,'snapshot',null,{id,name,captured_at,job_ids:rows.map(r=>r.job.id)})],clock)
  return json({snapshot:{id,name,captured_at}},201)
 }
 if(parts.length===2&&parts[1]==='schema'&&method==='GET')return json({version:config.version,fields:visibleFields,scopes,capabilities:{define_fields:office&&canCreate,share_views:office,create_views:canCreate,edit_values:canEdit,money_fields:!actor.permissions||actor.permissions.financial}})
 if(parts.length===2&&parts[1]==='fields'&&method==='POST'){
  need(office&&canCreate,'Only authorized owners and administrators define custom fields',403,'forbidden')
  const input=await body(request),previous=config.fields.find(field=>field.id===input.id)
  need(!previous||canEdit,'Editing field definitions is unavailable',403,'forbidden')
  allowedScope(input.record_scope??previous?.record_scope)
  need(!actor.permissions||actor.permissions.financial||(input.type??previous?.type)!=='money','Money fields require financial visibility',403,'forbidden')
  const saved=await saveField(db,actor,input)
  return json({...saved,fields:saved.fields.filter(fieldVisible)},201)
 }
 if(parts.length===3&&parts[1]==='job-sources'&&method==='GET'){
  const columns=reportColumns(visibleFields,'job',actor)
  const financial=columns.some(c=>c.id==='portfolio.actual'),schedule=columns.some(c=>c.id==='portfolio.slippage'),decisions=columns.some(c=>c.id==='portfolio.open_decisions')
  need(financial||schedule||decisions,'Source records are unavailable',403,'forbidden')
  const selection=parsePortfolioScope(url.searchParams.has('portfolio')?JSON.parse(url.searchParams.get('portfolio')!):undefined)
  checkSelection(selection)
  const captured=(await portfolioJobs(db,actor,selection)).find(r=>r.job.id===parts[2]);need(captured,'Job not found',404,'not_found')
  const job=captured.job,ledger=portfolioSources(job,selection)
  const source={as_of:captured.captured_at,selection:selection??null,job_id:job.id,source_version:job.version,currency:ledger.currency,values:Object.fromEntries(Object.entries(portfolioValues(job,selection,captured.captured_at)).filter(([id])=>columns.some(c=>c.id===id))),schedule:schedule?portfolioScheduleSources(job,selection):undefined,open_decisions:decisions?portfolioDecisionSources(job,selection):undefined,rows:financial?ledger.rows:undefined,forecast:financial&&ledger.forecast?{id:ledger.forecast.id,as_of:ledger.forecast.as_of,codes:ledger.forecast.codes,stale:ledger.forecast.stale}:null,label:ledger.label}
  await transaction(db,actor,null,[reportAudit(db,actor,'export',null,{job_id:job.id,format:'json',source_version:job.version})])
  return new Response(JSON.stringify(source,null,2),{headers:{...headers,'content-type':'application\u002fjson','content-disposition':'attachment; filename=portfolio-job-sources.json'}})
 }
 if(parts.length===2&&parts[1]==='records'&&method==='GET'){
  const scope=allowedScope(url.searchParams.get('record_scope'));return json({records:await recordsFor(scope),columns:reportColumns(visibleFields,scope,actor)})
 }
 if(parts[1]==='values'&&parts.length===4){const scope=allowedScope(parts[2]),id=text(parts[3],'record id',300)
  if(method==='PUT')return json({record:await saveValues(db,actor,scope,id,await body(request))})
  if(method==='GET'){const record=(await recordsFor(scope)).find(r=>r.id===id);need(record,'Record not found',404,'not_found');return json({record})}
 }
 const all=(await db.prepare('SELECT id,version,data FROM pl_report_views ORDER BY rowid DESC').all<{id:string;version:number;data:string}>()).results.map(r=>({version:r.version,view:JSON.parse(r.data) as ReportView}))
 const canRead=async(view:ReportView)=> {
  if(!(view.sharing==='shared'||view.created_by===actor.id)||!scopes.includes(view.scope.record_scope))return false
  const columns=reportColumns(visibleFields,view.scope.record_scope,actor),ids=new Set(columns.map(column=>column.id))
  if(view.portfolio&&Object.keys(view.portfolio).length&&!columns.some(c=>c.id==='portfolio.actual'))return false
  if(view.portfolio?.trade&&!columns.some(c=>c.id==='native.delayed'))return false
  if(!view.selected_columns.every(id=>ids.has(id))||!view.filters.every(filter=>ids.has(filter.column_id)))return false
  if(view.scope.record_ids!==null){const available=new Set((await recordsFor(view.scope.record_scope)).map(record=>record.id));if(!view.scope.record_ids.every(id=>available.has(id)))return false}
  return true
 }
 if(parts.length===2&&parts[1]==='views'&&method==='GET'){
  const readable=await Promise.all(all.map(async row=>await canRead(row.view)?row:null))
  return json({views:readable.filter(row=>row!==null)})
 }
 if(parts.length===2&&parts[1]==='query'&&method==='POST'){
  const input=await body(request),scope=allowedScope(object(input.scope).record_scope),columns=reportColumns(visibleFields,scope,actor),view=parseReportView(input,columns,actor.id)
  return json({report:await run(view)})
 }
 if(parts[1]==='views'&&(parts.length===2&&method==='POST'||parts.length===3&&method==='PUT')){
  const clock=await readClock(db),input=await body(request),previous=parts.length===3?all.find(r=>r.view.id===parts[2]):undefined
  if(parts.length===3)need(previous&&await canRead(previous.view),'View not found',404,'not_found')
  need(!previous||previous.view.created_by===actor.id,'Only the view creator edits it',403,'forbidden')
  need(input.expected_version===(previous?.version??0),'View changed; reload',409,'stale_version')
  const scope=allowedScope(object(input.scope??previous?.view.scope).record_scope),columns=reportColumns(visibleFields,scope,actor),view=parseReportView(input,columns,actor.id,previous?.view)
  await run(view)
  need(actor.role!=='project_manager'||view.sharing==='personal','Only owners and administrators share views',403,'forbidden')
  const version=(previous?.version??0)+1
  await transaction(db,actor,null,[db.prepare('INSERT INTO pl_report_views(id,version,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data').bind(view.id,version,JSON.stringify(view)),reportAudit(db,actor,'view',previous?.view,view)],clock)
  return json({view,version},previous?200:201)
 }
 if(parts[1]==='views'&&(parts.length===3||parts.length===4)&&method==='GET'){
  const saved=all.find(r=>r.view.id===parts[2]);need(saved&&await canRead(saved.view),'View not found',404,'not_found')
  const columns=reportColumns(visibleFields,saved.view.scope.record_scope,actor), report=await run(saved.view)
  if(parts.length===3||parts[3]==='run')return json({...saved,report})
  need(parts[3]==='export.csv'||parts[3]==='export.pdf'||parts[3]==='export.xlsx','Unknown report route',404,'not_found')
  const pdf=parts[3]==='export.pdf',xlsx=parts[3]==='export.xlsx',format=pdf?'pdf':xlsx?'xlsx':'csv',content=pdf?reportPdf(report,saved.view.name):xlsx?new Uint8Array(reportXlsx(report)).buffer:reportCsv(report)
  await transaction(db,actor,null,[reportAudit(db,actor,'export',null,{view_id:saved.view.id,format,annotation:report.annotation,selected_columns:report.columns})])
  return new Response(content,{headers:{...headers,'content-type':pdf?'application\u002fpdf':xlsx?'application\u002fvnd.openxmlformats-officedocument.spreadsheetml.sheet':'text\u002fcsv; charset=utf-8','content-disposition':`attachment; filename=plinth-scoped-view.${format}`}})
 }
 need(false,'Unknown report route',404,'not_found')
}
