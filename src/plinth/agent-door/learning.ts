import { defineTool, type ToolDefinition } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { nativeCall, safe } from './native'
import { recordClasses } from './classes'
const id={type:'string',minLength:1,maxLength:100}
const path=(args:Record<string,unknown>)=>'agent-learning/packets/'+encodeURIComponent(String(args.packet_id))
export function learningTools(env:Bindings):ToolDefinition[]{
 const definitions:ToolDefinition[]=[defineTool({name:'plinth.learning.list',title:'List reviewed learning packets',description:'List only currently consented owner packets with unchanged native sources. No discovery of unselected job facts.',scope:'drafts:read',readOnly:true,inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{packets:{type:'array'}},required:['packets']},classes:['standard'],clauses:['AGENT-009','NATIVE-008'],classify:()=>[{class:'standard',facts:{measure:1}}],async run(_,ctx){const value=await nativeCall(env,ctx.person,'agent-learning/packets','GET',undefined,ctx);return {result:{packets:value.packets}}}})]
 for(const write of [false,true])definitions.push(defineTool({
  name:'plinth.learning.'+(write?'prepare':'read'),title:write?'Prepare an estimating lesson draft':'Read reviewed learning sources',description:'Use only this exact owner-consented source packet. Source changes, erasure and revoked consent refuse the request. Drafts cannot change catalogs or approve a lesson.',scope:write?'drafts:write':'drafts:read',readOnly:!write,
  inputSchema:{type:'object',properties:{packet_id:id,...(write?{input:{type:'object',properties:{request_id:id,reason:{type:'string'},productivity_percent:{type:'integer'},rate_percent:{type:'integer'},risk_percent:{type:'integer'},dimension_percent:{type:'object'}},required:['request_id','reason'],additionalProperties:false}}:{})},required:write?['packet_id','input']:['packet_id'],additionalProperties:false},
  outputSchema:{type:'object',properties:{record:{type:'object'}},required:['record'],additionalProperties:false},classes:['standard','sensitive'],clauses:['AGENT-009','NATIVE-008'],untrusted:true,
  async classify(args,ctx){const value=await nativeCall(env,ctx.person,path(args),'GET',undefined,ctx);return recordClasses([value.packet,args.input])},
  async revision(args,ctx){const value=await nativeCall(env,ctx.person,path(args),'GET',undefined,ctx);return parseInt((value.packet as {digest:string}).digest.slice(0,12),16)},
  async summary(args){return {target:{id:String(args.packet_id),name:'Owner-reviewed completed jobs'},items:[write?'Prepare a bounded counterfactual draft':'Read the exact reviewed source packet']}},
  async run(args,ctx){const value=await nativeCall(env,ctx.person,path(args)+(write?'/drafts':''),write?'POST':'GET',write?args.input as Record<string,unknown>:undefined,ctx);return {result:{record:safe(write?value.draft:value)}}},
 }))
 return definitions
}
