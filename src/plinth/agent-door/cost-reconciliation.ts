import { defineTool, ToolRefusal, type ToolContext } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { nativeCall, nativeVersion, safe } from './native'
import { recordClasses } from './classes'

const id={type:'string',minLength:1,maxLength:100}
const base=(args:Record<string,unknown>)=>'jobs/'+encodeURIComponent(String(args.job_id))+'/cost-reconciliation'
export function reconciliationTools(env:Bindings){
 async function reviewed(args:Record<string,unknown>,ctx:ToolContext){
  const value=await nativeCall(env,ctx.person,base(args)+'/'+encodeURIComponent(String(args.packet_id))+'/reviewed','GET',undefined,ctx)
  const packet=(value.packets as Array<{id:string;digest:string;findings:unknown[]}>)[0]!
  if(packet.digest!==args.digest)throw new ToolRefusal('packet_digest')
  return packet
 }
 return [defineTool({name:'plinth.costs.packets',title:'List reviewed cost packets',description:'List only current owner-reviewed diagnostic packet identities. Native cost doors remain private.',scope:'drafts:read',readOnly:true,
  inputSchema:{type:'object',properties:{job_id:id},required:['job_id'],additionalProperties:false},outputSchema:{type:'object',properties:{packets:{type:'array'}},required:['packets']},classes:['standard'],clauses:['AGENT-005','NATIVE-008'],classify:()=>[{class:'standard',facts:{measure:1}}],
  async run(args,ctx){const value=await nativeCall(env,ctx.person,base(args)+'/reviewed','GET',undefined,ctx);return {result:{packets:(value.packets as Array<{id:string;digest:string}>).map(({id,digest})=>({id,digest}))}}},
 }),defineTool({name:'plinth.costs.reconcile',title:'Prepare reviewed cost suggestions',description:'Consume one explicitly reviewed native diagnostic packet. Only selected evidence is available. No approval, posting, payroll, payment or exception clearance.',scope:'drafts:write',readOnly:false,
  inputSchema:{type:'object',properties:{job_id:id,packet_id:id,digest:{type:'string',minLength:64,maxLength:64},expected_version:{type:'integer',minimum:1}},required:['job_id','packet_id','digest'],additionalProperties:false},outputSchema:{type:'object',properties:{record:{},version:{type:'integer'}},required:['record','version']},classes:['standard','sensitive'],clauses:['AGENT-005','NATIVE-008'],untrusted:true,
  async classify(args,ctx){return recordClasses(safe(await reviewed(args,ctx)))},
  revision(args,ctx){return nativeVersion(env,ctx.person,String(args.job_id))},
  async summary(args,ctx){const packet=await reviewed(args,ctx);return {target:{id:packet.id,name:'Owner-reviewed pre-draw diagnostic'},items:['Prepare suggestions from '+packet.findings.length+' selected findings','Packet digest '+packet.digest]}},
  async run(args,ctx){await reviewed(args,ctx);const version=await nativeVersion(env,ctx.person,String(args.job_id)),value=await nativeCall(env,ctx.person,base(args)+'/'+encodeURIComponent(String(args.packet_id))+'/propose','POST',{digest:args.digest,expected_version:args.expected_version??version},ctx);return {result:{record:safe(value.record),version:value.version}}},
 })]
}
