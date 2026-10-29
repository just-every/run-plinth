import { defineTool, type ToolDefinition } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { nativeCall, nativeVersion, safe } from './native'
/** Finance facts are available only in the private exact packet explicitly reviewed by the owner. */
export function recoveryEvidenceTools(env:Bindings):ToolDefinition[]{
 const id={type:'string',minLength:1,maxLength:100}
 return [true,false].map(readOnly=>defineTool({
  name:readOnly?'plinth.recovery.get':'plinth.recovery.assess',title:readOnly?'Read reviewed recovery evidence':'Prepare a recovery assessment',
  description:'Private owner-reviewed native evidence only. No source approval, receipt, publication, payment or final recovery decision.',scope:readOnly?'drafts:read':'drafts:write',readOnly,classes:['sensitive'],clauses:['AGENT-003'],untrusted:true,
  inputSchema:{type:'object',properties:{job_id:id,case_id:id,...(readOnly?{}:{expected_version:{type:'integer',minimum:1},packet_id:id,observation_id:id,observed_on:{type:'string'},observation:{type:'string'},risks:{type:'array',items:{type:'object'}}})},required:['job_id',...(readOnly?[]:['case_id','packet_id','observation_id','observed_on','observation','risks'])],additionalProperties:false},
  outputSchema:{type:'object',properties:{record:{},version:{type:'integer'}},required:['record','version'],additionalProperties:false},
  async classify(args,ctx){await nativeCall(env,ctx.person,`jobs/${encodeURIComponent(String(args.job_id))}/recovery-evidence/${encodeURIComponent(String(args.case_id??'current'))}`,'GET',undefined,ctx);return [{class:'sensitive',facts:{measure:1,kind:'protected record content'}}]},
  revision(args,ctx){return nativeVersion(env,ctx.person,String(args.job_id))},
  summary:()=>({items:['Prepare a private diagnostic assessment; source decisions remain at their human doors']}),
  async run(args,ctx){
   const path=`jobs/${encodeURIComponent(String(args.job_id))}/recovery-evidence/${encodeURIComponent(String(args.case_id??'current'))}`
   const input=readOnly?undefined:{expected_version:args.expected_version??await nativeVersion(env,ctx.person,String(args.job_id)),packet_id:args.packet_id,observation_id:args.observation_id,observed_on:args.observed_on,observation:args.observation,risks:args.risks}
   const value=await nativeCall(env,ctx.person,path+(readOnly?'':'/assess'),readOnly?'GET':'POST',input,ctx)
   return {result:{record:safe(value.record),version:value.version}}
  },
 }))
}
