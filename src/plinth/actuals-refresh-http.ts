import { runtimeBindings, type Bindings } from '../auth.server'
import { authorize, requireOwner } from './auth'
import { active, DomainError, need, object, usdOnly, type Input } from './model'
import { costLedger } from './cost-ledger'
import { costs } from './cost-model'
import { prepareActualsRefresh, refreshSources } from './actuals-refresh'
import { jobOf, readClock, transaction } from './store'
import { jobRef } from './audit'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
async function body(request:Request):Promise<Input>{
 need(request.headers.get('content-type')?.split(';')[0]?.trim()==='application/json','Send JSON',415,'content_type')
 const reader=request.body?.getReader();need(reader,'JSON body required')
 let size=0;const chunks:Uint8Array[]=[]
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>200_000){await reader.cancel();throw new DomainError('body_size','Refresh request too large',413)}chunks.push(value)}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
 try{return object(JSON.parse(new TextDecoder().decode(bytes)))}catch(e){if(e instanceof DomainError)throw e;throw new DomainError('invalid_json','Invalid JSON')}
}
/** Dedicated owner door; no bearer, delegated approval or outbound capability. */
export async function actualsRefreshResponse(request:Request,original:Bindings):Promise<Response|null>{
 const match=/^\/api\/plinth\/jobs\/([^/]+)\/actuals-refresh(?:\/([^/]+))?$/.exec(new URL(request.url).pathname)
 if(!match)return null
 const env=runtimeBindings(original),actor=await authorize(request,env);requireOwner(actor)
 need(!actor.agent_door,'A signed-in owner is required',403,'forbidden')
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,match[1]!)
 usdOnly(previous)
 const current=await refreshSources(previous)
 const rows=costs(previous).actuals_refresh??[]
 const locallyReviewed=async(id:string,digest:string)=>!!await env.DB.prepare('SELECT preview_id FROM pl_actuals_refresh_reviews WHERE preview_id=? AND owner_id=? AND digest=?').bind(id,actor.id,digest).first()
 if(request.method==='GET'){
  if(match[2]){
   const record=rows.find(r=>r.id===match[2]);need(record,'Preview not found in this job',404,'not_found')
   need(record.reviewed_by.id===actor.id&&await locallyReviewed(record.id,record.digest),'Restored or withdrawn review requires a fresh preview',409,'actuals_review_required')
   need(record.source_digest===current.source_digest,'Sources changed; request a fresh review',409,'actuals_stale')
   return json({record,version:previous.version})
  }
  return json({...current,version:previous.version,ledger:costLedger(previous),sov_lines:previous.sov?.at(-1)?.lines??[],codes:costs(previous).actuals_refresh?.at(-1)?.codes??null,previews:await Promise.all(rows.map(async record=>({...record,stale:record.source_digest!==current.source_digest,review_active:record.reviewed_by.id===actor.id&&await locallyReviewed(record.id,record.digest)})))})
 }
 need(request.method==='POST'&&!match[2],'Method not allowed',405,'method_not_allowed');active(previous)
 const input=await body(request)
 // Replay still rechecks current source custody, installation-local review and exact input.
 need(input.source_digest===current.source_digest,'Sources changed; request a fresh review',409,'actuals_stale')
 const replay=rows.find(r=>r.operation_id===input.operation_id)
 if(replay)need(await locallyReviewed(replay.id,replay.digest),'Restored review cannot be replayed',409,'actuals_review_required')
 else need(input.expected_version===previous.version,'Job changed; reload before review',409,'stale_version')
 const job=structuredClone(previous),record=await prepareActualsRefresh(job,actor,input)
 if(replay)return json({record,version:previous.version})
 // A private diagnostic has no connector event: saving it cannot schedule an outbound send.
 job.version=previous.version+1
 const data=JSON.stringify(job);need(data.length<=8_000_000,'Job history is too large')
 await transaction(env.DB,actor,previous,[
  env.DB.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(job.version,data,job.id,previous.version),
  env.DB.prepare('INSERT INTO pl_actuals_refresh_reviews(preview_id,job_id,owner_id,digest) VALUES(?,?,?,?)').bind(record.id,job.id,actor.id,record.digest)
 ],clock,{job_id:job.id,version_before:previous.version,version_after:job.version,before_ref:await jobRef(JSON.stringify(previous)),after_ref:await jobRef(data)})
 return json({record,version:job.version})
}
