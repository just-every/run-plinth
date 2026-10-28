import { requireJobManager } from './auth'
import { digest } from './attachments'
import { find, need, object, recordApproval, stamp, text, type Actor, type Input, type Job } from './model'
import { planManager, planRecipientAllowed, planSetVisible } from './plan-access'
import { planLink, type PlanSet, type PlanSheet, type PlanView } from './plan-model'

/** Plan originals have a document limit independent of daily-log photos. The request door also bounds the whole set. */
function planBytes(value:unknown){
 const limit=10*1024*1024
 need(typeof value==='string'&&value.length>0&&value.length<=4*Math.ceil(limit/3)&&/^[A-Za-z0-9+/]*={0,2}$/.test(value),'Upload a base64 PDF of at most 10 MB')
 let raw:string;try{raw=atob(value)}catch{need(false,'Invalid base64 PDF')}
 need(btoa(raw!)===value,'PDF base64 must be canonical')
 const bytes=Uint8Array.from(raw!,c=>c.charCodeAt(0));need(bytes.length>0&&bytes.length<=limit,'Each plan PDF must be at most 10 MB');return bytes
}
const key=(sheet:PlanSheet)=>sheet.kind+':'+sheet.number.toLowerCase()
export async function planView(db:D1Database,job:Job,actor:Actor):Promise<PlanView>{
 const sets=job.plan_sets??[],latest=new Map<string,{set:PlanSet;sheet:PlanSheet}>()
 for(const set of sets.filter(s=>s.approved_by).toSorted((a,b)=>a.approved_by!.at.localeCompare(b.approved_by!.at)))for(const sheet of set.sheets)latest.set(key(sheet),{set,sheet})
 const people=planManager(actor)?(await db.prepare("SELECT id,display_name AS name FROM oa_operators WHERE status='active' ORDER BY display_name").all<{id:string;name:string}>()).results:[]
 const recipients=[];for(const person of people)if(await planRecipientAllowed(db,job,person.id))recipients.push(person)
 return {id:job.id,version:job.version,name:job.name,manage:planManager(actor),annotate:actor.role!=='member'&&actor.role!=='estimator'&&(!actor.permissions||actor.permissions.matrix.documents.create),person_id:actor.id,recipients,sets:sets.filter(s=>planSetVisible(actor,s)).map(set=>({...set,recipients:planManager(actor)?set.recipients:set.recipients.filter(r=>r.id===actor.id),sheets:set.sheets.map(sheet=>{const current=latest.get(key(sheet));return {...sheet,current:current?.sheet.id===sheet.id,...(current&&current.sheet.id!==sheet.id?{superseded_by:{set_id:current.set.id,sheet_id:current.sheet.id,revision:current.sheet.revision}}:{}),href:planLink(job.id,set.id,sheet.id)}})}))}
}
export async function planAction(db:D1Database,job:Job,actor:Actor,input:Input,id?:string,verb?:string){
 const writes:D1PreparedStatement[]=[]
 if(!id){
  requireJobManager(actor)
  const issue_on=text(input.issue_on,'Issue date',10)
  need(/^\d{4}-\d{2}-\d{2}$/.test(issue_on)&&Number.isFinite(Date.parse(issue_on+'T12:00:00Z'))&&new Date(issue_on+'T12:00:00Z').toISOString().slice(0,10)===issue_on,'Enter a valid calendar issue date')
  need(Array.isArray(input.sheets)&&input.sheets.length>0&&input.sheets.length<=40,'Upload one to forty sheets')
  const set:PlanSet={id:crypto.randomUUID(),title:text(input.title,'Plan set title',200),issue_on,sheets:[],prepared_by:stamp(actor),recipients:[],annotations:[]}
  for(const raw of input.sheets){
   const value=object(raw),file=object(value.document),bytes=planBytes(file.base64),name=text(file.name,'Original filename',240)
   need(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'&&(!file.mime||file.mime==='application/pdf'),'Upload an original PDF')
   need(!/[\x00-\x1f/\\]/.test(name),'Invalid PDF filename')
   need(['plan','specification','addendum'].includes(String(value.kind)),'Choose plan, specification or addendum')
   for(const field of ['page','width','height'])need(typeof value[field]==='number'&&Number.isFinite(value[field])&&(value[field] as number)>0&&(value[field] as number)<=20000,'Supply a valid page and PDF dimensions')
   need(Number.isInteger(value.page),'Page must be a whole number')
   const sheet:PlanSheet={id:crypto.randomUUID(),number:text(value.number,'Sheet number',80),revision:text(value.revision,'Revision number',80),kind:value.kind as PlanSheet['kind'],page:value.page as number,width:value.width as number,height:value.height as number,document:{id:crypto.randomUUID(),name,mime:'application/pdf',size:bytes.length,checksum:await digest(bytes)}}
   need(!set.sheets.some(s=>key(s)===key(sheet)),'A set cannot repeat a sheet number in the same document kind')
   need(!(job.plan_sets??[]).some(s=>s.sheets.some(old=>key(old)===key(sheet)&&old.revision===sheet.revision)),'Use a new revision number for an existing sheet')
   set.sheets.push(sheet)
   if(bytes.length<=2_097_152)writes.push(db.prepare('INSERT INTO pl_attachments(id,job_id,entry_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?,?)').bind(sheet.document.id,job.id,set.id,name,'application/pdf',sheet.document.checksum,bytes.length,bytes.buffer))
   else for(let at=0,position=0;at<bytes.length;at+=524288,position++)writes.push(db.prepare('INSERT INTO pl_plan_file_chunks(file_id,job_id,set_id,position,bytes) VALUES(?,?,?,?,?)').bind(sheet.document.id,job.id,set.id,position,bytes.slice(at,at+524288).buffer))
  }
  ;(job.plan_sets??=[]).push(set);return {record:set,writes}
 }
 const set=find(job.plan_sets??[],id)
 need(planSetVisible(actor,set),'Plan set not found',404,'not_found')
 if(verb==='approve'){
  requireJobManager(actor);need(input.confirm===true,'Confirm the exact sheets and recipients')
  need(Array.isArray(input.recipient_ids)&&input.recipient_ids.length<=100,'Choose up to 100 current recipients')
  const ids=[...new Set(input.recipient_ids.map(id=>text(id,'Recipient',100)))].sort()
  if(set.approved_by){need(JSON.stringify(ids)===JSON.stringify(set.recipients.map(r=>r.id).sort()),'An approved distribution is immutable',409,'immutable');return {record:set,writes}}
  // A pending older set must not silently replace a set already approved after it was uploaded.
  for(const sheet of set.sheets)need(!(job.plan_sets??[]).slice((job.plan_sets??[]).indexOf(set)+1).some(s=>s.approved_by&&s.sheets.some(r=>key(r)===key(sheet))),'A newer approved set already replaces this sheet',409,'superseded')
  for(const id of ids){need(await planRecipientAllowed(db,job,id),'Recipient no longer has current plan access',409,'plan_recipient');const person=await db.prepare('SELECT display_name AS name FROM oa_operators WHERE id=?').bind(id).first<{name:string}>();set.recipients.push({id,name:person!.name})}
  set.approved_by=stamp(actor);recordApproval(job,actor,'plans.approve',set,{sheets:set.sheets,issue_on:set.issue_on,recipients:set.recipients})
 }else if(verb==='acknowledge'){
  need(set.approved_by,'Only approved distributions can be acknowledged',409,'unapproved')
  const recipient=set.recipients.find(r=>r.id===actor.id);need(recipient&&await planRecipientAllowed(db,job,actor.id),'This notice is not addressed to you',403,'forbidden')
  recipient.acknowledged_by??=stamp(actor)
 }else if(verb==='annotate'){
  need(actor.role!=='member'&&actor.role!=='estimator','Internal field or office annotation access required',403,'forbidden')
  need(set.approved_by,'Approve the source revision before annotation',409,'unapproved')
  const sheet=find(set.sheets,text(input.sheet_id,'Exact source sheet',100))
  need(set.annotations.length<1000,'This set has reached its annotation limit')
  for(const [coordinate,limit] of [['x',sheet.width],['y',sheet.height]] as const)need(typeof input[coordinate]==='number'&&Number.isFinite(input[coordinate])&&(input[coordinate] as number)>=0&&(input[coordinate] as number)<=limit,'Place the annotation within its source PDF page')
  const annotation={x:input.x as number,y:input.y as number,id:crypto.randomUUID(),sheet_id:sheet.id,revision:sheet.revision,text:text(input.text,'Annotation',4000),by:stamp(actor)}
  set.annotations.push(annotation);return {record:annotation,writes}
 }else need(false,'Unknown plan action',404,'not_found')
 return {record:set,writes}
}
export async function planFile(db:D1Database,job:Job,actor:Actor,setId:string,sheetId:string){
 const set=find(job.plan_sets??[],setId);need(planSetVisible(actor,set),'Plan set not found',404,'not_found')
 const sheet=find(set.sheets,sheetId),file=sheet.document
 const row=await db.prepare('SELECT bytes FROM pl_attachments WHERE id=? AND job_id=? AND entry_id=?').bind(file.id,job.id,set.id).first<{bytes:ArrayBuffer}>()
 let bytes:Uint8Array<ArrayBuffer>
 if(row)bytes=new Uint8Array(row.bytes)
 else{
  const {results:chunks}=await db.prepare('SELECT position,bytes FROM pl_plan_file_chunks WHERE file_id=? AND job_id=? AND set_id=? ORDER BY position').bind(file.id,job.id,set.id).all<{position:number;bytes:ArrayBuffer}>()
  need(chunks.length,'Plan original missing',503,'document_missing');bytes=new Uint8Array(file.size);let at=0
  for(const [position,chunk] of chunks.entries()){const part=new Uint8Array(chunk.bytes);need(chunk.position===position&&at+part.length<=bytes.length,'Plan integrity check failed',503,'document_integrity');bytes.set(part,at);at+=part.length}
  need(at===file.size,'Plan integrity check failed',503,'document_integrity')
 }
 need(bytes.length===file.size&&await digest(bytes)===file.checksum,'Plan integrity check failed',503,'document_integrity')
 return new Response(bytes,{headers:{'content-type':'application/pdf','content-disposition':`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'"}})
}
