import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { authGuard, requireOwner } from './auth'
import { auditStatement, automation, jobRef } from './audit'
import { DomainError, need, type Actor, type Job } from './model'
import { jobs, readClock } from './store'
import { authorityGuards, checkWarrantySend, loadWarrantyJob, officeAuthority, warrantyGeneration } from './warranty-store'
import { currentRecipient, followupPreview, state } from './followup-rules'
import { mirrorSend, suppression } from './mail-store'
import { oneLine, optionalNotice } from './mail-model'
import type { FollowupAction, FollowupAttempt } from './followup-model'

async function save(db:D1Database,previous:Job,next:Job,clock:number,guards:D1PreparedStatement[]=[],actor?:Actor){
 next.version=previous.version+1
 const data=JSON.stringify(next);need(data.length<=8_000_000,'Follow-up history is too large')
 try{await db.batch([
  db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_clock WHERE id=1 AND version=?) AND EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(clock,previous.id,previous.version),
  ...(actor?[authGuard(db,actor)]:[]),...guards,
  db.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(next.version,data,next.id,previous.version),
  auditStatement(db,actor??automation('followup-scheduler','Owner follow-up scheduler'),{kind:'automation',action:'followup.dispatch',job_id:next.id,version_before:previous.version,version_after:next.version,before_ref:await jobRef(JSON.stringify(previous)),after_ref:await jobRef(data)}),
  db.prepare('UPDATE pl_clock SET version=version+1 WHERE id=1'),db.prepare('DELETE FROM pl_guard'),
 ])}catch(error){if(/CHECK constraint|UNIQUE constraint|job_erased|FOREIGN KEY constraint/.test(String(error)))throw new DomainError('conflict','Follow-up source or authority changed',409);throw error}
}
async function eligible(db:D1Database,job:Job,key:string,now:number,ignoreAttempt?:string){
 const action=(await followupPreview(db,job,now,ignoreAttempt)).actions.find(a=>a.key===key&&a.status==='eligible')
 if(!action)return null
 const rule=state(job).rules.find(r=>r.id===action.rule_id)!,revision=rule.revisions.at(-1)!
 if(!revision.delivery)return null
 const consent=state(job).consents.findLast(c=>c.kind===rule.kind&&c.person_id===action.recipient_id)
 // Old preview-only consents never authorize delivery, including required notices.
 if(!consent?.channel||consent.channel==='off'&&!revision.required)return null
 const owner=await officeAuthority(db,job,revision.by.id,true),recipient=await currentRecipient(db,job,action.recipient_id,rule.kind)
 if(!owner||owner.role!=='owner'||!recipient)return null
 const person=await db.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active'").bind(recipient.id).first<{version:number}>()
 if(!person)return null
 const guards=[...authorityGuards(db,owner),db.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active') THEN 1 ELSE 0 END").bind(recipient.id,person.version),db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_auth_settings WHERE singleton=1 AND generation=?) THEN 1 ELSE 0 END').bind(await warrantyGeneration(db))]
 const suppressed=await suppression(db,recipient.email)
 return {action,revision,recipient,guards,preference_revision:state(job).consents.lastIndexOf(consent)+1,owner_followup:!!suppressed&&suppressed.reason!=='unsubscribed'}
}
async function finish(db:D1Database,jobId:string,id:string,outcome:Pick<FollowupAttempt,'status'|'label'>&Partial<Pick<FollowupAttempt,'provider_message_id'>>,now:number){
 for(let n=0;n<3;n++){
  const clock=await readClock(db),previous=await loadWarrantyJob(db,jobId)
  if(!previous)return
  const next=structuredClone(previous),attempt=state(next).attempts?.find(a=>a.id===id)
  if(!attempt||attempt.status!=='unknown'||attempt.completed_at)return
  Object.assign(attempt,outcome,{completed_at:new Date(now).toISOString()})
  try{await save(db,previous,next,clock);await db.prepare("UPDATE pl_mail_messages SET status=?,label=?,provider_message_id=COALESCE(provider_message_id,?),status_at=? WHERE id=? AND status='unknown'").bind(outcome.status,outcome.label,outcome.provider_message_id??null,new Date(now).toISOString(),id).run();return}
  catch(error){if(!(error instanceof DomainError)||error.code!=='conflict')throw error}
 }
}
async function dispatchOne(env:Bindings,jobId:string,action:FollowupAction,now:number,actor?:Actor){
 const clock=await readClock(env.DB),previous=await loadWarrantyJob(env.DB,jobId)
 if(!previous)return false
 const permitted=await eligible(env.DB,previous,action.key,now)
 if(!permitted)return false
 need((state(previous).attempts?.length??0)<4000,'Review the follow-up history before creating more notices')
 const next=structuredClone(previous),r=permitted.revision
 const attempt:FollowupAttempt={id:crypto.randomUUID(),key:action.key,rule_id:action.rule_id,rule_revision:r.revision,source_id:action.source_id,source_revision:action.source_revision,step_id:action.step_id,recipient_id:action.recipient_id,preference_revision:permitted.preference_revision,channel:permitted.owner_followup?'owner_followup':'email',required:!!r.required,...(r.required_reason?{required_reason:r.required_reason}:{}),owner_id:r.by.id,reserved_at:new Date(now).toISOString(),status:'unknown',label:'Reserved; provider outcome unknown. No automatic resend.'}
 ;(next.followup!.attempts??=[]).push(attempt)
 await save(env.DB,previous,next,clock,permitted.guards,actor)
 let outcome:Pick<FollowupAttempt,'status'|'label'>&Partial<Pick<FollowupAttempt,'provider_message_id'>>={status:'unknown',label:'Provider outcome unknown; no automatic resend.'}
 try{
  const notice=attempt.required?null:await optionalNotice(env,permitted.recipient.email)
  const text=`There is outstanding follow-up work in ${previous.name}. Open your signed-in Plinth workspace to review only the records available to you. This notice approves no work or financial action.${attempt.required?'\nRequired notice: '+attempt.required_reason:''}${notice?.text??''}`
  const subject=oneLine('Plinth follow-up: '+previous.name)
  await mirrorSend(env.DB,{id:attempt.id,job_id:jobId,kind:'reminder',required:attempt.required,to:permitted.recipient.email,visibility:'private',subject,text,status:'unknown',label:attempt.label})
  // Read all source, consent and authority facts again after asynchronous preparation.
  const sendClock=await readClock(env.DB),latest=await loadWarrantyJob(env.DB,jobId)
  const current=latest?await eligible(env.DB,latest,action.key,now,attempt.id):null
  const surviving=latest?.followup?.attempts?.find(a=>a.id===attempt.id)
  if(!latest||!current||!surviving||surviving.status!=='unknown'||current.revision.revision!==attempt.rule_revision||current.preference_revision!==attempt.preference_revision){
   outcome={status:'cancelled',label:'Source, consent or authority changed; nothing sent.'}
  }else{
   await checkWarrantySend(env.DB,latest,sendClock,current.guards,actor)
   if(current.owner_followup){outcome={status:'owner_followup',label:'Mailbox unusable or provider suppressed. Configuring owner must arrange an authorized alternative; no email sent.'}}
   else{
    const sender=operatorMail(env)
    if(!sender||!env.MAIL_FROM)outcome={status:'unconfigured',label:'Mail is not configured; no automatic resend.'}
    else{
     const result=await sender.send({deliveryId:attempt.id,from:env.MAIL_FROM,to:[current.recipient.email],headers:{},subject,text,html:'<p>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\n','<br>')+'</p>',...(notice?.unsubscribe?{unsubscribe:notice.unsubscribe}:{})})
     if(result.status==='accepted')outcome={status:'accepted',label:'Accepted by the mail provider; delivery is not confirmed.',...(result.providerMessageId?{provider_message_id:result.providerMessageId}:{})}
     else if(result.status==='development')outcome={status:'development',label:'Development mail suppressed; nothing sent.'}
     else if(result.status==='rejected'||result.status==='rate_limited')outcome={status:'refused',label:'Provider refused this notice; no automatic resend.'}
    }
   }
  }
 }catch(error){if(error instanceof DomainError&&error.code==='conflict')outcome={status:'cancelled',label:'Authority or source changed before sending; nothing sent.'}}
 await finish(env.DB,jobId,attempt.id,outcome,now)
 return true
}
/** Bounded hourly work. Reservations, including unknown outcomes, consume a source step once. */
export async function dispatchFollowups(env:Bindings,options:{jobId?:string;actor?:Actor;now?:number}={}){
 if(options.actor){requireOwner(options.actor);need(options.jobId,'Choose one job for a person-run dispatch')}
 const now=options.now??Date.now(),all=options.jobId?[{id:options.jobId}]:await jobs(env.DB)
 const offset=all.length?Math.floor(now/3600000)*20%all.length:0
 const selected=options.jobId?all:[...all.slice(offset),...all.slice(0,offset)].slice(0,20)
 let attempts=0,conflicts=0
 for(const row of selected){
  const job=await loadWarrantyJob(env.DB,row.id);if(!job?.followup)continue
  for(const action of (await followupPreview(env.DB,job,now)).actions.filter(a=>a.status==='eligible')){
   if(attempts>=20)break
   try{if(await dispatchOne(env,row.id,action,now,options.actor))attempts++}
   catch(error){if(error instanceof DomainError&&error.code==='conflict')conflicts++;else throw error}
  }
 }
 return {attempts,conflicts,label:'Each reserved source step is attempted once. Provider acceptance is not delivery.'}
}
