import { useEffect, useRef, useState } from 'react'
import type { Job } from '../plinth/model'
import type { RoomBoard, RoomFile, RoomRevision } from '../plinth/room-boards'
import type { JobProps } from './job'
import { Field, Form, money } from './shared'
import { openDrawing } from './takeoff-viewer'
import { RoomModelViewer } from './room-model-viewer'
import './room-boards.css'
const originalUrl=(jobId:string,id:string)=>`/api/plinth/jobs/${jobId}/room-boards/files/${id}`
async function uploads(form:FormData){const result=[];for(const entry of form.getAll('files')){if(!(entry instanceof File)||!entry.size)continue;if(entry.size>2097152)throw Error('Each original must be at most 2 MB');const data=new Uint8Array(await entry.arrayBuffer());let raw='';for(const n of data)raw+=String.fromCharCode(n);result.push({name:entry.name,base64:btoa(raw)})}return result}
function Measurements({revision}:{revision?:RoomRevision}){return <div className="room-fields"><Field label="Room length" name="length" defaultValue={revision?.measurements.length} inputMode="decimal"/><Field label="Room width" name="width" defaultValue={revision?.measurements.width} inputMode="decimal"/><Field label="Room height" name="height" defaultValue={revision?.measurements.height} inputMode="decimal"/><label>Measurement unit<select aria-label="Measurement unit" name="unit" defaultValue={revision?.measurements.unit??'ft'}><option value="ft">Feet</option><option value="m">Meters</option></select></label></div>}
const measurements=(f:FormData)=>({length:f.get('length'),width:f.get('width'),height:f.get('height'),unit:f.get('unit')})
function Sources({job,revision}:{job:Job;revision?:RoomRevision}){
 return <><label>Reviewed product revision<select aria-label="Reviewed product revision" name="product" defaultValue={revision?.products[0]?revision.products[0].product_id+':'+revision.products[0].id:''}><option value="">No product link</option>{job.products?.flatMap(p=>p.revisions.filter(r=>r.reviewed_by).map(r=><option key={r.id} value={p.id+':'+r.id}>{r.name} · capture {r.revision} · {money(r.cost_quote_cents)}</option>))}</select></label>
 <label>Exact selection revision<select aria-label="Exact selection revision" name="selection" defaultValue={revision?.selections[0]?revision.selections[0].selection_id+':'+revision.selections[0].revision_id:''}><option value="">No selection link</option>{job.selections?.flatMap(s=>s.revisions.map(r=><option key={r.id} value={s.id+':'+r.id}>{r.room} · {r.category} · revision {r.revision} · {r.status}</option>))}</select></label></>
}
function sourceInput(f:FormData){const product=String(f.get('product')??'').split(':'),selection=String(f.get('selection')??'').split(':');return {products:product[0]?[{product_id:product[0],revision_id:product[1]}]:[],selections:selection[0]?[{selection_id:selection[0],revision_id:selection[1]}]:[]}}
function Original({jobId,file,annotations}:{jobId:string;file:RoomFile;annotations:RoomRevision['annotations']}){
 const canvas=useRef<HTMLCanvasElement>(null),[page,setPage]=useState(1),[pages,setPages]=useState(1),[error,setError]=useState(''),[ready,setReady]=useState(false)
 const url=originalUrl(jobId,file.id)
 useEffect(()=>{if(file.format!=='pdf')return;let disposed=false,loaded:Awaited<ReturnType<typeof openDrawing>>|undefined,task:any;setReady(false);setError('')
  void openDrawing(url).then(async pdf=>{loaded=pdf;if(disposed)return;setPages(pdf.numPages);const sheet=await pdf.getPage(page);if(disposed||!canvas.current)return;const view=sheet.getViewport({scale:1.4});canvas.current.width=view.width;canvas.current.height=view.height;task=sheet.render({canvas:canvas.current,canvasContext:canvas.current.getContext('2d')!,viewport:view});await task.promise;if(!disposed)setReady(true)}).catch(e=>{if(!disposed)setError(e.message)})
  return()=>{disposed=true;task?.cancel();void loaded?.loadingTask.destroy()}
 },[url,page,file.format])
 if(file.format==='glb'||file.format==='obj')return <RoomModelViewer url={url+'/geometry'} name={file.name}/>
 return <section aria-label={'Original viewer '+file.name}>
  {file.format==='pdf'&&<label>PDF page<input type="number" min="1" max={pages} value={page} onChange={e=>setPage(Math.max(1,Math.min(pages,Number(e.target.value)||1)))}/></label>}
  {error&&<p role="alert">{error}. Download the retained original to inspect it.</p>}
  <div className="room-original">{file.format==='pdf'?<canvas ref={canvas} aria-label={'PDF original '+file.name}/>:<img src={url} alt={'Finish original '+file.name} onLoad={()=>setReady(true)} onError={()=>setError('Image could not be decoded')}/>}
   {annotations.filter(a=>a.file_id===file.id&&a.page===page).map((a,i)=><span key={i} className="room-marker" style={{left:a.x+'%',top:a.y+'%'}} aria-label={'Finish marker '+(i+1)}>{i+1}</span>)}
  </div>
  {ready&&<p role="status">Original opened: {file.name}{file.format==='pdf'?' · page '+page+' of '+pages:''}</p>}
 </section>
}
function Board({board,job,mutate}:{board:RoomBoard;job:Job;mutate:JobProps['mutate']}){
 const latest=board.revisions.at(-1)!,params=new URLSearchParams(window.location.search),[selected,setSelected]=useState(params.get('board')===board.id?params.get('revision')||latest.id:latest.id),[opened,setOpened]=useState('')
 const r=board.revisions.find(r=>r.id===selected)??latest,save=(body:Record<string,unknown>)=>mutate(`/room-boards/${board.id}/revise`,{title:latest.title,measurements:latest.measurements,base_revision_id:latest.id,...body})
 return <article className="record room-board" aria-label={latest.title}>
  <h3>{latest.title}</h3><label>Board revision<select aria-label="Board revision" value={r.id} onChange={e=>{setSelected(e.target.value);setOpened('')}}>{board.revisions.map(r=><option key={r.id} value={r.id}>Revision {r.revision} · {r.title}</option>)}</select></label>
  <p>Revision {r.revision} · {r.by.name} · {new Date(r.by.at).toLocaleString()}</p><p>Measurements: {r.measurements.length} × {r.measurements.width} × {r.measurements.height} {r.measurements.unit}</p>
  <a href={`/app?job=${job.id}&tab=Room+boards&board=${board.id}&revision=${r.id}`}>Open this room revision on another device</a>
  <p>Private owner board. Signed selections and construction scope are separate approvals.</p>
  {r.products.map(p=><p key={p.id}>Pinned product: {p.name} · SKU {p.sku} · capture {p.revision} · supplier cost {money(p.cost_quote_cents)} · {p.dimensions}</p>)}
  {r.selections.map(s=><section key={s.revision_id} aria-label={'Pinned selection '+s.category}><h4>{s.room} · {s.category} · selection revision {s.value.revision}</h4><p>Cost code {s.value.cost_code} · {s.value.status}</p>{s.value.signature?<p>Signed specification: {s.value.signature.option.name} · {s.value.signature.option.specifications} · client price {money(s.value.signature.option.price_cents)} · {s.value.signature.by.name}</p>:s.value.options.map(o=><p key={o.id}>{o.name} · {o.specifications} · client price {money(o.price_cents)}</p>)}</section>)}
  <ul>{r.files.map(file=><li key={file.id}><button type="button" className="secondary" onClick={()=>setOpened(file.id)}>Open {file.name}</button> <a href={originalUrl(job.id,file.id)+'?download=1'}>Download original {file.name}</a> · {file.size} bytes{file.model_status&&<p>{file.model_status}</p>}</li>)}</ul>
  {r.files.filter(f=>f.id===opened).map(file=><Original key={file.id} jobId={job.id} file={file} annotations={r.annotations}/>)}
  <ol>{r.annotations.map((a,i)=><li key={i}>{a.text} · {r.files.find(f=>f.id===a.file_id)?.name}, page {a.page} · {a.x}%, {a.y}%</li>)}</ol>
  {r.id===latest.id&&<>
   <details><summary>Annotate a finish</summary><Form submit="Save finish revision" action={async f=>{const result=await save({annotations:[...latest.annotations,{file_id:f.get('file_id'),page:Number(f.get('page')),x:Number(f.get('x')),y:Number(f.get('y')),text:f.get('annotation')}]});setSelected(result.record.revisions.at(-1).id)}}>
    <label>Finish original<select aria-label="Finish original" name="file_id">{latest.files.filter(f=>['pdf','png','jpeg'].includes(f.format)).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    <div className="room-fields"><Field label="Original page" name="page" type="number" min="1" defaultValue="1"/><Field label="Horizontal percent" name="x" type="number" min="0" max="100" defaultValue="50"/><Field label="Vertical percent" name="y" type="number" min="0" max="100" defaultValue="50"/></div><Field label="Finish annotation" name="annotation"/>
   </Form></details>
   <details><summary>Revise this room board</summary><Form submit="Save room revision" reset={false} action={async f=>{const result=await save({title:f.get('title'),measurements:measurements(f),files:await uploads(f),...sourceInput(f)});setSelected(result.record.revisions.at(-1).id)}}>
    <Field label="Room name" name="title" defaultValue={latest.title}/><Measurements revision={latest}/><Sources job={job} revision={latest}/><label>Additional room originals<input type="file" name="files" multiple accept=".pdf,.png,.jpg,.jpeg,.glb,.obj"/></label>
   </Form></details>
  </>}
 </article>
}
export function RoomBoards({job,mutate}:Pick<JobProps,'job'|'mutate'>){return <section className="room-boards" aria-label="Room boards"><h2>Room boards</h2><p>Keep measured rooms, finish originals and static geometry beside exact product and selection revisions. Up to 2 MB per original; 12000 vertices and triangles per model. IFC, animation, textured rendering and external design-tool exchange are unsupported.</p>
 <details><summary>Create a room board</summary><Form submit="Create room board" action={async f=>mutate('/room-boards',{title:f.get('title'),measurements:measurements(f),files:await uploads(f),...sourceInput(f)})}>
  <Field label="Room name" name="title"/><Measurements/><Sources job={job}/><label>Room originals<input type="file" name="files" required multiple accept=".pdf,.png,.jpg,.jpeg,.glb,.obj"/></label>
 </Form></details>
 {job.room_boards?.map(board=><Board key={board.id} board={board} job={job} mutate={mutate}/>)}
</section>}
