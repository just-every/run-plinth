import { requireOwner } from './auth'
import { auditStatement } from './audit'
import { learningEvidence } from './learning-evidence'
import { catalogValue } from './catalog-input'
import { catalogEntry } from './estimate-catalog'
import { catalogPreview } from './catalog-quote'
import type { Assembly, CatalogEntry, CatalogSource, EstimateTemplate } from './catalog-model'
import { performanceJob } from './estimate-performance'
import { decimal } from './estimate-math'
import { need, object, stamp, sum, text, type Actor, type Input } from './model'
import { jobOf, readClock, transaction } from './store'

const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
const hash=async(value:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('')
type Source={id:string;version:number;quote_id:string;catalog:CatalogSource;retained:CatalogEntry[];performance:ReturnType<typeof performanceJob>;evidence:ReturnType<typeof learningEvidence>}
type Packet={id:string;owner_id:string;reviewed_by:ReturnType<typeof stamp>;reason:string;digest:string;currency:string;target:CatalogEntry;sources:Source[];catalog_versions:{id:string;version:number}[]}
type Draft={citations:{job_id:string;source_version:number;quote_id:string;catalog:CatalogSource;order_ids:string[];receipt_ids:string[];callback_case_ids:string[];callback_cost_ids:string[]}[];id:string;packet_id:string;prepared_by:ReturnType<typeof stamp>;reason:string;changes:Input;value:Assembly|EstimateTemplate;observations:{job_id:string;rows:Source['performance']['rows']}[];replay:{job_id:string;quote_id:string;dimensions:Record<string,string>;signed_revenue_cents:number;historical_cost_cents:number|null;candidate_cost_cents:number;candidate_margin_cents:number;margin_delta_cents:number|null}[];limits:string[];lesson_input:{catalog_id:string;catalog_version:number;source_job_ids:string[];reason:string;value:Assembly|EstimateTemplate}}
async function catalog(db:D1Database){return (await db.prepare('SELECT data FROM pl_estimate_catalog ORDER BY id').all<{data:string}>()).results.map(r=>JSON.parse(r.data) as CatalogEntry)}
const current=(entry:CatalogEntry)=>entry.revisions.at(-1)!.value
function historical(entries:CatalogEntry[],source:CatalogSource){
 const refs=[{id:source.template_id,version:source.template_version},...source.assemblies,...source.rates]
 return [...new Map(refs.map(ref=>{const entry=entries.find(e=>e.id===ref.id),revision=entry?.revisions.find(r=>r.version===ref.version);need(entry&&revision,'Historical catalog source unavailable',409,'replay_source');return [entry.id,{...entry,version:ref.version,revisions:[revision]} as CatalogEntry] as const})).values()]
}
async function preview(db:D1Database,actor:Actor,input:Input){
 requireOwner(actor)
 need(Array.isArray(input.sources)&&input.sources.length>=2&&input.sources.length<=20,'Explicitly select two to twenty completed jobs')
 const entries=await catalog(db),target=await catalogEntry(db,text(input.catalog_id,'Catalog id',80))
 need(target.kind==='assembly'||target.kind==='template','Select an assembly or template')
 need(input.catalog_version===target.version,'Catalog changed; review again',409,'stale_catalog')
 const seen=new Set<string>(),sources:Source[]=[]
 for(const raw of input.sources){const ref=object(raw),job=await jobOf(db,actor,text(ref.id,'Source job id',80));need(!seen.has(job.id),'Select distinct completed jobs');seen.add(job.id)
  need(job.version===ref.version,'Source changed; review again',409,'stale_source')
  need(job.estimate_performance?.completion,'Select completed jobs',409,'completion_state')
  const quote=job.quotes.find(q=>q.status==='accepted'),source=quote?.cost_catalog
  need(quote&&source,'A signed coded estimate with retained dimensions is required',409,'replay_source')
  need(target.kind==='template'?source.template_id===target.id:source.assemblies.some(a=>a.id===target.id),'Select jobs using this catalog source',409,'incompatible_source')
  const retained=historical(entries,source),p=performanceJob(job,entries)
  if(target.kind==='assembly')need((retained.find(e=>e.id===target.id)?.revisions[0]?.value as Assembly)?.unit===(current(target) as Assembly).unit,'Production units must be compatible',409,'incompatible_units')
  sources.push({id:job.id,version:job.version,quote_id:quote.id,catalog:source,retained,performance:p,evidence:learningEvidence(job)})
 }
 need(sources.every(s=>s.performance.currency===sources[0]!.performance.currency),'Compare completed jobs in the same currency',409,'currency_mismatch')
 // Every current dependency is fenced; unrelated company catalogs are neither read into the packet nor exposed.
 const ids=new Set(sources.flatMap(s=>s.retained.map(e=>e.id)));ids.add(target.id)
 const catalog_versions=entries.filter(e=>ids.has(e.id)).map(e=>({id:e.id,version:e.version}))
 const value={target,sources,catalog_versions,currency:sources[0]!.performance.currency}
 return {...value,digest:await hash(value)}
}
async function packetOf(db:D1Database,id:string){const row=await db.prepare('SELECT data FROM pl_learning_packets WHERE id=?').bind(id).first<{data:string}>();need(row,'Learning packet unavailable',404,'not_found');return JSON.parse(row.data) as Packet}
function consumer(actor:Actor){need(actor.role==='owner'||actor.role==='agent'&&actor.agent_door?.sponsor_role==='owner','Owner-reviewed learning only',403,'forbidden')}
async function live(db:D1Database,actor:Actor,packet:Packet){
 consumer(actor);need(packet.owner_id===actor.id,'Learning packet unavailable',404,'not_found')
 const consent=await db.prepare("SELECT c.packet_id FROM pl_learning_consents c JOIN oa_operators o ON o.id=c.owner_id AND o.version=c.owner_version AND o.status='active' AND o.role='owner' WHERE c.packet_id=? AND c.owner_id=?").bind(packet.id,actor.id).first()
 need(consent,'Owner consent is absent or revoked; review a new packet',403,'consent_required')
 for(const source of packet.sources){const job=await jobOf(db,actor,source.id);need(job.version===source.version&&job.estimate_performance?.completion,'Completed source changed; review a new packet',409,'stale_source')}
 for(const ref of packet.catalog_versions){const entry=await catalogEntry(db,ref.id);need(entry.version===ref.version,'Catalog changed; review a new packet',409,'stale_catalog')}
}
function scaled(value:string,percent:number){const d=decimal(value,'Catalog factor',false),n=d.numerator*BigInt(100+percent),places=String(d.denominator).length+1,raw=n.toString().padStart(places+1,'0');return raw.slice(0,-places)+'.'+raw.slice(-places)}
function percent(value:unknown,name:string,min=-25,max=25){need(Number.isInteger(value)&&Number(value)>=min&&Number(value)<=max,`${name} must be a whole percentage from ${min} to ${max}`);return Number(value)}
function candidate(packet:Packet,input:Input):Assembly|EstimateTemplate{
 const value=structuredClone(current(packet.target)) as Assembly|EstimateTemplate
 if(packet.target.kind==='assembly'){
  const productivity=percent(input.productivity_percent,'Productivity change'),rate=percent(input.rate_percent,'Rate allowance change'),risk=percent(input.risk_percent,'Risk allowance',0)
  for(const part of (value as Assembly).parts){if(part.category==='labor')part.productivity=scaled(part.productivity,productivity);part.rate_factor=scaled(part.rate_factor??'1',rate);const waste=decimal(part.waste_percent,'Waste',false);need(waste.numerator<=25n*waste.denominator,'Existing risk allowance exceeds this bounded draft door');const total=waste.numerator+BigInt(risk)*waste.denominator;need(total<=25n*waste.denominator,'Total risk allowance must not exceed 25 percent');const places=String(waste.denominator).length-1,raw=total.toString().padStart(places+1,'0');part.waste_percent=places?raw.slice(0,-places)+'.'+raw.slice(-places):raw}
 }else{
  const factors=object(input.dimension_percent),definition=value as EstimateTemplate
  need(Object.keys(factors).length===Object.keys(definition.dimensions).length&&Object.keys(factors).every(k=>Object.hasOwn(definition.dimensions,k)),'Supply the existing template dimensions only')
  for(const key of Object.keys(definition.dimensions))definition.dimensions[key]=scaled(definition.dimensions[key]!,percent(factors[key],'Default dimension change'))
 }
 return catalogValue(packet.target.kind,object(value)) as Assembly|EstimateTemplate
}
async function prepare(db:D1Database,actor:Actor,packet:Packet,input:Input):Promise<Draft>{
 const value=candidate(packet,input),replay:Draft['replay']=[]
 for(const source of packet.sources){const job=await jobOf(db,actor,source.id),quote=job.quotes.find(q=>q.id===source.quote_id)!,retained=structuredClone(source.retained),target=retained.find(e=>e.id===packet.target.id)!
  target.version=packet.target.version+1;target.revisions=[{...packet.target.revisions.at(-1)!,version:target.version,value}]
  const proposed=await catalogPreview(db,job,actor,{template_id:source.catalog.template_id,as_of:source.catalog.as_of,dimensions:source.catalog.dimensions},retained),cost=proposed.proposal.cost_total_cents
  need(cost!==undefined,'Candidate cost is unknown',409,'replay_source')
  replay.push({job_id:job.id,quote_id:quote.id,dimensions:source.catalog.dimensions,signed_revenue_cents:quote.total_cents,historical_cost_cents:quote.cost_total_cents??null,candidate_cost_cents:cost,candidate_margin_cents:sum([quote.total_cents,-cost]),margin_delta_cents:quote.cost_total_cents===undefined?null:sum([quote.cost_total_cents,-cost])})
 }
 return {citations:packet.sources.map(s=>({job_id:s.id,source_version:s.version,quote_id:s.quote_id,catalog:s.catalog,order_ids:[...new Set(s.evidence.procurement.codes.flatMap(c=>c.sources.map(r=>r.order_id)))],receipt_ids:s.evidence.procurement.codes.flatMap(c=>c.sources.flatMap(r=>r.receipt_id?[r.receipt_id]:[])),callback_case_ids:s.evidence.warranty.cases.map(c=>c.id),callback_cost_ids:s.evidence.warranty.cases.flatMap(c=>c.costs.map(w=>w.id))})),id:crypto.randomUUID(),packet_id:packet.id,prepared_by:stamp(actor),reason:text(input.reason,'Analysis reason',2000),changes:input,value,observations:packet.sources.map(s=>({job_id:s.id,rows:s.performance.rows})),replay,lesson_input:{catalog_id:packet.target.id,catalog_version:packet.target.version,source_job_ids:packet.sources.map(s=>s.id),reason:text(input.reason,'Analysis reason',2000),value},limits:['Observed production uses only compatible installed units and approved labor. Unknown denominators stay null.','Rate allowance changes the assembly unit rate factor; vendor rate records are unchanged. Risk is a proposed waste allowance, not a measured probability.','Replay holds historical dimensions, dated rate revisions and signed revenue fixed. It is a counterfactual cost, not a restatement of actual margin.','Only the existing signed-person lesson approval changes a future catalog. No external training or other-company data use.']}
}
export async function learningResponse(request:Request,db:D1Database,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>):Promise<Response|null>{
 if(parts[0]!=='agent-learning')return null
 consumer(actor)
 const clock=await readClock(db),method=request.method
 if(parts.length===2&&parts[1]==='preview'&&method==='POST')return json({preview:await preview(db,actor,await body(request))})
 if(parts.length===2&&parts[1]==='packets'&&method==='GET'){
  const rows=(await db.prepare('SELECT data FROM pl_learning_packets WHERE owner_id=? ORDER BY rowid LIMIT 100').bind(actor.id).all<{data:string}>()).results,packets:{id:string;digest:string}[]=[]
  for(const row of rows){const packet=JSON.parse(row.data) as Packet;try{await live(db,actor,packet);packets.push({id:packet.id,digest:packet.digest})}catch(error){if(!(error instanceof Error)||!('status' in error)||Number(error.status)>=500)throw error}}
  return json({packets})
 }
 if(parts.length===2&&parts[1]==='packets'&&method==='POST'){
  requireOwner(actor);const input=await body(request),value=await preview(db,actor,input);need(input.confirm===true&&input.digest===value.digest,'Explicitly consent to this exact source packet',409,'packet_review')
  const packet:Packet={...value,id:crypto.randomUUID(),owner_id:actor.id,reviewed_by:stamp(actor),reason:text(input.reason,'Consent reason',2000)}
  need(JSON.stringify(packet).length<=1_000_000,'Select a smaller source packet')
  await transaction(db,actor,null,[db.prepare('INSERT INTO pl_learning_packets(id,owner_id,data) VALUES(?,?,?)').bind(packet.id,actor.id,JSON.stringify(packet)),db.prepare('INSERT INTO pl_learning_consents(packet_id,owner_id,owner_version) VALUES(?,?,?)').bind(packet.id,actor.id,actor.version),...packet.sources.map(s=>db.prepare('INSERT INTO pl_learning_sources(packet_id,job_id) VALUES(?,?)').bind(packet.id,s.id)),auditStatement(db,actor,{action:'learning.consent',subject_kind:'learning_packet',subject_id:packet.id,detail:{digest:packet.digest}})],clock)
  return json({packet},201)
 }
 need(parts[1]==='packets'&&parts[2],'Unknown learning route',404,'not_found')
 const packet=await packetOf(db,parts[2]);need(packet.owner_id===actor.id,'Learning packet unavailable',404,'not_found')
 if(parts.length===4&&parts[3]==='revoke'&&method==='POST'){
  requireOwner(actor);const input=await body(request);need(input.confirm===true,'Confirm consent revocation')
  await transaction(db,actor,null,[db.prepare('DELETE FROM pl_learning_consents WHERE packet_id=?').bind(packet.id),auditStatement(db,actor,{action:'learning.revoke',subject_kind:'learning_packet',subject_id:packet.id})],clock);return json({revoked:true})
 }
 if(parts.length===3&&method==='GET'){
  // Owners retain rejected history; agents must still have live source-bound consent before reading anything.
  if(actor.role!=='owner')await live(db,actor,packet)
  const rows=(await db.prepare('SELECT d.data,c.data AS decision FROM pl_learning_drafts d LEFT JOIN pl_learning_decisions c ON c.draft_id=d.id WHERE d.packet_id=? ORDER BY d.rowid').bind(packet.id).all<{data:string;decision:string|null}>()).results
  return json({packet,drafts:rows.map(r=>({draft:JSON.parse(r.data),decision:r.decision?JSON.parse(r.decision):null}))})
 }
 await live(db,actor,packet)
 if(parts.length===4&&parts[3]==='drafts'&&method==='POST'){
  const input=await body(request),key=text(input.request_id,'Request id',100),id=await hash([packet.id,key]),existing=await db.prepare('SELECT data FROM pl_learning_drafts WHERE id=?').bind(id).first<{data:string}>()
  if(existing){const draft=JSON.parse(existing.data) as Draft;need(JSON.stringify(draft.changes)===JSON.stringify(input),'Request id already used for different values',409,'request_replay');return json({draft})}
  const draft=await prepare(db,actor,packet,input);draft.id=id
  await transaction(db,actor,null,[db.prepare('INSERT INTO pl_learning_drafts(id,packet_id,data) VALUES(?,?,?)').bind(id,packet.id,JSON.stringify(draft)),auditStatement(db,actor,{action:'learning.prepare',subject_kind:'learning_draft',subject_id:id,detail:{packet_id:packet.id}})],clock)
  return json({draft},201)
 }
 if(parts.length===6&&parts[3]==='drafts'&&method==='POST'){
  requireOwner(actor);const input=await body(request),row=await db.prepare('SELECT data FROM pl_learning_drafts WHERE id=? AND packet_id=?').bind(parts[4],packet.id).first<{data:string}>();need(row,'Draft unavailable',404,'not_found');const draft=JSON.parse(row.data) as Draft
  need(!await db.prepare('SELECT draft_id FROM pl_learning_decisions WHERE draft_id=?').bind(draft.id).first(),'Draft was already reviewed',409,'draft_reviewed')
  const reason=text(input.reason,'Review reason',2000)
  need(parts[5]==='reject','Use the existing signed-person lesson proposal and approval doors for adoption',403,'human_required')
  await transaction(db,actor,null,[db.prepare('INSERT INTO pl_learning_decisions(draft_id,data) VALUES(?,?)').bind(draft.id,JSON.stringify({kind:'rejected',reason,by:stamp(actor)})),auditStatement(db,actor,{action:'learning.reject',subject_kind:'learning_draft',subject_id:draft.id})],clock)
  return json({rejected:true})
 }
 need(false,'Unknown learning action',404,'not_found')
}
