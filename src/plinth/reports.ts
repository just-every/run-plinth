import { need, object, text, type Actor, type Input } from './model'
import { readClock, transaction } from './store'
import { reportScope } from './report-field-model'
import { fieldConfig, reportAudit, saveField, saveValues } from './report-store'
import { reportColumns, reportRecords } from './report-records'
import { parseReportView, queryReport, reportCsv, type ReportView } from './report-query'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
export async function reportsResponse(request:Request,db:D1Database,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>):Promise<Response|null> {
 if(parts[0]!=='reports')return null
 need(['owner','admin','project_manager'].includes(actor.role),'Custom fields, queries and exports are office-only',403,'forbidden')
 const method=request.method, url=new URL(request.url), config=await fieldConfig(db)
 const visibleFields=actor.role==='project_manager'?config.fields.filter(f=>f.record_scope==='job'):config.fields
 if(parts.length===2&&parts[1]==='schema'&&method==='GET')return json({version:config.version,fields:visibleFields})
 if(parts.length===2&&parts[1]==='fields'&&method==='POST')return json(await saveField(db,actor,await body(request)),201)
 if(parts.length===2&&parts[1]==='records'&&method==='GET'){
  const scope=reportScope(url.searchParams.get('record_scope'));return json({records:await reportRecords(db,actor,scope),columns:reportColumns(visibleFields,scope)})
 }
 if(parts[1]==='values'&&parts.length===4){const scope=reportScope(parts[2]),id=text(parts[3],'record id',300)
  if(method==='PUT')return json({record:await saveValues(db,actor,scope,id,await body(request))})
  if(method==='GET'){const record=(await reportRecords(db,actor,scope)).find(r=>r.id===id);need(record,'Record not found',404,'not_found');return json({record})}
 }
 const all=(await db.prepare('SELECT id,version,data FROM pl_report_views ORDER BY rowid DESC').all<{id:string;version:number;data:string}>()).results.map(r=>({version:r.version,view:JSON.parse(r.data) as ReportView}))
 const canRead=(view:ReportView)=> (view.sharing==='shared'||view.created_by===actor.id)&&(actor.role!=='project_manager'||view.scope.record_scope==='job'&&(view.scope.record_ids===null||view.scope.record_ids.every(id=>actor.team!.job_ids.includes(id))))
 if(parts.length===2&&parts[1]==='views'&&method==='GET')return json({views:all.filter(r=>canRead(r.view))})
 if(parts.length===2&&parts[1]==='query'&&method==='POST'){
  const input=await body(request),scope=reportScope(object(input.scope).record_scope),columns=reportColumns(visibleFields,scope),view=parseReportView(input,columns,actor.id)
  return json({report:queryReport(await reportRecords(db,actor,scope),columns,view)})
 }
 if(parts[1]==='views'&&(parts.length===2&&method==='POST'||parts.length===3&&method==='PUT')){
  const clock=await readClock(db),input=await body(request),previous=parts.length===3?all.find(r=>r.view.id===parts[2]):undefined
  if(parts.length===3)need(previous,'View not found',404,'not_found')
  need(!previous||previous.view.created_by===actor.id,'Only the view creator edits it',403,'forbidden')
  need(input.expected_version===(previous?.version??0),'View changed; reload',409,'stale_version')
  const scope=reportScope(object(input.scope??previous?.view.scope).record_scope),columns=reportColumns(visibleFields,scope),view=parseReportView(input,columns,actor.id,previous?.view)
  await reportRecords(db,actor,scope)
  need(actor.role!=='project_manager'||view.sharing==='personal','Only owners and administrators share views',403,'forbidden')
  const version=(previous?.version??0)+1
  await transaction(db,actor,null,[db.prepare('INSERT INTO pl_report_views(id,version,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data').bind(view.id,version,JSON.stringify(view)),reportAudit(db,actor,'view',previous?.view,view)],clock)
  return json({view,version},previous?200:201)
 }
 if(parts[1]==='views'&&(parts.length===3||parts.length===4)&&method==='GET'){
  const saved=all.find(r=>r.view.id===parts[2]);need(saved&&canRead(saved.view),'View not found',404,'not_found')
  const columns=reportColumns(visibleFields,saved.view.scope.record_scope), report=queryReport(await reportRecords(db,actor,saved.view.scope.record_scope),columns,saved.view)
  if(parts.length===3||parts[3]==='run')return json({...saved,report})
  need(parts[3]==='export.csv','Unknown report route',404,'not_found')
  await transaction(db,actor,null,[reportAudit(db,actor,'export',null,{view_id:saved.view.id,annotation:report.annotation})])
  return new Response(reportCsv(report),{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename=plinth-scoped-view.csv'}})
 }
 need(false,'Unknown report route',404,'not_found')
}
