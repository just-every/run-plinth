import { requireOwner } from './auth'
import { digest, fromBase64 } from './attachments'
import { find, need, object, stamp, text, type Actor, type Attachment, type Input, type Job, type Stamp } from './model'
import { productSource } from './product-source'
import type { ProductSource } from './product-model'
import type { SelectionRevision } from './selection-model'
import { roomGeometry } from './room-geometry'
export interface RoomFile extends Attachment { format:'pdf'|'png'|'jpeg'|'glb'|'obj'|'ifc'; model_status?:string; unsupported?:string[] }
export interface RoomRevision {
 id:string; revision:number; title:string; measurements:{length:string;width:string;height:string;unit:'ft'|'m'}; files:RoomFile[];
 annotations:{file_id:string;page:number;x:number;y:number;text:string}[];
 walkthrough?:{title:string;url:string}; products:ProductSource[]; selections:{selection_id:string;revision_id:string;room:string;category:string;value:SelectionRevision}[]; by:Stamp
}
export interface RoomBoard { id:string; revisions:RoomRevision[] }
const measure=(value:unknown,label:string)=>{const raw=text(value,label,30);need(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw)&&Number(raw)>0&&Number(raw)<=10000,'Room measurements must be positive decimals up to 10000');return raw}
export async function roomBoardAction(db:D1Database,job:Job,actor:Actor,input:Input,id?:string,action?:string){
 requireOwner(actor);need(!id||action==='revise','Unknown room board action',404,'not_found')
 const board=id?find(job.room_boards??[],id):{id:crypto.randomUUID(),revisions:[] as RoomRevision[]},previous=board.revisions.at(-1)
 if(previous)need(input.base_revision_id===previous.id,'Room board changed. Reload its latest revision.',409,'room_revision')
 need(board.revisions.length<100,'A room board supports 100 revisions');need(id||(job.room_boards??[]).length<50,'A job supports 50 room boards')
 const revisionId=crypto.randomUUID(),writes:D1PreparedStatement[]=[],files=structuredClone(previous?.files??[])
 const uploads=input.files??[];need(Array.isArray(uploads)&&uploads.length<=10&&files.length+uploads.length<=30,'A board supports 30 originals, with up to 10 uploads per revision')
 for(const value of uploads){const f=object(value),name=text(f.name,'Original filename',240);need(!/[\x00-\x1f/\\]/.test(name),'Invalid original filename');const bytes=fromBase64(f.base64),extension=name.split('.').at(-1)?.toLowerCase();let format:RoomFile['format'],mime:string
  if(extension==='pdf'&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'){format='pdf';mime='application/pdf'}
  else if(extension==='png'&&bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'){format='png';mime='image/png'}
  else if(['jpg','jpeg'].includes(extension!)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255){format='jpeg';mime='image/jpeg'}
  else if(extension==='glb'&&new TextDecoder().decode(bytes.slice(0,4))==='glTF'){format='glb';mime='model/gltf-binary'}
  else if(extension==='ifc'){format='ifc';mime='application/x-step';need(/^\s*ISO-10303-21;/i.test(new TextDecoder().decode(bytes.slice(0,100))),'IFC must be a STEP original')}
  else {need(extension==='obj','Use PDF, PNG, JPEG, GLB, OBJ or IFC originals');format='obj';mime='text/plain';need(!bytes.includes(0),'OBJ must be text')}
  const geometry=format==='glb'||format==='obj'||format==='ifc'?roomGeometry(bytes,format):undefined
  const file:RoomFile={id:crypto.randomUUID(),name,mime,size:bytes.length,checksum:await digest(bytes),format,...(geometry?{model_status:geometry.error??'Static triangle geometry',unsupported:geometry.unsupported}:{} )}
  files.push(file);writes.push(db.prepare('INSERT INTO pl_attachments(id,job_id,entry_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?,?)').bind(file.id,job.id,board.id,name,mime,file.checksum,file.size,bytes.buffer))
 }
 need(files.length>0,'Upload at least one room original')
 const measures=object(input.measurements);need(measures.unit==='ft'||measures.unit==='m','Choose feet or meters')
 const annotations=input.annotations??previous?.annotations??[];need(Array.isArray(annotations)&&annotations.length<=100,'A revision supports 100 finish annotations')
 const products=input.products??previous?.products.map(p=>({product_id:p.product_id,revision_id:p.id}))??[];need(Array.isArray(products)&&products.length<=30,'Link up to 30 reviewed product sources')
 const selections=input.selections??previous?.selections.map(s=>({selection_id:s.selection_id,revision_id:s.revision_id}))??[];need(Array.isArray(selections)&&selections.length<=30,'Link up to 30 selection revisions')
 let walkthrough=previous?.walkthrough
 if(input.walkthrough===null)walkthrough=undefined
 else if(input.walkthrough!==undefined){const link=object(input.walkthrough);let url:URL|undefined;try{url=new URL(String(link.url))}catch{}
  need(url,'Use a complete HTTPS walkthrough link');need(url.protocol==='https:'&&!url.username&&!url.password,'Use an HTTPS walkthrough link without credentials');need(link.confirm_authorized===true||previous?.walkthrough?.url===String(link.url).trim()&&previous.walkthrough.title===String(link.title).trim(),'Confirm you may use this design-tool link');walkthrough={title:text(link.title,'Walkthrough title',200),url:text(link.url,'Walkthrough URL',2000)}
 }
 const revision:RoomRevision={id:revisionId,revision:board.revisions.length+1,title:text(input.title,'Room name',200),measurements:{length:measure(measures.length,'Room length'),width:measure(measures.width,'Room width'),height:measure(measures.height,'Room height'),unit:measures.unit},files,...(walkthrough?{walkthrough}:{}),
  annotations:annotations.map(value=>{const a=object(value);find(files,text(a.file_id,'Annotation original',100));need(Number.isInteger(a.page)&&Number(a.page)>=1&&Number(a.page)<=1000,'Choose an original page from 1 to 1000');need(typeof a.x==='number'&&typeof a.y==='number'&&a.x>=0&&a.x<=100&&a.y>=0&&a.y<=100,'Annotation coordinates are percentages from 0 to 100');return {file_id:String(a.file_id),page:Number(a.page),x:a.x,y:a.y,text:text(a.text,'Finish annotation',2000)}}),
  products:products.map(value=>{const p=object(value);return productSource(job,p.product_id,p.revision_id)}),
  selections:selections.map(value=>{const s=object(value),selection=find(job.selections??[],text(s.selection_id,'Selection',100)),r=find(selection.revisions,text(s.revision_id,'Selection revision',100));return {selection_id:selection.id,revision_id:r.id,room:r.room,category:r.category,value:structuredClone(r)}}),by:stamp(actor)}
 board.revisions.push(revision);if(!id)(job.room_boards??=[]).push(board)
 return {record:board,writes}
}
export async function roomBoardFile(db:D1Database,job:Job,actor:Actor,id:string,geometry=false,download=false){
 requireOwner(actor);const file=job.room_boards?.flatMap(b=>b.revisions.flatMap(r=>r.files)).find(f=>f.id===id);need(file,'Room original not found',404,'not_found')
 const row=await db.prepare('SELECT bytes FROM pl_attachments WHERE id=? AND job_id=?').bind(id,job.id).first<{bytes:ArrayBuffer}>();need(row,'Room original missing',503,'original_missing');const bytes=new Uint8Array(row.bytes)
 need(bytes.length===file.size&&await digest(bytes)===file.checksum,'Room original integrity check failed',503,'original_integrity')
 const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'}
 if(geometry){need(file.format==='glb'||file.format==='obj'||file.format==='ifc','Choose a GLB, OBJ or IFC model');return Response.json(roomGeometry(bytes,file.format),{headers})}
 return new Response(bytes,{headers:{...headers,'content-type':file.mime,'content-disposition':`${download?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,'content-security-policy':"sandbox; default-src 'none'; base-uri 'none'"}})
}
