import { requireOwner } from './auth'
import { digest, fromBase64 } from './attachments'
import { find, need, object, recordApproval, stamp, text, type Actor, type Attachment, type Input, type Job } from './model'
import { productSource, productStatus } from './product-source'
import { selectionAction } from './selections'
import { insideRoom, layoutMeasures, layoutOpenings, layoutPoints, metres, placementCorners, type LayoutPlacement, type LayoutRevision, type RoomLayout } from './room-layout-model'
import { layoutPdf } from './room-layout-pdf'
import { jobOf, readClock, saveJob } from './store'
import type { Bindings } from '../auth.server'
import type { TakeoffMeasurement } from './takeoff-model'

const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const all=(job:Job)=>job.room_layouts??=[]
function revision(job:Job,actor:Actor,input:Input,number:number):LayoutRevision{
 const points=layoutPoints(input),openings=layoutOpenings(input.openings??[],points)
 need(Array.isArray(input.placements)&&input.placements.length<=100,'Provide at most 100 fixture placements')
 const placements:LayoutPlacement[]=input.placements.map(raw=>{const p=object(raw);need(p.rotation===0||p.rotation===90,'Rotation must be zero or 90 degrees');const row:LayoutPlacement={id:text(p.id,'Placement label',80),name:text(p.name,'Fixture name',160),x:metres(p.x,'Placement X',true),y:metres(p.y,'Placement Y',true),width:metres(p.width,'Fixture width'),depth:metres(p.depth,'Fixture depth'),rotation:p.rotation,product_source:productSource(job,p.product_id,p.product_revision_id)}
  const corners=placementCorners(row);need(corners.every(c=>insideRoom(c,points))&&corners.every((c,i)=>{const b=corners[(i+1)%4]!;return insideRoom({x:(c.x+b.x)/2,y:(c.y+b.y)/2},points)}),'Fixture footprint must lie inside the measured room')
  if(p.selection){const s=object(p.selection),selection=find(job.selections??[],String(s.id)),r=find(selection.revisions,String(s.revision_id)),o=find(r.options,String(s.option_id));need(o.product_source?.product_id===row.product_source.product_id&&o.product_source.id===row.product_source.id,'The placement must match its exact selection product source');row.selection={id:selection.id,revision_id:r.id,option_id:o.id}}
  return row})
 need(new Set(placements.map(p=>p.id)).size===placements.length,'Placement labels must be unique')
 need(input.reconstructed===true,'Confirm manual reconstruction and site measurements; an imported image supplies no geometry')
 return {id:crypto.randomUUID(),revision:number,points,openings,placements,reconstructed:true,reason:text(input.reason,'Revision reason',1000),by:stamp(actor)}
}
function draftComparison(job:Job,layout:RoomLayout,r:LayoutRevision){
 const previous=layout.revisions[layout.revisions.indexOf(r)-1],before=previous?layoutMeasures(previous):null,after=layoutMeasures(r)
 return {before,after,area_change_m2:after.area_m2-(before?.area_m2??0),wall_changes:after.walls.map(w=>({wall:w.wall,before:before?.walls[w.wall]?.length_m??null,after:w.length_m,net_run_m:w.net_run_m})),openings:{before:previous?.openings??[],after:r.openings},placements:{before:previous?.placements??[],after:r.placements},selection_changes:r.placements.filter(p=>p.selection).map(p=>{const s=find(job.selections??[],p.selection!.id),source=find(s.revisions,p.selection!.revision_id);return {placement:p.id,selection_id:s.id,source_revision:source.revision,source_status:source.status,proposed_product:p.product_source.name,proposed_draft:'Separate draft selection; original signature and specification retained'}}),source_notices:r.placements.flatMap(p=>productStatus(job,p.product_source).map(n=>`${p.name}: ${n}`)),accepted_estimate_unchanged:true,professional_release:false}
}
async function preview(job:Job,layout:RoomLayout,r:LayoutRevision){const comparison=draftComparison(job,layout,r);return {comparison,digest:await digest(new TextEncoder().encode(JSON.stringify([job.id,job.version,layout.id,r,comparison])))}}
async function adopt(db:D1Database,job:Job,actor:Actor,layout:RoomLayout,r:LayoutRevision,input:Input){
 need(r===layout.revisions.at(-1),'Review the latest layout revision',409,'layout_stale')
 need(!layout.adoptions.some(a=>a.revision_id===r.id),'This layout revision was already adopted',409,'layout_replay')
 const check=await preview(job,layout,r);need(input.confirm===true&&input.digest===check.digest,'The layout or source changed; compare again before adoption',409,'layout_stale')
 for(const p of r.placements){need(!productStatus(job,p.product_source).length,'Review current supplier evidence before adopting this layout',409,'layout_source');if(p.selection){const s=find(job.selections??[],p.selection.id);need(s.revisions.at(-1)?.id===p.selection.revision_id,'Selection source changed; revise the layout before adoption',409,'layout_source')}}
 const bytes=layoutPdf(layout.name,r),document:Attachment={id:crypto.randomUUID(),name:'reviewed-room-layout.pdf',mime:'application/pdf',size:bytes.length,checksum:await digest(bytes)},drawing={id:crypto.randomUUID(),revision:1,document,page:1,width:612,height:792,uploaded_by:stamp(actor)}
 const minX=Math.min(...r.points.map(p=>p.x)),minY=Math.min(...r.points.map(p=>p.y)),w=Math.max(...r.points.map(p=>p.x))-minX,h=Math.max(...r.points.map(p=>p.y))-minY,scale=Math.min(440/Math.max(w,1),440/Math.max(h,1)),map=(p:{x:number;y:number})=>({x:80+(p.x-minX)*scale,y:172+(p.y-minY)*scale})
 const calibration={id:crypto.randomUUID(),revision_id:drawing.id,points:[map({x:minX,y:minY}),map({x:minX+1,y:minY})],length:'1',unit:'m' as const,by:stamp(actor)}
 const measurements:TakeoffMeasurement[]=[{id:crypto.randomUUID(),revision_id:drawing.id,calibration_id:calibration.id,kind:'area',points:r.points.map(map),name:'Reviewed room floor',dimension:'floor',annotation:`Manually reconstructed layout revision ${r.revision}; draft takeoff only`,by:stamp(actor)}]
 for(const [i,a] of r.points.entries()){const b=r.points[(i+1)%r.points.length]!,length=Math.hypot(b.x-a.x,b.y-a.y),wall:TakeoffMeasurement={id:crypto.randomUUID(),revision_id:drawing.id,calibration_id:calibration.id,kind:'length',points:[map(a),map(b)],name:`Wall ${i+1} run`,dimension:'walls',annotation:'Reviewed wall run; opening widths deducted separately',by:stamp(actor)};measurements.push(wall);for(const o of r.openings.filter(o=>o.wall===i)){measurements.push({...wall,id:crypto.randomUUID(),name:o.id,points:[map({x:a.x+(b.x-a.x)*o.offset/length,y:a.y+(b.y-a.y)*o.offset/length}),map({x:a.x+(b.x-a.x)*(o.offset+o.width)/length,y:a.y+(b.y-a.y)*(o.offset+o.width)/length})],deduct_from:wall.id,annotation:`${o.kind} ${o.width} m wide and ${o.height} m high`})}}
 if(r.placements.length)measurements.push({id:crypto.randomUUID(),revision_id:drawing.id,kind:'count',points:r.placements.map(map),name:'Sourced fixture placements',dimension:'fixtures',annotation:'Exact supplier snapshots remain in the layout revision',by:stamp(actor)})
 const sheet={id:crypto.randomUUID(),name:`${layout.name} layout ${r.revision}`,revisions:[drawing],calibrations:[calibration],measurements}
 ;(job.takeoff??=[]).push(sheet)
 const selection_ids:string[]=[]
 for(const p of r.placements.filter(p=>p.selection)){const source=find(find(job.selections??[],p.selection!.id).revisions,p.selection!.revision_id),option=find(source.options,p.selection!.option_id);const draft=selectionAction(job,actor,{room:source.room,category:`${source.category} - layout ${r.revision} draft`,allowance_cents:source.allowance_cents,cost_code:source.cost_code,decision_on:source.decision_on,lead_days:source.lead_days,options:[{...option,product_id:p.product_source.product_id,product_revision_id:p.product_source.id}]});selection_ids.push(draft.id)}
 const adoption={revision_id:r.id,digest:check.digest,sheet_id:sheet.id,selection_ids,by:stamp(actor)};layout.adoptions.push(adoption);recordApproval(job,actor,'room-layout.adopt',{id:r.id,revision:r.revision,prepared_by:r.by},{layout_id:layout.id,...adoption,comparison:check.comparison})
 return [db.prepare('INSERT INTO pl_attachments(id,job_id,entry_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?,?)').bind(document.id,job.id,drawing.id,document.name,document.mime,document.checksum,document.size,bytes.buffer)]
}
export async function roomLayoutResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>){
 if(parts[0]!=='jobs'||parts[2]!=='room-layouts')return null
 requireOwner(actor);need(!actor.agent_door,'A signed-in owner must review layouts',403,'human_required')
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,parts[1]!)
 if(request.method==='GET'){
  if(parts.length===3)return Response.json({version:previous.version,layouts:all(previous),products:previous.products??[],selections:previous.selections??[]},{headers})
  const layout=find(all(previous),parts[3]!)
  if(parts.length===6&&parts[4]==='files'){const metadata=find(layout.underlays.map(u=>u.document),parts[5]!),stored=await env.DB.prepare('SELECT bytes FROM pl_attachments WHERE id=? AND job_id=? AND entry_id=?').bind(metadata.id,previous.id,layout.id).first<{bytes:ArrayBuffer}>();need(stored&&await digest(new Uint8Array(stored.bytes))===metadata.checksum,'Historical underlay is unavailable',503,'layout_file');return new Response(new Uint8Array(stored.bytes),{headers:{...headers,'content-type':metadata.mime,'content-disposition':`inline; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,'content-security-policy':"sandbox; default-src 'none'"}})}
  need(parts.length===6,'Unknown layout route',404,'not_found');const r=find(layout.revisions,parts[4]!);if(parts[5]==='model.json')return Response.json({format:'plinth-room-layout-1',unit:'m',name:layout.name,geometry:{points:r.points,openings:r.openings,placements:r.placements.map(p=>({...p,product_id:p.product_source.product_id,product_revision_id:p.product_source.id}))},revision:r,measures:layoutMeasures(r)},{headers:{...headers,'content-disposition':'attachment; filename=room-layout.json'}})
  need(parts[5]==='drawing.pdf','Unknown layout export',404,'not_found');return new Response(layoutPdf(layout.name,r),{headers:{...headers,'content-type':'application/pdf','content-disposition':'attachment; filename=room-layout.pdf'}})
 }
 need(request.method==='POST','Method not allowed',405,'method_not_allowed');const input=await body(request);need(input.expected_version===previous.version,'Job changed; reload before editing the layout',409,'stale_version')
 const job=structuredClone(previous);let layout:RoomLayout;let writes:D1PreparedStatement[]=[]
 if(parts.length===3){need(all(job).length<50,'A job supports 50 room layouts');layout={id:crypto.randomUUID(),name:text(input.name,'Room name',160),underlays:[],revisions:[],adoptions:[]};all(job).push(layout);if(input.points)layout.revisions.push(revision(job,actor,input,1))}
 else{need(parts.length===5,'Unknown layout action',404,'not_found');layout=find(all(job),parts[3]!)
  if(parts[4]==='underlay'){const raw=object(input.document),bytes=fromBase64(raw.base64),prefix=new TextDecoder().decode(bytes.slice(0,5)),mime=prefix==='%PDF-'?'application/pdf':bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null;need(mime&&raw.mime===mime,'Import an original PDF, PNG or JPEG');need(layout.underlays.length<30,'A room supports 30 historical underlays');const name=text(raw.name,'Underlay filename',240);need(!/[\x00-\x1f/\\]/.test(name),'Invalid filename');const document={id:crypto.randomUUID(),name,mime,size:bytes.length,checksum:await digest(bytes)};layout.underlays.push({document,by:stamp(actor)});writes=[env.DB.prepare('INSERT INTO pl_attachments(id,job_id,entry_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?,?)').bind(document.id,job.id,layout.id,name,mime,document.checksum,document.size,bytes.buffer)]}
  else if(parts[4]==='revise'||parts[4]==='import'){need(input.base_revision_id===(layout.revisions.at(-1)?.id??null),'Layout changed; reload before revising',409,'layout_stale');need(layout.revisions.length<200,'A room supports 200 revisions');let source=input;if(parts[4]==='import'){const model=object(input.model);need(model.format==='plinth-room-layout-1'&&model.unit==='m','Choose portable Plinth geometry in metres');source={...object(model.geometry),unit:'m',reason:input.reason,reconstructed:input.reconstructed}}layout.revisions.push(revision(job,actor,source,layout.revisions.length+1))}
  else{const r=find(layout.revisions,String(input.revision_id));if(parts[4]==='preview')return Response.json(await preview(previous,find(all(previous),layout.id),find(find(all(previous),layout.id).revisions,r.id)),{headers});need(parts[4]==='adopt','Unknown layout action',404,'not_found');writes=await adopt(env.DB,job,actor,layout,r,input)}
 }
 await saveJob(env.DB,actor,previous,job,writes,clock)
 return Response.json({version:job.version,record:layout},{headers})
}
