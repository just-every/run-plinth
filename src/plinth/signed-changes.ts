import { enqueueContinuity, linkContinuityClaim } from './continuity'
import { requireJobManager, personActor } from './auth'
import { active, find, need, object, recordApproval, stamp, text, usdOnly, type Actor, type Input, type Job } from './model'
import { clientAccess } from './job-customers'
import { holds } from './role-model'
import { previewSchedule, publishSchedule } from './schedule-plan'
import { workingCalendar, workingMinutes } from './schedule-calendar'
import { wallClock, zonedInstant, nextDate } from './time-zone'
import { sovSources, prepareSov } from './sov'
import { approveVariation } from './quotes'
import { reviseBudget } from './budget'
import { prepareClaim } from './claims'
import { invoiceAction } from './invoices'
import type { ChangeJob, ChangeSigner, SignedChange } from './signed-change-model'

const canonical = (value: unknown): string => Array.isArray(value) ? '['+value.map(canonical).join(',')+']' : value && typeof value==='object' ? '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}' : JSON.stringify(value) ?? 'null'
export async function changeDigest(value: unknown) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),b=>b.toString(16).padStart(2,'0')).join('')}
export const changes = (job: Job) => (job as ChangeJob).signed_changes ?? []
export function changeOffice(actor: Actor, apply=false) {
 requireJobManager(actor)
 if(actor.permissions){const p=actor.permissions;need(p.financial&&holds({permissions:p.matrix},'changes','approve')&&(!apply||['budgets','schedule','invoices'].every(f=>holds({permissions:p.matrix},f as 'budgets','approve'))),'Current change, budget, schedule and billing approval authority is required',403,'forbidden')}
}
function signer(actor: Actor): ChangeSigner {return {id:actor.id,name:actor.name,version:actor.version,role:actor.role,team_version:actor.team?.version??null,role_version:actor.permissions?.role_version??null,role_id:actor.permissions?.role_id??null}}
async function currentSigner(db: D1Database, job: Job, saved: ChangeSigner, side: 'builder'|'client') {
 const row=await db.prepare("SELECT id,email,display_name,role,version FROM oa_operators WHERE id=? AND status='active'").bind(saved.id).first<{id:string;email:string;display_name:string;role:string;version:number}>()
 need(row,'A designated signer is no longer active; prepare a new document',409,'change_signer')
 const actor=await personActor(db,{...row,displayName:row.display_name},{method:'POST',path:'/api/plinth/jobs/'+job.id+'/signed-changes'})
 if(side==='builder'){changeOffice(actor);need(!actor.team||actor.team.job_ids.includes(job.id),'Builder is no longer assigned',409,'change_signer')}
 else need(actor.role==='member'&&await clientAccess(db,job,actor.email),'Client signer is no longer assigned',409,'change_signer')
 need(canonical(signer(actor))===canonical(saved),'Signer authority changed; prepare a new document',409,'change_signer')
 return actor
}
/** Guard both signers again inside the same atomic batch, independently of the requesting person's session. */
export function signerGuards(db: D1Database, row: SignedChange) {
 return [row.builder,row.client].map(s=>db.prepare(`INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active') AND COALESCE((SELECT version FROM pl_team WHERE operator_id=?),-1)=? AND (? IS NULL OR EXISTS(SELECT 1 FROM pl_roles WHERE id=? AND version=?)) THEN 1 ELSE 0 END`).bind(s.id,s.version,s.id,s.team_version??-1,s.role_id,s.role_id,s.role_version))
}
function source(job: Job, variationId: string) {return {quote:job.quotes.find(q=>q.status==='accepted'),budgets:job.budgets,sov:job.sov,variations:job.variations,selection:job.selections,schedules:job.schedules,calendar:job.schedule_calendar,actuals:job.schedule_actuals,claims:job.claims,invoices:job.invoices,client_email:job.client_email,customer_id:job.customer_id,contacts:job.client_contact_ids,variation_id:variationId}}
async function unchanged(db: D1Database, job: Job, row: SignedChange) {
 need(await changeDigest(source(job,row.variation_id))===row.source_digest,'Reviewed commercial or schedule sources changed; prepare a new document',409,'change_sources')
 await currentSigner(db,job,row.builder,'builder');return currentSigner(db,job,row.client,'client')
}
function shift(value: string, days: number, zone: string) {
 const wall=wallClock(Date.parse(value),zone);let date=wall.date
 for(let d=0;d<days;d++)date=nextDate(date)
 return new Date(zonedInstant(date,wall.hour*60+wall.minute,zone)).toISOString()
}
export async function prepareSignedChange(db: D1Database, job: Job, actor: Actor, input: Input, all: Job[]) {
 changeOffice(actor);active(job);usdOnly(job)
 need(!job.schedules.some(t=>t.status==='draft'),'Review and publish existing draft tasks before presenting a signed change',409,'change_schedule')
 const v=find(job.variations,text(input.variation_id,'Reviewed priced change',100))
 need(v.status==='draft'&&v.pricing?.approved_by&&v.pricing.tax.rate.human_reviewed&&v.pricing.tax.rate.approved_by,'Prepare a human-reviewed priced change and tax source first',409,'change_pricing')
 need(v.pricing.base_lines.filter(l=>l.included!==false).every(l=>l.cost_total_cents!==undefined),'Record the private cost of every included line before signing',409,'change_costs')
 need(v.pricing.total_cents===Math.abs(v.amount_cents),'Reviewed pricing must match the exact change',409,'change_pricing')
 need(!changes(job).some(r=>r.variation_id===v.id&&!['declined','disputed'].includes(r.status)),'This change already has a document; record a dispute before presenting revised terms',409,'change_duplicate')
 const clientId=text(input.client_id,'Assigned client account',100),client=await db.prepare("SELECT id,email,display_name,role,version FROM oa_operators WHERE id=? AND status='active' AND role='member'").bind(clientId).first<{id:string;email:string;display_name:string;role:string;version:number}>()
 need(client&&await clientAccess(db,job,client.email),'Choose a currently authorized assigned client',403,'change_signer')
 const clientActor=await personActor(db,{...client,displayName:client.display_name},{method:'POST',path:'/api/plinth/jobs/'+job.id+'/signed-changes'})
 const days=Number(input.extra_days);need(Number.isSafeInteger(days)&&days>=0&&days<=366,'Extra days must be whole calendar days from 0 to 366')
 if(v.allowance_change)need(v.allowance_change.impacts.schedule_days===days,'Signed calendar-day impact must match the reviewed allowance source',409,'change_allowance')
 need(Array.isArray(input.task_ids)&&input.task_ids.length>0,'Choose the affected tasks')
 const ids=input.task_ids.map(id=>text(id,'Affected task',100));need(new Set(ids).size===ids.length&&ids.every(id=>job.schedules.some(t=>t.id===id&&t.status==='booked')),'Choose current booked tasks')
 const affected=new Set(ids);for(let n=0;n<job.schedules.length;n++)for(const t of job.schedules)if(t.predecessors?.some(p=>affected.has(p.id)))affected.add(t.id)
 const calendar=workingCalendar(job.schedule_calendar,job.time_zone),zone=job.time_zone??'UTC'
 const plan={calendar,tasks:job.schedules.map(t=>({...t,start:affected.has(t.id)?shift(t.start,days,zone):t.start,duration_minutes:t.duration_minutes??workingMinutes(Date.parse(t.start),Date.parse(t.end),calendar)}))}
 const schedule=await previewSchedule(job,actor,plan,all)
 need(!schedule.conflicts.length&&!schedule.blockers.length,'Resolve schedule conflicts and prerequisites before presenting this change',409,'change_schedule')
 need(schedule.tasks.every(t=>{const before=find(job.schedules,t.id);return affected.has(t.id)||before.start===t.start&&before.end===t.end&&before.status===t.status}),'Review existing task dates first; this document can change only its named affected work',409,'change_schedule')
 need(schedule.completion_before&&schedule.completion_after,'An existing completion date is required',409,'change_schedule')
 const before=wallClock(Date.parse(schedule.completion_before),zone).date,after=wallClock(Date.parse(schedule.completion_after),zone).date
 need(Math.round((Date.parse(after)-Date.parse(before))/86400000)===days,'The reviewed calendar must reconcile extra calendar days to revised completion; revise the task plan',409,'change_schedule')
 // Validate every existing approved pricing source without approving this proposed change.
 sovSources(job)
 const private_terms=structuredClone(v),private_terms_digest=await changeDigest(private_terms)
 const document: SignedChange['document']={format:'plinth-signed-change-v1',job_id:job.id,job_name:job.name,scope:v.description,currency:'USD',amount_cents:v.amount_cents,tax_cents:v.pricing.tax.tax_cents*(v.amount_cents<0?-1:1),tax_reference:v.pricing.tax.rate.reference,allowance:v.allowance_change?{selection_id:v.allowance_change.selection_id,selection_revision_id:v.allowance_change.selection_revision_id,cost_code:v.allowance_change.cost_code,allowance_cents:v.allowance_change.selection_snapshot.allowance_cents,economic_delta_cents:v.allowance_change.economic_delta_cents,prior_economic_delta_cents:v.allowance_change.prior_economic_delta_cents,amount_cents:v.allowance_change.amount_cents}:null,affected_tasks:schedule.tasks.filter(t=>affected.has(t.id)).map(t=>{const old=find(job.schedules,t.id);return {id:t.id,description:t.description,start:old.start,end:old.end,revised_start:t.start,revised_end:t.end}}),extra_days:days,completion_before:before,revised_completion:after,private_terms_digest,signers:{builder:{id:actor.id,name:actor.name},client:{id:clientActor.id,name:clientActor.name}},statement:'Both named people explicitly sign these exact scope, price and calendar-day terms. Signatures authorize only a separate builder-reviewed application. Billing, purchasing, notices and payment require their own approvals.'}
 const row: SignedChange={id:crypto.randomUUID(),revision:changes(job).filter(r=>r.variation_id===v.id).length+1,variation_id:v.id,status:'presented',prepared_by:stamp(actor),builder:signer(actor),client:signer(clientActor),document,digest:await changeDigest(document),source_digest:'',private_terms,schedule,signatures:[],history:[]}
 ;((job as ChangeJob).signed_changes??=[]).push(row);v.signed_document_id=row.id
 row.source_digest=await changeDigest(source(job,v.id))
 recordApproval(job,actor,'signed-change.present',row,{document_digest:row.digest,builder_id:row.builder.id,client_id:row.client.id})
 return row
}
export async function actSignedChange(db: D1Database, job: Job, actor: Actor, row: SignedChange, action: string, input: Input, all: Job[]) {
 need(input.digest===row.digest,'Review the exact document digest',409,'change_document')
 const side=actor.id===row.builder.id?'builder':actor.id===row.client.id?'client':null
 if(action==='decline'||action==='dispute'){
  need(side,'Only the named signers may decline or dispute',403,'change_signer');if(side==='builder')changeOffice(actor);else need(actor.role==='member'&&await clientAccess(db,job,actor.email),'Current assigned client required',403,'change_signer')
  need(row.status!=='applied'&&!['declined','disputed'].includes(row.status),'Applied or closed documents retain their original history',409,'change_state')
  row.status=action==='decline'?'declined':'disputed';row.history.push({kind:action,reason:text(input.reason,'Decision reason',2000),by:stamp(actor)});recordApproval(job,actor,'signed-change.'+action,row,{document_digest:row.digest,reason:input.reason});return []
 }
 const client=await unchanged(db,job,row)
 if(action==='sign'){
  need(side,'Only the named builder and assigned client may sign',403,'change_signer')
  need(row.status==='presented'&&!row.signatures.some(s=>s.side===side),'This signer has already decided or the document is closed',409,'change_state')
  need(input.confirm===true,'Explicit electronic signature consent is required')
  const name=text(input.name,'Signature name',200);need(name===actor.name,'Type your current account display name exactly')
  const signature: SignedChange['signatures'][number]={side:side as 'builder'|'client',document_digest:row.digest,name,statement:'I consent to sign this exact change document electronically.',signed_by:stamp(actor)}
  row.signatures.push(signature);if(row.signatures.length===2)row.status='signed'
  recordApproval(job,actor,'signed-change.sign',row,{document_digest:row.digest,signature})
 }else if(action==='apply'){
  changeOffice(actor,true);need(row.status==='signed'&&row.signatures.length===2&&!row.application,'Both signatures and one separate application review are required',409,'change_state')
  need(input.confirm===true,'Explicitly confirm the reviewed budget, schedule, SOV and draft billing application')
  const v=find(job.variations,row.variation_id);need(v.status==='draft','Signed source is no longer pending',409,'change_sources')
  // The exact signed document is the only approval door for this variation.
  approveVariation(job,client,v.id,undefined,true);reviseBudget(job,actor,v);enqueueContinuity(job,actor,job.budgets!.at(-1)!)
  const assignments=object(input.code_assignments??{});const sov=prepareSov(job,actor,{code_assignments:assignments})
  const plan={calendar:row.schedule.calendar,tasks:row.schedule.tasks}
  const preview=await previewSchedule(job,actor,plan,all)
  need(canonical(preview.tasks.map(({prepared_by,revision,updated_at,...t})=>t))===canonical(row.schedule.tasks.map(({prepared_by,revision,updated_at,...t})=>t)),'Reviewed schedule changed',409,'change_schedule')
  await publishSchedule(job,actor,{...plan,digest:preview.digest},all)
  const billing=object(input.billing),claim=prepareClaim(job,actor,{description:'Draft billing for signed change: '+row.document.scope,...billing})
  need(claim.sov,'A coded draft billing application is required');linkContinuityClaim(job,claim)
  const invoice=await invoiceAction(db,job,actor,{kind:'milestone',source_application_id:claim.id,recipient_email:client.email,description:'Signed change: '+row.document.scope,due_on:billing.due_on,terms:billing.terms})
  row.application={by:stamp(actor),budget_revision:job.budgets!.at(-1)!.revision,sov_revision:sov.revision,claim_id:claim.id,invoice_id:invoice.record.id};row.status='applied'
  recordApproval(job,actor,'signed-change.apply',row,{document_digest:row.digest,...row.application})
  return invoice.writes
 }else need(false,'Unknown signed change action',404,'not_found')
 return signerGuards(db,row)
}
/** Private commercial sources never enter a client document, list, or decision response. */
export function publicChange(row: SignedChange) {const {private_terms,source_digest,schedule,...safe}=row;return safe}
