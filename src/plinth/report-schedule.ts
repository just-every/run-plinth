import { runtimeBindings, type Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { requireOwner } from './auth'
import { auditStatement, automation } from './audit'
import { jobs, jobOf, readClock, transaction } from './store'
import { need, stamp, text, type Actor, type Input, type Job, DomainError } from './model'
import { officeAuthority, authorityGuards, warrantyGeneration, loadWarrantyJob, checkWarrantySend } from './warranty-store'
import { clientAccess } from './job-customers'
import { portalEnabled } from './portal-policy'
import { teamGrant } from './team'
import { optionalNotice } from './mail-model'
import { suppression } from './mail-store'
import { statusOf } from './mail-send'
import { warrantyDay, warrantyOccurrence } from './warranty-schedule'
import { nextDate } from './time-zone'
import { drawPacket } from './report-packet'
import { reportRecords } from './report-records'

export interface ReportDelivery { id:string; due_on:string; generated_at:string; status:string; label:string; content:unknown; provider_message_id?:string }
export interface ReportSchedule {
 id:string; kind:'digest'|'packet'; audience:'manager'|'client'|'lender'; cadence:'weekly'|'monthly'; anchor_on:string
 recipient_id:string; recipient_email:string; owner_id:string; owner_version:number; generation:number
 status:'active'|'paused'; consent:ReturnType<typeof stamp>; deliveries:ReportDelivery[]
}
export type ReportJob=Job&{report_schedules?:ReportSchedule[]}
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
const summary=(s:ReportSchedule)=>({...s,deliveries:s.deliveries.map(({content,...delivery})=>delivery)})
function due(s:ReportSchedule,now:number):string|undefined {
 if(s.status!=='active')return
 const today=new Date(now).toISOString().slice(0,10)
 const days=Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(s.anchor_on+'T00:00:00Z'))/86400000)
 if(days<0||new Date(now).getUTCHours()<9&&days===0)return
 // Every occurrence stays anchored; missed occurrences collapse to the latest due report, never a mail backlog.
 let index=s.cadence==='weekly'?Math.floor(days/7):Math.max(0,(Number(today.slice(0,4))-Number(s.anchor_on.slice(0,4)))*12+Number(today.slice(5,7))-Number(s.anchor_on.slice(5,7)))
 let date=s.cadence==='weekly'?nextDate(s.anchor_on,index*7):warrantyOccurrence({anchor_on:s.anchor_on,interval_unit:'month',interval_count:1},index)
 if(date>today||date===today&&new Date(now).getUTCHours()<9){index--;if(index<0)return;date=s.cadence==='weekly'?nextDate(s.anchor_on,index*7):warrantyOccurrence({anchor_on:s.anchor_on,interval_unit:'month',interval_count:1},index)}
 return s.deliveries.some(d=>d.due_on===date)?undefined:date
}
async function guards(db:D1Database,job:Job,s:ReportSchedule):Promise<D1PreparedStatement[]|null>{
 if(s.status!=='active'||await warrantyGeneration(db)!==s.generation)return null
 const owner=await officeAuthority(db,job,s.owner_id,true)
 if(!owner||owner.role!=='owner'||owner.version!==s.owner_version)return null
 const p=await db.prepare("SELECT id,email,version,role FROM oa_operators WHERE id=? AND status='active'").bind(s.recipient_id).first<{id:string;email:string;version:number;role:string}>()
 if(!p||p.email.toLowerCase()!==s.recipient_email)return null
 const result=[...authorityGuards(db,owner),db.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active') THEN 1 ELSE 0 END").bind(p.id,p.version),db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_auth_settings WHERE singleton=1 AND generation=?) THEN 1 ELSE 0 END').bind(s.generation)]
 if(s.audience==='manager'){
  const office=await officeAuthority(db,job,p.id,true);if(!office)return null
  result.push(...authorityGuards(db,office))
 }else if(s.audience==='client'&&!await clientAccess(db,job,p.email))return null
 if(s.kind==='packet'&&!['billing','photos'].every(feature=>portalEnabled(job,'client',feature)))return null
 // A grant cannot widen a custom role or bypass an internal assignment.
 const team=await teamGrant(db,p.id)
 if(team&&s.audience!=='manager')return null
 return result
}
async function save(db:D1Database,previous:ReportJob,next:ReportJob,checks:D1PreparedStatement[],actor?:Actor,clock?:number){
 const seen=clock??await readClock(db);next.version=previous.version+1
 const data=JSON.stringify(next);need(data.length<=8_000_000,'Report packet history is full; pause schedules and archive the job',409,'report_limit')
 const writes=[...checks,db.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(next.version,data,next.id,previous.version)]
 if(actor)return transaction(db,actor,previous,writes,seen,{action:'report.schedule',job_id:next.id})
 try{await db.batch([db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_clock WHERE id=1 AND version=?) AND EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(seen,previous.id,previous.version),...writes,auditStatement(db,automation('report-scheduler','Scheduled reports'),{kind:'automation',action:'report.delivery',job_id:next.id}),db.prepare('UPDATE pl_clock SET version=version+1 WHERE id=1'),db.prepare('DELETE FROM pl_guard')])}
 catch(error){if(/CHECK constraint|UNIQUE constraint/.test(String(error)))throw new DomainError('conflict','Report authority changed',409);throw error}
}
export async function reportScheduleResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>):Promise<Response|null>{
 if(parts[0]!=='report-schedules')return null
 need(actor.role!=='agent','A signed-in person is required',403,'forbidden')
 if(parts.length===2&&parts[1]==='run-due'&&request.method==='POST'){requireOwner(actor);await body(request);await dispatchReportSchedules(env,Date.now());return json({checked:true})}
 const owner=actor.role==='owner',all=await jobs(env.DB) as ReportJob[]
 const accessible: {job_id:string;job_name:string;schedule:ReturnType<typeof summary>}[]=[]
 for(const job of all)for(const s of job.report_schedules??[])if(owner||s.recipient_id===actor.id&&await guards(env.DB,job,s))accessible.push({job_id:job.id,job_name:job.name,schedule:summary(s)})
 if(parts.length===1&&request.method==='GET')return json({schedules:accessible})
 if(parts.length===1&&request.method==='POST'){
  requireOwner(actor);const input=await body(request),clock=await readClock(env.DB),job=await jobOf(env.DB,actor,text(input.job_id,'job',100)) as ReportJob
  need(input.expected_version===job.version,'Job changed; reload',409,'stale_version');need(input.confirm===true,'Confirm recurring delivery to this named person',400,'consent')
  need(['manager','client','lender'].includes(String(input.audience)),'Choose a packet audience')
  need(['weekly','monthly'].includes(String(input.cadence)),'Choose weekly or monthly')
  const p=await env.DB.prepare("SELECT id,email FROM oa_operators WHERE lower(email)=? AND status='active'").bind(text(input.recipient_email,'Recipient email',254).toLowerCase()).first<{id:string;email:string}>();need(p,'Invite this person and have them sign in first',400,'recipient')
  const s:ReportSchedule={id:crypto.randomUUID(),kind:input.audience==='manager'?'digest':'packet',audience:input.audience as ReportSchedule['audience'],cadence:input.cadence as ReportSchedule['cadence'],anchor_on:warrantyDay(input.anchor_on,'First report date'),recipient_id:p.id,recipient_email:p.email.toLowerCase(),owner_id:actor.id,owner_version:actor.version,generation:await warrantyGeneration(env.DB),status:'active',consent:stamp(actor),deliveries:[]}
  need(s.anchor_on>=new Date(Date.now()).toISOString().slice(0,10),'Choose today or a future date')
  const checks=await guards(env.DB,job,s);need(checks,'The recipient has no current authority for this report',403,'recipient')
  const next=structuredClone(job);need((next.report_schedules??[]).length<20,'This job has reached its report schedule limit');(next.report_schedules??=[]).push(s)
  await save(env.DB,job,next,checks,actor,clock);return json({schedule:summary(s)},201)
 }
 const match=accessible.find(r=>r.schedule.id===parts[1]);need(match,'Report schedule not found',404,'not_found')
 const job=all.find(j=>j.id===match.job_id)!,s=job.report_schedules!.find(s=>s.id===parts[1])!
 if(parts.length===2&&request.method==='DELETE'){
  requireOwner(actor);await body(request);const next=structuredClone(job);next.report_schedules!.find(r=>r.id===s.id)!.status='paused';await save(env.DB,job,next,[],actor);return json({paused:true})
 }
 need(parts.length===4&&parts[2]==='downloads'&&request.method==='GET','Unknown report schedule route',404,'not_found')
 const delivery=s.deliveries.find(d=>d.id===parts[3]);need(delivery,'Packet not found',404,'not_found')
 const checks=await guards(env.DB,job,s);need(checks,'This report grant is no longer current',404,'not_found')
 await transaction(env.DB,actor,job,checks,undefined,{kind:'export',action:'report.download',job_id:job.id,subject_id:delivery.id})
 return new Response(JSON.stringify(delivery.content,null,2),{headers:{...headers,'content-type':'application\u002fjson','content-disposition':'attachment; filename=plinth-report-packet.json','content-security-policy':"sandbox; default-src 'none'"}})
}
export async function dispatchReportSchedules(original:Bindings,now:number){
 const env=runtimeBindings(original);let attempts=0
 for(const initial of await jobs(env.DB) as ReportJob[])for(const candidate of initial.report_schedules??[]){
  if(attempts>=20)return
  const clock=await readClock(env.DB),job=await loadWarrantyJob(env.DB,initial.id) as ReportJob|null,s=job?.report_schedules?.find(s=>s.id===candidate.id)
  if(!job||!s)continue
  const due_on=due(s,now);if(!due_on)continue
  const checks=await guards(env.DB,job,s);if(!checks)continue
  const content=s.kind==='packet'?await drawPacket(env.DB,job,now):await managerDigest(env.DB,job,s,now)
  const next=structuredClone(job),schedule=next.report_schedules!.find(r=>r.id===s.id)!,delivery:ReportDelivery={id:crypto.randomUUID(),due_on,generated_at:new Date(now).toISOString(),content,status:'unknown',label:'Send reserved; provider outcome unknown. No automatic resend.'}
  if(schedule.deliveries.length>=100)continue;schedule.deliveries.push(delivery)
  try{await save(env.DB,job,next,checks,undefined,clock)}catch(error){if(error instanceof DomainError&&error.code==='conflict')continue;throw error}
  attempts++
  let outcome:{status:string;label:string}=statusOf({status:'uncertain'}),providerId:string|undefined
  try{
   const suppressed=await suppression(env.DB,s.recipient_email),sender=operatorMail(env)
   if(suppressed)outcome={status:'suppressed',label:'Optional report notice suppressed; no message sent'}
   else if(!sender||!env.MAIL_FROM)outcome={status:'unconfigured',label:'Mail is not configured; nothing was sent'}
   else{
    const current=await loadWarrantyJob(env.DB,job.id) as ReportJob|null,currentSchedule=current?.report_schedules?.find(r=>r.id===s.id),fresh=current&&currentSchedule?await guards(env.DB,current,currentSchedule):null
    need(current&&fresh,'Report authority changed',409,'conflict');await checkWarrantySend(env.DB,current,await readClock(env.DB),fresh)
    const optional=await optionalNotice(env,s.recipient_email),link=new URL('/api/plinth/report-schedules/'+s.id+'/downloads/'+delivery.id,env.AUTH_ORIGIN).href
    const message=await sender.send({deliveryId:delivery.id,from:env.MAIL_FROM,to:[s.recipient_email],subject:'Your scheduled Plinth '+(s.kind==='digest'?'manager digest':'draw packet'),text:'Sign in to download your permission-scoped report: '+link+(optional?.text??''),html:'<p>Sign in to Plinth to download your scheduled report.</p>',headers:{},...(optional?.unsubscribe?{unsubscribe:optional.unsubscribe}:{})})
    outcome=statusOf(message);if('providerMessageId' in message)providerId=String(message.providerMessageId)
   }
  }catch{outcome={status:'unknown',label:'Provider outcome unknown. No automatic resend.'}}
  const current=await loadWarrantyJob(env.DB,job.id) as ReportJob|null
  if(current){const finished=structuredClone(current),entry=finished.report_schedules?.find(r=>r.id===s.id)?.deliveries.find(d=>d.id===delivery.id);if(entry){Object.assign(entry,outcome,...(providerId?[{provider_message_id:providerId}]:[]));try{await save(env.DB,current,finished,[])}catch(error){if(!(error instanceof DomainError&&error.code==='conflict'))throw error}}}
 }
}
async function managerDigest(db:D1Database,job:Job,s:ReportSchedule,now:number){
 const p=await db.prepare('SELECT id,email,display_name,role,version FROM oa_operators WHERE id=?').bind(s.recipient_id).first<{id:string;email:string;display_name:string;role:'owner'|'admin';version:number}>();need(p,'Recipient unavailable')
 const grant=await teamGrant(db,p.id),actor:Actor={id:p.id,email:p.email,name:p.display_name,role:grant?'project_manager':p.role,version:p.version,...(grant?{team:{version:grant.version,job_ids:grant.grant.job_ids,po_limit_cents:grant.grant.po_limit_cents}}:{})}
 const record=(await reportRecords(db,actor,'job')).find(r=>r.id===job.id);need(record,'Job unavailable')
 return {format:'plinth-manager-digest-v1',as_of:new Date(now).toISOString(),job_id:job.id,job_name:job.name,values:record.values}
}
