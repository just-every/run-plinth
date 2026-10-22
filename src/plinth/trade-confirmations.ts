import {portalEnabled} from './portal-policy'
import { scopeContact } from './scope-contacts'
import type { Bindings } from '../auth.server'
import { requireJobManager } from './auth'
import { find, need, stamp, text, type Actor, type Input, type Job } from './model'
import { checkConflicts, scheduleTime } from './operations'
import { invitationSnapshot, type TradeInvitation } from './schedule-resource-model'
import { requireResources, resources, resourceConflicts } from './schedule-resources'
import { jobs, readClock, saveJob } from './store'
const json=(v:unknown)=>Response.json(v,{headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
export async function inviteTrade(db:D1Database,job:Job,actor:Actor,input:Input,taskId:string){
 requireJobManager(actor);const task=find(job.schedules,taskId);need(task.status==='booked'&&!task.milestone,'Invite a booked work task',409,'schedule_state')
 const email=text(input.email,'Invited trade contact email',254).toLowerCase()
 need(await db.prepare("SELECT 1 FROM oa_operators WHERE lower(email)=? AND role='member' AND status='active'").bind(email).first(),'First invite this person through People & access',409,'contact_required')
 const scope=await scopeContact(db,job,email,text(input.subcontract_id,'Released subcontract scope',100),task.trade);need(scope,'The invited person must be an assigned contact of this task trade’s released company scope',403,'scope_required')
 const snapshot=invitationSnapshot(task)
 need(!job.trade_invitations?.some(i=>i.task_id===taskId&&i.email===email&&i.snapshot===snapshot),'This contact already has this exact invitation',409,'invitation_exists')
 const invitation:TradeInvitation={subcontract_id:scope.id,id:crypto.randomUUID(),task_id:task.id,email,invited_by:stamp(actor),snapshot,start:task.start,end:task.end,responses:[]}
 ;(job.trade_invitations??=[]).push(invitation);return invitation
}
/** A separate, deliberately narrow portal: invitation access never becomes client/job access. */
export async function tradePortalResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>){
 if(parts[0]!=='trade-confirmations')return null
 need(actor.role==='member','Sign in as the personally invited trade contact',403,'trade_required')
 const clock=await readClock(env.DB),all=await jobs(env.DB),catalog=await resources(env.DB)
 const visible=(await Promise.all(all.map(async job=>{const invitations=[];for(const i of job.trade_invitations??[])if(portalEnabled(job,'subcontractor','schedule')&&i.email===actor.email.toLowerCase()&&await scopeContact(env.DB,job,actor.email,i.subcontract_id,find(job.schedules,i.task_id).trade))invitations.push(i);return invitations.map(invitation=>{const task=find(job.schedules,invitation.task_id),conflicts=resourceConflicts(catalog,all,job);return {id:invitation.id,job_id:job.id,expected_version:job.version,job_name:job.name,address:job.address,task:{id:task.id,description:task.description,trade:task.trade,start:task.start,end:task.end,status:task.status,travel_minutes:task.travel_minutes??0},start:invitation.start,end:invitation.end,current:invitation.snapshot===invitationSnapshot(task),at_risk:invitation.snapshot!==invitationSnapshot(task)||conflicts.length>0||invitation.responses.at(-1)?.kind!=='confirm',responses:invitation.responses}})}))).flat()
 if(request.method==='GET'&&parts.length===1)return json({invitations:visible})
 need(request.method==='POST'&&parts.length===3&&['confirm','alternative'].includes(parts[2]),'Unknown trade confirmation route',404,'not_found')
 const permitted=find(visible,parts[1]),previous=find(all,permitted.job_id),input=await body(request);need(input.expected_version===previous.version,'The booking changed. Review the current invitation.',409,'stale_version')
 const job=structuredClone(previous),invitation=find(job.trade_invitations!,parts[1]),task=find(job.schedules,invitation.task_id)
 need(invitation.snapshot===invitationSnapshot(task)&&task.status==='booked','The booking changed; request a new invitation',409,'invitation_stale')
 need(invitation.responses.at(-1)?.kind!=='confirm','The exact slot was already confirmed',409,'immutable')
 const kind=parts[2] as 'confirm'|'alternative',start=kind==='confirm'?task.start:scheduleTime(input,'start'),end=kind==='confirm'?task.end:scheduleTime(input,'end');need(end>start,'Alternative must end after it starts')
 if(kind==='confirm'){need(input.confirm===true,'Explicitly confirm the exact invited dates');checkConflicts(all,job,task);await requireResources(env.DB,job,all,actor)}
 invitation.responses.push({kind,start,end,reason:text(input.reason,kind==='confirm'?'Confirmation statement':'Alternative reason',2000),by:stamp(actor)})
 await saveJob(env.DB,actor,previous,job,[],clock)
 return json({response:invitation.responses.at(-1),label:kind==='confirm'?'Exact invited dates explicitly confirmed':'Alternative proposed, not booked; a builder must review feasibility and issue a new invitation'})
}
