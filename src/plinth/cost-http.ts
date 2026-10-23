import { runtimeBindings, type Bindings } from '../auth.server'
import { authorize, requireManager } from './auth'
import { active, DomainError, find, need, object, usdOnly, type Actor, type Input, type Job } from './model'
import { jobOf, jobs, readClock, saveJob } from './store'
import { costs } from './cost-model'
import { costLedger } from './cost-ledger'
import { billAction } from './cost-bills'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
/** New cost custody is only returned by its dedicated office door, never a generic job or agent response. */
export function withoutCosts(job:Job,actor:Actor):Job{const {cost_records:_,...safe}=job;return {...safe,approvals:job.approvals.filter(a=>!a.kind.startsWith('cost.')||!actor.permissions&&(actor.role==='owner'||actor.role==='admin'))}}
async function body(request:Request):Promise<Input>{need(request.headers.get('content-type')?.split(';')[0]?.trim()==='application/json','Send application/json',415,'content_type');const reader=request.body?.getReader();need(reader,'JSON body required');const chunks:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_500_000){await reader.cancel();throw new DomainError('body_size','Cost request too large',413)}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}try{return object(JSON.parse(new TextDecoder().decode(bytes)))}catch(e){if(e instanceof DomainError)throw e;throw new DomainError('invalid_json','Invalid JSON')}}
export async function costResponse(request:Request,original:Bindings):Promise<Response|null>{
 const m=/^\/api\/plinth\/jobs\/([^/]+)\/costs(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(new URL(request.url).pathname);if(!m)return null
 const env=runtimeBindings(original),actor=await authorize(request,env);requireManager(actor);need(!actor.permissions,'Custom-role cost access remains closed until ROLE-006 registers this door',403,'forbidden')
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,m[1]!);usdOnly(previous)
 if(request.method==='GET'){
  if(!m[2]||m[2]==='ledger'&&!m[3]){const report=costLedger(previous),code=new URL(request.url).searchParams.get('code');return json(code?{...report,rows:report.rows.filter(r=>r.cost_code===code)}:report)}
  if(m[2]==='bills'&&m[3]&&m[4]==='original'){const d=find(costs(previous).bills,m[3]).document;return new Response(Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0)),{headers:{...headers,'content-type':d.mime,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(d.name),'content-security-policy':"default-src 'none'; sandbox",'x-content-sha256':d.checksum}})}
  if(m[2]==='bills'&&!m[3])return json({version:previous.version,bills:costs(previous).bills.map(({document,...b})=>({...b,document:{...document,base64:undefined}}))})
  throw new DomainError('not_found','Unknown cost route',404)
 }
 need(request.method==='POST','Method not allowed',405,'method_not_allowed');active(previous);const input=await body(request);need(input.expected_version===previous.version,'Job changed; reload before writing costs',409,'stale_version')
 const job=structuredClone(previous);let record:unknown
 if(m[2]==='bills'){if(!m[3])need(!(await jobs(env.DB)).some(j=>costs(j).bills.some(b=>b.vendor.toLowerCase()===String(input.vendor).trim().toLowerCase()&&b.reference.toLowerCase()===String(input.reference).trim().toLowerCase())),'Vendor invoice reference already exists in this installation',409,'cost_duplicate');record=await billAction(job,actor,input,m[3],m[4]);}else throw new DomainError('not_found','Unknown cost action',404)
 await saveJob(env.DB,actor,previous,job,[],clock)
 return json({version:job.version,record:record&&typeof record==='object'?'document' in record?{...record,document:{...(record as {document:object}).document,base64:undefined}}:record:record,ledger:costLedger(job)})
}
/** Apply after every JSON handler, including independent legacy handlers returning a raw job. */
export async function protectCosts(response:Response,actor?:Actor){
 if(!response.headers.get('content-type')?.includes('application/json'))return response
 const office=actor&&!actor.permissions&&(actor.role==='owner'||actor.role==='admin')
 const scrub=(value:unknown,key=''):unknown=>Array.isArray(value)?value.filter(v=>key!=='approvals'||office||!v?.kind?.startsWith('cost.')).map(v=>scrub(v)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='cost_records').map(([k,v])=>[k,scrub(v,k)])):value
 return new Response(JSON.stringify(scrub(await response.json())),{status:response.status,headers:response.headers})
}
