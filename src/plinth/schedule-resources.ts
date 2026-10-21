import { requireJobManager, requireManager } from './auth'
import { find, need, object, stamp, text, type Actor, type Input, type Job, type Schedule } from './model'
import { scheduleTime } from './operations'
import { jobs, readClock, transaction } from './store'
import type { TradeConflict } from './schedule-travel'
import type { ResourceWindow, ScheduleResource } from './schedule-resource-model'
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'private, no-store'}})
export async function resources(db:D1Database):Promise<ScheduleResource[]>{return (await db.prepare('SELECT data FROM pl_schedule_resources ORDER BY rowid').all<{data:string}>()).results.map(r=>JSON.parse(r.data))}
function windows(value:unknown):ResourceWindow[]{need(Array.isArray(value)&&value.length<=200,'Supply up to 200 availability/leave windows');return value.map(v=>{const r=object(v),start=scheduleTime(r,'start'),end=scheduleTime(r,'end');need(end>start,'A resource window must end after it starts');return {start,end,reason:text(r.reason,'Window reason',500)}})}
export async function resourceResponse(request:Request,db:D1Database,actor:Actor,parts:string[],body:(request:Request)=>Promise<Input>){
 if(parts[0]!=='resources')return null
 requireJobManager(actor);need(parts.length<=2,'Resource not found',404,'not_found')
 const all=await resources(db)
 if(request.method==='GET')return json({resources:all.map(r=>actor.role==='project_manager'?{...r,history:[],leave:r.leave.map(w=>({...w,reason:'Unavailable'}))}:r)})
 requireManager(actor);need(request.method==='POST','Method not allowed',405,'method_not_allowed')
 const input=await body(request),clock=await readClock(db),previous=parts[1]?find(all,parts[1]):undefined
 if(previous)need(input.expected_version===previous.version,'Resource changed. Reload before editing',409,'stale_version')
 need(['crew','equipment'].includes(String(input.kind)),'Choose crew or equipment');need(Number.isSafeInteger(input.capacity)&&Number(input.capacity)>0&&Number(input.capacity)<=10000,'Capacity must be whole units from 1 to 10000')
 const available=windows(input.available??[]),leave=windows(input.leave??[]),reason=text(input.reason,'Resource revision reason',1000)
 const row:ScheduleResource={id:previous?.id??crypto.randomUUID(),version:(previous?.version??0)+1,name:text(input.name,'Resource name',200),kind:input.kind as ScheduleResource['kind'],capacity:Number(input.capacity),available,leave,history:[...(previous?.history??[]),{by:stamp(actor),reason,capacity:Number(input.capacity),available,leave}]}
 const writes=previous?[db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_schedule_resources WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(row.id,previous.version),db.prepare('UPDATE pl_schedule_resources SET version=?,data=? WHERE id=?').bind(row.version,JSON.stringify(row),row.id)]:[db.prepare('INSERT INTO pl_schedule_resources(id,version,data) VALUES(?,?,?)').bind(row.id,row.version,JSON.stringify(row))]
 await transaction(db,actor,null,writes,clock);return json({resource:row},previous?200:201)
}
/** Half-open elapsed-UTC windows; global clock guards the read/check/write transaction across all publication doors. */
export function resourceConflicts(catalog:ScheduleResource[],all:Job[],job:Job):TradeConflict[]{
 const result:TradeConflict[]=[],others=all.filter(j=>j.id!==job.id).concat(job)
 for(const task of job.schedules.filter(t=>t.status==='booked'&&!t.milestone))for(const allocation of task.resources??[]){
  const resource=catalog.find(r=>r.id===allocation.resource_id)
  const add=(reason:TradeConflict['reason'],otherJob=job,booking=task)=>result.push({resource_id:allocation.resource_id,job_id:otherJob.id,job_name:otherJob.name,schedule_id:booking.id,trade:booking.trade,start:booking.start,end:booking.end,reason})
  if(!resource){add('resource_missing');continue}
  if(resource.available.length&&!resource.available.some(w=>w.start<=task.start&&w.end>=task.end))add('availability')
  if(resource.leave.some(w=>w.start<task.end&&w.end>task.start))add('leave')
  const overlaps=others.flatMap(j=>j.schedules.filter(t=>t.id!==task.id&&t.status==='booked'&&!t.milestone).flatMap(t=>{const a=t.resources?.find(a=>a.resource_id===resource.id);if(!a)return [];const buffer=j.id===job.id?0:Math.max(t.travel_minutes??0,task.travel_minutes??0)*60000;return [{job:j,task:t,units:a.units,start:Date.parse(t.start)-buffer,end:Date.parse(t.end)+buffer}]})).filter(t=>t.start<Date.parse(task.end)&&t.end>Date.parse(task.start))
  const points=[Date.parse(task.start),...overlaps.map(t=>Math.max(t.start,Date.parse(task.start)))]
  if(allocation.units>resource.capacity)add('capacity')
  else for(const point of points){const active=overlaps.filter(t=>t.start<=point&&t.end>point);if(allocation.units+active.reduce((n,t)=>n+t.units,0)>resource.capacity){for(const other of active)add('capacity',other.job,other.task);break}}
 }
 return result
}
export function scopedConflicts(conflicts:TradeConflict[],actor:Actor){return conflicts.map(c=>['owner','admin'].includes(actor.role)||actor.role==='project_manager'&&actor.team!.job_ids.includes(c.job_id)?c:{...c,job_id:'unavailable',job_name:'Another job',schedule_id:'unavailable',trade:'Allocated resource'})}
export async function requireResources(db:D1Database,job:Job,all:Job[],actor:Actor){const conflicts=scopedConflicts(resourceConflicts(await resources(db),all,job),actor);need(!conflicts.length,'Resolve crew/equipment availability, leave, capacity or travel conflicts',409,'resource_conflict',{conflicts})}
