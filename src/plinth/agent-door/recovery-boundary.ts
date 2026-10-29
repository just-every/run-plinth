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
 let rpc:{id?:string|number;method?:string;params?:{name?:string;arguments?:Record<string,unknown>}}
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
 return null
}
