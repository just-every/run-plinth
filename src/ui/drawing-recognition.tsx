import { useEffect, useRef, useState } from 'react'
import type { PlanSetView, PlanSheetView, PlanView } from '../plinth/plan-model'
import type { DrawingProposal, DrawingRegion } from '../plinth/drawing-review'
import { Action, api, Field, Form } from './shared'
import { recognizeDrawing, type Run } from './attachment-text'
import { openDrawing } from './takeoff-viewer'
const latest=(set:PlanSetView,sheet:string)=>set.drawing_review?.reviews.findLast(r=>r.sheet_id===sheet)
const file=(job:string,set:string,sheet:string)=>`/api/plinth/jobs/${job}/plans/${set}/files/${sheet}`
type Mutate=(path:string,body:Record<string,unknown>)=>Promise<any>
export function DrawingRecognition({data,set,sheet,mutate}:{data:PlanView;set:PlanSetView;sheet:PlanSheetView;mutate:Mutate}){
 const [draft,setDraft]=useState<{text:string;regions:DrawingRegion[];number:string;name:string}>(),[progress,setProgress]=useState(''),[error,setError]=useState(''),[running,setRunning]=useState(false),[query,setQuery]=useState(''),[hits,setHits]=useState<any[]>([]),[compared,setCompared]=useState('')
 const active=useRef<Run|undefined>(undefined)
 const release=()=>{const run=active.current;if(run){for(const dispose of run.cleanup.splice(0))dispose();active.current=undefined}}
 useEffect(()=>()=>{release()},[])
 const proposal=set.drawing_review?.proposals.findLast(p=>p.sheet_id===sheet.id),review=latest(set,sheet.id)
 const targets=data.sets.flatMap(s=>s.sheets.map(p=>({set:s,sheet:p,review:latest(s,p.id)}))).filter(t=>t.sheet.id!==sheet.id&&t.set.approved_by)
 const suggestions=targets.filter(t=>t.review&&review?.text.toLowerCase().includes(t.review.number.toLowerCase()))
 const comparisons=targets.filter(t=>t.sheet.number===sheet.number)
 return <section aria-label="Office drawing review"><h4>Office drawing review</h4><p>English recognition is an uncertain proposal. Correct the number, name and full text before adopting it. Approved sheet labels and original bytes stay unchanged. Reviews and detail links remain private to the office.</p>
  <Action action={async()=>{
   setRunning(true);setDraft(undefined);setError('')
   const controller=new AbortController(),run:Run={signal:controller.signal,progress:setProgress,cleanup:[()=>controller.abort()]};active.current=run
   try{const result=await recognizeDrawing(file(data.id,set.id,sheet.id),sheet.page,run);setDraft({...result,number:result.text.match(/\b[A-Z]{1,3}[-]?[A-Z0-9][A-Z0-9.-]*\b/i)?.[0]??sheet.number,name:result.text.split('\n').find(l=>l.trim())?.slice(0,200)??sheet.number});setProgress('Recognition ready for review.')}
   catch(e){setError(e instanceof Error?e.message:'Recognition failed.')}
   finally{release();setRunning(false)}
  }}>Recognize this source page</Action>
  {running&&<button type="button" onClick={release}>Stop recognition</button>}{progress&&<p role="status">{progress}</p>}{error&&<p role="alert">{error}</p>}
  {draft&&<Form key={sheet.id+draft.text} reset={false} submit="Save recognition proposal" action={async f=>{await mutate(`/${set.id}/recognition-propose`,{...draft,number:f.get('number'),name:f.get('name'),sheet_id:sheet.id,page:sheet.page,checksum:sheet.document.checksum});setDraft(undefined)}}>
   <Field label="Proposed sheet number" name="number" defaultValue={draft.number}/><Field label="Proposed sheet name" name="name" defaultValue={draft.name}/>
   <p>Unreviewed text</p><pre style={{whiteSpace:'pre-wrap',fontSize:13}}>{draft.text}</pre><Regions proposal={draft}/>
  </Form>}
  {proposal&&<article className="record" aria-label="Recognition proposal"><h4>Source proposal · page {proposal.page}</h4><p>Proposed {proposal.number} · {proposal.name}</p><Regions proposal={proposal}/>
   <Form key={proposal.id+review?.id} reset={false} submit="Adopt reviewed recognition" action={async f=>mutate(`/${set.id}/recognition-review`,{proposal_id:proposal.id,previous_review_id:review?.id??null,number:f.get('number'),name:f.get('name'),text:f.get('text'),confirm:f.get('confirm')==='on'})}>
    <Field label="Reviewed sheet number" name="number" defaultValue={review?.number??proposal.number}/><Field label="Reviewed sheet name" name="name" defaultValue={review?.name??proposal.name}/>
    <label>Reviewed drawing text<textarea name="text" required defaultValue={review?.text??proposal.text} rows={6}/></label>
    <label><input type="checkbox" name="confirm" required/> I checked the full text, name and number against this exact original page.</label>
   </Form>
  </article>}
  {review&&<article className="record" aria-label="Reviewed drawing text"><h4>Reviewed {review.number} · {review.name}</h4><p>Source {sheet.number} · revision {sheet.revision} · page {sheet.page} · Reviewed by {review.by.name}</p><p style={{whiteSpace:'pre-wrap'}}>{review.text}</p>
   <details><summary>Retained review history</summary>{set.drawing_review?.reviews.filter(r=>r.sheet_id===sheet.id).map(r=><p key={r.id}>{r.number} · {r.name} · {r.text} · {r.by.name}</p>)}</details>
   <h4>Reviewed detail links</h4>
   {(set.drawing_review?.links??[]).filter(l=>l.from_review===review.id).map(l=><p key={l.id}><Action action={async()=>{const target=await api(`/jobs/${data.id}/plans/${set.id}/links/${l.id}`);location.assign(target.href)}}>{l.label}</Action> · Source area {l.x}, {l.y}, {l.width} × {l.height}</p>)}
   {!!suggestions.length&&<p>Suggested references from reviewed text: {suggestions.map(t=>t.review!.number).join(', ')}. A reference becomes a link only after explicit review.</p>}
   <details><summary>Review a detail link</summary><Form reset={false} submit="Approve exact detail link" action={async f=>{const target=targets.find(t=>t.sheet.id===f.get('target'));if(!target?.review)throw new Error('Review the target sheet first.');await mutate(`/${set.id}/detail-link`,{from_review:review.id,to_set:target.set.id,to_review:target.review.id,label:f.get('label'),x:Number(f.get('x')),y:Number(f.get('y')),width:Number(f.get('width')),height:Number(f.get('height')),confirm:f.get('confirm')==='on'})}}>
    <label>Reviewed link target<select name="target" required defaultValue={suggestions[0]?.sheet.id??''}><option value="">Choose a reviewed source</option>{targets.filter(t=>t.review).map(t=><option key={t.sheet.id} value={t.sheet.id}>{t.review!.number} · revision {t.sheet.revision} · page {t.sheet.page}</option>)}</select></label>
    <Field label="Detail link label" name="label" defaultValue={suggestions[0]?'Open detail on '+suggestions[0].review!.number:''}/>
    {(['x','y','width','height'] as const).map(k=><Field key={k} label={'Detail area '+k} name={k} type="number" step="any" min={k==='width'||k==='height'?'.01':'0'} defaultValue={proposal?.regions[0]?.[k]??(k==='width'||k==='height'?20:0)}/>)}
    <label><input type="checkbox" name="confirm" required/> I checked this source region and the exact reviewed target sheet.</label>
   </Form></details>
  </article>}
  <Form reset={false} submit="Search reviewed drawings" action={async()=>{const result=await api(`/jobs/${data.id}/plans/review-search?`+new URLSearchParams({q:query}));setHits(result.results)}}><Field label="Reviewed text or annotation" name="q" value={query} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setQuery(e.target.value)}/></Form>
  <div aria-label="Reviewed drawing search results">{hits.map(hit=><p key={hit.review.id}><a href={hit.href}>{hit.review.number} · {hit.review.name} · revision {hit.revision}</a> · {hit.review.text}{hit.annotations.map((a:any)=><span key={a.id}> · {a.text}</span>)}</p>)}</div>
  {!!comparisons.length&&<><label>Compare exact revision<select aria-label="Compare exact revision" value={compared} onChange={e=>setCompared(e.target.value)}><option value="">Choose another revision</option>{comparisons.map(t=><option key={t.sheet.id} value={t.sheet.id}>{t.sheet.number} · revision {t.sheet.revision} · page {t.sheet.page}</option>)}</select></label>{comparisons.filter(t=>t.sheet.id===compared).map(t=><DrawingComparison key={sheet.id+t.sheet.id} job={data.id} from={{set,sheet}} to={t}/>)}</>}
 </section>
}
function Regions({proposal}:{proposal:Pick<DrawingProposal,'regions'>}){return <details><summary>Recognition coordinates and uncertainty</summary>{proposal.regions.map((r,i)=><p key={i}>{r.text} · confidence {Math.round(r.confidence)}% · PDF area {r.x}, {r.y}, {r.width} × {r.height}. Unverified.</p>)}</details>}
function DrawingComparison({job,from,to}:{job:string;from:{set:PlanSetView;sheet:PlanSheetView};to:{set:PlanSetView;sheet:PlanSheetView}}){
 const canvas=useRef<HTMLCanvasElement>(null),[result,setResult]=useState('Rendering exact revision overlay…'),[error,setError]=useState('')
 useEffect(()=>{
  let stopped=false;const documents:any[]=[],renders:any[]=[]
  const run=async()=>{
   if(from.sheet.width!==to.sheet.width||from.sheet.height!==to.sheet.height)throw new Error('Page sizes differ. Review the originals separately; automatic alignment is unavailable.')
   const scale=Math.min(2,1200/Math.max(from.sheet.width,from.sheet.height)),width=Math.ceil(from.sheet.width*scale),height=Math.ceil(from.sheet.height*scale),images=[]
   for(const source of [from,to]){
    const pdf=await openDrawing(file(job,source.set.id,source.sheet.id));documents.push(pdf);if(stopped)return
    const page=await pdf.getPage(source.sheet.page),scratch=document.createElement('canvas');scratch.width=width;scratch.height=height
    const context=scratch.getContext('2d')!;const render=page.render({canvas:scratch,canvasContext:context,viewport:page.getViewport({scale})});renders.push(render);await render.promise
    images.push(context.getImageData(0,0,width,height));scratch.width=0;scratch.height=0
   }
   if(stopped||!canvas.current)return
   const a=images[0]!,b=images[1]!,out=new ImageData(width,height);let changed=0,left=width,top=height,right=0,bottom=0
   for(let i=0;i<a.data.length;i+=4){const different=Math.abs(a.data[i]!-b.data[i]!)+Math.abs(a.data[i+1]!-b.data[i+1]!)+Math.abs(a.data[i+2]!-b.data[i+2]!)>100;const x=(i/4)%width,y=Math.floor(i/4/width);if(different){changed++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}out.data[i]=different?210:(a.data[i]!+b.data[i]!)/2;out.data[i+1]=different?40:(a.data[i+1]!+b.data[i+1]!)/2;out.data[i+2]=different?65:(a.data[i+2]!+b.data[i+2]!)/2;out.data[i+3]=255}
   canvas.current.width=width;canvas.current.height=height;canvas.current.getContext('2d')!.putImageData(out,0,0);canvas.current.dataset.changedPixels=String(changed)
   setResult(changed?`${changed} changed rendered pixels. Change area in source PDF coordinates: ${Math.floor(left/scale)}, ${Math.floor(top/scale)} to ${Math.ceil(right/scale)}, ${Math.ceil(bottom/scale)}. Red shows changed pixels; unchanged content is blended.`:'No rendered pixel changes at this comparison resolution.')
  }
  void run().catch(e=>{if(!stopped)setError(e.message)}).finally(()=>{for(const pdf of documents)void pdf.loadingTask.destroy()})
  return()=>{stopped=true;for(const render of renders)render.cancel();for(const pdf of documents)void pdf.loadingTask.destroy()}
 },[job,from.sheet.id,to.sheet.id])
 return <section aria-label="Exact revision comparison"><h4>{from.sheet.number} revision {from.sheet.revision} compared with {to.sheet.number} revision {to.sheet.revision}</h4><p>Exact pages {from.sheet.page} and {to.sheet.page}. Same-size pages aligned at the page origin; scanned registration differences also appear as changes.</p><details><summary>Exact comparison sources</summary>{[from,to].map(s=><p key={s.sheet.id}>{s.set.title} · {s.sheet.number} · {s.sheet.revision} · page {s.sheet.page} · checksum {s.sheet.document.checksum}</p>)}</details><p role={error?'alert':'status'}>{error||result}</p><canvas ref={canvas} aria-label="Rendered revision overlay and change area" style={{width:'100%',maxWidth:from.sheet.width,height:'auto'}}/></section>
}
