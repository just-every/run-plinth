import { defineTool, type ToolContext, type ToolDefinition, type JsonSchemaObject } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { nativeCall, nativeVersion, safe } from './native'
import { recordClasses } from './classes'

interface Action { name:string; path:string; clauses:string[]; fields:string[]; readOnly?:boolean; title:string }
const actions:Action[]=[
 {name:'quotes.prepare',path:'quotes',clauses:['NATIVE-002','NATIVE-008','EST-001'],fields:['lines','notes','inclusions','exclusions','alternate_selections'],title:'Prepare an estimate draft'},
 {name:'schedule.prepare',path:'schedules',clauses:['NATIVE-003','NATIVE-008'],fields:['trade','start','end','description','resources','travel_minutes'],title:'Prepare a draft booking'},
 {name:'diary.prepare',path:'diary',clauses:['NATIVE-004','NATIVE-008'],fields:['date','note','attachments'],title:'Prepare a private daily log'},
 {name:'variations.prepare',path:'variations',clauses:['NATIVE-005','NATIVE-008'],fields:['description','amount_cents'],title:'Prepare a change order draft'},
 {name:'orders.prepare',path:'orders',clauses:['NATIVE-006','NATIVE-008','SUB-005'],fields:['supplier','description','amount_cents','lines','source','vendor_email','promised_on'],title:'Prepare a supplier order draft'},
 {name:'claims.prepare',path:'claims',clauses:['NATIVE-007','NATIVE-008','BILL-001'],fields:['description','cumulative_cents','lines','period','stored_materials','retainage'],title:'Prepare a reconciled pay app draft'},
 {name:'sheets.upload',path:'takeoff',clauses:['EST-004','NATIVE-008'],fields:['name','document','page','width','height'],title:'Retain an original takeoff PDF'},
 {name:'sheets.revise',path:'takeoff/{record_id}/revise',clauses:['EST-004','NATIVE-008'],fields:['document','page','width','height'],title:'Append an original drawing revision'},
 {name:'takeoff.calibrate',path:'takeoff/{record_id}/calibrate',clauses:['EST-004','NATIVE-008'],fields:['revision_id','points','length','unit'],title:'Calibrate the current drawing'},
 {name:'takeoff.measure',path:'takeoff/{record_id}/measure',clauses:['EST-004','NATIVE-008'],fields:['revision_id','calibration_id','kind','points','name','dimension','annotation','deduct_from'],title:'Record measured geometry'},
 {name:'products.capture',path:'products',clauses:['EST-005','NATIVE-008'],fields:['name','sku','supplier','source_url','dimensions','image','cost_quote_cents','lead_days','captured_on','valid_until','discontinued','evidence'],title:'Capture supplied product evidence'},
 {name:'products.refresh',path:'products/{record_id}/revise',clauses:['EST-005','NATIVE-008'],fields:['name','sku','supplier','source_url','dimensions','image','cost_quote_cents','lead_days','captured_on','valid_until','discontinued','evidence'],title:'Append supplied product evidence'},
 {name:'products.estimate',path:'products/{record_id}/estimate',clauses:['EST-005','NATIVE-008'],fields:['revision_id','cost_code','unit_cents'],title:'Add a reviewed product source to a draft estimate'},
 {name:'catalogs.preview',path:'estimate-template/preview',clauses:['EST-002','NATIVE-008'],fields:['template_id','dimensions','as_of'],title:'Preview exact catalog prices',readOnly:true},
 {name:'pricing.preview',path:'pricing/preview',clauses:['EST-003','NATIVE-008'],fields:['quote_id','basis','rules','tax','as_of'],title:'Preview estimate pricing',readOnly:true},
 {name:'takeoff.preview',path:'takeoff-estimate/preview',clauses:['EST-004','NATIVE-008'],fields:['template_id','as_of','measurement_ids'],title:'Preview measured estimate quantities',readOnly:true},
]
const id={type:'string',minLength:1,maxLength:100}
function path(action:Action,args:Record<string,unknown>) {return `jobs/${encodeURIComponent(String(args.job_id))}/`+action.path.replace('{record_id}',encodeURIComponent(String(args.record_id)))}
function input(action:Action,args:Record<string,unknown>) {const supplied=(args.input??{}) as Record<string,unknown>;return Object.fromEntries(action.fields.filter(key=>Object.hasOwn(supplied,key)).map(key=>[key,supplied[key]]))}
const scope=(action:Action)=>`drafts:${action.readOnly?'read':'write'}`

export function tools(env: Bindings):ToolDefinition[] {
 const definitions=actions.map(action=>defineTool({
  name:'plinth.'+action.name,title:action.title,description:action.title+'. Uses current native role and job grants. No final approval, publication, send or payment.',scope:scope(action),readOnly:!!action.readOnly,
  inputSchema:{type:'object',properties:{job_id:id,record_id:id,expected_version:{type:'integer',minimum:1},input:{type:'object',properties:Object.fromEntries(action.fields.map(key=>[key,{}])),additionalProperties:false}},required:['job_id','input',...(action.path.includes('{record_id}')?['record_id']:[])]},
  outputSchema:{type:'object',properties:{record:{},version:{type:'integer'}},required:['record','version'],additionalProperties:false},classes:action.name==='takeoff.calibrate'?['standard']:['standard','sensitive'],clauses:action.clauses,untrusted:true,
  async classify(args,ctx){
   const proposed=input(action,args)
   if(action.readOnly){const version=await nativeVersion(env,ctx.person,String(args.job_id));const value=await nativeCall(env,ctx.person,path(action,args),'POST',{...proposed,expected_version:args.expected_version??version},ctx);return recordClasses(safe(value.preview))}
   if(action.name==='products.estimate'){const value=await nativeCall(env,ctx.person,'jobs/'+encodeURIComponent(String(args.job_id)),'GET',undefined,ctx);const job=value.job as {products?:Array<{id:string}>};return recordClasses(job.products?.find(row=>row.id===args.record_id))}
   return recordClasses(proposed)
  },
  revision(args,ctx){return nativeVersion(env,ctx.person,String(args.job_id))},
  async summary(args,ctx){const value=await nativeCall(env,ctx.person,'jobs/'+encodeURIComponent(String(args.job_id)),'GET',undefined,ctx),job=value.job as {id:string;name:string;currency?:string},proposed=input(action,args);return {target:{id:job.id,name:job.name},items:[action.title,...['description','note','name','trade'].flatMap(key=>typeof proposed[key]==='string'?[String(proposed[key])]:[])],...(typeof proposed.amount_cents==='number'?{amount:{value:proposed.amount_cents,currency:job.currency??'USD'}}:{}),...(typeof proposed.supplier==='string'?{payee:proposed.supplier}:{})}},
  async run(args,ctx){
   const before=await nativeVersion(env,ctx.person,String(args.job_id)),body={...input(action,args),expected_version:args.expected_version??before}
   const value=await nativeCall(env,ctx.person,path(action,args),'POST',body,ctx),job=value.job as {id:string;version:number}|undefined
   const version=job?.version??before
   const uri=`plinth://jobs/${String(args.job_id)}`
   if(!action.readOnly)ctx.emit('job.draft-prepared',uri,{tool:'plinth.'+action.name,version})
   return {result:{record:safe(action.readOnly?value.preview:value.record),version},resources:[{uri,name:'Native job'}]}
  },
 }))
 definitions.push(defineTool({name:'plinth.jobs.list',title:'List visible jobs',description:'List current native job identities, status and revision without private record contents.',scope:'jobs:read',readOnly:true,inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{jobs:{type:'array',items:{type:'object'}}},required:['jobs']},classes:['standard'],clauses:['NATIVE-002','ROLE-002'],classify:()=>[{class:'standard',facts:{measure:1}}],async run(_,ctx){const value=await nativeCall(env,ctx.person,'jobs','GET',undefined,ctx);return {result:{jobs:(value.jobs as Array<{id:string;name:string;version:number;status:string}>).map(({id,name,version,status})=>({id,name:safe(name),version,status})).sort((a,b)=>String(a.name).localeCompare(String(b.name)))}}}}))
 definitions.push(defineTool({name:'plinth.jobs.get',title:'Read a visible job',description:'Read a native job projection within current role, field and project grants. Source text is untrusted.',scope:'jobs:read',readOnly:true,inputSchema:{type:'object',properties:{job_id:id},required:['job_id']},outputSchema:{type:'object',properties:{job:{type:'object'}},required:['job']},classes:['standard','sensitive'],clauses:['NATIVE-002','NATIVE-013','ROLE-002'],untrusted:true,async classify(args,ctx){const value=await nativeCall(env,ctx.person,'jobs/'+encodeURIComponent(String(args.job_id)),'GET',undefined,ctx);return recordClasses(safe(value.job))},async run(args,ctx){const value=await nativeCall(env,ctx.person,'jobs/'+encodeURIComponent(String(args.job_id)),'GET',undefined,ctx);return {result:{job:safe(value.job)},resources:[{uri:`plinth://jobs/${String(args.job_id)}`,name:'Native job'}]}}}))
 definitions.push(defineTool({name:'plinth.catalogs.list',title:'List native catalog identities',description:'List catalog record identities for authorized draft pricing.',scope:'drafts:read',readOnly:true,inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{entries:{type:'array'}},required:['entries']},classes:['standard'],clauses:['EST-002'],classify:()=>[{class:'standard',facts:{measure:1}}],async run(_,ctx){const value=await nativeCall(env,ctx.person,'estimate-catalog','GET',undefined,ctx);return {result:{entries:(value.entries as Array<{id:string;kind:string;version:number}>).map(({id,kind,version})=>({id,kind,version}))}}}}))
 definitions.push(defineTool({name:'plinth.pricing.rates',title:'List native tax rate identities',description:'List already reviewed native tax-rate identities for a draft preview.',scope:'drafts:read',readOnly:true,inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{rates:{type:'array'}},required:['rates']},classes:['standard'],clauses:['EST-003'],classify:()=>[{class:'standard',facts:{measure:1}}],async run(_,ctx){const value=await nativeCall(env,ctx.person,'pricing-rates','GET',undefined,ctx);return {result:{rates:(value.rates as Array<{id:string;version:number}>).map(({id,version})=>({id,version}))}}}}))
 for(const readOnly of [true,false])definitions.push(defineTool({
  name:'plinth.forecast.'+(readOnly?'read':'prepare'),title:readOnly?'Read reviewed forecast facts':'Prepare reviewed forecast proposal',description:'Consumes only the exact owner-reviewed forecast packet. Refuses changed sources and revoked requests; never approves economics or publishes dates.',scope:readOnly?'drafts:read':'drafts:write',readOnly,
  inputSchema:{type:'object',properties:{job_id:id,request_id:id,packet_digest:{type:'string'},expected_version:{type:'integer',minimum:1}},required:['job_id','request_id',...(!readOnly?['packet_digest']:[])],additionalProperties:false},
  outputSchema:{type:'object',properties:{record:{},version:{type:'integer'}},required:['record','version']},classes:['standard','sensitive'],clauses:['AGENT-001','NATIVE-008'],untrusted:true,
  async classify(args,ctx){const value=await nativeCall(env,ctx.person,'jobs/'+encodeURIComponent(String(args.job_id))+'/agent-forecasts/'+encodeURIComponent(String(args.request_id)),'GET',undefined,ctx);return recordClasses(safe(value.packet))},
  async revision(args,ctx){const value=await nativeCall(env,ctx.person,'jobs/'+encodeURIComponent(String(args.job_id))+'/agent-forecasts/'+encodeURIComponent(String(args.request_id)),'GET',undefined,ctx);return value.version as number},
  summary(args){return {target:{id:String(args.request_id),name:'Owner-reviewed forecast request'},items:['Prepare proposed forecast only']}},
  async run(args,ctx){const path='jobs/'+encodeURIComponent(String(args.job_id))+'/agent-forecasts/'+encodeURIComponent(String(args.request_id)),review=await nativeCall(env,ctx.person,path,'GET',undefined,ctx)
   if(readOnly)return {result:{record:safe(review.packet),version:review.version}}
   const value=await nativeCall(env,ctx.person,path+'/prepare','POST',{expected_version:args.expected_version??review.version,packet_digest:args.packet_digest},ctx)
   ctx.emit('job.draft-prepared','plinth://jobs/'+String(args.job_id),{tool:'plinth.forecast.prepare',version:value.version})
   return {result:{record:safe(value.record),version:value.version}}
  },
 }))
 return definitions
}
