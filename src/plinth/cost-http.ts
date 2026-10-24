import { accountingRead, accountingWrite, nativePeriodClose } from './accounting-authority'
import { costAccess, costLedgerVisible, drawPacket, costCapabilities } from './cost-access'
import { cashReport, periodAction } from './cost-periods'
import { auditStatement } from './audit'
import { costRecords, costFields, costQuery, costView, runCostView } from './cost-fields'
import { reportCsv } from './report-query'
import { sourceAction, payrollAction } from './cost-labor'
import { transferCost } from './cost-transfer'
import { forecastAction } from './cost-forecast'
import { exceptionAction, exceptionView, refreshExceptions } from './cost-exceptions'
import { runtimeBindings, type Bindings } from '../auth.server'
import { authorize } from './auth'
import { active, DomainError, find, need, object, usdOnly, type Actor, type Input, type Job } from './model'
import { jobOf, jobs, readClock, saveJob } from './store'
import { costs } from './cost-model'
import { costLedger } from './cost-ledger'
import { billAction } from './cost-bills'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
/** New cost custody is only returned by its dedicated office door, never a generic job or agent response. */
export function withoutCosts(job:Job,actor:Actor):Job{const {cost_records:_,accounting_authority:__,field_time:___,...safe}=job;return {...safe,approvals:job.approvals.filter(a=>!a.kind.startsWith('cost.')||!actor.permissions&&(actor.role==='owner'||actor.role==='admin'))}}
async function body(request:Request):Promise<Input>{need(request.headers.get('content-type')?.split(';')[0]?.trim()==='application/json','Send application/json',415,'content_type');const reader=request.body?.getReader();need(reader,'JSON body required');const chunks:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_500_000){await reader.cancel();throw new DomainError('body_size','Cost request too large',413)}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}try{return object(JSON.parse(new TextDecoder().decode(bytes)))}catch(e){if(e instanceof DomainError)throw e;throw new DomainError('invalid_json','Invalid JSON')}}
export async function costResponse(request:Request,original:Bindings):Promise<Response|null>{
 const m=/^\/api\/plinth\/jobs\/([^/]+)\/costs(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(new URL(request.url).pathname);if(!m)return null
 const env=runtimeBindings(original),actor=await authorize(request,env);if(request.method==='GET'&&m[2]==='access'&&!m[3]){const accessJob=await jobOf(env.DB,actor,m[1]!);return json(costCapabilities(actor,accessJob))}if(m[2]!=='accountant')costAccess(actor, request)
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,m[1]!);usdOnly(previous)
 if(request.method==='GET'){
  const accounting=await accountingRead(previous,actor,m[2],Object.fromEntries(new URL(request.url).searchParams));if(accounting)return json(accounting)
  if(m[2]==='draw-packet'&&!m[3]){await env.DB.batch([auditStatement(env.DB,actor,{kind:'export',action:'cost.draw_packet',job_id:previous.id,subject_kind:'job',subject_id:previous.id})]);return json(drawPacket(previous))}
  if(!m[2]||m[2]==='ledger'&&!m[3]){const report=costLedger(previous),code=new URL(request.url).searchParams.get('code');return json(code?{...report,rows:report.rows.filter(r=>r.cost_code===code)}:report)}
  if(m[2]==='bills'&&m[3]&&m[4]==='original'){const d=find(costs(previous).bills,m[3]).document;await env.DB.batch([auditStatement(env.DB,actor,{kind:'export',action:'cost.bill.original',job_id:previous.id,subject_kind:'cost_bill',subject_id:m[3],detail:{checksum:d.checksum}})]);return new Response(Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0)),{headers:{...headers,'content-type':d.mime,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(d.name),'content-security-policy':"default-src 'none'; sandbox",'x-content-sha256':d.checksum}})}
  if(m[2]==='cash'&&!m[3])return json(cashReport(previous,Object.fromEntries(new URL(request.url).searchParams)))
  if(m[2]==='periods'&&!m[3])return json({periods:costs(previous).periods??[]})
  if(m[2]==='records'&&!m[3])return json(await costRecords(env.DB,previous))
  if(m[2]==='views'&&!m[3])return json({views:(costs(previous).views??[]).filter(v=>v.sharing==='shared'||v.created_by===actor.id)})
  if(m[2]==='views'&&m[3]){const result=await runCostView(env.DB,previous,actor,m[3]);return m[4]==='export.csv'?new Response(reportCsv(result.report),{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename=job-cost-view.csv'}}):json(result)}
  if(m[2]==='sources'&&!m[3])return json({version:previous.version,sources:costs(previous).sources.map(({document,...s})=>({...s,document:document?{...document,base64:undefined}:undefined}))})
  if(m[2]==='sources'&&m[3]&&m[4]==='original'){const d=find(costs(previous).sources,m[3]).document;need(d,'Source has no original',404,'not_found');await env.DB.batch([auditStatement(env.DB,actor,{kind:'export',action:'cost.source.original',job_id:previous.id,subject_kind:'cost_source',subject_id:m[3],detail:{checksum:d.checksum}})]);return new Response(Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0)),{headers:{...headers,'content-type':d.mime,'content-disposition':'attachment; filename=employee-receipt','content-security-policy':"default-src 'none'; sandbox"}})}
  if(m[2]==='payroll'&&m[3]&&m[4]==='original'){const d=find(costs(previous).payroll_imports??[],m[3]).document;await env.DB.batch([auditStatement(env.DB,actor,{kind:'export',action:'cost.payroll.original',job_id:previous.id,subject_kind:'cost_payroll',subject_id:m[3],detail:{checksum:d.checksum}})]);return new Response(Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0)),{headers:{...headers,'content-type':'text/csv','content-disposition':'attachment; filename=payroll.csv'}})}
  if(m[2]==='forecasts'&&!m[3])return json({version:previous.version,forecasts:costs(previous).forecasts.map(f=>({...f,stale:f.source_version!==previous.version}))})
  if(m[2]==='exceptions'&&!m[3])return json(exceptionView(previous))
  if(m[2]==='bills'&&!m[3])return json({version:previous.version,bills:costs(previous).bills.map(({document,...b})=>({...b,document:{...document,base64:undefined}}))})
  throw new DomainError('not_found','Unknown cost route',404)
 }
 need(request.method==='POST','Method not allowed',405,'method_not_allowed');active(previous);const input=await body(request);if(actor.role==='bookkeeper'&&m[2]==='bills'&&!m[3]&&input.reviewer_id===undefined)input.reviewer_id=costs(previous).policy?.owner_id??previous.created_by.id;need(input.expected_version===previous.version,'Job changed; reload before writing costs',409,'stale_version')
 if(m[2]==='query'&&!m[3])return json(await costQuery(env.DB,previous,actor,input))
 if(m[2]==='transfers'&&!m[3])return json(await transferCost(env.DB,actor,previous,input,clock))
 const job=structuredClone(previous);let record:unknown
 const accounting=await accountingWrite(env.DB,job,actor,input,m[2]);
 if(accounting)record=accounting;else if(['cash-dates','periods'].includes(m[2]!)&&!m[3]){if(m[2]==='periods')await nativePeriodClose(env.DB,job,actor,input);record=periodAction(job,actor,input,m[2]!);if(m[2]==='periods'&&input.native_review_id){(record as Record<string,unknown>).native_review=structuredClone(job.accounting_authority!.reviews.find(r=>r.id===input.native_review_id));(record as Record<string,unknown>).snapshot=structuredClone(job.accounting_authority!.reviews.find(r=>r.id===input.native_review_id)!.snapshot);(record as Record<string,unknown>).label='Period close recorded by owner after review by the named signed-in accountant account; no professional certification is claimed'}if(m[2]==='periods')await costFields(env.DB,job,(record as {id:string}).id,input,'closed');}else if(m[2]==='refresh'&&!m[3]){refreshExceptions(job);record=exceptionView(job)}else if(m[2]==='bills'){if(input.reviewer_id!==undefined){const reviewer=await env.DB.prepare("SELECT id FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin') AND NOT EXISTS(SELECT 1 FROM pl_team WHERE operator_id=oa_operators.id)").bind(input.reviewer_id).first();need(reviewer,'Bill reviewer must be an active owner or administrator')}if(!m[3])need(!(await jobs(env.DB)).some(j=>costs(j).bills.some(b=>b.vendor.toLowerCase()===String(input.vendor).trim().toLowerCase()&&b.reference.toLowerCase()===String(input.reference).trim().toLowerCase())),'Vendor invoice reference already exists in this installation',409,'cost_duplicate');record=await billAction(job,actor,input,m[3],m[4]);await costFields(env.DB,job,(record as {id:string}).id,input,(record as {status:string}).status);}else if(m[2]==='sources'){record=await sourceAction(job,actor,input,m[3],m[4]);await costFields(env.DB,job,(record as {id:string}).id,input,(record as {approved_by?:unknown}).approved_by?'approved':'draft');}else if(m[2]==='payroll'&&!m[3]){const imported=await payrollAction(job,actor,input);for(const r of imported.records)await costFields(env.DB,job,r.id,input,'approved');record=imported;}else if(m[2]==='forecasts'&&!m[3]){record=await forecastAction(job,actor,input);await costFields(env.DB,job,(record as {id:string}).id,input,'recorded');}else if(m[2]==='values'&&m[3]){need((await costRecords(env.DB,job)).records.some(r=>r.local_id===m[3]),'Cost record not found',404,'not_found');record=await costFields(env.DB,job,m[3],input)}else if(m[2]==='views'&&!m[3])record=await costView(env.DB,job,actor,input);else if(['policy','reconcile','exceptions'].includes(m[2]!)){if(m[2]==='policy'){need(actor.role==='owner','Only the owner defines cost approval policy',403,'forbidden');const person=await env.DB.prepare("SELECT id FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin') AND NOT EXISTS(SELECT 1 FROM pl_team WHERE operator_id=oa_operators.id)").bind(input.owner_id).first();need(person,'Exception owner must be an active owner or administrator')}record=exceptionAction(job,actor,input,m[2]!,m[3])}else throw new DomainError('not_found','Unknown cost action',404)
 refreshExceptions(job)
 await saveJob(env.DB,actor,previous,job,[],clock)
 return json({version:job.version,record:record&&typeof record==='object'?'document' in record?{...record,document:{...(record as {document:object}).document,base64:undefined}}:record:record,...(costLedgerVisible(actor)?{ledger:costLedger(job)}:{})})
}
/** Apply after every JSON handler, including independent legacy handlers returning a raw job. */
export async function protectCosts(response:Response,actor?:Actor){
 if(!response.headers.get('content-type')?.includes('application/json'))return response
 const office=actor&&!actor.permissions&&(actor.role==='owner'||actor.role==='admin')
 const scrub=(value:unknown,key=''):unknown=>Array.isArray(value)?value.filter(v=>key!=='approvals'||office||!v?.kind?.startsWith('cost.')).map(v=>scrub(v)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='field_time'&&k!=='cost_records'&&k!=='accounting_authority'&&(office||k!=='cost_billing')&&(office||k!=='source_digest'||!('kind' in value)||value.kind!=='cost_plus')&&(office||k!=='cost_ledger')).map(([k,v])=>[k,scrub(v,k)])):value
 return new Response(JSON.stringify(scrub(await response.json())),{status:response.status,headers:response.headers})
}
