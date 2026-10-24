import { geofenceAction } from './field-geofence'
import { runtimeBindings, type Bindings } from '../auth.server'
import { authorize } from './auth'
import { active, cents, DomainError, find, need, object, recordApproval, stamp, text, usdOnly, type Actor, type Input, type Job } from './model'
import { costCode } from './cost-model'
import { sourceAction } from './cost-labor'
import { localDate } from './remittances'
import { jobOf, readClock, saveJob } from './store'
import type { FieldTime, FieldTimeState, TimeRevision } from './field-time-model'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json=(value:unknown)=>Response.json(value,{headers})
const office=(actor:Actor)=>actor.role==='owner'||actor.role==='admin'&&(!actor.permissions||actor.permissions.financial)
const state=(job:Job):FieldTimeState=>job.field_time??={entries:[],rates:[]}
function access(actor:Actor){need(office(actor)||actor.role==='crew'||actor.role==='superintendent','Time access is not available for this role',403,'forbidden')}
function projected(row:FieldTime,actor:Actor){return office(actor)?row:{id:row.id,employee_id:row.employee_id,entered_by:row.entered_by,revisions:row.revisions,...(row.approval?{approval:{by:row.approval.by}}:{})}}
function revision(job:Job,actor:Actor,input:Input):TimeRevision{
 const minutes=cents(input.minutes,'minutes'),break_minutes=cents(input.break_minutes??0,'break_minutes')
 need(minutes>0&&minutes<=1440&&break_minutes<minutes,'Enter at most 24 hours with a break shorter than the shift')
 need(input.classification==='regular'||input.classification==='overtime','Choose regular or overtime')
 return {dated_on:localDate(input.dated_on,'dated_on'),cost_code:costCode(job,input.cost_code),activity:text(input.activity,'Activity',500),minutes,break_minutes,classification:input.classification,reason:text(input.reason,'Entry or correction reason',1000),by:stamp(actor)}
}
/** Independent native time door. Pay data never enters the generic job projection. */
export async function fieldTimeResponse(request:Request,original:Bindings):Promise<Response|null>{
 const path=new URL(request.url).pathname,m=/^\/api\/plinth\/jobs\/([^/]+)\/time(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path);if(!m)return null
 const env=runtimeBindings(original),actor=await authorize(request,env);access(actor)
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,m[1]!);usdOnly(previous)
 const data=previous.field_time??{entries:[],rates:[]},rows=data.entries.filter(r=>office(actor)||r.employee_id===actor.id)
 if(request.method==='GET'){
  if(!m[2])return json({version:previous.version,entries:rows.map(r=>projected(r,actor)),location_choice:data.location_choices?.find(c=>c.employee_id===actor.id)??null,site:data.site?{label:data.site.label,radius_meters:data.site.radius_meters}:null,...(office(actor)?{rates:data.rates}:{})})
  need(m[2]==='payroll.csv'&&!m[3],'Time route not found',404,'not_found');need(office(actor),'Payroll export is office-only',403,'forbidden')
  const csv=['time_id,employee_id,job_id,cost_code,dated_on,classification,paid_minutes,gross_cents,burden_cents,time_source_id',...rows.filter(r=>r.approval).map(r=>{const v=r.revisions.at(-1)!,a=r.approval!;return [r.id,r.employee_id,previous.id,v.cost_code,v.dated_on,v.classification,v.minutes-v.break_minutes,a.base_cents,a.burden_cents,a.source_id].map(value=>'"'+(/^[=+\-@\t\r]/.test(String(value))?"'"+String(value):String(value)).replaceAll('"','""')+'"').join(',')})].join('\n')+'\n'
  // The ordinary export audit fence records the path and actor, without pay values.
  return new Response(csv,{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename=plinth-time.csv'}})
 }
 need(request.method==='POST','Method not allowed',405,'method_not_allowed');active(previous)
 if(m[2]==='location')need(data.location_choices?.some(c=>c.employee_id===actor.id&&c.consent),'Location reminders require your current explicit consent',403,'location_consent')
 need(request.headers.get('content-type')?.split(';')[0]==='application/json','Send JSON',415,'content_type')
 const reader=request.body?.getReader();need(reader,'JSON body required');let raw='',size=0;const decoder=new TextDecoder();for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>20000){await reader.cancel();throw new DomainError('body_size','Time request too large',413)}raw+=decoder.decode(chunk.value,{stream:true})}raw+=decoder.decode()
 let input:Input;try{input=object(JSON.parse(raw))}catch{throw new DomainError('invalid_json','Invalid JSON')}
 need(input.expected_version===previous.version,'Job changed; reload before writing time',409,'stale_version')
 const job=structuredClone(previous),next=state(job);let record:unknown
 if(['site','consent','location'].includes(m[2]??'')&&!m[3]){
  record=geofenceAction(job,actor,input,m[2]!)
 }else if(m[2]==='rates'&&!m[3]){
  need(actor.role==='owner','Only the owner configures reviewed pay rates',403,'forbidden')
  const employee_id=text(input.employee_id,'Employee',200);await employee(env.DB,job,employee_id)
  const hour_cents=cents(input.hour_cents,'hour_cents'),burden_bps=cents(input.burden_bps??0,'burden_bps'),overtime_bps=cents(input.overtime_bps??15000,'overtime_bps')
  need(hour_cents>0&&burden_bps<=100000&&overtime_bps>=10000&&overtime_bps<=100000,'Pay rates are outside the supported range')
  need(input.human_reviewed===true,'Confirm rates and overtime classification were reviewed; Plinth does not determine payroll law')
  const rate={employee_id,hour_cents,burden_bps,overtime_bps,reference:text(input.reference,'Rate evidence',1000),by:stamp(actor)};next.rates.push(rate);record=rate
 }else if(!m[2]){
  const employee_id=input.employee_id===undefined?actor.id:text(input.employee_id,'Employee',200)
  need(office(actor)||employee_id===actor.id,'Workers enter only their own time',403,'forbidden');await employee(env.DB,job,employee_id)
  const row:FieldTime={id:crypto.randomUUID(),employee_id,entered_by:stamp(actor),revisions:[revision(job,actor,input)]};next.entries.push(row);record=projected(row,actor)
 }else{
  const row=find(next.entries,m[2]);need(office(actor)||row.employee_id===actor.id,'Time not found',404,'not_found');need(!row.approval,'Approved time is immutable; use the recorded cost correction process',409,'time_approved')
  if(m[3]==='correct'){
   row.revisions.push(revision(job,actor,input));record=projected(row,actor)
  }else if(m[3]==='approve'){
   need(office(actor),'Only an authorized office supervisor approves time',403,'forbidden');need(actor.id!==row.employee_id&&actor.id!==row.entered_by.id&&!row.revisions.some(v=>v.by.id===actor.id),'Nobody approves their own time or a time entry they prepared',403,'time_separation');await employee(env.DB,job,row.employee_id)
   const rate=[...next.rates].reverse().find(r=>r.employee_id===row.employee_id);need(rate,'Owner must record a reviewed employee rate first',409,'time_rate')
   const v=row.revisions.at(-1)!,hour_cents=v.classification==='overtime'?Number((BigInt(rate.hour_cents)*BigInt(rate.overtime_bps)+5000n)/10000n):rate.hour_cents
   const source=await sourceAction(job,actor,{kind:'time',reference:'field-time:'+row.id,employee_reference:row.employee_id,dated_on:v.dated_on,period:v.dated_on.slice(0,7),cost_code:v.cost_code,minutes:v.minutes-v.break_minutes,hour_cents,burden_bps:rate.burden_bps})
   source.prepared_by=row.entered_by;source.detail.field_time_id=row.id;source.detail.classification=v.classification;source.detail.rate_reference=rate.reference
   await sourceAction(job,actor,{},source.id,'approve')
   row.approval={by:stamp(actor),source_id:source.id,hour_cents,burden_bps:rate.burden_bps,amount_cents:source.amount_cents,base_cents:Number(source.detail.base_cents),burden_cents:Number(source.detail.burden_cents)}
   recordApproval(job,actor,'time.approve',{id:row.id,prepared_by:row.entered_by},{time_id:row.id,source_id:source.id,label:'Supervisor approved recorded time; payroll not executed'})
   record=projected(row,actor)
  }else throw new DomainError('not_found','Time action not found',404)
 }
 await saveJob(env.DB,actor,previous,job,[],clock)
 return json({version:job.version,record})
}
async function employee(db:D1Database,job:Job,id:string){
 const person=await db.prepare("SELECT o.id FROM oa_operators o JOIN pl_team t ON t.operator_id=o.id WHERE o.id=? AND o.status='active' AND o.role='admin' AND (coalesce(json_extract(t.data,'$.base'),json_extract(t.data,'$.role')) IN ('crew','superintendent')) AND EXISTS(SELECT 1 FROM json_each(json_extract(t.data,'$.job_ids')) WHERE value=?)").bind(id,job.id).first()
 need(person,'Employee must be an active assigned crew member or superintendent',409,'time_employee')
}
