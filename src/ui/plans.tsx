import { DrawingRecognition } from './drawing-recognition'
import { useEffect, useState } from 'react'
import type { PlanSetView, PlanSheetView, PlanView } from '../plinth/plan-model'
import { planLink } from '../plinth/plan-model'
import { Action, api, Field, Form } from './shared'
import { openDrawing, TakeoffViewer } from './takeoff-viewer'
import { Page } from './shell'

const status=(set:PlanSetView,sheet:PlanSheetView)=>!set.approved_by?'Unapproved draft':sheet.current?'Latest approved':'Superseded history'
export function PlanWorkspace({jobId}:{jobId:string}){
 const [data,setData]=useState<PlanView>(),[error,setError]=useState(''),[selected,setSelected]=useState(''),[point,setPoint]=useState<{x:number;y:number}>()
 const refresh=()=>api(`/jobs/${jobId}/plans`).then(r=>{setData(r.plans);setError('')}).catch(e=>{setData(undefined);setError(e.message)})
 useEffect(()=>{setSelected(new URLSearchParams(window.location.search).get('plan_sheet')??'');setData(undefined);void refresh()},[jobId])
 useEffect(()=>setPoint(undefined),[data?.version,selected])
 const mutate=async(path:string,body:Record<string,unknown>={})=>{try{const r=await api(`/jobs/${jobId}/plans${path}`,{expected_version:data?.version,...body});setData(r.plans);return r} catch(e){await refresh();throw e}}
 if(!data)return <p role={error?'alert':'status'}>{error||'Opening plans…'}</p>
 const sources=data.sets.flatMap(set=>set.sheets.map(sheet=>({set,sheet}))),pinned=sources.find(s=>s.sheet.id===selected),current=pinned??sources.find(s=>s.sheet.current)??sources.at(-1)
 const pinnedMissing=!!selected&&!pinned
 return <section className="card" aria-label="Versioned plans"><h2>{data.name} · Plans and specifications</h2>
  <p>Approved originals and exact revision history. Notices appear in the recipient’s plan inbox; opening a drawing does not acknowledge it.</p>
  {pinnedMissing&&<p role="alert">This pinned sheet is unavailable for your current access. Choose an available revision.</p>}
  {!sources.length&&<p>No plan sets uploaded.</p>}
  {!!sources.length&&<label>Drawing revision<select aria-label="Drawing revision" value={current?.sheet.id??''} onChange={e=>{setSelected(e.target.value);const item=sources.find(s=>s.sheet.id===e.target.value)!;history.replaceState(null,'',planLink(jobId,item.set.id,item.sheet.id))}}>{sources.map(({set,sheet})=><option key={sheet.id} value={sheet.id}>{sheet.number} · {sheet.revision} · {set.title} · {status(set,sheet)}</option>)}</select></label>}
  {current&&!pinnedMissing&&<article className="record" aria-label="Selected drawing">
   <h3>{current.sheet.number} · revision {current.sheet.revision}</h3><span className="badge" style={{fontSize:13}}>{status(current.set,current.sheet)}</span>
   <p>{current.set.title} · {current.sheet.kind} · Issued {current.set.issue_on} · Page {current.sheet.page}</p>
   {current.sheet.superseded_by&&<p role="status">Superseded by revision {current.sheet.superseded_by.revision}. This link retains the original source.</p>}
   <p><a href={current.sheet.href}>Pinned link to this exact sheet</a> · <a href={`/api/plinth/jobs/${jobId}/plans/${current.set.id}/files/${current.sheet.id}`}>Download exact original</a></p>
   <TakeoffViewer links={data.review?(current.set.drawing_review?.links??[]).filter(l=>l.from_review===current.set.drawing_review?.reviews.findLast(r=>r.sheet_id===current.sheet.id)?.id).map(l=>({...l,href:`/api/plinth/jobs/${jobId}/plans/${current.set.id}/links/${l.id}?open=1`})) : []} jobId={jobId} sourceUrl={`/api/plinth/jobs/${jobId}/plans/${current.set.id}/files/${current.sheet.id}`} revision={{id:current.sheet.id,revision:data.sets.indexOf(current.set)+1,document:current.sheet.document,page:current.sheet.page,width:current.sheet.width,height:current.sheet.height,uploaded_by:current.set.prepared_by}} points={point?[point]:[]} mode="count" calibrations={[]} measurements={current.set.annotations.filter(a=>a.sheet_id===current.sheet.id).map(a=>({id:a.id,revision_id:current.sheet.id,kind:'count' as const,points:[{x:a.x,y:a.y}],name:'Annotation',dimension:'note',annotation:a.text,by:a.by}))} onPoint={setPoint} editable={data.annotate&&!!current.set.approved_by}/>
   {data.review&&current.set.approved_by&&<DrawingRecognition key={current.sheet.id} data={data} set={current.set} sheet={current.sheet} mutate={mutate}/>}
   <h4>Source revision annotations</h4>
   {current.set.annotations.filter(a=>a.sheet_id===current.sheet.id).map(a=><p key={a.id}>{a.text} · {current.sheet.number} · source revision {a.revision} · {a.by.name}</p>)}
   {!current.set.annotations.some(a=>a.sheet_id===current.sheet.id)&&<p>No annotations on this revision.</p>}
   {data.annotate&&current.set.approved_by&&<Form submit="Save source annotation" action={async f=>mutate(`/${current.set.id}/annotate`,{sheet_id:current.sheet.id,text:f.get('text'),x:Number(f.get('x')),y:Number(f.get('y'))})}><p>Choose a point on the drawing or enter its source PDF coordinates.</p><Field label="Annotation X" name="x" type="number" min="0" max={current.sheet.width} step="any" value={point?.x??''} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setPoint({x:Number(e.target.value),y:point?.y??0})}/><Field label="Annotation Y" name="y" type="number" min="0" max={current.sheet.height} step="any" value={point?.y??''} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setPoint({y:Number(e.target.value),x:point?.x??0})}/><Field label="Revision annotation" name="text"/></Form>}
  </article>}
  <h3>Plan sets and notices</h3>
  {data.sets.map(set=><article className="record" key={set.id}><h4>{set.title}</h4><p>Issued {set.issue_on} · {set.approved_by?'Approved by '+set.approved_by.name:'Awaiting approval'}</p>
   {set.sheets.map(sheet=><p key={sheet.id}><a href={sheet.href}>{sheet.number} · revision {sheet.revision}</a> · {status(set,sheet)}</p>)}
   {set.recipients.map(person=><p key={person.id}>Plan inbox notice for {person.name}: {person.acknowledged_by?'Acknowledged by '+person.acknowledged_by.name:'Awaiting acknowledgment'}</p>)}
   {set.recipients.some(r=>r.id===data.person_id&&!r.acknowledged_by)&&<Action action={()=>mutate(`/${set.id}/acknowledge`)}>Acknowledge {set.title}</Action>}
   {data.manage&&!set.approved_by&&<Form submit="Approve and notify recipients" action={async f=>mutate(`/${set.id}/approve`,{confirm:f.get('confirm')==='on',recipient_ids:f.getAll('recipient')})}>
    <fieldset><legend>Recipients with current job access</legend>{data.recipients.map(r=><label key={r.id}><input type="checkbox" name="recipient" value={r.id}/> {r.name}</label>)}</fieldset>
    <label><input type="checkbox" name="confirm" required/> I approve these exact sheets and notify the selected recipients in their plan inbox.</label>
   </Form>}
  </article>)}
  {data.manage&&<PlanUpload mutate={mutate}/>}
 </section>
}
function PlanUpload({mutate}:{mutate:(path:string,body:Record<string,unknown>)=>Promise<any>}){
 const [files,setFiles]=useState<File[]>([])
 return <details><summary>Upload a plan set</summary><Form reset={false} submit="Upload plan set" action={async f=>{
  const sheets=[]
  for(const [i,file] of files.entries()){
   const bytes=new Uint8Array(await file.arrayBuffer()),pdf=await openDrawing(bytes.slice())
   try{
    const page=Number(f.get('page'+i));if(page<1||page>pdf.numPages)throw new Error('Choose a page present in '+file.name)
    const viewport=(await pdf.getPage(page)).getViewport({scale:1});let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte)
    sheets.push({number:f.get('number'+i),revision:f.get('revision'+i),kind:f.get('kind'+i),page,width:viewport.width,height:viewport.height,document:{name:file.name,mime:'application/pdf',base64:btoa(raw)}})
   }finally{await pdf.loadingTask.destroy()}
  }
  await mutate('',{title:f.get('title'),issue_on:f.get('issue_on'),sheets})
 }}><Field label="Plan set title" name="title"/><Field label="Issue date" name="issue_on" type="date"/>
 <label>Original plan PDFs<input aria-label="Original plan PDFs" type="file" accept="application/pdf" multiple required onChange={e=>setFiles(Array.from(e.target.files??[]))}/></label>
 {files.map((file,i)=><fieldset key={file.name+i}><legend>{file.name}</legend><Field label={'Sheet number '+(i+1)} name={'number'+i}/><Field label={'Revision number '+(i+1)} name={'revision'+i}/><label>Document kind {i+1}<select aria-label={'Document kind '+(i+1)} name={'kind'+i}><option value="plan">Plan</option><option value="specification">Specification</option><option value="addendum">Addendum</option></select></label><Field label={'PDF page '+(i+1)} name={'page'+i} type="number" min="1" defaultValue="1"/></fieldset>)}
 </Form></details>
}
export function PlanInbox(){
 const [jobs,setJobs]=useState<{id:string;name:string}[]>([]),[error,setError]=useState('')
 const selected=new URLSearchParams(location.search).get('plan_job')
 useEffect(()=>{api('/plan-inbox').then(r=>setJobs(r.jobs)).catch(e=>setError(e.message))},[])
 return <Page title="Plan inbox" lead="Current approved drawings, original revisions and notices for your current job access.">{error&&<p role="alert">{error}</p>}{!jobs.length&&!error&&<p>No distributed plans available.</p>}{selected&&!jobs.some(j=>j.id===selected)&&<p role="alert">This plan job is unavailable for your current access.</p>}{jobs.filter(j=>!selected||j.id===selected).map(job=><PlanWorkspace key={job.id} jobId={job.id}/>)}</Page>
}
