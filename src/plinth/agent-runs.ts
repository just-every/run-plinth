import { requireOwner } from './auth'
import { auditStatement } from './audit'
import { prepareDiary } from './attachments'
import { DomainError, need, object, text, type Actor, type Input, type Job } from './model'
import { jobOf, readClock, saveJob, transaction } from './store'
import { runScheduleResponse } from './agent-run-schedules'

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
const size=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length
const hash=async(value:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('')
type Step={tool:'plinth.jobs.get'}|{tool:'plinth.diary.prepare';input:{date:string;note:string}}
type Selection={job_id:string;expected_job_version:number;diary_ids:string[];steps:Step[];limits:{max_tool_calls:number;max_payload_bytes:number}}
type Packet={job:{id:string;name:string;status:string;currency:string};diary:{id:string;date:string;note:string;status:string}[];references:{job_id:string;version:number;diary_ids:string[]};untrusted:true}
type Plan=Selection&{packet:Packet;digest:string}
type Run={id:string;job_id:string;owner_id:string;version:number;state:'ready'|'paused'|'complete'|'failed'|'cancelled'|'revoked';expected_job_version:number;next_sequence:number;payload_bytes:number;native_ms:number;error:string|null;data:string}
const consumer=(actor:Actor)=>need(actor.role==='owner'||actor.role==='agent'&&actor.agent_door?.sponsor_role==='owner','Only the owner or their reviewed MCP run may use this door',403,'forbidden')
const terminal=(run:Run)=>['complete','failed','cancelled','revoked'].includes(run.state)
async function of(db:D1Database,actor:Actor,id:string){
 consumer(actor)
 const run=await db.prepare('SELECT * FROM pl_agent_runs WHERE id=? AND owner_id=?').bind(id,actor.id).first<Run>()
 need(run,'Run unavailable',404,'not_found')
 return run
}
async function consent(db:D1Database,run:Run,actor:Actor){
 return !!await db.prepare("SELECT c.run_id FROM pl_agent_run_consents c JOIN oa_operators o ON o.id=c.owner_id AND o.version=c.owner_version AND o.status='active' AND o.role='owner' WHERE c.run_id=? AND c.owner_id=? AND c.digest=?").bind(run.id,actor.id,(JSON.parse(run.data) as Plan).digest).first()
}
async function live(db:D1Database,actor:Actor,run:Run){
 need(!['paused','cancelled','revoked'].includes(run.state),'Run is paused, cancelled or revoked',409,'run_stopped')
 need(await consent(db,run,actor),'Fresh destination-owner preview and approval are required',403,'review_required')
 const job=await jobOf(db,actor,run.job_id)
 need(job.version===run.expected_job_version,'Source changed; request a new run',409,'stale_source')
 return job
}
async function summary(db:D1Database,run:Run,actor:Actor){
 const plan=JSON.parse(run.data) as Plan,checkpoints=(await db.prepare('SELECT data FROM pl_agent_run_steps WHERE run_id=? ORDER BY sequence').bind(run.id).all<{data:string}>()).results.map(r=>JSON.parse(r.data))
 return {id:run.id,job_id:run.job_id,version:run.version,state:run.state==='ready'&&!await consent(db,run,actor)?'review_required':run.state,digest:plan.digest,next_sequence:run.next_sequence,error:run.error,limits:plan.limits,measurements:{tool_calls:run.next_sequence,payload_bytes:run.payload_bytes,native_ms:run.native_ms,model_usage:null,provider_cost:null},checkpoints}
}
async function preview(db:D1Database,actor:Actor,input:Input):Promise<Plan>{
 requireOwner(actor)
 const job=await jobOf(db,actor,text(input.job_id,'Job id',100))
 need(input.expected_job_version===job.version,'Source changed; review again',409,'stale_source')
 need(Array.isArray(input.diary_ids)&&input.diary_ids.length<=20&&input.diary_ids.every(id=>typeof id==='string')&&new Set(input.diary_ids).size===input.diary_ids.length,'Select at most twenty exact daily log sources')
 const diary_ids=input.diary_ids as string[],diary=diary_ids.map(id=>{const row=job.diary.find(d=>d.id===id);need(row,'Selected source unavailable',404,'not_found');return {id:row.id,date:row.date,note:row.note,status:row.status}})
 need(Array.isArray(input.steps)&&input.steps.length>0&&input.steps.length<=8,'Select one to eight read or draft steps')
 let drafts=0
 const steps:Step[]=input.steps.map(raw=>{
  const step=object(raw)
  if(step.tool==='plinth.jobs.get'){need(Object.keys(step).every(k=>k==='tool'),'Read steps accept no source instructions');return {tool:'plinth.jobs.get'}}
  need(step.tool==='plinth.diary.prepare','Only reviewed job reads and private daily log drafts are allowed',403,'tool_not_allowed')
  need(Object.keys(step).every(k=>['tool','input'].includes(k)),'Unknown draft option')
  need(++drafts<=1,'A run may prepare one daily log draft')
  const value=object(step.input),date=text(value.date,'Draft date',10)
  need(Object.keys(value).every(k=>['date','note'].includes(k)),'Only a dated private note may be drafted')
  need(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,'Use a calendar date')
  return {tool:'plinth.diary.prepare',input:{date,note:text(value.note,'Draft note',8000)}}
 })
 const limits=object(input.limits),calls=Number(limits.max_tool_calls),payload=Number(limits.max_payload_bytes)
 need(Number.isInteger(calls)&&calls>=1&&calls<=8&&Number.isInteger(payload)&&payload>=128&&payload<=65536,'Choose bounded tool calls and payload bytes')
 const packet:Packet={job:{id:job.id,name:job.name,status:job.status,currency:job.currency??'USD'},diary,references:{job_id:job.id,version:job.version,diary_ids},untrusted:true}
 const selected={job_id:job.id,expected_job_version:job.version,diary_ids,steps,limits:{max_tool_calls:calls,max_payload_bytes:payload},packet}
 need(size(selected)<=65536,'Select a smaller source packet',413,'payload_limit')
 return {...selected,digest:await hash(selected)}
}
async function fail(db:D1Database,actor:Actor,run:Run,code:string,clock:number){
 await transaction(db,actor,null,[db.prepare("UPDATE pl_agent_runs SET state='failed',error=?,version=version+1 WHERE id=? AND version=?").bind(code,run.id,run.version)],clock)
 return json({record:{run:await summary(db,(await of(db,actor,run.id)),actor)}})
}
async function continuation(db:D1Database,actor:Actor,run:Run,input:Input,clock:number){
 need(actor.role==='agent'&&actor.agent_door?.sponsor_role==='owner','An approved run continues only through its MCP tool',403,'human_required')
 const started=performance.now(),job=await live(db,actor,run),plan=JSON.parse(run.data) as Plan
 need(Number.isInteger(input.sequence)&&Number(input.sequence)>=0,'Supply the exact checkpoint sequence')
 const sequence=Number(input.sequence)
 if(sequence<run.next_sequence){
  const saved=await db.prepare('SELECT data FROM pl_agent_run_steps WHERE run_id=? AND sequence=?').bind(run.id,sequence).first<{data:string}>()
  need(saved,'Checkpoint unavailable',409,'checkpoint')
  return json({record:{run:await summary(db,run,actor),checkpoint:JSON.parse(saved.data)}})
 }
 need(run.state==='ready'&&sequence===run.next_sequence,'Run cannot continue at this checkpoint',409,'checkpoint')
 if(sequence>=plan.limits.max_tool_calls)return fail(db,actor,run,'tool_call_limit',clock)
 const step=plan.steps[sequence];need(step,'No further step is approved',409,'complete')
 let next:Job|undefined,record:unknown,writes:D1PreparedStatement[]=[]
 if(step.tool==='plinth.jobs.get')record=plan.packet
 else{
  // Prepare the already shipped native draft; draft and checkpoint commit in one D1 transaction.
  next=structuredClone(job)
  try{const prepared=await prepareDiary(db,next,actor,step.input);record=prepared.row;writes=prepared.writes}catch(error){if(error instanceof DomainError)return fail(db,actor,run,error.code,clock);throw error}
 }
 const payload_bytes=size({input:step,output:record})
 if(run.payload_bytes+payload_bytes>plan.limits.max_payload_bytes)return fail(db,actor,run,'payload_limit',clock)
 const native_ms=Math.max(0,performance.now()-started),checkpoint={sequence,tool:step.tool,data_references:plan.packet.references,input_digest:await hash(step),record,native_ms,payload_bytes,draft_id:step.tool==='plinth.diary.prepare'?(record as {id:string}).id:null}
 const done=sequence+1===plan.steps.length
 const commits=[
  db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_agent_runs WHERE id=? AND version=? AND state=?) THEN 1 ELSE 0 END').bind(run.id,run.version,'ready'),
  db.prepare('INSERT INTO pl_agent_run_steps(run_id,sequence,data) VALUES(?,?,?)').bind(run.id,sequence,JSON.stringify(checkpoint)),
  db.prepare('UPDATE pl_agent_runs SET version=version+1,state=?,next_sequence=next_sequence+1,payload_bytes=payload_bytes+?,native_ms=native_ms+?,expected_job_version=? WHERE id=?').bind(done?'complete':'ready',payload_bytes,native_ms,job.version+(next?1:0),run.id),
  auditStatement(db,actor,{action:'agent-run.continue',subject_kind:'agent_run',subject_id:run.id,detail:{sequence,tool:step.tool,draft_id:checkpoint.draft_id}}),
 ]
 // The installation-local consent and run version are fenced alongside authGuard and the global clock.
 commits.unshift(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_agent_run_consents WHERE run_id=? AND owner_id=? AND owner_version=? AND digest=?) THEN 1 ELSE 0 END').bind(run.id,actor.id,actor.version,plan.digest))
 if(next)await saveJob(db,actor,job,next,[...writes,...commits],clock)
 else await transaction(db,actor,job,commits,clock)
 return json({record:{run:await summary(db,await of(db,actor,run.id),actor),checkpoint}})
}
export async function agentRunsResponse(request:Request,db:D1Database,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>):Promise<Response|null>{
 if(parts[0]!=='agent-runs')return null
 const schedule=await runScheduleResponse(request,db,actor,parts,body);if(schedule)return schedule
 consumer(actor)
 const clock=await readClock(db),method=request.method
 if(parts.length===2&&parts[1]==='preview'&&method==='POST')return json({preview:await preview(db,actor,await body(request))})
 if(parts.length===1&&method==='GET'){
  const rows=(await db.prepare('SELECT * FROM pl_agent_runs WHERE owner_id=? ORDER BY rowid DESC LIMIT 100').bind(actor.id).all<Run>()).results
  const runs=[]
  for(const run of rows){if(actor.role==='owner')runs.push(await summary(db,run,actor));else try{await live(db,actor,run);runs.push({id:run.id,digest:(JSON.parse(run.data) as Plan).digest})}catch{}}
  return json({runs})
 }
 if(parts.length===1&&method==='POST'){
  requireOwner(actor);const input=await body(request),plan=await preview(db,actor,input)
  need(input.confirm===true&&input.digest===plan.digest,'Preview and explicitly approve these exact sources, steps and limits',409,'run_review')
  need((await db.prepare('SELECT count(*) AS n FROM pl_agent_runs WHERE owner_id=?').bind(actor.id).first<{n:number}>())!.n<100,'Run history limit reached',409,'run_limit')
  const id=crypto.randomUUID(),data=JSON.stringify({...plan,approved_by:{id:actor.id,at:new Date(Date.now()).toISOString()},reason:text(input.reason,'Approval reason',1000)})
  await transaction(db,actor,null,[db.prepare("INSERT INTO pl_agent_runs(id,job_id,owner_id,version,state,expected_job_version,data) VALUES(?,?,?,1,'ready',?,?)").bind(id,plan.job_id,actor.id,plan.expected_job_version,data),db.prepare('INSERT INTO pl_agent_run_consents(run_id,owner_id,owner_version,digest) VALUES(?,?,?,?)').bind(id,actor.id,actor.version,plan.digest),auditStatement(db,actor,{action:'agent-run.approve',subject_kind:'agent_run',subject_id:id,detail:{digest:plan.digest}})],clock)
  return json({run:await summary(db,await of(db,actor,id),actor)},201)
 }
 const run=await of(db,actor,parts[1]??'')
 if(parts.length===2&&method==='GET'){
  if(actor.role!=='owner')await live(db,actor,run)
  return json({record:{run:await summary(db,run,actor),plan:JSON.parse(run.data)}})
 }
 need(parts.length===3,'Unknown run route',404,'not_found')
 if(parts[2]==='continue'&&method==='POST')return continuation(db,actor,run,await body(request),clock)
 requireOwner(actor)
 if(parts[2]==='preview'&&method==='GET'){
  const job=await jobOf(db,actor,run.job_id);need(job.version===run.expected_job_version,'Source changed; request a new run',409,'stale_source')
  return json({preview:{run:await summary(db,run,actor),plan:JSON.parse(run.data),digest:await hash([run.id,run.version,run.expected_job_version,actor.id,actor.version])}})
 }
 need(method==='POST','Unknown run method',405,'method_not_allowed')
 const input=await body(request);need(input.expected_version===run.version,'Run changed; preview again',409,'stale_version')
 if(parts[2]==='review'){
  need(!terminal(run),'A finished, failed or revoked run cannot be restarted',409,'run_stopped')
  const job=await jobOf(db,actor,run.job_id);need(job.version===run.expected_job_version,'Source changed; request a new run',409,'stale_source')
  need(input.confirm===true&&input.digest===await hash([run.id,run.version,run.expected_job_version,actor.id,actor.version]),'Preview and approve recovered or paused work',409,'run_review')
  await transaction(db,actor,job,[db.prepare('INSERT INTO pl_agent_run_consents(run_id,owner_id,owner_version,digest) VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET owner_id=excluded.owner_id,owner_version=excluded.owner_version,digest=excluded.digest').bind(run.id,actor.id,actor.version,(JSON.parse(run.data) as Plan).digest),db.prepare("UPDATE pl_agent_runs SET state='ready',version=version+1 WHERE id=?").bind(run.id),auditStatement(db,actor,{action:'agent-run.review',subject_kind:'agent_run',subject_id:run.id})],clock)
 }else{
  need(['pause','revoke','cancel'].includes(parts[2]!),'Unknown run action',404,'not_found')
  need(!['cancelled','revoked'].includes(run.state),'Run is already stopped',409,'run_stopped')
  const state=parts[2]==='pause'?'paused':parts[2]==='revoke'?'revoked':'cancelled'
  need(state!=='paused'||!terminal(run),'Finished work cannot be paused',409,'run_stopped')
  await transaction(db,actor,null,[db.prepare('UPDATE pl_agent_runs SET state=?,version=version+1 WHERE id=?').bind(state,run.id),db.prepare('DELETE FROM pl_agent_run_consents WHERE run_id=?').bind(run.id),auditStatement(db,actor,{action:'agent-run.'+parts[2],subject_kind:'agent_run',subject_id:run.id})],clock)
 }
 return json({run:await summary(db,await of(db,actor,run.id),actor)})
}
