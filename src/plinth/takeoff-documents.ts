import { requireEstimating, requirePlans } from './auth'
import { digest, fromBase64 } from './attachments'
import { find, need, object, stamp, text, usdOnly, type Actor, type Attachment, type Input, type Job } from './model'
import { decimal } from './estimate-math'
import { points, measured, validateShape, validateOpening } from './takeoff-geometry'
import type { Calibration, DrawingRevision, TakeoffMeasurement, TakeoffSheet } from './takeoff-model'

/** Original PDFs share existing job-owned binary custody; deletion and private archives already cover this table. */
export async function takeoffAction(db:D1Database,job:Job,actor:Actor,input:Input,id?:string,action?:string){
 requireEstimating(actor,true);usdOnly(job)
 const sheets=job.takeoff??=[],writes:D1PreparedStatement[]=[]
 if(!id||action==='revise'){
  need(sheets.length<100||id,'A job supports up to 100 takeoff sheets')
  const sheet:TakeoffSheet=id?find(sheets,id):{id:crypto.randomUUID(),name:text(input.name,'Sheet name/number',200),revisions:[],calibrations:[],measurements:[]}
  const raw=object(input.document),bytes=fromBase64(raw.base64),name=text(raw.name,'PDF filename',240)
  need(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'&&(!raw.mime||raw.mime==='application/pdf'),'Upload an original PDF drawing');need(!/[\x00-\x1f/\\]/.test(name),'Invalid PDF filename')
  need(typeof input.page==='number'&&Number.isInteger(input.page)&&input.page>=1&&input.page<=10000,'Choose a PDF page number')
  for(const key of ['width','height'])need(typeof input[key]==='number'&&Number.isFinite(input[key])&&(input[key] as number)>0&&(input[key] as number)<=20000,'Page width and height must be scale-1 PDF points, at most 20000')
  const document:Attachment={id:crypto.randomUUID(),name,mime:'application/pdf',size:bytes.length,checksum:await digest(bytes)}
  const revision:DrawingRevision={id:crypto.randomUUID(),revision:sheet.revisions.length+1,document,page:input.page,width:input.width as number,height:input.height as number,uploaded_by:stamp(actor)}
  sheet.revisions.push(revision);if(!id)(job.takeoff??=[]).push(sheet)
  writes.push(db.prepare('INSERT INTO pl_attachments(id,job_id,entry_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?,?)').bind(document.id,job.id,revision.id,name,document.mime,document.checksum,document.size,bytes.buffer))
  return {record:sheet,writes}
 }
 const sheet=find(sheets,id),revision=find(sheet.revisions,text(input.revision_id,'Drawing revision',100));need(revision===sheet.revisions.at(-1),'Use the current drawing revision; earlier measurements remain history',409,'takeoff_review_required')
 if(action==='calibrate'){
  const ps=points(input.points,revision,2,2);need(Math.hypot(ps[1]!.x-ps[0]!.x,ps[1]!.y-ps[0]!.y)>0,'Calibration endpoints must differ');decimal(input.length,'Known reference length');need(Number(input.length)<=1e9,'Calibration length exceeds the supported range');need(input.unit==='ft'||input.unit==='m','Calibrate in feet or meters')
  const calibration:Calibration={id:crypto.randomUUID(),revision_id:revision.id,points:ps,length:String(input.length),unit:input.unit,by:stamp(actor)};sheet.calibrations.push(calibration);return {record:calibration,writes}
 }
 need(action==='measure','Unknown takeoff action',404,'not_found')
 need(input.kind==='length'||input.kind==='area'||input.kind==='count','Choose length, area or count')
 const calibration=input.kind==='count'?undefined:find(sheet.calibrations,text(input.calibration_id,'Calibration',100));need(!calibration||calibration.revision_id===revision.id,'Calibration must belong to this drawing revision')
 const row:TakeoffMeasurement={id:crypto.randomUUID(),revision_id:revision.id,...(calibration?{calibration_id:calibration.id}:{}),kind:input.kind,points:points(input.points,revision,input.kind==='area'?3:input.kind==='length'?2:1),name:text(input.name,'Measurement name',200),dimension:text(input.dimension,'Template dimension',100),annotation:text(input.annotation,'Drawing annotation',2000),by:stamp(actor),...(input.deduct_from?{deduct_from:text(input.deduct_from,'Parent measurement',100)}:{})}
 validateShape(row)
 need(sheet.measurements.length<1000,'A sheet supports up to 1000 measured annotations')
 if(row.deduct_from){const parent=find(sheet.measurements,row.deduct_from);need(!parent.deduct_from&&parent.revision_id===revision.id,'An opening must deduct from a parent on the same revision');need(parent.kind===row.kind&&parent.dimension===row.dimension&&parent.calibration_id===row.calibration_id,'Opening must use the same kind, dimension and calibration as its parent');validateOpening(parent,row,sheet.measurements.filter(m=>m.deduct_from===parent.id));sheet.measurements.push(row);measured(sheet,parent)}else {sheet.measurements.push(row);measured(sheet,row)}
 return {record:row,writes}
}
export async function takeoffFile(db:D1Database,job:Job,actor:Actor,id:string){requirePlans(actor,true);const file=job.takeoff?.flatMap(s=>s.revisions.map(r=>r.document)).find(f=>f.id===id);need(file,'Drawing not found',404,'not_found');const row=await db.prepare('SELECT bytes FROM pl_attachments WHERE id=? AND job_id=?').bind(id,job.id).first<{bytes:ArrayBuffer}>();need(row,'Drawing bytes missing',503,'document_missing');const bytes=new Uint8Array(row.bytes);need(bytes.length===file.size&&await digest(bytes)===file.checksum,'Drawing integrity check failed',503,'document_integrity');return new Response(bytes,{headers:{'content-type':'application/pdf','content-disposition':`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,'content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff','cache-control':'private, no-store'}})}
