import { requireRateAccess } from './auth'
import { wallClock } from './time-zone'
import { auditStatement } from './audit'
import { catalogValue, date } from './catalog-input'
import type { Assembly, CatalogEntry, EstimateTemplate } from './catalog-model'
import { catalogEntry } from './estimate-catalog'
import { actualEntries } from './cost-ledger'
import { lineCents } from './estimate-math'
import { latestActual } from './schedule-baseline-model'
import { currencyOf, find, need, object, recordApproval, stamp, sum, text, type Actor, type Input, type Job } from './model'
import { jobOf, jobs, readClock, saveJob } from './store'
import type { EstimatePerformance, PerformanceLesson, SalesStage } from './estimate-performance-model'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
const state=(job:Job):EstimatePerformance=>job.estimate_performance??={sales:[],lessons:[]}
/** Reports resolve grants before deriving rows, denominators or counts. Catalog edits retain their existing office authority. */
function access(actor:Actor,write=false){
 need(['owner','admin','project_manager'].includes(actor.role),'Performance reports are office-only',403,'forbidden')
 if(actor.permissions){const p=actor.permissions;need(p.financial&&p.matrix.reports.view&&p.matrix.estimates.view&&p.matrix.budgets.view&&p.matrix.schedule.view&&p.matrix.orders.view&&p.matrix.time.view,'Performance sources require current financial, estimate, budget and schedule visibility',403,'forbidden');if(write)need(p.matrix.reports.edit,'Performance editing is unavailable',403,'forbidden')}
}
function catalogAccess(actor:Actor){
 need(actor.role==='owner'||actor.role==='admin','Only catalog managers approve lesson revisions',403,'forbidden')
 if(actor.permissions)need(actor.permissions.matrix.estimates.edit&&actor.permissions.matrix.reports.approve,'Catalog editing and report approval are required',403,'forbidden')
}
const allowed=(actor:Actor,job:Job)=>!actor.team||(!actor.permissions&&actor.role!=='project_manager')||actor.team.job_ids.includes(job.id)
async function entries(db:D1Database){return (await db.prepare('SELECT data FROM pl_estimate_catalog ORDER BY rowid').all<{data:string}>()).results.map(r=>JSON.parse(r.data) as CatalogEntry)}
export function performanceJob(job:Job,catalog:CatalogEntry[]){
 const quote=job.quotes.find(q=>q.status==='accepted')??job.quotes.at(-1),source=quote?.cost_catalog
 const template=source&&catalog.find(e=>e.id===source.template_id)?.revisions.find(r=>r.version===source.template_version)?.value as EstimateTemplate|undefined
 const ledger=actualEntries(job),lines=quote?.lines.filter(l=>l.included!==false)??[],codes=[...new Set([...lines.map(l=>l.cost_code??'Unassigned'),...ledger.map(e=>e.cost_code)])]
 const rows=codes.map(cost_code=>{
  const selected=lines.filter(l=>(l.cost_code??'Unassigned')===cost_code),actual=ledger.filter(e=>e.cost_code===cost_code)
  const assemblyIds=[...new Set(selected.flatMap(l=>{const item=template?.items.find(i=>l.id?.startsWith(i.id+':'));return item?[item.assembly_id]:[]}))]
  const assembly=assemblyIds.length===1?catalog.find(e=>e.id===assemblyIds[0]):undefined
  const assemblyVersion=source?.assemblies.find(a=>a.id===assembly?.id)?.version
  const tasks=job.schedules.filter(t=>t.status==='booked'&&latestActual(job,t.id)?.installed?.cost_code===cost_code)
  const trades=[...new Set(tasks.map(t=>t.trade))],trade=trades.length===1?trades[0]!:null
  const production=tasks.map(t=>({task_id:t.id,trade:t.trade,actual:latestActual(job,t.id)!})),units=[...new Set(production.map(p=>p.actual.installed!.unit))]
  const time=(job.cost_records?.sources??[]).filter(s=>s.kind==='time'&&s.approved_by&&s.cost_code===cost_code)
  const transferred=time.some(s=>{const entry=ledger.find(e=>e.source_id===s.id);return entry&&ledger.some(e=>e.source_id===entry.id&&e.source_kind==='transfer.out')})
  const minutes=time.length&&!transferred?sum(time.map(s=>Number(s.detail.minutes))):null
  const quantity=production.length&&units.length===1&&production.every(p=>p.actual.actual_finish)?production.reduce((n,p)=>n+Number(p.actual.installed!.quantity),0):null
  const labor=selected.filter(l=>l.category==='labor'),estimatedMinutes=labor.length&&labor.every(l=>l.rate_unit==='hour')?sum(labor.map(l=>lineCents(l.quantity,60,l.conversion))):null
  const estimatedQuantity=assembly&&template&&source?template.items.filter(i=>i.assembly_id===assembly.id&&selected.some(l=>l.id?.startsWith(i.id+':'))).reduce((n,i)=>n+Number(source.dimensions[i.dimension]),0):null
  const dimensionUnit=(assembly?.revisions.find(r=>r.version===assemblyVersion)?.value as Assembly|undefined)?.unit??null
  const knownQuantity=quantity!==null&&units[0]===dimensionUnit?quantity:null
  return {cost_code,trade,assembly_id:assembly?.id??null,assembly_name:assembly?.name??'Unallocated assembly',assembly_version:assemblyVersion??null,
   estimated_cost_cents:selected.length&&selected.every(l=>l.cost_total_cents!==undefined)?sum(selected.map(l=>l.cost_total_cents!)):null,
   actual_cost_cents:sum(actual.map(e=>e.amount_cents)),estimated_minutes:estimatedMinutes,approved_minutes:minutes,estimated_quantity:estimatedQuantity,installed_quantity:knownQuantity,unit:dimensionUnit,
   estimated_units_per_hour:estimatedMinutes&&estimatedQuantity!==null?estimatedQuantity*60/estimatedMinutes:null,
   actual_units_per_hour:minutes&&knownQuantity!==null?knownQuantity*60/minutes:null,
   unknown:!assembly?'Assembly attribution unknown':knownQuantity===null?'Production denominator unknown':minutes===null?'Approved labor denominator unknown':trade===null?'Trade attribution unknown':null,
   source:{quote_id:quote?.id??null,line_ids:selected.map(l=>l.id),entry_ids:actual.map(e=>e.id),time_ids:time.map(s=>s.id),production:production.map(p=>({task_id:p.task_id,actual_id:p.actual.id,evidence:p.actual.evidence,quantity:p.actual.installed!.quantity,unit:p.actual.installed!.unit})),actuals:actual.map(e=>({id:e.id,source_id:e.source_id,kind:e.source_kind,amount_cents:e.amount_cents,dated_on:e.dated_on}))}}
 })
 const sales=state(job).sales.findLast(s=>s.quote_id===quote?.id),won=quote?.status==='accepted',stage=won?'won':sales?.stage??(quote?'estimating':'qualified')
 return {id:job.id,name:job.name,version:job.version,currency:currencyOf(job),completion:state(job).completion??null,rows,
  sales:{stage,quote_id:quote?.id??null,estimator:quote?.prepared_by??null,amount_cents:quote?.total_cents??null,evidence:won?quote.acceptance?.evidence:sales?.evidence??null,history:state(job).sales},
  bids:(job.bids??[]).filter(b=>b.published_by).map(b=>{const revision=b.revisions.at(-1)!,invites=b.invitations.filter(i=>!i.revoked_by),responded=invites.filter(i=>i.responses.some(r=>r.revision_id===revision.id)),awards=(job.bid_comparison_awards??[]).filter(a=>a.package_id===b.id&&!a.cancelled);return {id:b.id,title:b.title,trade:b.trade,revision_id:revision.id,invited:invites.length,responded:responded.length,declined:invites.filter(i=>i.decline).length,response_rate:invites.length?responded.length/invites.length:null,awards:awards.map(a=>({id:a.id,amount_cents:a.amount_cents,comparison_id:a.comparison_id})),response_ids:responded.flatMap(i=>i.responses.filter(r=>r.revision_id===revision.id).map(r=>r.id))}})}
}
export type PerformanceJob=ReturnType<typeof performanceJob>
export async function performanceResponse(request:Request,db:D1Database,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>):Promise<Response|null>{
 if(parts[0]!=='reports'||parts[1]!=='performance')return null
 access(actor,request.method!=='GET')
 const canPropose=actor.role==='owner'||actor.role==='admin'
 const clock=await readClock(db),catalog=await entries(db),available=(await jobs(db)).filter(j=>allowed(actor,j)),mapped=available.map(j=>performanceJob(j,catalog))
 if(parts.length===2&&request.method==='GET'){
  const estimators=[...new Set(mapped.flatMap(j=>j.sales.estimator?[j.sales.estimator.id]:[]))].map(id=>{const records=mapped.filter(j=>j.sales.estimator?.id===id),won=records.filter(j=>j.sales.stage==='won').length,lost=records.filter(j=>j.sales.stage==='lost').length;return {id,name:records[0]!.sales.estimator!.name,won,lost,open:records.length-won-lost,win_rate:won+lost?won/(won+lost):null,job_ids:records.map(j=>j.id)}})
  const lessons=available.flatMap(j=>state(j).lessons.filter(l=>l.sources.every(s=>available.some(a=>a.id===s.id))).map(l=>({...l,job_id:j.id})))
  const pipeline=[...new Set(mapped.map(j=>j.currency+':'+j.sales.stage))].map(key=>{const rows=mapped.filter(j=>j.currency+':'+j.sales.stage===key);return {currency:rows[0]!.currency,stage:rows[0]!.sales.stage,count:rows.length,amount_cents:rows.every(j=>j.sales.amount_cents!==null)?sum(rows.map(j=>j.sales.amount_cents!)):null}})
  return json({as_of:new Date(Date.now()).toISOString(),jobs:mapped,pipeline,estimators,lessons:canPropose?lessons:[],catalog:canPropose?catalog.filter(e=>e.kind!=='rate'):[],can_propose:canPropose,can_edit:!actor.permissions||actor.permissions.matrix.reports.edit,can_approve:(actor.role==='owner'||actor.role==='admin')&&(!actor.permissions||actor.permissions.matrix.estimates.edit&&actor.permissions.matrix.reports.approve),label:'Native source records under current grants. Unknown production is never zero. Won quotes use recorded client acceptance; lost outcomes are attributed office evidence.'})
 }
 need(parts[2]==='jobs'&&parts[3]&&parts.length>=4,'Unknown performance route',404,'not_found')
 const previous=await jobOf(db,actor,parts[3]!);need(allowed(actor,previous),'Job not found',404,'not_found')
 if(request.method==='GET'&&parts.length===4)return json({job:performanceJob(previous,catalog),performance:{...state(previous),lessons:canPropose?state(previous).lessons.filter(l=>l.sources.every(s=>available.some(j=>j.id===s.id))):[]}})
 need(request.method==='POST','Method not allowed',405)
 const input=await body(request);need(input.expected_version===previous.version,'Job changed; reload the performance report',409,'stale_version')
 const job=structuredClone(previous),value=state(job);let record:unknown,writes:D1PreparedStatement[]=[]
 if(parts[4]==='sales'&&parts.length===5){
  need(job.status==='quoting','Accepted sales terms remain won',409,'sales_won');const quote=find(job.quotes,text(input.quote_id,'Quote id',80));need(quote.id===job.quotes.at(-1)?.id,'Use the current proposal',409,'stale_quote')
  const stage=input.stage;need(['qualified','estimating','submitted','negotiating','lost'].includes(String(stage)),'Choose a native sales stage');need(input.confirm===true,'Confirm the exact sales evidence')
  record={id:crypto.randomUUID(),stage:stage as SalesStage,quote_id:quote.id,reason:text(input.reason,'Decision reason',2000),evidence:text(input.evidence,'Sales evidence',2000),by:stamp(actor)};value.sales.push(record as EstimatePerformance['sales'][number])
 }else if(parts[4]==='complete'&&parts.length===5){
  need(job.status==='active'&&!value.completion,'Record completion once for an accepted job',409,'completion_state')
  const tasks=job.schedules.filter(t=>t.status==='booked');need(tasks.length&&tasks.every(t=>latestActual(job,t.id)?.actual_finish),'Every booked task needs recorded actual completion',409,'completion_sources');need(input.confirm===true,'Confirm completion evidence')
  const completed_on=date(input.completed_on);need(tasks.every(t=>wallClock(Date.parse(latestActual(job,t.id)!.actual_finish!),job.time_zone??'UTC').date<=completed_on),'Completion date precedes recorded work')
  record=value.completion={completed_on,evidence:text(input.evidence,'Completion evidence',2000),by:stamp(actor)}
 }else if(parts[4]==='lessons'&&parts.length===5){
  requireRateAccess(actor,'GET')
  need(value.completion,'Lessons require a completed source job',409,'completion_state')
  const entry=await catalogEntry(db,text(input.catalog_id,'Catalog id',80));need(entry.kind==='assembly'||entry.kind==='template','Propose an assembly or template revision')
  need(input.catalog_version===entry.version,'Catalog changed; review again',409,'stale_catalog')
  need(Array.isArray(input.source_job_ids)&&input.source_job_ids.length>=2&&input.source_job_ids.length<=20,'Compare at least two completed jobs')
  const ids=[...new Set(input.source_job_ids.map(id=>text(id,'Source job id',80)))];need(ids.length>=2&&ids.includes(job.id),'Include this job and another completed job')
  const sources=ids.map(id=>{const found=available.find(j=>j.id===id);need(found&&state(found).completion,'Completed source job unavailable',404,'not_found');need(currencyOf(found)===currencyOf(job),'Compare source jobs in the same currency');return {id,version:found.version+(id===job.id?1:0)}})
  const proposed=catalogValue(entry.kind,object(input.value));record={id:crypto.randomUUID(),catalog_id:entry.id,catalog_version:entry.version,kind:entry.kind,name:entry.name,reason:text(input.reason,'Lesson reason',2000),value:proposed,sources,proposed_by:stamp(actor)};value.lessons.push(record as PerformanceLesson)
 }else if(parts[4]==='lessons'&&parts[5]&&parts[6]==='approve'&&parts.length===7){
  catalogAccess(actor);const lesson=find(value.lessons,parts[5]);need(!lesson.approved,'Lesson already approved',409,'lesson_approved');need(input.confirm===true,'Approve this exact catalog revision for new estimates only')
  const entry=await catalogEntry(db,lesson.catalog_id);need(entry.version===lesson.catalog_version,'Catalog changed; propose a fresh lesson',409,'stale_catalog')
  for(const source of lesson.sources){const current=available.find(j=>j.id===source.id);need(current&&state(current).completion,'Source job unavailable',404,'not_found');need(current.version===source.version,'Source changed; propose a fresh lesson',409,'stale_source');if(source.id!==job.id)writes.push(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(source.id,current.version))}
  if(lesson.kind==='assembly')for(const part of (lesson.value as Assembly).parts)await catalogEntry(db,part.rate_id,'rate')
  else for(const item of (lesson.value as EstimateTemplate).items)await catalogEntry(db,item.assembly_id,'assembly')
  const version=entry.version+1,by=stamp(actor);entry.version=version;entry.revisions.push({version,name:entry.name,value:lesson.value,reason:lesson.reason,approved_by:by})
  need(JSON.stringify(entry).length<=2_000_000,'Catalog history is too large')
  writes.push(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_estimate_catalog WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(entry.id,lesson.catalog_version),db.prepare('UPDATE pl_estimate_catalog SET version=?,data=? WHERE id=?').bind(version,JSON.stringify(entry),entry.id))
  lesson.approved={by,catalog_version:version};record=lesson
 }else need(false,'Unknown performance action',404,'not_found')
 recordApproval(job,actor,'estimate.performance.'+parts.slice(4).filter(p=>p==='sales'||p==='complete'||p==='lessons'||p==='approve').join('.'),{id:typeof record==='object'&&record&&'id' in record?String(record.id):job.id,prepared_by:stamp(actor)},record)
 writes.push(auditStatement(db,actor,{kind:'financial',action:'estimate.performance.'+parts[4]+(parts[6]?'.'+parts[6]:''),job_id:job.id,subject_kind:'estimate_performance',subject_id:record&&typeof record==='object'&&'id' in record?String(record.id):job.id,detail:{source_version:previous.version}}))
 await saveJob(db,actor,previous,job,writes,clock)
 return json({record,job:performanceJob(job,catalog),performance:{...value,lessons:canPropose?value.lessons:[]}})
}
