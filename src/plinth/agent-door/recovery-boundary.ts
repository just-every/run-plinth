import { policyState, policyRefusal } from '../../modules/agent-door/policy-store.ts'
import { preparedBy } from '../../modules/agent-door/people.ts'
import { authenticate } from '../../modules/agent-door/credentials.ts'
import { rpcError } from '../../modules/agent-door/wire.ts'
import { ToolRefusal, type AgentDoorOptions, type Runtime, type ToolContext } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { nativeCall } from './native'

/** Cached MCP replies must pass the same live packet fence as a new read. Base stays byte-exact. */
export async function recoveryBoundary(request:Request,env:Bindings,options:AgentDoorOptions):Promise<Response|null>{
 if(new URL(request.url).pathname!=='/mcp'||request.method!=='POST')return null
 let rpc:{id?:string|number;method?:string;params?:{name?:string;arguments?:Record<string,unknown>;requestState?:unknown}}
 try{rpc=await request.clone().json()}catch{return null}
 if(rpc.method!=='tools/call'||!['plinth.recovery.read','plinth.recovery.compare'].includes(rpc.params?.name??''))return null
 const runtime:Runtime={options,tools:options.tools,now:options.now??Date.now},state=await policyState(runtime)
 if(policyRefusal(runtime,state,['standard','sensitive']))return null
 const principal=await authenticate(options,request,state.business)
 if(!principal||!principal.scopes.includes(options.tools.find(t=>t.name===rpc.params?.name)!.scope))return null
 const args=rpc.params?.arguments??{},ctx:ToolContext={person:principal.person,agent:principal.agent,actor:preparedBy(principal),db:env.DB,seed:'plinth',origin:env.AUTH_ORIGIN,now:Date.now,door:'mcp',approvers:[],emit(){}}
 try{await nativeCall(env,principal.person,'jobs/'+encodeURIComponent(String(args.job_id))+'/recovery/requests/'+encodeURIComponent(String(args.request_id)),'GET',undefined,ctx)}catch(error){
  if(error instanceof ToolRefusal)return rpcError(rpc.id??null,-32000,'Recovery packet unavailable',200,{code:error.code})
  throw error
 }
 // A prior policy decision cannot disclose packet contents under changed authority.
 const pending=typeof rpc.params?.requestState==='string'?await env.DB.prepare("SELECT saved FROM agent_door_approvals WHERE json_extract(saved,'$.result.requestState')=?").bind(rpc.params.requestState).first<{saved:string}>():null
 const cached=typeof args.idempotency_key==='string'?await env.DB.prepare('SELECT outcome FROM agent_door_calls WHERE agent=? AND key=?').bind(principal.agent.id,args.idempotency_key).first<{outcome:string|null}>():null
 if(pending&&JSON.parse(pending.saved).revision!==state.revision||cached?.outcome&&JSON.parse(cached.outcome).decision?.revision!==state.revision)return rpcError(rpc.id??null,-32000,'Recovery authority changed; request fresh review',200,{code:'approval_evidence_changed'})
 return null
}
