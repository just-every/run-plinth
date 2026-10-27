import { digest } from './attachments'
import { invoiceBalance } from './invoices'
import { need, type Job } from './model'

export interface PacketFile { id:string; name:string; mime:string; checksum:string; base64:string }
export interface DrawPacket {
 format:'plinth-draw-packet-v1'; job_id:string; job_name:string; currency:string; as_of:string
 sov:{revision:number;lines:{id:string;cost_code:string;description:string;scheduled_cents:number}[]} | null
 applications:{id:string;description:string;scheduled_cents:number;previous_cents:number;current_cents:number;total_cents:number;balance_cents:number;lines:{cost_code:string;description:string;previous_cents:number;current_cents:number;total_cents:number;balance_cents:number}[]}[]
 invoices:{id:string;number:string;description:string;due_on:string;terms:string;gross_cents:number;due_cents:number}[]
 photos:PacketFile[]; inspections:{title:string;status:string;documents:PacketFile[]}[]
 waivers:{draw_id:string;status:string;document:PacketFile|null}[]
}
/** Build an allowlist, never a serialized job or an office document with fields removed afterward. */
export async function drawPacket(db:D1Database,job:Job,now:number):Promise<DrawPacket> {
 const file=async(table:string,metadata:{id:string;name:string;mime:string;checksum:string;size:number}):Promise<PacketFile>=>{
  const stored=await db.prepare(`SELECT bytes FROM ${table} WHERE id=? AND job_id=?`).bind(metadata.id,job.id).first<{bytes:ArrayBuffer}>()
  need(stored,'Packet original is unavailable',503,'document_missing')
  const bytes=new Uint8Array(stored.bytes);need(bytes.length===metadata.size&&await digest(bytes)===metadata.checksum,'Packet original failed integrity check',503,'document_integrity')
  let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte)
  return {id:metadata.id,name:metadata.name,mime:metadata.mime,checksum:metadata.checksum,base64:btoa(raw)}
 }
 const sov=job.sov?.at(-1)
 return {
  format:'plinth-draw-packet-v1',job_id:job.id,job_name:job.name,currency:job.currency??'USD',as_of:new Date(now).toISOString(),
  sov:sov?{revision:sov.revision,lines:sov.lines.map(l=>({id:l.id,cost_code:l.cost_code,description:l.description,scheduled_cents:l.scheduled_cents}))}:null,
  applications:job.claims.filter(c=>c.status==='exported'&&c.sov).map(c=>({id:c.id,description:c.description,scheduled_cents:c.sov!.scheduled_cents,previous_cents:c.sov!.previous_cents,current_cents:c.sov!.current_cents,total_cents:c.sov!.total_cents,balance_cents:c.sov!.balance_cents,lines:c.sov!.lines.map(l=>({cost_code:l.cost_code,description:l.description,previous_cents:l.previous_cents,current_cents:l.current_cents,total_cents:l.total_cents,balance_cents:l.balance_cents}))})),
  invoices:(job.invoices??[]).filter(i=>i.issued).map(i=>({id:i.id,number:i.issued!.number,description:i.issued!.description,due_on:i.issued!.due_on,terms:i.issued!.terms,gross_cents:i.issued!.gross_cents,due_cents:invoiceBalance(job,i).due_cents})),
  photos:await Promise.all(job.diary.filter(d=>d.status==='published').flatMap(d=>d.attachments).map(m=>file('pl_attachments',m))),
  inspections:await Promise.all((job.schedule_constraints??[]).filter(c=>c.kind==='inspection').map(async c=>({title:c.title,status:c.events.at(-1)!.action,documents:await Promise.all(c.events.flatMap(e=>e.documents).map(m=>file('pl_schedule_constraint_files',m)))}))),
  waivers:await Promise.all((job.subcontracts??[]).flatMap(s=>(s.draws??[]).flatMap(d=>d.waivers.map(async w=>({draw_id:d.id,status:w.status,document:w.release?await file('pl_lien_waiver_files',w.release.document):null}))))),
 }
}
