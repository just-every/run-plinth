import type { Bindings } from '../auth.server'
import { requireOwner } from './auth'
import { need, object, stamp, text, type Actor, type Input, type Job } from './model'
import { jobOf, readClock, saveJob } from './store'
import { warrantyGeneration, officeAuthority } from './warranty-store'
import { clientAccess } from './job-customers'
import { portalEnabled } from './portal-policy'
import { teamGrant } from './team'
import { roleOf } from './role-store'
import { presets } from './role-model'
import { invoiceBalance } from './invoices'
import { suppression } from './mail-store'
import { day } from './purchase-order-model'
import { wallClock, nextDate, timeZone } from './time-zone'
import type { FollowupKind, FollowupRevision, FollowupSource, FollowupAction } from './followup-model'
const kinds:FollowupKind[]=['estimate','selection','collection']
const state=(job:Job)=>job.followup??{rules:[],consents:[]}
const kindOf=(input:unknown)=>{need(kinds.includes(input as FollowupKind),'Choose an estimate, selection or collection sequence');return input as FollowupKind}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}})
const instant=(value:unknown)=>{need(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value)),'Choose a dated preview instant with a time zone');return Date.parse(value)}
const clockTime=(value:unknown)=>{need(typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value),'Quiet hours use HH:MM');return value}
const dateAt=(at:string,zone:string)=>wallClock(Date.parse(at),zone).date
/** The live sources are read afresh; no preview can keep a resolved source eligible. */
export function followupSources(job:Job):FollowupSource[]{
 const quotes=job.quotes.slice(-1).map(q=>({id:q.id,revision:String(q.revision),kind:'estimate' as const,title:'Estimate revision '+q.revision,event_on:dateAt(q.prepared_by.at,job.time_zone??'UTC'),scheduled_on:dateAt(q.prepared_by.at,job.time_zone??'UTC'),amount_cents:q.total_cents,outstanding:q.status==='draft'&&job.status==='quoting'}))
 const selections=(job.selections??[]).flatMap(s=>{const r=s.revisions.at(-1);return !r||r.status==='draft'?[]:[{id:s.id,revision:r.id,kind:'selection' as const,title:r.room+' · '+r.category,event_on:dateAt(r.presented_by!.at,job.time_zone??'UTC'),scheduled_on:r.decision_on,amount_cents:Math.max(r.allowance_cents,...r.options.map(o=>o.price_cents)),outstanding:r.status==='presented'&&!s.decisions?.some(d=>d.revision_id===r.id&&['withdraw','dispute'].includes(d.kind))}]})
 const invoices=(job.invoices??[]).filter(i=>i.issued).map(i=>({id:i.id,revision:i.number!,kind:'collection' as const,title:i.number+' · '+i.description,event_on:i.due_on,scheduled_on:i.due_on,amount_cents:Math.max(0,invoiceBalance(job,i).due_cents),outstanding:invoiceBalance(job,i).due_cents>0}))
 return [...quotes,...selections,...invoices]
}
async function currentRecipient(db:D1Database,job:Job,id:string,kind:FollowupKind){
 const p=await db.prepare("SELECT id,email,display_name,role FROM oa_operators WHERE id=? AND status='active'").bind(id).first<{id:string;email:string;display_name:string;role:string}>()
 if(!p)return null
 if(p.role==='owner')return p
 const feature=kind==='estimate'?'estimates':kind==='selection'?'selections':'invoices'
 if(p.role==='member')return await clientAccess(db,job,p.email)&&portalEnabled(job,'client',kind==='estimate'?'contracts':kind==='selection'?'selections':'billing')?p:null
 if(p.role!=='admin')return null
 const t=await teamGrant(db,p.id),r=t?.grant.role==='custom'?await roleOf(db,t.grant.role_id??''):null
 if(t?.grant.role==='custom'&&!r)return null
 // Job assignment narrows every custom copy here, including administrator copies.
 if(t&&(!['project_manager','custom'].includes(t.grant.role)||!t.grant.job_ids.includes(job.id)))return null
 if(r&&(!['admin','project_manager'].includes(presets[r.role.copy_of].base)||!r.role.permissions[feature].view||!r.role.financial_visible))return null
 return p
}
async function revision(db:D1Database,actor:Actor,input:Input,number:number):Promise<FollowupRevision>{
 need(input.confirm===true,'Confirm this preview configuration; no delivery is authorized')
 const recipients=input.recipients
 need(Array.isArray(recipients)&&recipients.length>0&&recipients.length<=20,'Choose one to 20 named recipients')
 const ids=recipients.map(id=>text(id,'Recipient',100));need(new Set(ids).size===ids.length,'Choose each recipient once')
 const steps=input.steps;need(Array.isArray(steps)&&steps.length>0&&steps.length<=8,'Choose one to eight sequence steps')
 let previous=-1
 const parsed=steps.map((s,index)=>{const v=object(s),offset=v.after_days;need(Number.isInteger(offset)&&Number(offset)>=0&&Number(offset)<=3650&&Number(offset)>previous,'Step days must increase from zero to 3650');previous=Number(offset);need(typeof v.escalate==='boolean','Choose reminder or escalation');return {id:'step-'+(index+1),label:text(v.label,'Step label',120),after_days:Number(offset),escalate:v.escalate}})
 need(input.mode==='event'||input.mode==='scheduled','Choose event or scheduled preview')
 const starts_on=day(input.starts_on,'Sequence start'),stop_on=day(input.stop_on,'Sequence stop');need(stop_on>=starts_on,'Stop date must follow the start')
 need(Number.isSafeInteger(input.approval_limit_cents)&&Number(input.approval_limit_cents)>=0,'Choose a nonnegative whole-cent review limit')
 const quiet_start=clockTime(input.quiet_start),quiet_end=clockTime(input.quiet_end);need(quiet_start!==quiet_end,'Choose distinct quiet-hour boundaries')
 const escalation_recipient=text(input.escalation_recipient,'Escalation owner',100);need(escalation_recipient===actor.id,'Escalation stays with the configuring owner')
 return {revision:number,by:stamp(actor),generation:await warrantyGeneration(db),mode:input.mode,starts_on,stop_on,recipients:ids,escalation_recipient,quiet_start,quiet_end,time_zone:timeZone(input.time_zone),approval_limit_cents:Number(input.approval_limit_cents),steps:parsed,paused:input.paused===true,reason:text(input.reason,'Revision reason',2000)}
}
export async function followupPreview(db:D1Database,job:Job,asOf:number){
 const actions:FollowupAction[]=[],generation=await warrantyGeneration(db)
 for(const rule of state(job).rules){
  const r=rule.revisions.at(-1)!,local=wallClock(asOf,r.time_zone),hhmm=String(local.hour).padStart(2,'0')+':'+String(local.minute).padStart(2,'0')
  const quiet=r.quiet_start<r.quiet_end?hhmm>=r.quiet_start&&hhmm<r.quiet_end:hhmm>=r.quiet_start||hhmm<r.quiet_end
  const owner=await officeAuthority(db,job,r.by.id,true)
  const optedOut=r.recipients.some(id=>state(job).consents.findLast(c=>c.person_id===id&&c.kind===rule.kind)?.allowed===false)
  for(const source of followupSources(job).filter(s=>s.kind===rule.kind)){
   const anchor=r.mode==='event'?source.event_on:[source.scheduled_on,r.starts_on].sort().at(-1)!
   for(const step of r.steps){
    const due_on=nextDate(anchor,step.after_days)
    for(const id of step.escalate?[r.escalation_recipient]:r.recipients){
     const p=await currentRecipient(db,job,id,rule.kind)
     const consent=state(job).consents.findLast(c=>c.person_id===id&&c.kind===rule.kind)
     const suppressed=p?await suppression(db,p.email):null
     const reason=r.paused?'Rule paused':r.generation!==generation||!owner||owner.role!=='owner'?'Owner authority changed; review the rule again':!source.outstanding?'Source resolved or held':optedOut?'Recipient opted out; sequence stopped':local.date<r.starts_on?'Sequence not started':local.date>r.stop_on?'Stop date passed':due_on>local.date?'Step not due':source.amount_cents>r.approval_limit_cents?'Amount exceeds owner review limit':!p?'Recipient has no current access':!consent?.allowed?'Recipient consent is off':suppressed?'Mailbox suppression requires owned follow-up':quiet?'Recipient quiet hours':'Prospective action only; nothing sent'
     actions.push({key:[rule.id,source.id,source.revision,step.id,id].join(':'),rule_id:rule.id,rule_revision:r.revision,source_id:source.id,source_revision:source.revision,source_title:source.title,step_id:step.id,step:step.label,due_on,recipient_id:id,recipient_name:p?.display_name??'Unavailable recipient',escalation:step.escalate,status:reason==='Prospective action only; nothing sent'?'eligible':'withheld',reason})
    }
   }
  }
 }
 return {as_of:new Date(asOf).toISOString(),job_version:job.version,actions,label:'Read-only preview. No notice, task, financial approval or provider instruction is created.'}
}
export async function followupResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>):Promise<Response|null>{
 if(parts[0]!=='jobs'||!parts[1]||!['followup-rules','followup-consent'].includes(parts[2]))return null
 need(parts.length===3||parts.length===4&&parts[2]==='followup-rules'&&parts[3]==='preview','Unknown follow-up route',404,'not_found')
 need(actor.role!=='agent','A signed-in person is required',403,'forbidden')
 const consentRoute=parts[2]==='followup-consent'
 if(!consentRoute)requireOwner(actor)
 const clock=await readClock(env.DB),job=await jobOf(env.DB,actor,parts[1])
 if(request.method==='GET'){
  if(consentRoute)return json({version:job.version,kinds:(await Promise.all(kinds.map(async k=>await currentRecipient(env.DB,job,actor.id,k)?k:null))).filter(Boolean),consents:state(job).consents.filter(c=>c.person_id===actor.id)})
  if(parts[3]==='preview')return json(await followupPreview(env.DB,job,instant(new URL(request.url).searchParams.get('as_of'))))
  const people=await env.DB.prepare("SELECT id,display_name,email FROM oa_operators WHERE status='active' ORDER BY display_name").all<{id:string;display_name:string;email:string}>()
  const recipients=[]
  for(const p of people.results)if(await Promise.all(kinds.map(k=>currentRecipient(env.DB,job,p.id,k))).then(a=>a.some(Boolean)))recipients.push(p)
  return json({version:job.version,owner_id:actor.id,rules:state(job).rules,consents:state(job).consents,recipients,sources:followupSources(job)})
 }
 need(request.method==='POST'&&parts.length===3,'Method not allowed',405,'method_not_allowed')
 const input=await body(request);need(input.expected_version===job.version,'Job changed; reload before saving',409,'stale_version')
 const next=structuredClone(job);next.followup??={rules:[],consents:[]}
 const kind=kindOf(input.kind)
 if(consentRoute){
  need(await currentRecipient(env.DB,job,actor.id,kind),'This sequence is unavailable to your current grant',403,'forbidden')
  need(typeof input.allowed==='boolean'&&input.confirm===true,'Confirm your own follow-up preview preference')
  next.followup.consents.push({kind,person_id:actor.id,allowed:input.allowed,by:stamp(actor)})
 }else{
  const existing=next.followup.rules.find(r=>r.kind===kind),r=await revision(env.DB,actor,input,(existing?.revisions.length??0)+1)
  for(const id of [...r.recipients,r.escalation_recipient])need(await currentRecipient(env.DB,job,id,kind),'Recipient needs current access to this sequence',403,'recipient')
  if(existing)existing.revisions.push(r)
  else next.followup.rules.push({id:crypto.randomUUID(),kind,revisions:[r]})
 }
 await saveJob(env.DB,actor,job,next,[],clock)
 return json({version:next.version,...(consentRoute?{consents:next.followup.consents.filter(c=>c.person_id===actor.id)}:{rules:next.followup.rules})})
}
