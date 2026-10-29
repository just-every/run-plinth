import { requireOwner } from './auth'
import { auditStatement } from './audit'
import { need, text, type Actor, type Input } from './model'
import { jobOf, readClock, transaction } from './store'

const week=7*24*60*60*1000
type Schedule={id:string;job_id:string;owner_id:string;version:number;paused:number;data:string}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}})
export async function runScheduleResponse(request:Request,db:D1Database,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>):Promise<Response|null>{
 if(parts[0]!=='agent-runs'||parts[1]!=='schedules')return null
 requireOwner(actor)
 const clock=await readClock(db)
 if(parts.length===2&&request.method==='POST'){
  const input=await body(request),job=await jobOf(db,actor,text(input.job_id,'Job id',100))
  need(input.expected_job_version===job.version,'Job changed; review again',409,'stale_source')
  need(input.confirm===true,'Confirm an inert weekly review ticket, with no inference or tool execution')
  const starts_at=text(input.starts_at,'First due time',40)
  need(Number.isFinite(Date.parse(starts_at))&&new Date(starts_at).toISOString()===starts_at,'Use an exact UTC due time')
  const id=crypto.randomUUID(),data=JSON.stringify({starts_at,purpose:text(input.purpose,'Review purpose',1000),interval:'weekly',inference:false,tool_dispatch:false})
  await transaction(db,actor,job,[db.prepare('INSERT INTO pl_agent_schedules(id,job_id,owner_id,version,data) VALUES(?,?,?,1,?)').bind(id,job.id,actor.id,data),db.prepare('INSERT INTO pl_agent_schedule_consents(schedule_id,owner_id,owner_version) VALUES(?,?,?)').bind(id,actor.id,actor.version),auditStatement(db,actor,{action:'agent-run.schedule',subject_kind:'agent_schedule',subject_id:id})],clock)
  return json({schedule:{id,job_id:job.id,version:1,paused:false,...JSON.parse(data)}},201)
 }
 if(parts.length===2&&request.method==='GET'){
  const schedules=(await db.prepare('SELECT s.*,c.schedule_id AS approved FROM pl_agent_schedules s LEFT JOIN pl_agent_schedule_consents c ON c.schedule_id=s.id AND c.owner_id=? AND c.owner_version=? WHERE s.owner_id=? ORDER BY s.rowid LIMIT 100').bind(actor.id,actor.version,actor.id).all<Schedule&{approved:string|null}>()).results
  const tickets=(await db.prepare('SELECT t.* FROM pl_agent_tickets t JOIN pl_agent_schedules s ON s.id=t.schedule_id WHERE s.owner_id=? ORDER BY due_at DESC LIMIT 100').bind(actor.id).all()).results
  return json({schedules:schedules.map(s=>({id:s.id,job_id:s.job_id,version:s.version,paused:!!s.paused,review_required:!s.approved,...JSON.parse(s.data)})),tickets})
 }
 need(parts.length===4&&parts[3]==='pause'&&request.method==='POST','Unknown schedule route',404,'not_found')
 const input=await body(request),schedule=await db.prepare('SELECT * FROM pl_agent_schedules WHERE id=? AND owner_id=?').bind(parts[2],actor.id).first<Schedule>()
 need(schedule,'Schedule unavailable',404,'not_found');need(input.expected_version===schedule.version,'Schedule changed',409,'stale_version')
 await transaction(db,actor,null,[db.prepare('UPDATE pl_agent_schedules SET version=version+1,paused=1 WHERE id=?').bind(schedule.id),db.prepare('DELETE FROM pl_agent_schedule_consents WHERE schedule_id=?').bind(schedule.id)],clock)
 return json({paused:true})
}
/** Weekly work is only an inert ticket. This function never reads job contents or invokes a tool or provider. */
export async function dispatchAgentTickets(db:D1Database,at:number){
 const schedules=(await db.prepare("SELECT s.* FROM pl_agent_schedules s JOIN pl_agent_schedule_consents c ON c.schedule_id=s.id JOIN oa_operators o ON o.id=c.owner_id AND o.version=c.owner_version AND o.role='owner' AND o.status='active' WHERE s.paused=0 AND s.owner_id=c.owner_id ORDER BY s.id LIMIT 100").all<Schedule>()).results
 for(const s of schedules){
  const start=Date.parse(JSON.parse(s.data).starts_at)
  if(at<start)continue
  const due=new Date(start+Math.floor((at-start)/week)*week).toISOString()
  await db.batch([db.prepare("INSERT OR IGNORE INTO pl_agent_tickets(id,schedule_id,due_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM pl_agent_schedules s JOIN pl_agent_schedule_consents c ON c.schedule_id=s.id JOIN oa_operators o ON o.id=c.owner_id AND o.version=c.owner_version AND o.status='active' AND o.role='owner' WHERE s.id=? AND s.version=? AND s.paused=0 AND s.owner_id=c.owner_id)").bind(s.id+':'+due,s.id,due,s.id,s.version)])
 }
}
