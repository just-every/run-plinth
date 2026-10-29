import { authenticate } from '../../modules/agent-door/credentials.ts'
import { preparedBy } from '../../modules/agent-door/people.ts'
import { digest } from '../../modules/agent-door/execution.ts'
import { audit, newAudit } from '../../modules/agent-door/audit.ts'
import { ToolRefusal, type AgentDoorOptions, type ToolContext, type Runtime } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { nativeCall } from './native'

async function messageOf(request:Request){
 const reader=request.clone().body?.getReader();if(!reader)return null
 const chunks:Uint8Array[]=[];let length=0
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1048576){void reader.cancel();return null}chunks.push(value)}
 const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{return null}
}
/** Recheck native custody before the shared idempotency cache can return prior packet contents. */
export async function reconciliationReplayGuard(request:Request,env:Bindings,options:AgentDoorOptions):Promise<Response|null>{
 if(new URL(request.url).pathname!=='/mcp'||request.method!=='POST')return null
 const message=await messageOf(request)
 if(message?.method!=='tools/call'||message.params?.name!=='plinth.costs.reconcile')return null
 const args=message.params.arguments
 if(!args||!['job_id','packet_id','digest','idempotency_key'].every(key=>typeof args[key]==='string'))return null
 const state=await env.DB.prepare('SELECT envelope,local_document,local_revision,local_paused FROM agent_door_state WHERE id=1').first<{envelope:string|null;local_document:string|null;local_revision:number;local_paused:number}>()
 const envelope=state?.envelope?JSON.parse(state.envelope):null
 // Policy admission and all fresh executions belong to the shared pipeline.
 if(state?.local_paused||(options.trust?(!envelope?.document||envelope?.paused||envelope.exp*1000<=Date.now()):!state?.local_document))return null
 const principal=await authenticate(options,request,envelope?.business??null)
 if(!principal)return null
 const cached=await env.DB.prepare('SELECT digest,outcome,decision_id FROM agent_door_calls WHERE agent=? AND key=?').bind(principal.agent.id,args.idempotency_key).first<{digest:string;outcome:string|null;decision_id:string}>()
 if(!cached?.outcome||JSON.parse(cached.outcome).outcome!=='done')return null
 const declared=Object.fromEntries(Object.entries(args).filter(([key])=>['job_id','packet_id','digest','expected_version','expected_revision','idempotency_key'].includes(key)))
 if(cached.digest!==await digest({name:'plinth.costs.reconcile',arguments:declared}))return null
 const ctx:ToolContext={db:env.DB,person:principal.person,agent:principal.agent,actor:preparedBy(principal),seed:'plinth',origin:env.AUTH_ORIGIN,now:Date.now,door:'mcp',approvers:[],emit(){}}
 try{
  const value=await nativeCall(env,principal.person,'jobs/'+encodeURIComponent(String(args.job_id))+'/cost-reconciliation/'+encodeURIComponent(String(args.packet_id))+'/reviewed','GET',undefined,ctx)
  if((value.packets as Array<{digest:string}>)[0]?.digest!==args.digest)throw new ToolRefusal('packet_digest')
  return null
 }catch(error){
  if(!(error instanceof ToolRefusal))throw error
  const rt:Runtime={options:{...options,limits:{requestsPerMinute:600,maxBodyBytes:1048576}},tools:[],now:Date.now}
  const row=newAudit(rt,principal,'plinth.costs.reconcile','mcp',undefined)
  row.code=error.code;row.idempotency_key=args.idempotency_key;row.replay_of=cached.decision_id;row.revision=options.trust?envelope?.revision??null:state?.local_revision??null
  await audit(rt,row)
  return Response.json({jsonrpc:'2.0',id:message.id??null,result:{resultType:'complete',isError:true,content:[{type:'text',text:'The reviewed diagnostic source is unavailable. Request current owner review.'}],_meta:{'com.runeditrun/error':{code:error.code}}}},{headers:{'cache-control':'private, no-store'}})
 }
}
