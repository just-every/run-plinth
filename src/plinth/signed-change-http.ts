import { changeOffice, changes, publicChange, prepareSignedChange, actSignedChange, signerGuards } from './signed-changes'
import { requirePortalFeature } from './portal-policy'
import { need, find, type Actor, type Input } from './model'
import { jobOf, jobs, readClock, saveJob } from './store'
import type { Bindings } from '../auth.server'

const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
export async function signedChangeResponse(request: Request, env: Bindings, actor: Actor, parts: string[], body: (r: Request)=>Promise<Input>) {
 if(parts[0]!=='jobs'||parts[2]!=='signed-changes')return null
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,parts[1]!)
 if(actor.role==='member')requirePortalFeature(previous,'client','changes');else changeOffice(actor)
 const visible=changes(previous).filter(r=>actor.role!=='member'||r.client.id===actor.id),show=(r: typeof visible[number])=>actor.role==='member'?publicChange(r):r
 if(request.method==='GET'){
  if(parts.length===3){const people=actor.role==='member'?[]:(await env.DB.prepare("SELECT id,email,display_name FROM oa_operators WHERE role='member' AND status='active'").all<{id:string;email:string;display_name:string}>()).results;const {clientAccess}=await import('./job-customers');const allowed=[];for(const p of people)if(await clientAccess(env.DB,previous,p.email))allowed.push({id:p.id,name:p.display_name});return Response.json({version:previous.version,person_id:actor.id,changes:visible.map(show),clients:allowed},{headers})}
  need(parts.length===5&&parts[4]==='document.json','Unknown document route',404,'not_found');const row=find(visible,parts[3]!)
  return Response.json({document:row.document,digest:row.digest,builder:row.builder,client:row.client,signatures:row.signatures},{headers:{...headers,'content-disposition':'attachment; filename=signed-change.json'}})
 }
 need(request.method==='POST','Method not allowed',405,'method_not_allowed');const input=await body(request)
 need(input.expected_version===previous.version,'Job changed; reload before deciding',409,'stale_version')
 const job=structuredClone(previous);let row;let writes:D1PreparedStatement[]=[]
 if(parts.length===3){row=await prepareSignedChange(env.DB,job,actor,input,await jobs(env.DB));writes=signerGuards(env.DB,row)}
 else {need(parts.length===5,'Unknown change action',404,'not_found');row=find(changes(job),parts[3]!);need(actor.role!=='member'||row.client.id===actor.id,'Document not found',404,'not_found');writes=await actSignedChange(env.DB,job,actor,row,parts[4]!,input,await jobs(env.DB))}
 if(parts[4]==='apply'){
  const {requireResources}=await import('./schedule-resources');await requireResources(env.DB,job,await jobs(env.DB),actor)
  writes.push(...signerGuards(env.DB,row))
 }
 await saveJob(env.DB,actor,previous,job,writes,clock)
 return Response.json({version:job.version,record:show(row)},{headers})
}
