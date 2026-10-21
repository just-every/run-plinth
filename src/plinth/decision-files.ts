import { digest, fromBase64 } from './attachments'
import { find, need, object, text, type Actor, type Attachment, type Input, type Job } from './model'
/** Job-owned originals use the existing archive/erasure custody table. Explicit record grants gate every download. */
export async function decisionFiles(db:D1Database,job:Job,entryId:string,value:unknown) {
 const files=value??[];need(Array.isArray(files)&&files.length<=5,'Attach at most five original PDF or image files')
 const attachments:Attachment[]=[],writes:D1PreparedStatement[]=[]
 for(const value of files){const raw=object(value),bytes=fromBase64(raw.base64),prefix=new TextDecoder().decode(bytes.slice(0,5)),mime=prefix==='%PDF-'?'application/pdf':bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':undefined
  need(mime,'Upload an original PDF, PNG or JPEG');need(raw.mime===undefined||raw.mime===mime,'File media type does not match its bytes');const name=text(raw.name,'File name',240);need(!/[\x00-\x1f/\\]/.test(name),'Invalid file name')
  const file={id:crypto.randomUUID(),name,mime,size:bytes.length,checksum:await digest(bytes)};attachments.push(file)
  writes.push(db.prepare('INSERT INTO pl_attachments(id,job_id,entry_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?,?)').bind(file.id,job.id,entryId,name,mime,file.checksum,file.size,bytes.buffer))
 }
 return {attachments,writes}
}
export async function decisionDownload(db:D1Database,job:Job,files:Attachment[],id:string){const file=find(files,id),row=await db.prepare('SELECT bytes FROM pl_attachments WHERE id=? AND job_id=?').bind(id,job.id).first<{bytes:ArrayBuffer}>();need(row,'Original file missing',503,'document_missing');const bytes=new Uint8Array(row.bytes);need(bytes.length===file.size&&await digest(bytes)===file.checksum,'Original integrity check failed',503,'document_integrity');return new Response(bytes,{headers:{'content-type':file.mime,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff','cache-control':'private, no-store'}})}
