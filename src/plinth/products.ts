import { productSource } from './product-source'
import { requireJobManager } from './auth'
import { cents, find, need, object, recordApproval, stamp, text, usdOnly, type Actor, type Attachment, type Input, type Job } from './model'
import { day } from './purchase-order-model'
import { digest, fromBase64 } from './attachments'
import { prepareQuote } from './quotes'
import { type ProductRevision } from './product-model'

async function captureImage(db:D1Database,job:Job,entry:string,value:unknown) {
 const input=object(value),bytes=fromBase64(input.base64),name=text(input.name,'Image name',240)
 need(!/[\x00-\x1f/\\]/.test(name),'Invalid image name')
 const mime=bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null
 need(mime&&(!input.mime||input.mime===mime),'Capture a PNG or JPEG original')
 const image:Attachment={id:crypto.randomUUID(),name,mime,size:bytes.length,checksum:await digest(bytes)}
 return {image,write:db.prepare('INSERT INTO pl_attachments(id,job_id,entry_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?,?)').bind(image.id,job.id,entry,name,mime,image.checksum,image.size,bytes.buffer)}
}
function url(value:unknown){const raw=text(value,'Supplier source URL',2000);let parsed:URL;try{parsed=new URL(raw)}catch{need(false,'Provide an HTTP or HTTPS supplier URL')}need(['https:','http:'].includes(parsed!.protocol)&&!parsed!.username&&!parsed!.password,'Provide an HTTP or HTTPS supplier URL without credentials');return parsed!.href}
export async function productAction(db:D1Database,job:Job,actor:Actor,input:Input,id?:string,action?:string){
 requireJobManager(actor,true);usdOnly(job)
 const writes:D1PreparedStatement[]=[]
 if(!id||action==='revise'){
  const product=id?find(job.products??[],id):{id:crypto.randomUUID(),revisions:[] as ProductRevision[]},previous=product.revisions.at(-1),revisionId=crypto.randomUUID()
  const image=input.image===undefined?previous?.image:await captureImage(db,job,revisionId,input.image).then(result=>{writes.push(result.write);return result.image})
  need(image,'Capture the supplier product image')
  const captured_on=day(input.captured_on,'Capture date'),valid_until=day(input.valid_until,'Price valid until')
  need(valid_until>=captured_on,'Price validity cannot end before capture')
  need(captured_on<=new Date().toISOString().slice(0,10),'Capture date cannot be in the future')
  need(typeof input.lead_days==='number'&&Number.isInteger(input.lead_days)&&input.lead_days>=0&&input.lead_days<=3650,'Lead time is zero to 3650 calendar days')
  need(typeof input.discontinued==='boolean','Record whether the supplier reports discontinued')
  const revision:ProductRevision={id:revisionId,revision:product.revisions.length+1,name:text(input.name,'Product name',200),sku:text(input.sku,'SKU',200),supplier:text(input.supplier,'Supplier',200),source_url:url(input.source_url),dimensions:text(input.dimensions,'Dimensions and units',1000),image,cost_quote_cents:cents(input.cost_quote_cents,'Quoted supplier USD cents'),lead_days:input.lead_days,captured_on,valid_until,discontinued:input.discontinued,evidence:text(input.evidence,'Source evidence',4000),prepared_by:stamp(actor)}
  product.revisions.push(revision);if(!id)(job.products??=[]).push(product)
  return {record:product,writes}
 }
 const product=find(job.products??[],id),revision=find(product.revisions,text(input.revision_id,'revision_id',100))
 need(revision===product.revisions.at(-1),'Review the latest capture',409,'product_superseded')
 if(action==='review'){
  requireJobManager(actor);need(input.confirm===true,'Confirm review of the exact supplier capture');need(!revision.reviewed_by,'This capture is already reviewed',409,'immutable')
  revision.reviewed_by=stamp(actor);recordApproval(job,actor,'product.review',{id:revision.id,prepared_by:revision.prepared_by,revision:revision.revision},revision)
  return {record:product,writes}
 }
 need(action==='estimate','Unknown product action',404,'not_found')
 const source=productSource(job,product.id,revision.id),prior=job.quotes.at(-1)
 need(!prior?.pricing,'A priced estimate needs a fresh full pricing review; add supplier sources through the measured estimate editor',409,'pricing_review')
 const line={description:source.name,quantity:'1',unit:'each',category:'material',phase:'Product specification',cost_code:text(input.cost_code,'Cost code',80),cost_unit_cents:source.cost_quote_cents,unit_cents:cents(input.unit_cents),product_id:product.id,product_revision_id:revision.id}
 return {record:prepareQuote(job,actor,{lines:[...(prior?.lines??[]),line],notes:prior?.notes,inclusions:prior?.inclusions,exclusions:prior?.exclusions,alternate_selections:prior?.alternate_selections}),writes}
}
/** Image sharing follows existing presented-selection / accepted-quote grants, including immutable old revisions. */
export async function productImage(db:D1Database,job:Job,actor:Actor,id:string){
 const sources=actor.role==='member'?[...job.quotes.filter(q=>q.status==='accepted').flatMap(q=>q.lines.filter(l=>l.included!==false).map(l=>l.product_source)),...(job.selections??[]).flatMap(s=>s.revisions.filter(r=>r.status!=='draft').flatMap(r=>r.options.map(o=>o.product_source)))]:job.products?.flatMap(p=>p.revisions)??[]
 const source=sources.find(s=>s?.image.id===id);need(source,'Image not found',404,'not_found')
 const stored=await db.prepare('SELECT bytes FROM pl_attachments WHERE id=? AND job_id=?').bind(id,job.id).first<{bytes:ArrayBuffer}>();need(stored,'Original image missing',503,'photo_missing')
 const bytes=new Uint8Array(stored.bytes);need(bytes.length===source.image.size&&await digest(bytes)===source.image.checksum,'Original image failed integrity check',503,'photo_integrity')
 return new Response(bytes,{headers:{'content-type':source.image.mime,'content-security-policy':"sandbox; default-src 'none'",'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
}
