import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { requireOwner } from './auth'
import { need, stamp, type Actor, type Input } from './model'
import { todoGrant } from './todo-access'
import { library, loadTodo, readClock, saveLibrary, saveTodo, type TodoContext } from './todo-store'
import { wallClock, timeZone } from './time-zone'
import type { TodoNotice } from './todo-model'
import { checkWarrantySend } from './warranty-store'
import { optionalNotice } from './mail-model'
import { suppression } from './mail-store'
import { transaction } from './store'
export interface TodoPreferences { operator_id:string;revision:number;assignment:'email'|'off';comment:'email'|'off';reminder:'email'|'off';quiet?:{start:number;end:number;time_zone:string} }
export async function preferences(db:D1Database,operatorId:string){const rows=await library<TodoPreferences>(db,'preference');return rows.find(r=>r.data.operator_id===operatorId)}
export async function savePreferences(db:D1Database,actor:Actor,input:Input,clock:number){const previous=await preferences(db,actor.id);need(input.expected_revision===(previous?.data.revision??0),'Preferences changed; reload',409,'stale_revision');for(const event of ['assignment','comment','reminder'])need(['email','off'].includes(String(input[event])),'Choose email or off for each to-do event. SMS, push and digest are not connected.')
 let quiet:TodoPreferences['quiet'];if(input.quiet){const q=input.quiet as Record<string,unknown>,minutes=(v:unknown)=>{need(typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v),'Quiet hours must use HH:MM');const [h,m]=v.split(':').map(Number);return h!*60+m!};quiet={start:minutes(q.start),end:minutes(q.end),time_zone:timeZone(q.time_zone)}}
 const value:TodoPreferences={operator_id:actor.id,revision:(previous?.data.revision??0)+1,assignment:input.assignment as 'email'|'off',comment:input.comment as 'email'|'off',reminder:input.reminder as 'email'|'off',...(quiet?{quiet}:{})};await saveLibrary(db,actor,{id:'preference:'+actor.id,kind:'preference',version:1,data:value},clock,previous);return value}
async function recipient(db:D1Database,context:TodoContext,notice:TodoNotice){
 const person=await db.prepare("SELECT id,email,version FROM oa_operators WHERE lower(email)=? AND status='active'").bind(notice.email).first<{id:string;email:string;version:number}>();if(!person)return null
 const items=[];for(const item of context.todo.items)if(notice.item_ids.includes(item.id)&&item.assignee.email===notice.email&&await todoGrant(db,context.job,item.assignee)&&!(notice.event==='reminder'&&item.completed))items.push(item)
 if(!items.length)return null
 const pref=await preferences(db,person.id);if(!pref||pref.data[notice.event]!=='email')return null
 const quiet=pref.data.quiet;if(quiet){const w=wallClock(Date.now(),quiet.time_zone),minute=w.hour*60+w.minute;if(quiet.start===quiet.end||quiet.start<quiet.end&&minute>=quiet.start&&minute<quiet.end||quiet.start>quiet.end&&(minute>=quiet.start||minute<quiet.end))return null}
 const guards=[db.prepare("INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND lower(email)=? AND status='active') THEN 1 ELSE 0 END").bind(person.id,person.version,notice.email),db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_todo_library WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(pref.id,pref.version)]
 return {person,items,pref:pref.data,guards}
}
/** A prepared record is not delivery. Only this explicit owner-approved email door calls the real configured mail transport. */
export async function sendTodoNotice(env:Bindings,actor:Actor,context:TodoContext,id:string,input:Input,clock:number){requireOwner(actor);need(input.channel==='email'&&input.confirm===true,'Approve this email channel and the named recipient explicitly');const original=context.todo.notices.find(n=>n.id===id);need(original,'Notice not found',404,'not_found');need(input.email===original.email,'Approve the exact recipient shown');need(original.status==='prepared','This notice already has a reserved attempt; no automatic resend',409,'notice_reserved');const eligible=await recipient(env.DB,context,original);need(eligible,'Recipient access, chosen email channel or quiet hours currently prevents delivery',409,'notice_held')
 const next=structuredClone(context.todo),attempt=next.notices.find(n=>n.id===id)!;attempt.status='unknown';attempt.approved_by=stamp(actor);attempt.preference_revision=eligible.pref.revision;await saveTodo(env.DB,actor,context,next,clock,eligible.guards)
 let status:TodoNotice['status']='unknown',provider_message_id:string|undefined
 try{const seen=await readClock(env.DB),latest=await loadTodo(env.DB,context.todo.id,context.job?.id),current=await recipient(env.DB,latest,attempt);if(!current||current.person.id!==eligible.person.id)status='cancelled';else{
  if(latest.job)await checkWarrantySend(env.DB,latest.job,seen,current.guards,actor);else await transaction(env.DB,actor,null,current.guards,seen)
  const sender=operatorMail(env);if(await suppression(env.DB,attempt.email))status='cancelled';else if(!sender||!env.MAIL_FROM)status='unconfigured';else{const notice=await optionalNotice(env,attempt.email),body=`${latest.todo.title}\n${attempt.event==='assignment'?'Your assigned checklist items':attempt.event==='comment'?'A comment was added to your checklist item':'Your checklist items are overdue'}:\n${current.items.map(i=>i.title).join('\n')}\nOpen your Plinth My to-dos list to review your current items.${notice.text}`,escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),result=await sender.send({deliveryId:attempt.id,from:env.MAIL_FROM,to:[attempt.email],headers:{},subject:'Plinth: to-do '+attempt.event,text:body,html:'<p>'+escape(body).replaceAll('\n','<br>')+'</p>',...(notice.unsubscribe?{unsubscribe:notice.unsubscribe}:{})});status=result.status==='accepted'?'accepted':result.status==='development'?'development':result.status==='rejected'||result.status==='rate_limited'?'refused':'unknown';provider_message_id=result.providerMessageId??undefined}
 }}catch{/* The reserved unknown attempt is truthful when the provider outcome cannot be established. */}
 const finished=await loadTodo(env.DB,context.todo.id,context.job?.id),outcome=structuredClone(finished.todo),stored=outcome.notices.find(n=>n.id===id)!;Object.assign(stored,{status,outcome_at:new Date().toISOString(),...(provider_message_id?{provider_message_id}:{})});await saveTodo(env.DB,actor,finished,outcome,await readClock(env.DB));return outcome
}
