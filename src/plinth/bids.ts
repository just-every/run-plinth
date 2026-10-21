import {runtimeBindings,type Bindings} from '../auth.server'
import {authorize,requireManager} from './auth'
import {DomainError,find,need,object,type Input} from './model'
import {jobs,readClock,saveJob} from './store'
import {decisionDownload} from './decision-files'
import {bidAction} from './bid-actions'
import {bidOffice,bidSource} from './bid-access'
import type {BidJob} from './bid-model'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
async function body(request:Request):Promise<Input>{
 need(request.headers.get('content-type')?.split(';')[0]?.trim()==='application/json','Send application/json',415,'content_type')
 const reader=request.body?.getReader();need(reader,'JSON body required');let size=0;const chunks:Uint8Array[]=[]
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>15_000_000){await reader.cancel();need(false,'Request too large',413,'body_size')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 try{return object(JSON.parse(new TextDecoder().decode(bytes)))}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('invalid_json','Invalid JSON body')}
}
/** An independent portal; bid contacts never gain general job access. */
export async function bidsResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/plinth\/(?:bids(?:\/(.*))?|jobs\/([^/]+)\/bids(?:\/(.*))?)$/.exec(url.pathname)
 if(!match)return null
 try{
  const env=runtimeBindings(original),db=env.DB,actor=await authorize(request,env),office=bidOffice(actor)
  need(office||actor.role==='member','Bid access requires a personally signed-in estimator or invited member',403,'forbidden')
  const parts=match[2]?[match[2],...(match[3]?.split('/')??[])]:match[1]?.split('/')??[]
  const clock=request.method==='GET'?undefined:await readClock(db),all=(await jobs(db) as BidJob[]).filter(j=>actor.role!=='project_manager'||actor.team!.job_ids.includes(j.id))
  if(!parts.length){need(request.method==='GET','Method not allowed',405,'method_not_allowed');const sources=await Promise.all(all.map(j=>bidSource(db,j,actor)));return json({sources:sources.filter(s=>office||s.bids.length)})}
  const previous=find(all,parts[0]!),source=await bidSource(db,previous,actor);need(office||source.bids.length,'Bid job not found',404,'not_found')
  if(request.method==='GET'){
   if(parts.length===1)return json({source})
   need(parts.length===3&&parts[1]==='files','Unknown bid route',404,'not_found')
   const files=source.bids.flatMap(b=>[...b.revisions.flatMap(r=>r.plans),...b.invitations.flatMap(i=>i.responses.flatMap(r=>r.attachments))]);return await decisionDownload(db,previous,files,parts[2]!)
  }
  need(request.method==='POST'&&(parts.length===1||parts.length===3),'Unknown bid action',404,'not_found')
  if(parts.length===1)requireManager(actor)
  else need(source.bids.some(b=>b.id===parts[1]),'Bid package not found',404,'not_found')
  const input=await body(request);need(input.expected_version===previous.version,'The bid job changed; reload before acting',409,'stale_version')
  const job=structuredClone(previous),result=await bidAction(db,job,actor,input,parts[1],parts[2]);await saveJob(db,actor,previous,job,result.writes,clock)
  return json({source:await bidSource(db,job,actor),record_id:result.record.id},parts.length===1?201:200)
 }catch(error){if(error instanceof DomainError)return json({error:error.code,message:error.message,details:error.details},error.status);throw error}
}
