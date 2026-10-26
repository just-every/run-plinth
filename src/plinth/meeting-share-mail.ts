import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { requireOwner } from './auth'
import { currentMeetingShareRecipient, meetingShareRecipientGuards } from './meeting-sharing'
import type { MeetingShare, MeetingSharingJob } from './meeting-sharing-model'
import { find, need, stamp, text, type Actor, type Input, type Stamp } from './model'
import { officeAuthority, authorityGuards, checkWarrantySend, loadWarrantyJob, warrantyGeneration } from './warranty-store'
import { readClock, saveJob } from './store'
import { digest } from './attachments'
import { optionalNotice } from './mail-model'
import { preferences } from './todo-notices'
import { wallClock } from './time-zone'
import { suppression } from './mail-store'

export interface MeetingEmailRequest {
 id: string; operation_id: string; recipient_id: string; email: string; kind: 'minutes' | 'action_reminder'; action_id?: string
 by: Stamp; generation: number; status: 'requested' | 'unknown' | 'accepted' | 'development' | 'refused' | 'unconfigured' | 'cancelled'
 label: string; cancelled_by?: Stamp; approved_by?: Stamp; subject?: string; body?: string; provider_message_id?: string
}
const requested = (share: MeetingShare, id: string) => find(share.email_requests ?? [], id)
/** A recipient requests one exact email copy; this never sends and grants no standing consent. */
export async function requestMeetingEmail(db: D1Database, job: MeetingSharingJob, actor: Actor, input: Input, shareId: string) {
 const share = find(job.meeting_shares ?? [], shareId), recipient = await currentMeetingShareRecipient(db, job, actor, share)
 need(recipient, 'Meeting extract not found', 404, 'not_found')
 need(input.confirm === true, 'Request one email copy of this exact extract')
 if(input.cancel===true){const record=requested(share,text(input.request_id,'Email request',100));need(record.recipient_id===actor.id&&record.status==='requested','Only your own unreserved request can be cancelled',409,'mail_reserved');record.status='cancelled';record.label='Recipient cancelled before dispatch; nothing sent';record.cancelled_by=stamp(actor);return record}
 need(input.kind === 'minutes' || input.kind === 'action_reminder', 'Choose an extract copy or action reminder')
 const operation_id = text(input.operation_id, 'Operation id', 100)
 need(!(share.email_requests ?? []).some(r => r.operation_id === operation_id), 'This email request is already recorded', 409, 'operation_conflict')
 const action_id = input.kind === 'action_reminder' ? text(input.action_id, 'Meeting action', 100) : undefined
 if (action_id) await currentAction(db, job, share, actor.email, action_id)
 need(!(share.email_requests ?? []).some(r => r.recipient_id === actor.id && r.status === 'requested'), 'An email copy is already awaiting review', 409, 'mail_pending')
 const record: MeetingEmailRequest = { id: crypto.randomUUID(), operation_id, recipient_id: actor.id, email: actor.email.toLowerCase(), kind: input.kind, ...(action_id ? { action_id } : {}), by: stamp(actor), generation: await warrantyGeneration(db), status: 'requested', label: 'One email copy requested; nothing sent' }
 ;(share.email_requests ??= []).push(record)
 return record
}
async function currentAction(db: D1Database, job: MeetingSharingJob, share: MeetingShare, email: string, id: string) {
 const meeting = find(job.meetings ?? [], share.meeting_id), action = find(meeting.actions, id)
 need(!action.completion && action.owner_email === email, 'Only the current authorized owner of an outstanding action receives its reminder', 409, 'meeting_action')
 const authority = await officeAuthority(db, job, email); need(authority, 'The action owner no longer manages this job', 403, 'forbidden')
 return { action, guards: authorityGuards(db, authority) }
}
async function eligible(db: D1Database, job: MeetingSharingJob, share: MeetingShare, request: MeetingEmailRequest) {
 need(!share.revocation && request.generation === await warrantyGeneration(db), 'The extract or installation authority changed; obtain a fresh recipient request', 409, 'mail_authority')
 const person = await db.prepare("SELECT id,email,display_name,version,role FROM oa_operators WHERE id=? AND status='active'").bind(request.recipient_id).first<{id:string;email:string;display_name:string;version:number;role:Actor['role']}>()
 need(person && person.email.toLowerCase() === request.email, 'The recipient is no longer active', 409, 'recipient_authority')
 // The grant checker re-reads native team, role, client and released company scope authority.
 const recipient = await currentMeetingShareRecipient(db, job, {id:person.id,email:person.email,version:person.version}, share)
 need(recipient, 'The recipient no longer has this exact extract grant', 409, 'recipient_authority')
 const preference=await preferences(db,person.id),quiet=preference?.data.quiet
 if(quiet){const current=wallClock(Date.now(),quiet.time_zone),minute=current.hour*60+current.minute;need(!(quiet.start===quiet.end||quiet.start<quiet.end&&minute>=quiet.start&&minute<quiet.end||quiet.start>quiet.end&&(minute>=quiet.start||minute<quiet.end)),'The recipient’s recorded quiet hours currently hold this optional email',409,'mail_quiet')}
 const guards = meetingShareRecipientGuards(db,recipient)
 guards.push(preference?db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_todo_library WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(preference.id,preference.version):db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pl_todo_library WHERE id=?) THEN 1 ELSE 0 END').bind('preference:'+person.id))
 let reminder = ''
 if (request.action_id) { const current = await currentAction(db,job,share,request.email,request.action_id);guards.push(...current.guards);reminder=`\nOutstanding action: ${current.action.title}\nDue: ${current.action.due_on}\n` }
 const subject = request.kind === 'action_reminder' ? 'Meeting action reminder: ' + share.title : 'Meeting decision: ' + share.title
 const body = `${share.title}\n\n${share.body}\n${reminder}\nThis is the reviewed extract you requested. Private minutes and original sources are not included.`
 return { subject, body, guards }
}
async function outgoing(env: Bindings, job: MeetingSharingJob, share: MeetingShare, request: MeetingEmailRequest) {
 const value = await eligible(env.DB, job, share, request), optional = await optionalNotice(env, request.email)
 return { ...value, body: value.body + optional.text, optional }
}
export async function meetingEmailPreview(env: Bindings, job: MeetingSharingJob, actor: Actor, shareId: string, requestId: string) {
 requireOwner(actor);need(actor.session_id && !actor.credential_id, 'Sign in as the owner to review an email copy', 403, 'human_required')
 const share=find(job.meeting_shares??[],shareId),request=requested(share,requestId)
 need(request.status==='requested','This request already has a delivery attempt; reconcile its recorded outcome',409,'mail_reserved')
 const value=await outgoing(env,job,share,request),preview={request_id:request.id,email:request.email,subject:value.subject,body:value.body}
 return {...preview,digest:await digest(new TextEncoder().encode(JSON.stringify(preview)))}
}
/** Reserve once before the provider call. Unknown remains unknown and cannot be sent again. */
export async function sendMeetingEmail(env: Bindings, previous: MeetingSharingJob, actor: Actor, input: Input, shareId: string, clock: number) {
 const id=text(input.request_id,'Email request',100),preview=await meetingEmailPreview(env,previous,actor,shareId,id)
 need(input.confirm===true && input.digest===preview.digest,'Review and confirm this exact email copy before sending',409,'mail_review')
 const next=structuredClone(previous),share=find(next.meeting_shares??[],shareId),request=requested(share,id),value=await eligible(env.DB,next,share,request)
 Object.assign(request,{status:'unknown',label:'Email reserved; provider outcome unknown. No automatic resend.',approved_by:stamp(actor),subject:preview.subject,body:preview.body})
 await saveJob(env.DB,actor,previous,next,value.guards,clock)
 let status:MeetingEmailRequest['status']='unknown',label=request.label,providerId:string|undefined
 try {
  const seen=await readClock(env.DB)
  const latest=await loadWarrantyJob(env.DB,next.id) as MeetingSharingJob|null;need(latest,'Job erased',404,'not_found')
  const currentShare=find(latest.meeting_shares??[],shareId),current=requested(currentShare,id),check=await outgoing(env,latest,currentShare,current)
  need(check.subject===preview.subject && check.body===preview.body,'The reviewed action changed',409,'mail_review')
  await checkWarrantySend(env.DB,latest,seen,check.guards,actor)
  if(await suppression(env.DB,current.email)){status='cancelled';label='Not sent: the recipient suppressed optional notices'}
  else {
   const sender=operatorMail(env)
   if(!sender||!env.MAIL_FROM){status='unconfigured';label='Mail is not configured; nothing sent'}
   else {const body=preview.body,escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');const outcome=await sender.send({deliveryId:current.id,from:env.MAIL_FROM,to:[current.email],subject:preview.subject,text:body,html:'<pre>'+escape(body)+'</pre>',headers:{},...(check.optional.unsubscribe?{unsubscribe:check.optional.unsubscribe}:{})});status=outcome.status==='accepted'?'accepted':outcome.status==='development'?'development':outcome.status==='rejected'||outcome.status==='rate_limited'?'refused':'unknown';label=status==='accepted'?'Accepted by the mail provider; delivery is not confirmed':status==='development'?'Development mail suppressed; nothing sent':status==='refused'?'Provider refused the email; no automatic resend':request.label;providerId=outcome.providerMessageId??undefined}
  }
 } catch { /* The durable reservation stays unknown after an uncertain provider response. */ }
 const latest=await loadWarrantyJob(env.DB,next.id) as MeetingSharingJob|null
 if(latest){const finished=structuredClone(latest),stored=requested(find(finished.meeting_shares??[],shareId),id);Object.assign(stored,{status,label,...(providerId?{provider_message_id:providerId}:{})});await saveJob(env.DB,actor,latest,finished,[],await readClock(env.DB));return finished}
 return next
}
