import type { Bindings } from '../auth.server'
import { requireOwner } from './auth'
import { need, find, stamp, text, type Actor, type Input, type Job } from './model'
import { jobOf, readClock, saveJob } from './store'
import { officeAuthority, recipientGuards, warrantyGeneration } from './warranty-store'
import { portalEnabled } from './portal-policy'
import { createTodo } from './todo-model'
import { validateAssignees } from './todo-actions'
import { sendSurveyMail } from './satisfaction-mail'
import type { SatisfactionState, SatisfactionSurvey, SurveySettings } from './satisfaction-model'

export const satisfactionState = (job: Job): SatisfactionState => job.satisfaction ??= {settings_history:[],consents:[],surveys:[]}
const json = (value:unknown) => Response.json(value,{headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
export function surveyFeature(job:Job,kind:'handover'|'warranty') {return portalEnabled(job,'client',kind==='handover'?'handover':'warranty')}
function settings(actor:Actor,input:Input):SurveySettings {
 need(Array.isArray(input.questions)&&input.questions.length>0&&input.questions.length<=8,'Enter one to eight survey questions')
 need(Number.isInteger(input.low_score)&&Number(input.low_score)>=1&&Number(input.low_score)<=9,'Choose a low-score threshold from 1 to 9')
 const review_url=text(input.review_url,'Public review site',2000)
 let url:URL;try{url=new URL(review_url)}catch{need(false,'Choose a valid public review URL')}
 need(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&['g.page','search.google.com','www.google.com','google.com','maps.google.com','www.houzz.com','houzz.com'].includes(url.hostname),'Choose an HTTPS Google Business Profile or Houzz public review link')
 return {title:text(input.title,'Survey title',200),questions:input.questions.map(q=>text(q,'Survey question',500)),low_score:Number(input.low_score),review_url:url.href,by:stamp(actor)}
}
async function context(db:D1Database,job:Job,source:SatisfactionSurvey['source']) {
 const team=(await db.prepare("SELECT t.operator_id,t.data,o.display_name FROM pl_team t JOIN oa_operators o ON o.id=t.operator_id WHERE o.status='active'").all<{operator_id:string;data:string;display_name:string}>()).results.map(r=>({...r,grant:JSON.parse(r.data) as {role:string;job_ids:string[]}})).filter(r=>r.grant.job_ids.includes(job.id))
 const visit=job.warranties?.cases.flatMap(c=>c.service?.visits??[]).find(v=>v.id===source.id)
 return {
  managers:team.filter(r=>r.grant.role==='project_manager').map(r=>({id:r.operator_id,name:r.display_name})),
  crew:team.filter(r=>['crew','superintendent'].includes(r.grant.role)).map(r=>({id:r.operator_id,name:r.display_name})),
  subs:(job.subcontracts??[]).filter(s=>source.kind==='warranty'?s.id===visit?.assignment.subcontract_id:s.status==='released').map(s=>({id:s.vendor_id,name:s.vendor_name,trade:s.trade})),
 }
}
function source(job:Job,input:Input):SatisfactionSurvey['source'] {
 const id=text(input.source_id,'Completed source',100)
 if(input.source_kind==='handover'){
  const p=job.handover?.packages.find(p=>p.id===id)
  need(p?.completion&&p.acceptance,'Record builder completion and client handover acceptance first',409,'handover_required')
  return {kind:'handover',id,title:p.title}
 }
 need(input.source_kind==='warranty','Choose handover or warranty')
 const visit=job.warranties?.cases.flatMap(c=>c.service?.visits??[]).find(v=>v.id===id)
 need(visit?.submission,'A warranty visit must have submitted repair evidence first',409,'visit_required')
 return {kind:'warranty',id,title:'Warranty visit '+visit.start}
}
function projection(job:Job,actor:Actor,generation:number) {
 const state=satisfactionState(job),client=actor.role==='member'
 return {version:job.version,owner:actor.role==='owner',settings:client?undefined:state.settings,
  consent:client?state.consents.filter(c=>c.person_id===actor.id).at(-1):undefined,
  consents:client?undefined:[...new Map(state.consents.map(c=>[c.person_id,c])).values()].filter(c=>c.generation===generation&&c.email_surveys),
  sources:client?undefined:[...(job.handover?.packages??[]).filter(p=>p.acceptance&&p.completion).map(p=>({kind:'handover',id:p.id,title:p.title})),...(job.warranties?.cases??[]).flatMap(c=>(c.service?.visits??[]).filter(v=>v.submission).map(v=>({kind:'warranty',id:v.id,title:'Warranty visit '+v.start})))],
  surveys:state.surveys.filter(s=>!client||s.recipient.id===actor.id&&s.recipient.email===actor.email.toLowerCase()&&surveyFeature(job,s.source.kind)).map(s=>client?{id:s.id,source:s.source,settings:{title:s.settings.title,questions:s.settings.questions,review_url:s.settings.review_url},invitation:s.invitation,response:s.response,review_permission:s.review_permission,review_request:s.review_request}:s),
 }
}
/** Every survey door checks the current native person and job grant; no public bearer response link. */
export async function satisfactionResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>):Promise<Response|null> {
 if(parts[0]!=='jobs'||parts[2]!=='satisfaction')return null
 need(actor.role==='member'||['owner','admin','project_manager'].includes(actor.role),'Surveys require a signed-in client or office person',403,'forbidden')
 need(!actor.permissions||actor.permissions.matrix.documents.view,'Surveys are unavailable',403,'forbidden')
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,parts[1]!),generation=await warrantyGeneration(env.DB)
 if(actor.role==='member')need(surveyFeature(previous,'handover')||surveyFeature(previous,'warranty'),'Surveys unavailable',404,'not_found')
 if(request.method==='GET'){
  need(parts.length===3,'Unknown survey route',404,'not_found')
  return json(projection(previous,actor,generation))
 }
 need(request.method==='POST','Method not allowed',405,'method_not_allowed')
 const input=await body(request)
 need(input.expected_version===previous.version,'Job changed. Reload before changing surveys.',409,'stale_version')
 const job=structuredClone(previous),state=satisfactionState(job),verb=parts.at(-1)
 if(parts.length===4&&verb==='consent'){
  need(actor.role==='member','Only a client can choose their survey channel',403,'forbidden')
  need(typeof input.email_surveys==='boolean','Explicitly choose whether to receive email surveys')
  need(state.consents.length<1000,'Survey consent history is full')
  state.consents.push({person_id:actor.id,email:actor.email.toLowerCase(),email_surveys:input.email_surveys,generation,by:stamp(actor)})
 } else if(parts.length===4&&verb==='settings'){
  requireOwner(actor);need(state.settings_history.length<200,'Survey settings history is full')
  state.settings=settings(actor,input);state.settings_history.push(structuredClone(state.settings))
 } else if(parts.length===4&&verb==='send'){
  requireOwner(actor);need(input.confirm===true,'Confirm this survey send')
  need(state.settings,'Save survey settings first',409,'settings_required');need(state.surveys.length<500,'Survey history is full')
  const from=source(job,input),email=text(input.recipient_email,'Client email',254).toLowerCase()
  const consent=state.consents.filter(c=>c.email===email).at(-1)
  need(consent?.email_surveys&&consent.generation===generation&&surveyFeature(job,from.kind),'The client must currently consent to email surveys',403,'consent_required')
  const guards=await recipientGuards(env.DB,job,{kind:'client',email});need(guards,'The client is no longer assigned',403,'recipient')
  const person=await env.DB.prepare("SELECT id FROM oa_operators WHERE id=? AND lower(email)=? AND role='member' AND status='active'").bind(consent.person_id,email).first<{id:string}>();need(person,'The consenting client is no longer active',403,'recipient')
  need(!state.surveys.some(s=>s.generation===generation&&s.source.kind===from.kind&&s.source.id===from.id&&s.recipient.id===person.id),'This client already has a survey for this source; inspect the recorded send outcome',409,'survey_reserved')
  const follow=await officeAuthority(env.DB,job,text(input.follow_up_id,'Follow-up owner',100),true);need(follow,'Choose a currently assigned office follow-up owner',409,'assignee_grant')
  const name=(await env.DB.prepare('SELECT display_name FROM oa_operators WHERE id=?').bind(follow.id).first<{display_name:string}>())!.display_name
  const by=stamp(actor),survey:SatisfactionSurvey={id:crypto.randomUUID(),generation,source:from,recipient:{id:person.id,email},settings:structuredClone(state.settings),by,context:await context(env.DB,job,from),follow_up_owner:{id:follow.id,email:follow.email,name},invitation:{id:crypto.randomUUID(),status:'unknown',label:'Reserved; provider outcome unknown. No automatic resend.',by},permission_history:[]}
  state.surveys.push(survey)
  await saveJob(env.DB,actor,previous,job,guards,clock)
  await sendSurveyMail(env,actor,job.id,survey.id,'invitation')
  return json(projection(await jobOf(env.DB,actor,job.id),actor,generation))
 } else if(parts.length===5){
  const survey=find(state.surveys,parts[3]!)
  need(survey.generation===generation,'This restored survey is historical; request a fresh survey',409,'historical_survey')
  if(verb==='respond'||verb==='review-permission'){
   need(actor.role==='member'&&actor.id===survey.recipient.id&&actor.email.toLowerCase()===survey.recipient.email&&surveyFeature(job,survey.source.kind),'Survey not found',404,'not_found')
   if(verb==='respond'){
    need(!survey.response,'The recorded response is immutable',409,'immutable')
    need(Number.isInteger(input.score)&&Number(input.score)>=1&&Number(input.score)<=10,'Score must be from 1 to 10')
    need(Array.isArray(input.answers)&&input.answers.length===survey.settings.questions.length,'Answer each configured question')
    survey.response={score:Number(input.score),answers:input.answers.map(a=>text(a,'Survey answer',2000)),comment:text(input.comment,'Comment',4000,true),by:stamp(actor)}
    if(survey.response.score<=survey.settings.low_score){
     const current=await officeAuthority(env.DB,job,survey.follow_up_owner.id,true)
     // If the named manager has left, assign the active owner instead; no low response loses its follow-up.
     const owner=current??await env.DB.prepare("SELECT id,email FROM oa_operators WHERE role='owner' AND status='active'").first<{id:string;email:string}>();need(owner,'An active office follow-up owner is required',409,'assignee_grant')
     const todo=createTodo({title:'Satisfaction follow-up: '+survey.settings.title,notes:`Survey ${survey.id}: ${survey.response.score} of 10. ${survey.response.comment}`,due_at:new Date(Date.now()+86400000).toISOString(),priority:'high',tags:['satisfaction'],items:[{title:'Contact the client about their satisfaction response',assignee:{kind:'office',email:owner.email}}]},actor,job)
     await validateAssignees(env.DB,todo,job);(job.todos??=[]).push(todo);survey.follow_up={todo_id:todo.id,assignee_id:owner.id}
    }
   } else {
    need(typeof input.allowed==='boolean','Explicitly choose public review permission')
    const permission={allowed:input.allowed,url:survey.settings.review_url,by:stamp(actor)}
    need(survey.permission_history.length<200,'Review permission history is full')
    survey.review_permission=permission;survey.permission_history.push(structuredClone(permission))
   }
  } else if(verb==='request-review'){
   requireOwner(actor);need(input.confirm===true,'Confirm this review request')
   need(survey.review_permission?.allowed,'This client has not permitted a review request',403,'review_permission')
   need(!survey.review_request,'A review request attempt is already recorded',409,'review_reserved')
   survey.review_request={id:crypto.randomUUID(),status:'unknown',label:'Reserved; provider outcome unknown. No automatic resend.',by:stamp(actor)}
   await saveJob(env.DB,actor,previous,job,[],clock)
   await sendSurveyMail(env,actor,job.id,survey.id,'review_request')
   return json(projection(await jobOf(env.DB,actor,job.id),actor,generation))
  } else need(false,'Unknown survey action',404,'not_found')
 } else need(false,'Unknown survey action',404,'not_found')
 await saveJob(env.DB,actor,previous,job,[],clock)
 return json(projection(job,actor,generation))
}
