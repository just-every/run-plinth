import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { optionalNotice, oneLine } from './mail-model'
import { mirrorSend, suppression } from './mail-store'
import { readClock } from './store'
import { checkWarrantySend, loadWarrantyJob, recipientGuards, saveWarrantyJob, warrantyGeneration } from './warranty-store'
import { surveyFeature } from './satisfaction'
import type { Actor } from './model'
import type { SurveyDelivery } from './satisfaction-model'

/** A durable attempt exists before this function runs. Unknown and refused attempts are never retried. */
export async function sendSurveyMail(env:Bindings,actor:Actor,jobId:string,surveyId:string,kind:'invitation'|'review_request') {
 const clock=await readClock(env.DB),job=await loadWarrantyJob(env.DB,jobId),survey=job?.satisfaction?.surveys.find(s=>s.id===surveyId),attempt=survey?.[kind]
 if(!job||!survey||!attempt||attempt.status!=='unknown'||attempt.completed_at)return
 const outcome:SurveyDelivery={...attempt},email=survey.recipient.email
 let sent:{subject:string;text:string}|undefined
 try {
  const generation=await warrantyGeneration(env.DB),consent=job.satisfaction!.consents.filter(c=>c.person_id===survey.recipient.id&&c.email===email).at(-1)
  const guards=await recipientGuards(env.DB,job,{kind:'client',email})
  const person=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND lower(email)=? AND role='member' AND status='active'").bind(survey.recipient.id,email).first<{version:number}>()
  if(!guards||!person||survey.generation!==generation||!consent?.email_surveys||consent.generation!==generation||!surveyFeature(job,survey.source.kind)||kind==='review_request'&&!survey.review_permission?.allowed||await suppression(env.DB,email)) {
   outcome.status='cancelled';outcome.label='Current consent, recipient access or optional-mail preferences prevent this send'
  } else {
   await checkWarrantySend(env.DB,job,clock,[...guards,env.DB.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active') THEN 1 ELSE 0 END").bind(survey.recipient.id,person.version),env.DB.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_auth_settings WHERE singleton=1 AND generation=?) THEN 1 ELSE 0 END').bind(generation)],actor)
   const sender=operatorMail(env)
   if(!sender||!env.MAIL_FROM){outcome.status='unconfigured';outcome.label='Mail is not configured; nothing was sent'}
   else {
    const notice=await optionalNotice(env,email),subject=oneLine((kind==='invitation'?'Satisfaction survey: ':'Public review invitation: ')+job.name)
    const text=kind==='invitation'?`${survey.settings.title}\n${survey.source.title}\nPlease score your experience from 1 to 10 and answer these questions:\n${survey.settings.questions.join('\n')}\nComments are welcome.\nOpen your signed-in client portal: ${env.AUTH_ORIGIN}/app?job=${job.id}&tab=Handover\nYour response stays with this job. A public review request needs your separate permission.`:`You permitted a public review invitation for ${job.name}.\nShare your honest experience at ${survey.settings.review_url}\nEvery score is eligible. Plinth never filters, gates or edits public reviews.`
    sent={subject,text:text+notice.text}
    const result=await sender.send({deliveryId:attempt.id,from:env.MAIL_FROM,to:[email],headers:{},...sent,html:`<pre>${sent.text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</pre>`,...(notice.unsubscribe?{unsubscribe:notice.unsubscribe}:{})})
    if(result.status==='accepted'){outcome.status='accepted';outcome.label='Accepted by the mail provider; delivery is not confirmed';outcome.provider_message_id=result.providerMessageId??undefined}
    else if(result.status==='development'){outcome.status='development';outcome.label='Development mail suppressed; nothing was sent'}
    else if(result.status==='rejected'||result.status==='rate_limited'){outcome.status='refused';outcome.label='The provider refused this message; no automatic resend'}
   }
  }
 } catch { /* A provider may have accepted before a transport error. Preserve unknown without retry. */ }
 // Outcome recording updates only an existing surviving attempt, never an erased job or newer consent.
 for(let retry=0;retry<3;retry++){
  const seen=await readClock(env.DB),previous=await loadWarrantyJob(env.DB,jobId)
  if(!previous)return
  const next=structuredClone(previous),delivery=next.satisfaction?.surveys.find(s=>s.id===surveyId)?.[kind]
  if(!delivery||delivery.id!==attempt.id||delivery.completed_at)return
  Object.assign(delivery,outcome,{completed_at:new Date(Date.now()).toISOString()})
  try {await saveWarrantyJob(env.DB,previous,next,seen);break} catch {if(retry===2)return}
 }
 if(sent)await mirrorSend(env.DB,{id:attempt.id,job_id:jobId,kind:kind==='invitation'?'satisfaction_survey':'review_request',required:false,to:email,visibility:'private',...sent,status:outcome.status==='accepted'?'accepted':outcome.status==='development'?'development':outcome.status==='refused'?'refused':'unknown',label:outcome.label,provider_message_id:outcome.provider_message_id})
}
