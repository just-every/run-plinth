import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { authorize, requireManager, requireOwner } from './auth'
import { emptyJob, DomainError, need, object, type Actor, type Input, type Job } from './model'
import { insertJob, jobOf, jobs, readClock, saveJob, transaction } from './store'
import { acceptQuote, approveVariation, prepareQuote, prepareVariation } from './quotes'
import { approveSchedule, issueOrder, prepareOrder, prepareSchedule, receiveOrder } from './operations'
import { approveDiary, prepareDiary, serveAttachment } from './attachments'
import { calendarFeed, manageCalendar } from './calendar'
import { changeSchedule } from './schedule-changes'
import { approveClaim, exportClaim, prepareClaim } from './claims'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
const role=(actor:Actor)=>actor.role==='member'?'client':actor.role
/** Each job with its client's name from People & access, once they are invited. */
async function named(db:D1Database,list:Job[]):Promise<Job[]>{const rows=await db.prepare("SELECT lower(email) AS email,display_name FROM oa_operators WHERE role='member'").all<{email:string;display_name:string}>();const names=new Map(rows.results.map(r=>[r.email,r.display_name]));return list.map(job=>names.has(job.client_email)?{...job,client_name:names.get(job.client_email)}:job)}
function display(job:Job,actor:Actor) {
 if(actor.role!=='member')return job
 const claims=job.claims.filter(c=>c.status!=='draft').map(c=>{const {commitments_cents,received_cents,outstanding_cents,orders,...reconciliation}=c.reconciliation;const {export:artifact,...claim}=c;return {...claim,reconciliation}})
 return {...job,quotes:job.quotes.filter(q=>q.status==='accepted'),schedules:job.schedules.filter(s=>s.status!=='draft'),diary:job.diary.filter(d=>d.status==='published'),orders:[],claims,approvals:job.approvals.filter(a=>['quote','variation','schedule','schedule.move','schedule.cancel','diary'].includes(a.kind))}
}
async function body(request:Request):Promise<Input>{need((request.headers.get('content-type')??'').split(';')[0]==='application/json','Send application/json',415,'content_type');const reader=request.body?.getReader();need(reader,'JSON body is required');const chunks:Uint8Array[]=[];let size=0;for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>15_000_000){await reader.cancel();need(false,'Request is too large',413,'body_size')}chunks.push(r.value)}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}try{return object(JSON.parse(new TextDecoder().decode(bytes)))}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('invalid_json','Invalid JSON body')}}
async function handle(request:Request,original:Bindings):Promise<Response>{const env=runtimeBindings(original),actor=await authorize(request,env),parts=new URL(request.url).pathname.slice('/api/plinth/'.length).split('/').filter(Boolean),method=request.method
 if(parts[0]==='agent-credentials'&&parts.length===1&&method==='POST'){requireOwner(actor);const input=await body(request);const credential=await operatorAuth(env).mintCredential(request,{expiresInSeconds:input.expires_in_seconds===undefined?86400:Number(input.expires_in_seconds)});return json({credential},201)}
 if(parts[0]==='agent-credentials'&&parts.length===1&&method==='GET'){requireOwner(actor);const credentials=await env.DB.prepare('SELECT id,operator_id,expires_at,revoked_at FROM oa_credentials ORDER BY expires_at DESC').all();return json({credentials:credentials.results})}
 if(parts[0]==='agent-credentials'&&parts.length===3&&parts[2]==='revoke'&&method==='POST'){requireOwner(actor);await body(request);await transaction(env.DB,actor,null,[env.DB.prepare("UPDATE oa_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE id=?").bind(Date.now(),parts[1]),env.DB.prepare("INSERT INTO oa_auth_audit(id,actor_id,action,value,created_at) VALUES(?,?,'credential.revoke',?,?)").bind(crypto.randomUUID(),actor.id,parts[1],Date.now())]);return json({revoked:true})}
 if(parts[0]!=='jobs')return json({error:'not_found',message:'Unknown Plinth route'},404)
 if(parts.length===1){if(method==='GET'){const all=await jobs(env.DB);return json({role:role(actor),jobs:(await named(env.DB,all.filter(job=>actor.role!=='member'||job.client_email===actor.email.toLowerCase()))).map(job=>display(job,actor))})}if(method==='POST'){requireManager(actor);const job=emptyJob(await body(request),actor);await insertJob(env.DB,actor,job);return json({job,role:role(actor)},201)}return json({error:'method_not_allowed'},405)}
 // Observe the installation clock before reading any cross-job schedule state.
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,parts[1])
 if(parts.length===3&&parts[2]==='calendar'&&method==='POST'){const input=await body(request);need(input.expected_version===previous.version,'Job changed. Reload before changing the feed.',409,'stale_version');return json(await manageCalendar(env.DB,actor,previous,input))}
 if(parts.length===2&&method==='GET')return json({job:display((await named(env.DB,[previous]))[0]!,actor),role:role(actor)})
 if(parts[2]==='diary'&&parts[4]==='attachments'&&parts.length===6&&method==='GET')return serveAttachment(env.DB,previous,actor,parts[3],parts[5])
 if(parts.length===2&&method==='DELETE'){
  requireOwner(actor);const input=await body(request);need(input.expected_version===previous.version,'Job changed. Reload before erasing.',409,'stale_version')
  const { eraseJob }=await import('./import-erasure')
  await eraseJob(env.DB,actor,previous)
  return json({erased:true,job_id:previous.id})
 }
 need(method==='POST','Method not allowed',405,'method_not_allowed');const input=await body(request);if(parts.length===5&&parts[2]==='claims'&&parts[4]==='export'){requireManager(actor);const exported=previous.claims.find(c=>c.id===parts[3]&&c.status==='exported');if(exported)return json({job:previous,record:exported,role:role(actor),report:exported.export})}
 need(input.expected_version===previous.version,'Job changed. Reload before applying this action.',409,'stale_version')
 const job=structuredClone(previous);let record:unknown;let writes:D1PreparedStatement[]=[];const category=parts[2],id=parts[3],action=parts[4]
 if(parts.length===3){switch(category){case 'quotes':record=prepareQuote(job,actor,input);break;case 'schedules':record=prepareSchedule(job,actor,input,await jobs(env.DB));break;case 'diary':{const prepared=await prepareDiary(env.DB,job,actor,input);record=prepared.row;writes=prepared.writes;break}case 'variations':record=prepareVariation(job,actor,input);break;case 'orders':record=prepareOrder(job,actor,input);break;case 'claims':record=prepareClaim(job,actor,input);break;default:throw new DomainError('not_found','Unknown action',404)}}
 else if(parts.length===5){switch(category+'/'+action){case 'quotes/accept':record=acceptQuote(job,actor,id,input);break;case 'schedules/move':case 'schedules/cancel':record=changeSchedule(job,actor,id,input,action,await jobs(env.DB));break;case 'schedules/approve':record=approveSchedule(job,actor,id,await jobs(env.DB));break;case 'diary/approve':record=approveDiary(job,actor,id);break;case 'variations/approve':record=approveVariation(job,actor,id);break;case 'orders/issue':record=issueOrder(job,actor,id);break;case 'orders/receive':record=receiveOrder(job,actor,id,input);break;case 'claims/approve':record=approveClaim(job,actor,id);break;case 'claims/export':record=exportClaim(job,actor,id);break;default:throw new DomainError('not_found','Unknown action',404)}}else throw new DomainError('not_found','Unknown action',404)
 await saveJob(env.DB,actor,previous,job,writes,clock)
 return json({job:display((await named(env.DB,[job]))[0]!,actor),record,role:role(actor),...(category==='claims'&&action==='export'?{report:(record as {export:unknown}).export}:{})})
}
/** Each direct API request authenticates independently of document-route guards. */
export async function plinthResponse(request:Request,env:Bindings):Promise<Response|null>{if(!new URL(request.url).pathname.startsWith('/api/plinth/'))return null;try{return await calendarFeed(request,env) ?? await handle(request,env)}catch(error){if(error instanceof DomainError)return json({error:error.code,message:error.message,...(error.details?{details:error.details}:{})},error.status);const e=error as {status?:number;code?:string;message?:string};if(e.status&&e.status<500)return json({error:e.code??'forbidden',message:e.message??'Request refused'},e.status);console.error('Plinth request failed',error instanceof Error?error.message:'unknown error');return json({error:'server_error',message:'The request could not be completed'},500)}}
