import { requireOwner } from './auth'
import { need, type Actor, type Input } from './model'
import { readClock, transaction } from './store'
import { fieldConfig, reportAudit } from './report-store'
import { reportColumns, reportRecords, type FieldRecord } from './report-records'
import { queryReport, reportCsv, reportCsvCell, type ReportResult, type ReportView } from './report-query'
import { reportXlsxSheet, xlsxRows } from './report-xlsx'

const chunkSize=25, maxBytes=2_000_000, encoder=new TextEncoder()
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
type Snapshot={view:ReportView;view_version:number;report:ReportResult;digest:string;source_versions:{id:string;version:number;native_version:number}[]}
type Work={id:string;version:number;state:'paused'|'complete'|'failed'|'cancelled';owner_id:string;format:'csv'|'xlsx';created_at:string;data:string;progress:number;total:number;error:string|null;checksum:string|null}
type Chunk={sequence:number;source:string;output:string|null}
async function hash(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(b=>b.toString(16).padStart(2,'0')).join('')}
const bytes=(text:string)=>encoder.encode(text)
const rowValues=(r:ReportResult['rows'][number],columns:ReportResult['columns'])=>[r.id,r.label,r.currency,...columns.map(c=>{const v=r.values[c.id];return v!==null&&typeof v==='object'?`${v.currency} ${v.amount_cents}`:v})]
function renderRows(rows:ReportResult['rows'],report:ReportResult,format:Work['format']){
 const values=rows.map(r=>rowValues(r,report.columns))
 return format==='csv'?values.map(row=>row.map(reportCsvCell).join(',')).join('\r\n')+(rows.length?'\r\n':''):xlsxRows(values)
}
function output(work:Work,snapshot:Snapshot,chunks:Chunk[]):Uint8Array{
 const r=snapshot.report,body=chunks.map(c=>c.output??'').join('')
 if(work.format==='csv')return bytes(reportCsv(r)+body)
 const prefix=xlsxRows([['Scope and filters',JSON.stringify(r.annotation)],['Current report date (UTC)',work.created_at.slice(0,10)],['record_id','record_name','currency',...r.columns.map(c=>c.name+(c.type==='money'?' (currency and integer cents)':''))]])
 const suffix=xlsxRows(r.money_totals.map(t=>['Total',t.column_id,t.currency,t.amount_cents,t.count]))
 return reportXlsxSheet(prefix+body+suffix)
}
async function approved(db:D1Database,work:Work,snapshot:Snapshot,actor:Actor){
 return !!await db.prepare('SELECT task_id FROM pl_background_reviews WHERE task_id=? AND owner_id=? AND digest=?').bind(work.id,actor.id,snapshot.digest).first()
}
async function currentSources(db:D1Database,actor:Actor,snapshot:Snapshot){
 const config=await fieldConfig(db),columns=reportColumns(config.fields,snapshot.view.scope.record_scope,actor),ids=new Set(columns.map(c=>c.id))
 need([...snapshot.view.selected_columns,...snapshot.view.filters.map(f=>f.column_id)].every(id=>ids.has(id)),'Report authority changed; create a new export',403,'forbidden')
 // Check live sources even when the pinned query uses an earlier portfolio capture.
 const records=await reportRecords(db,actor,snapshot.view.scope.record_scope,config.fields),available=new Set(records.map(r=>r.id))
 need(snapshot.report.annotation.scope_record_ids.every(id=>available.has(id)),'An export source is no longer available',404,'not_found')
}
async function summary(db:D1Database,work:Work,actor:Actor){
 const s=JSON.parse(work.data) as Snapshot
 return {id:work.id,version:work.version,state:work.state==='cancelled'?'cancelled':await approved(db,work,s,actor)?work.state:'review_required',name:s.view.name,format:work.format,created_at:work.created_at,progress:work.progress,total:work.total,chunk_size:chunkSize,error:work.error,checksum:work.checksum,digest:s.digest,view_version:s.view_version,source_versions:s.source_versions}
}
async function chunksOf(db:D1Database,id:string){return (await db.prepare('SELECT sequence,source,output FROM pl_background_chunks WHERE task_id=? ORDER BY sequence').bind(id).all<Chunk>()).results}
export async function backgroundWorkResponse(request:Request,db:D1Database,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>,saved:{view:ReportView;version:number}[],run:(view:ReportView)=>Promise<ReportResult>,recordsFor:(scope:ReportView['scope']['record_scope'])=>Promise<FieldRecord[]>):Promise<Response|null>{
 if(parts[1]!=='work')return null
 requireOwner(actor)
 const method=request.method
 if(parts.length===2&&method==='GET'){
  const rows=(await db.prepare('SELECT * FROM pl_background_work ORDER BY created_at DESC,id DESC LIMIT 100').all<Work>()).results
  return json({tasks:await Promise.all(rows.map(w=>summary(db,w,actor)))})
 }
 const clock=await readClock(db)
 if(parts.length===2&&method==='POST'){
  const input=await body(request),savedView=saved.find(s=>s.view.id===input.view_id)
  need(savedView&&(savedView.view.sharing==='shared'||savedView.view.created_by===actor.id),'View not found',404,'not_found')
  need(input.format==='csv'||input.format==='xlsx','Choose CSV or XLSX')
  need(input.expected_view_version===savedView.version,'View changed; reload before requesting export',409,'stale_version')
  need((await db.prepare("SELECT count(*) AS n FROM pl_background_work WHERE state!='cancelled'").first<{n:number}>())!.n<100,'Cancel an older export before creating more work',409,'work_limit')
  const report=await run(savedView.view),records=await recordsFor(savedView.view.scope.record_scope),sourceIds=new Set(report.annotation.scope_record_ids),sources=records.filter(r=>sourceIds.has(r.id))
  const table=savedView.view.scope.record_scope==='customer'?'pl_customers':savedView.view.scope.record_scope==='vendor'?'pl_vendors':'pl_jobs'
  const native=(await db.prepare('SELECT id,version FROM '+table).all<{id:string;version:number}>()).results,nativeVersions=new Map(native.map(r=>[r.id,r.version]))
  const source_versions=sources.map(r=>({id:r.id,version:r.version,native_version:nativeVersions.get(r.job_id??r.id)??0})),created_at=new Date(Date.now()).toISOString()
  const capture=JSON.stringify({view:savedView.view,view_version:savedView.version,report,source_versions,created_at})
  need(bytes(capture).length<=maxBytes,'Report snapshot exceeds the bounded export size; narrow the saved view',400,'work_size')
  const snapshot:Snapshot={view:structuredClone(savedView.view),view_version:savedView.version,report:{...report,rows:[]},source_versions,digest:await hash(bytes(capture))}
  const id=crypto.randomUUID(),writes=[db.prepare('INSERT INTO pl_background_work(id,version,state,owner_id,format,created_at,data,total) VALUES(?,1,\'paused\',?,?,?,?,?)').bind(id,actor.id,input.format,created_at,JSON.stringify(snapshot),report.rows.length),db.prepare('INSERT INTO pl_background_reviews(task_id,owner_id,digest) VALUES(?,?,?)').bind(id,actor.id,snapshot.digest)]
  // Zero-row reports still need a finalization checkpoint.
  for(let at=0;at<Math.max(1,report.rows.length);at+=chunkSize)writes.push(db.prepare('INSERT INTO pl_background_chunks(task_id,sequence,source) VALUES(?,?,?)').bind(id,at/chunkSize,JSON.stringify(report.rows.slice(at,at+chunkSize))))
  for(const r of sources)writes.push(db.prepare('INSERT INTO pl_background_sources(task_id,record_scope,record_id,job_id) VALUES(?,?,?,?)').bind(id,r.record_scope,r.id,r.job_id??null))
  await transaction(db,actor,null,[...writes,reportAudit(db,actor,'export',null,{work_id:id,view_id:savedView.view.id,format:input.format,digest:snapshot.digest})],clock)
  const work=(await db.prepare('SELECT * FROM pl_background_work WHERE id=?').bind(id).first<Work>())!
  return json({task:await summary(db,work,actor)},201)
 }
 const work=await db.prepare('SELECT * FROM pl_background_work WHERE id=?').bind(parts[2]??'').first<Work>()
 need(work,'Export work not found',404,'not_found')
 const snapshot=JSON.parse(work.data) as Snapshot
 if(parts.length===3&&method==='GET')return json({task:await summary(db,work,actor)})
 const action=parts[3]
 if(method==='POST'&&parts.length===4){
  const input=await body(request)
  need(input.expected_version===work.version,'Export work changed; refresh before continuing',409,'stale_version')
  if(action==='cancel'){
   need(work.state!=='cancelled','Export is already cancelled',409,'cancelled')
   await transaction(db,actor,null,[db.prepare("UPDATE pl_background_work SET version=version+1,state='cancelled',data=?,error=NULL,checksum=NULL WHERE id=?").bind(JSON.stringify({...snapshot,report:{...snapshot.report,rows:[],annotation:{...snapshot.report.annotation,scope_record_ids:[],matched_record_ids:[]}},source_versions:[]}),work.id),db.prepare('DELETE FROM pl_background_chunks WHERE task_id=?').bind(work.id),db.prepare('DELETE FROM pl_background_reviews WHERE task_id=?').bind(work.id)],clock)
  }else{
   need(work.state!=='cancelled','Cancelled work cannot resume',409,'cancelled')
   await currentSources(db,actor,snapshot)
   if(action==='review'){
    need(input.confirm===true&&input.digest===snapshot.digest,'Explicitly review the exact recovered export',400,'review_required')
    await transaction(db,actor,null,[db.prepare('INSERT INTO pl_background_reviews(task_id,owner_id,digest) VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET owner_id=excluded.owner_id,digest=excluded.digest').bind(work.id,actor.id,snapshot.digest),db.prepare('UPDATE pl_background_work SET owner_id=?,version=version+1 WHERE id=?').bind(actor.id,work.id)],clock)
   }else{
    need(action==='resume','Unknown export action',404,'not_found')
    need(await approved(db,work,snapshot,actor),'Restored work needs explicit destination-owner review',409,'review_required')
    need(work.state!=='complete','Completed work cannot resume',409,'complete')
    const chunks=await chunksOf(db,work.id),next=chunks.find(c=>c.output===null)
    need(next,'Export checkpoint is unavailable',409,'checkpoint')
    const rows=JSON.parse(next.source) as ReportResult['rows'],rendered=renderRows(rows,snapshot.report,work.format)
    const progress=work.progress+rows.length,all=chunks.map(c=>c.sequence===next.sequence?{...c,output:rendered}:c),finished=all.every(c=>c.output!==null)
    let failure:string|null=null,checksum:string|null=null
    if(bytes(rendered).length>maxBytes)failure='Output chunk exceeds the bounded size. Narrow the saved view and request a new export.'
    if(!failure&&finished){const final=output(work,snapshot,all);if(final.length>8_000_000)failure='Final download exceeds the bounded size. Narrow the saved view and request a new export.';else checksum=await hash(final)}
    await transaction(db,actor,null,[
     ...(failure?[]:[db.prepare('UPDATE pl_background_chunks SET output=? WHERE task_id=? AND sequence=? AND output IS NULL').bind(rendered,work.id,next.sequence)]),
     db.prepare('UPDATE pl_background_work SET version=version+1,state=?,progress=?,error=?,checksum=? WHERE id=?').bind(failure?'failed':finished?'complete':'paused',failure?work.progress:progress,failure,checksum,work.id)
    ],clock)
   }
  }
  return json({task:await summary(db,(await db.prepare('SELECT * FROM pl_background_work WHERE id=?').bind(work.id).first<Work>())!,actor)})
 }
 if(parts.length===4&&action==='download'&&method==='GET'){
  need(work.state==='complete','Export is not complete',409,'incomplete')
  need(await approved(db,work,snapshot,actor),'Restored work needs explicit destination-owner review',409,'review_required')
  await currentSources(db,actor,snapshot)
  const final=output(work,snapshot,await chunksOf(db,work.id))
  need(await hash(final)===work.checksum,'Export checksum failed; request a new export',409,'checksum')
  await transaction(db,actor,null,[reportAudit(db,actor,'export',null,{work_id:work.id,checksum:work.checksum,format:work.format})],clock)
  return new Response(final.buffer as ArrayBuffer,{headers:{...headers,'content-type':work.format==='csv'?'text\u002fcsv; charset=utf-8':'application\u002fvnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename=plinth-report.${work.format}`,'x-content-sha256':work.checksum!}})
 }
 need(false,'Unknown export route',404,'not_found')
}
