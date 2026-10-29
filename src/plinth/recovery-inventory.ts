import { requireOwner, actorPredicate } from './auth'
import { digest } from './attachments'
import { need, object, type Actor, type Input } from './model'

export interface RecoveryField { identity:string; path:string; value:string|number|boolean|null; type:string }
export interface RecoveryRecord { kind:string; identity:string; sha256:string; revision?:string|number }
export interface RecoveryFile { identity:string; size:number; sha256:string; declared_size:number|null; declared_sha256:string|null; verified:boolean }
export interface RecoveryControls { currency:string; issued_invoices:number; issued_gross_cents:number; corrections_cents:number; receipts_cents:number; deposit_applications_cents:number; write_offs_cents:number; posted_cost_cents:number }
export interface RecoveryManifest { format:'plinth-recovery-inventory-v1'; records:RecoveryRecord[]; files:RecoveryFile[]; controls:RecoveryControls[]; exclusions:string[]; tables:{name:string;count:number}[] }
const omitted = new Set(['pl_clock','pl_guard','pl_calendar_tokens','pl_warranty_scheduler','pl_connector_subscriptions','pl_connector_deliveries','pl_connector_event_order','pl_api_limits'])
const exclusions = [
 'Sessions, credentials, private settings, signing keys and standing consent are excluded. This manifest grants no authority.',
 'Live connector subscriptions, delivery queues, calendar tokens and runtime counters are excluded; retained connector bindings are inert references.',
 'Native product and import custody records are inventoried. Base account and bootstrap metadata, provider state and external accounting are outside this semantic comparison.',
 'A manifest is a confidential comparison document, not an archive, proof of source authenticity or permission to restore. Use the existing CLI archive and later erasure journal.',
 'Complete target-wide recovery, future entities, differently owned installation handoff and complete PDF, CSV and XLSX reports remain unproved.',
]
const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"'
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}'
 return JSON.stringify(value)
}
const hash=(value:unknown)=>digest(new TextEncoder().encode(canonical(value)))
const integer=(value:unknown)=>{need(Number.isSafeInteger(value),'Inventory contains an invalid financial amount',409,'inventory_invalid');return value as number}
const add=(a:number,b:unknown)=>integer(a+integer(b))
function control(job:Record<string,any>):RecoveryControls {
 const result:RecoveryControls={currency:job.currency??'USD',issued_invoices:0,issued_gross_cents:0,corrections_cents:0,receipts_cents:0,deposit_applications_cents:0,write_offs_cents:0,posted_cost_cents:0}
 // Count issued source facts independently of report projections and balance helpers.
 for(const invoice of job.invoices??[])if(invoice.issued){
  result.issued_invoices++
  result.issued_gross_cents=add(result.issued_gross_cents,invoice.issued.gross_cents)
  for(const row of invoice.corrections??[])result.corrections_cents=add(result.corrections_cents,row.document.gross_cents)
  for(const row of invoice.receipts??[])result.receipts_cents=add(result.receipts_cents,row.amount_cents)
  for(const row of invoice.deposit_applications??[])result.deposit_applications_cents=add(result.deposit_applications_cents,row.amount_cents)
  for(const row of invoice.write_offs??[])result.write_offs_cents=add(result.write_offs_cents,row.amount_cents)
 }
 for(const entry of job.cost_records?.entries??[])result.posted_cost_cents=add(result.posted_cost_cents,entry.amount_cents)
 return result
}
/** One read batch observes native records and original bytes together; no reconciliation write or provider operation exists. */
export async function recoveryInventory(db:D1Database,actor:Actor,fields?:RecoveryField[]):Promise<RecoveryManifest>{
 requireOwner(actor);need(!actor.agent_door&&!actor.credential_id,'A signed-in owner session is required',403,'forbidden')
 const names=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name GLOB 'pl_*' OR name GLOB 'ik_*') ORDER BY name").all<{name:string}>()).results.map(r=>r.name).filter(name=>!omitted.has(name))
 const columns=await db.batch(names.map(name=>db.prepare('PRAGMA table_info('+quote(name)+')')))
 const rows=await db.batch(names.map(name=>db.prepare('SELECT * FROM '+quote(name))))
 const declaredFiles=new Map<string,{size:number;sha256:string}>()
 const chunkFiles=new Map<string,{parts:{position:number;bytes:Uint8Array}[];size:unknown;sha256:unknown}>()
 const records:RecoveryRecord[]=[],files:RecoveryFile[]=[],tables:RecoveryManifest['tables']=[],controls=new Map<string,RecoveryControls>()
 async function original(identity:string,bytes:Uint8Array,declaredSize:unknown,declaredHash:unknown){
  const sha256=await digest(bytes),size=bytes.byteLength
  const declared_size=typeof declaredSize==='number'?declaredSize:null,declared_sha256=typeof declaredHash==='string'?declaredHash:null
  files.push({identity,size,sha256,declared_size,declared_sha256,verified:(declared_size===null||declared_size===size)&&(declared_sha256===null||declared_sha256===sha256)})
  return {size,sha256}
 }
 async function walk(value:any,path:string):Promise<any>{
  if(Array.isArray(value))return Promise.all(value.map((v,i)=>walk(v,path+'/'+encodeURIComponent(String(v?.id??i)))))
  if(!value||typeof value!=='object')return value
  if(typeof value.id==='string'&&typeof value.size==='number'&&typeof value.checksum==='string')declaredFiles.set('pl_plan_file_chunks:'+value.id,{size:value.size,sha256:value.checksum})
  const normalized:Record<string,unknown>={}
  for(const [key,child] of Object.entries(value)){
   if(key==='base64'&&typeof child==='string'){
    const bytes=Uint8Array.from(atob(child),c=>c.charCodeAt(0))
    normalized[key]=await original(path,bytes,value.size,value.checksum)
   }else normalized[key]=await walk(child,path+'/'+encodeURIComponent(key))
  }
  if(typeof value.id==='string')records.push({kind:'revision-reference',identity:path,sha256:await hash(normalized),...(typeof value.revision==='number'||typeof value.revision==='string'?{revision:value.revision}:{})})
  return normalized
 }
 for(let index=0;index<names.length;index++){
  const name=names[index]!,keyColumns=(columns[index]!.results as {name:string;pk:number}[]).filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name)
  tables.push({name,count:rows[index]!.results.length})
  for(const row of rows[index]!.results as Record<string,any>[]){
   if(name==='ik_originals')declaredFiles.set('ik_d1_original_chunks:'+canonical([row.job_id,row.kind,row.original_key]),{size:row.size,sha256:row.sha256})
   const identity=name+':'+canonical(keyColumns.length?keyColumns.map(k=>row[k]):row),normalized:Record<string,unknown>={}
   for(const [key,value] of Object.entries(row)){
    if(value instanceof ArrayBuffer||ArrayBuffer.isView(value)||Array.isArray(value)&&key==='bytes'){
     const bytes=value instanceof ArrayBuffer?new Uint8Array(value):ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):new Uint8Array(value)
     if(['pl_plan_file_chunks','ik_d1_original_chunks'].includes(name)){
      const group=name==='pl_plan_file_chunks'?String(row.file_id):canonical([row.job_id,row.kind,row.original_key])
      const groupId=name+':'+group,existing=chunkFiles.get(groupId)??{parts:[],size:null,sha256:null}
      existing.parts.push({position:row.position??row.ordinal,bytes});chunkFiles.set(groupId,existing)
      normalized[key]={size:bytes.byteLength,sha256:await digest(bytes)}
     }else normalized[key]=await original(identity+':'+key,bytes,row.size,row.checksum??row.sha256)
    }else if(typeof value==='string'&&['data','record_json','plan_json'].includes(key)){
     let parsed:any;try{parsed=JSON.parse(value)}catch{parsed=value}
     normalized[key]=await walk(parsed,identity+':'+key)
     if(name==='pl_jobs'){
      const result=control(parsed),current=controls.get(result.currency)
      if(current){for(const key of Object.keys(result).filter(k=>k!=='currency') as (keyof Omit<RecoveryControls,'currency'>)[])current[key]=add(current[key],result[key])}else controls.set(result.currency,result)
     }
    }else normalized[key]=value
   }
   records.push({kind:name,identity,sha256:await hash(normalized),...(typeof row.version==='number'?{revision:row.version}:{})})
   if(fields)describeFields(normalized,identity,'',fields)
  }
 }
 for(const [identity,file] of chunkFiles){
  file.parts.sort((a,b)=>a.position-b.position)
  const size=file.parts.reduce((total,part)=>total+part.bytes.byteLength,0),bytes=new Uint8Array(size)
  let offset=0;for(const part of file.parts){bytes.set(part.bytes,offset);offset+=part.bytes.byteLength}
  const declared=declaredFiles.get(identity)
  await original(identity,bytes,declared?.size??file.size,declared?.sha256??file.sha256)
 }
 // Recheck current owner authority after the potentially long read, without mutating any data.
 const fence=actorPredicate(actor)
 const allowed=await db.prepare(`SELECT CASE WHEN ${fence.sql} THEN 1 ELSE 0 END AS allowed`).bind(...fence.params).first<{allowed:number}>()
 need(allowed?.allowed===1,'Owner authority changed; sign in again',403,'forbidden')
 return {format:'plinth-recovery-inventory-v1',records:records.sort((a,b)=>a.identity.localeCompare(b.identity)),files:files.sort((a,b)=>a.identity.localeCompare(b.identity)),controls:[...controls.values()].sort((a,b)=>a.currency.localeCompare(b.currency)),exclusions:[...exclusions],tables}
}
function sourceManifest(value:unknown):RecoveryManifest{
 const source=object(value)
 need(source.format==='plinth-recovery-inventory-v1','Choose a Plinth recovery inventory manifest')
 for(const key of ['records','files','controls','exclusions','tables'])need(Array.isArray(source[key]),'Manifest is incomplete')
 for(const key of ['records','files']){
  const identities=new Set<string>()
  for(const value of source[key] as unknown[]){const row=object(value);need(typeof row.identity==='string'&&row.identity.length<=4000&&!identities.has(row.identity),'Manifest identities must be unique');identities.add(row.identity);need(typeof row.sha256==='string'&&/^[a-f0-9]{64}$/.test(row.sha256),'Manifest checksum is invalid');if(key==='files')need(Number.isSafeInteger(row.size)&&Number(row.size)>=0,'Manifest file size is invalid')}
 }
 const currencies=new Set<string>(),amountKeys=['issued_invoices','issued_gross_cents','corrections_cents','receipts_cents','deposit_applications_cents','write_offs_cents','posted_cost_cents']
 need((source.controls as Input[]).every(c=>{
  if(!c||typeof c!=='object'||typeof c.currency!=='string'||!/^[A-Z]{3}$/.test(c.currency)||currencies.has(c.currency))return false
  currencies.add(c.currency)
  return amountKeys.every(key=>Number.isSafeInteger(c[key]))&&Number(c.issued_invoices)>=0&&Object.keys(c).every(key=>key==='currency'||amountKeys.includes(key))
 }),'Manifest control totals are invalid')
 return source as unknown as RecoveryManifest
}
function differences(source:{identity:string}[],current:{identity:string}[]){
 const expected=new Map(source.map(r=>[r.identity,r])),actual=new Map(current.map(r=>[r.identity,r]))
 return {missing:source.filter(r=>!actual.has(r.identity)).map(r=>r.identity),extra:current.filter(r=>!expected.has(r.identity)).map(r=>r.identity),mismatched:source.filter(r=>actual.has(r.identity)&&canonical(r)!==canonical(actual.get(r.identity))).map(r=>r.identity)}
}
export function reconcileRecovery(value:unknown,current:RecoveryManifest){
 const source=sourceManifest(value),records=differences(source.records,current.records),files=differences(source.files,current.files)
 const controls=canonical(source.controls)!==canonical(current.controls),coverage=canonical(source.tables)!==canonical(current.tables)||canonical(source.exclusions)!==canonical(current.exclusions)
 return {matches:!current.files.some(f=>!f.verified)&&!controls&&!coverage&&[records,files].every(diff=>Object.values(diff).every(rows=>rows.length===0)),records,files,control_totals:{match:!controls,source:source.controls,current:current.controls},coverage_match:!coverage,unverified_files:current.files.filter(f=>!f.verified).map(f=>f.identity),notice:'Comparison only. Supplied source claims are unverified. No records, permissions, credentials, sending consent or provider instructions were changed.'}
}

/** Human reports retain native source facts; original payloads have already become byte counts and checksums. */
function describeFields(value:unknown,identity:string,path:string,fields:RecoveryField[]):void {
 if(value===null||typeof value!=='object'){
  fields.push({identity,path,value:value as string|number|boolean|null,type:value===null?'null':typeof value});return
 }
 const entries=Object.entries(value)
 if(!entries.length){fields.push({identity,path,value:Array.isArray(value)?'[]':'{}',type:'container'});return}
 for(const [key,child] of entries)describeFields(child,identity,path+'/'+key.replaceAll('~','~0').replaceAll('/','~1'),fields)
}
