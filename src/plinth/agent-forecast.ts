import type { Bindings } from '../auth.server'
import { requireOwner } from './auth'
import { cents, active, need, object, stamp, sum, text, type Actor, type Input, type Job, type Stamp } from './model'
import { costLedger } from './cost-ledger'
import { digest } from './cost-model'
import { previewSchedule } from './schedule-plan'
import { workingCalendar, workingMinutes } from './schedule-calendar'
import { wallClock, zonedInstant } from './time-zone'
import { localDate } from './remittances'
import { jobOf, readClock, saveJob } from './store'

type Kind = 'estimate'|'budget'|'ledger'|'schedule'|'quantities'|'procurement'|'confirmations'
interface Source { key:Kind; id:string; revision:string; facts:unknown }
interface ReviewedSource extends Source { as_of:string; valid_until:string }
interface Uncertainty { source:string; state:'withheld'|'unavailable'|'stale'|'unverified'; owner_id:string; due_on:string; reason:string }
interface RequestPacket { format:'plinth-agent-forecast-v1'; job_id:string; id:string; reviewed_by:Stamp; as_of:string; sources:ReviewedSource[]; assumptions:Input; uncertainties:Uncertainty[]; forecast:unknown; digest:string; revoked_by?:Stamp; proposal_id?:string }
export interface AgentForecastState { requests:RequestPacket[]; proposals:{id:string;request_id:string;packet_digest:string;prepared_by:Stamp;packet:RequestPacket}[] }
const state=(job:Job)=>job.agent_forecasts??={requests:[],proposals:[]}
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
const decimal=(v:unknown,name:string)=>{const s=String(v);need(/^\d{1,9}(\.\d{1,3})?$/.test(s),name+' requires a nonnegative decimal with up to three places');const [n,f='']=s.split('.');return BigInt(n!)*1000n+BigInt(f.padEnd(3,'0'))}
const quantity=(v:unknown,name:string)=>{const s=String(v);need(/^\d{1,12}(\.\d{1,4})?$/.test(s),name+' requires a nonnegative decimal with up to four places');const [n,f='']=s.split('.');return BigInt(n!)*10_000n+BigInt(f.padEnd(4,'0'))}
const units=(n:bigint)=>`${n/1000n}.${String(n%1000n).padStart(3,'0')}`
const quantityText=(n:bigint)=>n%10n===0n?units(n/10n):`${n/10_000n}.${String(n%10_000n).padStart(4,'0')}`

/** Only these native facts can enter a review. Private originals and raw payroll stay at their existing doors. */
async function sources(job:Job):Promise<Source[]> {
 const ledger=costLedger(structuredClone(job)),budget=job.budgets?.at(-1)
 const facts:Partial<Record<Kind,unknown>>={
  ...(job.quotes.some(q=>q.status==='accepted')?{estimate:job.quotes.filter(q=>q.status==='accepted')}:{}),
  ...(budget?{budget}:{}),
  ledger:{currency:ledger.currency,budget_revision:ledger.budget_revision,rows:ledger.rows.map(r=>({cost_code:r.cost_code,posted_actual_cents:r.posted_actual_cents,open_commitment_cents:r.open_commitment_cents,sources:r.sources})),reconciliations:job.cost_records?.reconciliations??[]},
  // The planner revision invalidates packets computed with unreviewed job records.
  ...(job.schedules.length?{schedule:{planner:'reviewed-schedule-only-v1',tasks:job.schedules,calendar:workingCalendar(job.schedule_calendar,job.time_zone),constraints:job.schedule_constraints??[]}}:{}),
  ...(job.schedule_actuals?.length?{quantities:job.schedule_actuals}:{}),
  ...(job.orders.length?{procurement:job.orders.map(o=>({id:o.id,revision:o.amendments?.filter(a=>a.status==='approved').length??0,status:o.status,promised_on:o.promised_on,amount_cents:o.amount_cents,lines:o.lines,receipts:o.receipts,amendments:o.amendments}))}:{}),
  ...(job.trade_invitations?.length?{confirmations:job.trade_invitations}:{}),
 }
 return Promise.all(Object.entries(facts).map(async([key,facts])=>({key:key as Kind,id:job.id+':'+key,revision:await digest(facts),facts})))
}

async function calculate(job:Job,actor:Actor,selected:ReviewedSource[],input:Input,unknown:Uncertainty[]) {
 const has=(key:Kind)=>selected.some(s=>s.key===key),codes=input.codes
 const costAssumptions:{cost_code:string;remaining_quantity:string;minutes_per_unit:string}[]=[]
 let native_cost:unknown=null
 need(codes===undefined||Array.isArray(codes)&&codes.length<=100,'Provide up to 100 dated code assumptions')
 if(has('ledger')&&has('budget')&&Array.isArray(codes)&&codes.length){
  const ledger=costLedger(structuredClone(job)),budget=job.budgets!.at(-1)!,seen=new Set<string>()
  const rows=codes.map(value=>{
   const a=object(value),code=text(a.cost_code,'cost_code',80),source=ledger.rows.find(r=>r.cost_code===code)
   need(source&&!seen.has(code),'Review each current ledger code once',409,'forecast_codes');seen.add(code)
   const remaining=decimal(a.remaining_quantity,'remaining_quantity'),minutes=decimal(a.minutes_per_unit,'minutes_per_unit'),rate=cents(a.labor_hour_cents,'labor_hour_cents'),n=remaining*minutes*BigInt(rate),d=60_000_000n
   const labor=cents(Number((n*2n+d)/(2n*d))),committed=cents(a.outstanding_commitment_cents,'outstanding_commitment_cents')
   need(committed===source.open_commitment_cents,'Review the exact remaining commitment; consumed costs cannot enter twice',409,'forecast_source_changed')
   const remaining_cents=sum([labor,committed,cents(a.unbought_cents,'unbought_cents'),cents(a.risk_cents,'risk_cents')]),final_cents=sum([source.posted_actual_cents,remaining_cents]),revenue_cents=budget.codes.find(c=>c.cost_code===code)?.revenue_cents??0
   text(a.reference,'Dated assumption evidence',2000)
   costAssumptions.push({cost_code:code,remaining_quantity:units(remaining),minutes_per_unit:units(minutes)})
   return {cost_code:code,remaining_quantity:units(remaining),minutes_per_unit:units(minutes),labor_cents:labor,actual_cents:source.posted_actual_cents,remaining_cents,final_cents,revenue_cents,margin_cents:sum([revenue_cents,-final_cents])}
  })
  need(ledger.rows.every(r=>seen.has(r.cost_code)),'Every current ledger code needs an assumption',409,'forecast_codes')
  native_cost={currency:ledger.currency,codes:rows,remaining_cents:sum(rows.map(r=>r.remaining_cents)),final_cents:sum(rows.map(r=>r.final_cents)),revenue_cents:sum(rows.map(r=>r.revenue_cents)),margin_cents:sum(rows.map(r=>r.margin_cents)),label:'Proposed native recorded costs only; external accounting completeness is unknown'}
 }
 let schedule:unknown=null
 if(has('schedule')){
  const reviewed=selected.find(s=>s.key==='schedule')!.facts as {tasks:Job['schedules'];calendar:ReturnType<typeof workingCalendar>;constraints:NonNullable<Job['schedule_constraints']>}
  const calendar=structuredClone(reviewed.calendar),observed=text(input.observed_at,'Observation instant',40)
  // Build the planner input from reviewed facts; native bid and RFI records confer no review authority.
  const candidate:Job={id:job.id,version:job.version,name:'',client_email:'',address:'',status:'active',created_by:stamp(actor),quotes:[],schedules:structuredClone(reviewed.tasks),diary:[],variations:[],orders:[],claims:[],approvals:[],schedule_calendar:calendar,time_zone:calendar.time_zone,schedule_constraints:structuredClone(reviewed.constraints)}
  need(Number.isFinite(Date.parse(observed))&&wallClock(Date.parse(observed),calendar.time_zone??'UTC').date===input.as_of,'Observation instant must fall on the assumption date')
  const production=input.production??[],deliveries=input.deliveries??[]
  need(Array.isArray(production)&&production.length<=100&&Array.isArray(deliveries)&&deliveries.length<=100,'Provide bounded task assumptions')
  const measured:{task_id:string;actual_id:string;installed_quantity:string;remaining_quantity:string;elapsed_minutes:number;minutes_per_unit:string;remaining_minutes:number}[]=[],seen=new Set<string>()
  for(const value of production){
   need(has('quantities'),'Review field quantities before using production',409,'forecast_source_withheld')
   const p=object(value),id=text(p.task_id,'Task',100),task=candidate.schedules.find(t=>t.id===id),actual=job.schedule_actuals?.findLast(a=>a.task_id===id)
   need(task&&task.status==='booked'&&actual?.installed&&!seen.has(id),'Choose one current task with recorded installed quantity',409,'forecast_quantity');seen.add(id)
   need(p.unit===actual.installed.unit,'Production units must match the recorded quantity',409,'forecast_quantity')
   const total=quantity(p.total_quantity,'total_quantity'),installed=quantity(actual.installed.quantity,'installed quantity'),elapsed=workingMinutes(Date.parse(actual.actual_start),Date.parse(observed),calendar)
   need(total>=installed&&installed>0n&&Number.isSafeInteger(elapsed)&&elapsed>0,'Review positive measured progress and elapsed working minutes',409,'forecast_quantity')
   const remaining=total-installed,remaining_minutes=Number((BigInt(elapsed)*remaining+installed-1n)/installed),perUnit=(BigInt(elapsed)*10_000_000n+installed/2n)/installed
   need(remaining_minutes<=525600,'Remaining work exceeds the supported planner horizon')
   task.start=new Date(observed).toISOString();task.duration_minutes=remaining_minutes;task.milestone=remaining_minutes===0
   const cost=costAssumptions.find(c=>c.cost_code===actual.installed!.cost_code)
   if(cost&&(quantity(cost.remaining_quantity,'Remaining cost quantity')!==remaining||cost.minutes_per_unit!==units(perUnit)))unknown.push({source:'productivity:'+id,state:'unverified',owner_id:actor.id,due_on:String(input.due_on),reason:'Reviewed cost assumptions differ from measured elapsed productivity; elapsed time is not attested crew labor'})
   measured.push({task_id:id,actual_id:actual.id,installed_quantity:actual.installed.quantity,remaining_quantity:quantityText(remaining),elapsed_minutes:elapsed,minutes_per_unit:units(perUnit),remaining_minutes})
  }
  const linked=new Set<string>()
  for(const value of deliveries){
   need(has('procurement'),'Review procurement before using promised delivery dates',409,'forecast_source_withheld')
   const p=object(value),task=candidate.schedules.find(t=>t.id===p.task_id),order=job.orders.find(o=>o.id===p.order_id)
   need(task&&task.status==='booked'&&order&&order.status==='issued'&&order.promised_on&&!linked.has(task.id),'Choose one issued dated order for an existing task',409,'forecast_delivery');linked.add(task.id)
   // A promise is a dated assumption, never proof of physical receipt.
   const available=new Date(zonedInstant(order.promised_on,0,calendar.time_zone??'UTC')).toISOString();if(Date.parse(available)>Date.parse(task.start))task.start=available
  }
  // Project remaining work forward; retained physical actuals are not rewritten by the planner.
  candidate.schedule_actuals=[]
  const preview=await previewSchedule(candidate,actor,{calendar,tasks:candidate.schedules},[])
  for(const blocker of preview.blockers)unknown.push({source:'schedule-constraint',state:'unverified',owner_id:actor.id,due_on:String(input.due_on),reason:'Proposed dates retain an unresolved native work prerequisite: '+JSON.stringify(blocker)})
  schedule={completion_before:preview.completion_before,completion_after:preview.completion_after,tasks:preview.tasks,critical_path:preview.critical_path,blockers:preview.blockers,production:measured,label:'Proposed remaining-work dates; delivery promises and elapsed productivity are assumptions, not confirmations or labor time'}
 }
 if(!native_cost)unknown.push({source:'native-cost',state:'unavailable',owner_id:actor.id,due_on:String(input.due_on),reason:'Review ledger and budget plus complete code assumptions before calculating native economics'})
 return {native_cost,schedule,accounting_actual_cents:null,complete_cost_to_complete_cents:null,complete_margin_cents:null,label:'Proposed only; no approval, publication, physical receipt or provider synchronization'}
}

async function access(env:Bindings,actor:Actor,agent=false){
 if(actor.role==='owner'&&!actor.permissions)return
 need(agent&&actor.role==='agent'&&!!actor.agent_door&&!actor.permissions,'Only a signed-in owner reviews forecast facts; an agent consumes a reviewed request',403,'forbidden')
 const owner=await env.DB.prepare("SELECT id FROM oa_operators WHERE id=? AND status='active' AND role='owner' AND NOT EXISTS(SELECT 1 FROM pl_team WHERE operator_id=oa_operators.id)").bind(actor.id).first()
 need(owner,'The sponsoring owner is no longer authorized',403,'forbidden')
}
async function reviewed(db:D1Database,packet:RequestPacket,actor:Actor){need(await db.prepare('SELECT request_id FROM pl_agent_forecast_reviews WHERE request_id=? AND owner_id=? AND digest=?').bind(packet.id,actor.id,packet.digest).first(),'Review this request in the current installation before consuming its facts',403,'forecast_review_required')}
async function freshness(job:Job,packet:RequestPacket){const current=await sources(job);return packet.sources.filter(s=>!current.some(c=>c.key===s.key&&c.id===s.id&&c.revision===s.revision)).map(s=>s.key)}

export async function agentForecastResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(request:Request)=>Promise<Input>):Promise<Response|null>{
 if(parts[0]!=='jobs'||parts[2]!=='agent-forecasts')return null
 await access(env,actor,parts.length>=4&&parts[3]!=='sources')
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,parts[1]!),job=structuredClone(previous),records=state(job)
 if(request.method==='GET'){
  if(parts.length===4&&parts[3]==='sources'){requireOwner(actor);return json({version:job.version,sources:await sources(job)})}
  if(parts.length===3){requireOwner(actor);return json({version:job.version,requests:await Promise.all(records.requests.map(async r=>({...r,stale_sources:await freshness(job,r)}))),proposals:records.proposals})}
  const packet=(parts[3]==='latest'?records.requests.findLast(r=>r.reviewed_by.id===actor.id&&!r.revoked_by):records.requests.find(r=>r.id===parts[3]));need(packet,'Reviewed request not found',404,'not_found')
  need(packet.reviewed_by.id===actor.id&&!packet.revoked_by,'Request is unavailable',403,'forecast_revoked')
  await reviewed(env.DB,packet,actor)
  const stale=await freshness(job,packet);need(!stale.length,'Reviewed source changed; request a fresh owner review',409,'forecast_source_changed',{sources:stale})
  return json({packet,version:job.version})
 }
 need(request.method==='POST','Method not allowed',405,'method_not_allowed');active(job)
 const input=await body(request);need(input.expected_version===job.version,'Job changed; reload before preparing the forecast',409,'stale_version')
 let record:unknown;const writes:D1PreparedStatement[]=[]
 if(parts.length===3){
  need(records.requests.length<100,'Forecast request history reached its supported limit',409,'forecast_limit')
  requireOwner(actor);const as_of=localDate(input.as_of,'as_of'),due_on=localDate(input.due_on,'due_on');need(due_on>=as_of,'Uncertainty due date precedes the forecast')
  need(Array.isArray(input.sources)&&input.sources.length<=7,'Explicitly review up to seven native source groups')
  const available=await sources(job),selected:ReviewedSource[]=[],uncertainties:Uncertainty[]=[],seen=new Set<string>()
  for(const value of input.sources){const review=object(value),source=available.find(s=>s.key===review.key);need(source&&!seen.has(source.key)&&review.revision===source.revision,'Review the exact available source revision once',409,'forecast_source_changed');seen.add(source.key)
   const dated=localDate(review.as_of,'Source as_of'),valid_until=localDate(review.valid_until,'Source valid_until');need(dated<=as_of&&valid_until>=dated,'Source freshness dates are inconsistent');selected.push({...source,as_of:dated,valid_until})
   if(valid_until<as_of)uncertainties.push({source:source.key,state:'stale',owner_id:actor.id,due_on,reason:'Owner-declared source freshness expired; retained for explicit historical comparison'})
  }
  for(const key of ['estimate','budget','ledger','schedule','quantities','procurement','confirmations'])if(!seen.has(key))uncertainties.push({source:key,state:available.some(s=>s.key===key)?'withheld':'unavailable',owner_id:actor.id,due_on,reason:'No reviewed facts for this request'})
  for(const key of ['bids','field-time','accounting','cross-job-capacity'])uncertainties.push({source:key,state:'unavailable',owner_id:actor.id,due_on,reason:'Not integrated into this packet; no completeness or provider freshness claim'})
  // Only explicitly reviewed, currently dated groups may influence calculations.
  const usable=selected.filter(s=>s.valid_until>=as_of),assumptions={as_of,due_on,observed_at:input.observed_at,codes:input.codes,production:input.production,deliveries:input.deliveries,reference:text(input.reference,'Request assumptions',2000)}
  const forecast=await calculate(job,actor,usable,assumptions,uncertainties),packet={format:'plinth-agent-forecast-v1' as const,job_id:job.id,id:crypto.randomUUID(),reviewed_by:stamp(actor),as_of,sources:selected,assumptions,uncertainties,forecast}
  const row:RequestPacket={...packet,digest:await digest(packet)};records.requests.push(row);writes.push(env.DB.prepare('INSERT INTO pl_agent_forecast_reviews(request_id,job_id,owner_id,digest) VALUES(?,?,?,?)').bind(row.id,job.id,actor.id,row.digest));record=row
 }else{
  const row=(parts[3]==='latest'?records.requests.findLast(r=>r.reviewed_by.id===actor.id&&!r.revoked_by):records.requests.find(r=>r.id===parts[3]));need(row,'Reviewed request not found',404,'not_found');need(row.reviewed_by.id===actor.id,'Only the requesting owner may use this packet',403,'forbidden')
  if(parts.length===5&&parts[4]==='revoke'){requireOwner(actor);need(!row.revoked_by,'Request is already revoked',409,'forecast_revoked');row.revoked_by=stamp(actor);writes.push(env.DB.prepare('DELETE FROM pl_agent_forecast_reviews WHERE request_id=?').bind(row.id));record={id:row.id,revoked:true}}
  else if(parts.length===5&&parts[4]==='prepare'){
   need(!row.revoked_by,'Request revoked',409,'forecast_revoked')
   await reviewed(env.DB,row,actor)
   need(input.packet_digest===row.digest,'Review the exact request packet',409,'forecast_review')
   const stale=await freshness(job,row);need(!stale.length,'Reviewed source changed; request a fresh owner review',409,'forecast_source_changed',{sources:stale})
   if(row.proposal_id)return json({record:records.proposals.find(p=>p.id===row.proposal_id),version:job.version})
   const proposal={id:crypto.randomUUID(),request_id:row.id,packet_digest:row.digest,prepared_by:stamp(actor),packet:structuredClone(row)};records.proposals.push(proposal);row.proposal_id=proposal.id;record=proposal
  }else need(false,'Unknown forecast action',404,'not_found')
 }
 await saveJob(env.DB,actor,previous,job,writes,clock)
 return json({record,version:job.version})
}

/** Shared transport receipts may be cached. Recheck private forecast custody before returning any receipt. */
export async function forecastResultRefusal(env:Bindings,result:unknown,revision?:number|null):Promise<string|null>{
 const record=(result as {record?:RequestPacket|{packet:RequestPacket}}|undefined)?.record
 const packet=record&&('packet' in record?record.packet:record)
 if(packet?.format!=='plinth-agent-forecast-v1')return null
 if(revision!==undefined){const state=await env.DB.prepare('SELECT envelope,local_revision FROM agent_door_state WHERE id=1').first<{envelope:string|null;local_revision:number}>(),current=env.RER_OWNER_CLAIM_PUBLIC_KEYS?(state?.envelope?JSON.parse(state.envelope).revision:null):state?.local_revision||null;if(revision!==current)return 'forecast_policy_changed'}
 const saved=await env.DB.prepare('SELECT data FROM pl_jobs WHERE id=?').bind(packet.job_id).first<{data:string}>()
 if(!saved)return 'not_found'
 const job=JSON.parse(saved.data) as Job,current=job.agent_forecasts?.requests.find(r=>r.id===packet.id)
 if(!current||current.digest!==packet.digest)return 'forecast_review'
 if(current.revoked_by)return 'forecast_revoked'
 const owner=await env.DB.prepare("SELECT id FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(current.reviewed_by.id).first()
 if(!owner)return 'forbidden'
 const grant=await env.DB.prepare('SELECT request_id FROM pl_agent_forecast_reviews WHERE request_id=? AND owner_id=? AND digest=?').bind(current.id,current.reviewed_by.id,current.digest).first()
 if(!grant)return 'forecast_review_required'
 return (await freshness(job,current)).length?'forecast_source_changed':null
}
export async function forecastResponseGuard(env:Bindings,response:Response):Promise<Response>{
 if(!response.headers.get('content-type')?.includes('application/json'))return response
 const value=await response.clone().json() as {id?:unknown;result?:{structuredContent?:unknown;_meta?:Record<string,unknown>&{'com.runeditrun/decision'?:{revision?:number|null}}}}
 const code=await forecastResultRefusal(env,value.result?.structuredContent,value.result?._meta?.['com.runeditrun/decision']?.revision)
 if(!code)return response
 return Response.json({jsonrpc:'2.0',id:value.id,result:{resultType:'complete',content:[{type:'text',text:JSON.stringify({code})}],isError:true,_meta:{...value.result?._meta,'com.runeditrun/error':{code}}}},{status:200,headers:response.headers})
}
