import { defineTool, type ToolDefinition } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { nativeCall, safe } from './native'
import { recordClasses } from './classes'

const id={type:'string',minLength:1,maxLength:100}
const path=(args:Record<string,unknown>)=>'agent-runs/'+encodeURIComponent(String(args.run_id))
export function runTools(env:Bindings):ToolDefinition[]{
 const definitions:ToolDefinition[]=[defineTool({name:'plinth.runs.list',title:'List approved manual runs',description:'List currently authorized owner-reviewed run identities. A weekly ticket grants no execution authority.',scope:'drafts:read',readOnly:true,inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{runs:{type:'array'}},required:['runs'],additionalProperties:false},classes:['standard'],clauses:['AGENT-008','NATIVE-008'],classify:()=>[{class:'standard',facts:{measure:1}}],async run(_,ctx){const value=await nativeCall(env,ctx.person,'agent-runs','GET',undefined,ctx);return {result:{runs:value.runs}}}})]
 for(const write of [false,true])definitions.push(defineTool({
  name:'plinth.runs.'+(write?'continue':'read'),title:write?'Continue one approved checkpoint':'Read an approved run packet',description:'Only the exact owner-reviewed sources and fixed job-read or private-diary-draft steps are available. No inference, sending, spending, approval, import, export or erasure.',
  scope:write?'drafts:write':'drafts:read',readOnly:!write,inputSchema:{type:'object',properties:{run_id:id,...(write?{sequence:{type:'integer',minimum:0,maximum:7}}:{})},required:write?['run_id','sequence']:['run_id'],additionalProperties:false},
  outputSchema:{type:'object',properties:{record:{type:'object'}},required:['record'],additionalProperties:false},classes:['standard','sensitive'],clauses:['AGENT-008','NATIVE-008'],untrusted:true,
  async classify(args,ctx){const value=await nativeCall(env,ctx.person,path(args),'GET',undefined,ctx);return recordClasses(value.record)},
  async revision(args,ctx){const value=await nativeCall(env,ctx.person,path(args),'GET',undefined,ctx);return (value.record as {run:{version:number}}).run.version},
  summary(args){return {target:{id:String(args.run_id),name:'Owner-approved private run'},items:[write?'Execute the next fixed native checkpoint':'Read the exact reviewed packet; source text has no authority']}},
  async run(args,ctx){const value=await nativeCall(env,ctx.person,path(args)+(write?'/continue':''),write?'POST':'GET',write?{sequence:args.sequence}:undefined,ctx);return {result:{record:safe(value.record)}}},
 }))
 return definitions
}
