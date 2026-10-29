import type { AgentDoor, AgentDoorOptions, Person } from '../../modules/agent-door/index.ts'
import { authenticate } from '../../modules/agent-door/credentials.ts'
import type { Bindings } from '../../auth.server'
import { checkPacket } from '../agent-answers'
import { jobOf } from '../store'
import { need, type Actor } from '../model'

/** Native packet fences precede the shared door's cached tool and approval replay. */
export function answerAccess(door:AgentDoor,options:AgentDoorOptions,env:Bindings):AgentDoor {
 async function check(name:string,args:Record<string,unknown>,person:Person){
  if(!name.startsWith('plinth.answers.'))return
  const row=await env.DB.prepare("SELECT id,email,display_name AS name,version FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(person.id).first<{id:string;email:string;name:string;version:number}>()
  need(row,'Current owner sponsorship is required',403,'forbidden')
  const owner:Actor={...row,role:'owner'},job=await jobOf(env.DB,owner,String(args.job_id))
  if(args.packet_id){const packet=job.agent_answers?.find(p=>p.id===args.packet_id);need(packet,'Question packet not found',404,'not_found');await checkPacket(env.DB,job,owner,packet)}
 }
 return {...door,
  async handle(request){
   if(new URL(request.url).pathname==='/mcp'&&request.method==='POST'){
    // Keep malformed and oversized input on the shared transport's bounded parser.
    const reader=request.clone().body?.getReader(),decoder=new TextDecoder();let raw='',size=0
    if(reader)for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>1048576){void reader.cancel();return door.handle(request)}raw+=decoder.decode(next.value,{stream:true})}
    let rpc:{id?:unknown;method?:string;params?:{name?:string;arguments?:Record<string,unknown>;requestState?:unknown}}
    try{rpc=JSON.parse(raw)}catch{return door.handle(request)}
    if(rpc?.method==='tools/call'&&typeof rpc.params?.name==='string'&&rpc.params.name.startsWith('plinth.answers.')&&rpc.params.arguments){
     const state=await env.DB.prepare('SELECT envelope FROM agent_door_state WHERE id=1').first<{envelope:string|null}>()
     const principal=await authenticate(options,request,state?.envelope?JSON.parse(state.envelope).business??null:null)
     const replay=principal&&(typeof rpc.params.requestState==='string'||typeof rpc.params.arguments.idempotency_key==='string'&&await env.DB.prepare('SELECT 1 FROM agent_door_calls WHERE agent=? AND key=? AND outcome IS NOT NULL').bind(principal.agent.id,rpc.params.arguments.idempotency_key).first())
     if(principal&&replay)try{await check(rpc.params.name,rpc.params.arguments,principal.person)}catch(error){const code=(error as {code?:string}).code??'forbidden';return Response.json({jsonrpc:'2.0',id:rpc.id??null,result:{isError:true,content:[{type:'text',text:code}],_meta:{'com.runeditrun/error':{code}}}},{headers:{'cache-control':'private, no-store'}})}
    }
   }
   return door.handle(request)
  },
  async invoke(name,args,who){try{if(name.startsWith('plinth.answers.')&&typeof args.idempotency_key==='string'&&await env.DB.prepare('SELECT 1 FROM agent_door_calls WHERE agent=? AND key=? AND outcome IS NOT NULL').bind(who.agent.id,args.idempotency_key).first())await check(name,args,who.person)}catch(error){return {outcome:'refused',decision:null,code:(error as {code?:string}).code??'forbidden'}}return door.invoke(name,args,who)},
 }
}
