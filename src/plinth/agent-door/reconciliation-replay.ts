import { authenticate } from '../../modules/agent-door/credentials.ts'
import { preparedBy } from '../../modules/agent-door/people.ts'
import { ToolRefusal, type AgentDoorOptions, type ToolContext } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { nativeCall } from './native'

/** Recheck native custody before the shared idempotency cache can return prior packet contents. */
export async function reconciliationReplayGuard(request:Request,env:Bindings,options:AgentDoorOptions):Promise<Response|null>{
 if(new URL(request.url).pathname!=='/mcp'||request.method!=='POST')return null
 let message:{id?:unknown;method?:string;params?:{name?:string;arguments?:Record<string,unknown>}}
 try{message=await request.clone().json()}catch{return null}
 if(message.method!=='tools/call'||message.params?.name!=='plinth.costs.reconcile')return null
 const args=message.params.arguments
 if(!args||!['job_id','packet_id','digest'].every(key=>typeof args[key]==='string'))return null
 const state=await env.DB.prepare('SELECT envelope FROM agent_door_state WHERE id=1').first<{envelope:string|null}>()
 const principal=await authenticate(options,request,state?.envelope?JSON.parse(state.envelope).business??null:null)
 if(!principal)return null
 const ctx:ToolContext={db:env.DB,person:principal.person,agent:principal.agent,actor:preparedBy(principal),seed:'plinth',origin:env.AUTH_ORIGIN,now:Date.now,door:'mcp',approvers:[],emit(){}}
 try{
  const value=await nativeCall(env,principal.person,'jobs/'+encodeURIComponent(String(args.job_id))+'/cost-reconciliation/'+encodeURIComponent(String(args.packet_id))+'/reviewed','GET',undefined,ctx)
  if((value.packets as Array<{digest:string}>)[0]?.digest!==args.digest)throw new ToolRefusal('packet_digest')
  return null
 }catch(error){
  if(!(error instanceof ToolRefusal))throw error
  return Response.json({jsonrpc:'2.0',id:message.id??null,result:{resultType:'complete',isError:true,content:[{type:'text',text:'The reviewed diagnostic source is unavailable. Request current owner review.'}],_meta:{'com.runeditrun/error':{code:error.code}}}},{headers:{'cache-control':'private, no-store'}})
 }
}
