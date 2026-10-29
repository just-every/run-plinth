import { defineTool, type ToolDefinition } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { nativeCall, nativeVersion, safe } from './native'
import { recordClasses } from './classes'

const id={type:'string',minLength:1,maxLength:100}
export function recoveryTools(env:Bindings):ToolDefinition[]{
 return (['requests','read','compare'] as const).map(action=>{
  const draft=action==='compare'
  const path=(args:Record<string,unknown>)=>'jobs/'+encodeURIComponent(String(args.job_id))+'/recovery/requests'+(action==='requests'?'':'/'+encodeURIComponent(String(args.request_id)))
  return defineTool({name:'plinth.recovery.'+action,title:draft?'Prepare two recovery alternatives':'Read owner-reviewed recovery '+action,description:'Private exact-source owner packet. Draft comparison only; never approves a baseline, commitment, attendance, client decision, payment or receipt.',scope:draft?'drafts:write':'drafts:read',readOnly:!draft,classes:['standard','sensitive'],clauses:['AGENT-002'],untrusted:true,
   inputSchema:{type:'object',properties:{job_id:id,...(action==='requests'?{}:{request_id:id}),...(draft?{key:id,alternatives:{type:'array',minItems:2,maxItems:2,items:{type:'object'}}}:{})},required:['job_id',...(action==='requests'?[]:['request_id']),...(draft?['key','alternatives']:[])],additionalProperties:false},
   outputSchema:{type:'object',properties:{record:{},version:{type:'integer'}},required:['record','version'],additionalProperties:false},
   async classify(args,ctx){const value=await nativeCall(env,ctx.person,path(args),'GET',undefined,ctx);return recordClasses({record:value.record??value.requests,alternatives:args.alternatives})},
   revision(args,ctx){return nativeVersion(env,ctx.person,String(args.job_id))},
   async summary(args){return {target:{id:String(args.request_id??args.job_id),name:'Owner-reviewed recovery packet'},items:[draft?'Prepare an inert comparison of two alternatives':'Read reviewed recovery evidence']}},
   async run(args,ctx){
    const version=await nativeVersion(env,ctx.person,String(args.job_id)),value=draft?await nativeCall(env,ctx.person,path(args)+'/compare','POST',{expected_version:version,key:args.key,alternatives:args.alternatives},ctx):await nativeCall(env,ctx.person,path(args),'GET',undefined,ctx)
    return {result:{record:safe(draft?{id:(value.record as {id:string}).id,request_id:String(args.request_id)}:action==='requests'?(value.requests as Array<{id:string;source_digest:string}>).map(({id,source_digest})=>({id,source_digest})):value.record),version:Number(value.version??version)}}
   },
  })
 })
}
