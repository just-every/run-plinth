import { useEffect, useState } from 'react'
import type { DailyLog, DailyLogView, DailyRevision, DailyWeather } from '../plinth/daily-logs-model'
import type { JobProps } from './job'
import { api, Action, Field, Form } from './shared'

export function WeatherSource({weather}:{weather:DailyWeather}) {
 return <div className="notice"><p>{weather.source} · {weather.site || 'Site not named'} · {weather.date}{weather.station?' · Station '+weather.station:''}</p>
  {weather.status==='unavailable'?<p>Weather unavailable: {weather.reason}</p>:<ul>{weather.observations.map((o,i)=><li key={i}>{o.at} · {o.description || 'Description unavailable'} · {o.temperature_c===null?'Temperature unavailable':o.temperature_c+' °C'}</li>)}</ul>}
  {weather.url&&<a href={weather.url} target="_blank" rel="noreferrer">NWS observation source</a>}
 </div>
}
export function DailyRecords({job,refresh}:Pick<JobProps,'job'|'refresh'>) {
 const [data,setData]=useState<DailyLogView>(),[error,setError]=useState(''),[date,setDate]=useState(''),[weather,setWeather]=useState<DailyWeather>()
 const root='/jobs/'+job.id+'/daily-logs'
 const load=async()=>{const result=await api(root);setData(result);setError('')}
 useEffect(()=>{void load().catch(e=>setError(e.message))},[job.id,job.version])
 const mutate=async(path:string,body:Record<string,unknown>)=>{
  try{const result=await api(root+path,{expected_version:data?.version,...body});setData(result.daily_logs);await refresh()}
  catch(e){await load();await refresh();throw e}
 }
 if(!data)return <p role={error?'alert':'status'}>{error||'Opening private daily records…'}</p>
 return <section className="card" aria-label="Private daily records">
  <h2>Private daily records</h2><p>Crew and office only. Reviewing quantities prepares production inputs; it records no time, payroll, actual cost or promised schedule date.</p>
  {data.configure&&<details><summary>Daily weather Settings</summary><Form submit="Save weather site" reset={false} action={f=>mutate('/settings',{latitude:Number(f.get('latitude')),longitude:Number(f.get('longitude')),site:f.get('site')})}>
   <Field label="Named weather site" name="site" defaultValue={data.settings?.label??job.address}/>
   <div className="fields"><Field label="Site latitude" name="latitude" type="number" step="any" min="-90" max="90" defaultValue={data.settings?.latitude}/><Field label="Site longitude" name="longitude" type="number" step="any" min="-180" max="180" defaultValue={data.settings?.longitude}/></div>
  </Form></details>}
  {data.write&&<details><summary>Record a private crew day</summary>
   <Field label="Weather preview date" name="weather_date" type="date" value={date} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>{setDate(e.target.value);setWeather(undefined)}}/>
   <Action action={async()=>{const result=await api(root+'/weather?'+new URLSearchParams({date}));setWeather(result.weather)}}>Preview NWS weather</Action>
   {weather&&<WeatherSource weather={weather}/>}
   <Form key={data.logs.length} submit="Save private daily record" action={async f=>{
    const attachments=[]
    for(const file of f.getAll('media'))if(file instanceof File&&file.size){if(file.size>6_291_456)throw Error('Choose each MP4 up to 6 MB, or each photo up to 2 MB.');const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]!);reader.onerror=reject;reader.readAsDataURL(file)});attachments.push({name:file.name,mime:file.type,base64})}
    await mutate('',{...fields(f),date:f.get('date'),attachments})
   }}><Field label="Private log date" name="date" type="date" defaultValue={date}/><DailyFields data={data}/><label>Original photos and MP4 video<input name="media" type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4" multiple/></label><p>Up to five originals, 8 MB total. Photos up to 2 MB each; MP4 video up to 6 MB each.</p></Form>
  </details>}
  {!data.logs.length&&<p>No private records yet.</p>}
  {[...data.logs].reverse().map(row=><DailyRecord key={row.id} row={row} data={data} jobId={job.id} mutate={mutate}/>)}
  <ProductionRows data={data}/>
 </section>
}
const fields=(f:FormData)=>({work:f.get('work'),delays:f.get('delays'),equipment:f.get('equipment'),deliveries:f.get('deliveries'),weather_correction:f.get('weather_correction'),headcounts:f.getAll('trade').map((trade,i)=>({trade,count:Number(f.getAll('count')[i])})),quantities:f.getAll('task_id').map((task_id,i)=>({task_id,cost_code:f.getAll('cost_code')[i],quantity:f.getAll('quantity')[i],unit:f.getAll('unit')[i]}))})
function DailyFields({data,initial}:{data:DailyLogView;initial?:DailyRevision}) {
 const [heads,setHeads]=useState(initial?.headcounts??[{trade:'',count:0}]),[quantities,setQuantities]=useState(initial?.quantities??[])
 return <><label>Work performed<textarea name="work" rows={3} required defaultValue={initial?.work}/></label>
  {heads.map((h,i)=><div className="fields" key={i}><Field label={'Crew or trade '+(i+1)} name="trade" defaultValue={h.trade}/><Field label={'Headcount '+(i+1)} name="count" type="number" min="0" step="1" defaultValue={h.count}/></div>)}
  <button type="button" onClick={()=>setHeads([...heads,{trade:'',count:0}])}>Add crew headcount</button>
  {quantities.map((q,i)=><div className="record" key={i}><label>Production task<select name="task_id" defaultValue={q.task_id} required><option value="">Choose an existing task</option>{data.tasks.map(t=><option key={t.id} value={t.id}>{t.description}</option>)}</select></label><label>Production cost code<select name="cost_code" defaultValue={q.cost_code} required><option value="">Choose an existing code</option>{data.cost_codes.map(c=><option key={c}>{c}</option>)}</select></label><div className="fields"><Field label="Installed quantity" name="quantity" inputMode="decimal" defaultValue={q.quantity}/><Field label="Quantity unit" name="unit" defaultValue={q.unit}/></div><button type="button" onClick={()=>setQuantities(quantities.filter((_,at)=>at!==i))}>Remove this quantity</button></div>)}
  <button type="button" onClick={()=>setQuantities([...quantities,{id:'',task_id:'',task_revision:0,task:'',cost_code:'',quantity:'',unit:''}])}>Add production quantity</button>
  <label>Delays<textarea name="delays" defaultValue={initial?.delays}/></label><label>Equipment<textarea name="equipment" defaultValue={initial?.equipment}/></label><label>Deliveries<textarea name="deliveries" defaultValue={initial?.deliveries}/></label><label>Observed weather correction<textarea name="weather_correction" defaultValue={initial?.weather_correction}/></label>
 </>
}
type Mutate=(path:string,body:Record<string,unknown>)=>Promise<void>
function DailyRecord({row,data,jobId,mutate}:{row:DailyLog;data:DailyLogView;jobId:string;mutate:Mutate}) {
 const current=row.revisions.at(-1)!,call=(action:string,body:Record<string,unknown>)=>mutate('/'+row.id+'/'+action,{revision_id:current.id,...body})
 return <article className="record" aria-label={'Private daily record '+row.date}>
  <h3>{row.date} · {row.site || 'Job site'}</h3><WeatherSource weather={row.weather}/>
  {row.revisions.map(revision=><section key={revision.id} aria-label={'Daily revision '+revision.revision}><h4>Revision {revision.revision} · {revision.id===current.id?'Current':'Retained history'}</h4>
   <p>{revision.review?'Reviewed by '+revision.review.by.name:'Awaiting manager review'} · {revision.by.name} · {revision.by.at}</p>
   {revision.reason&&<p>Correction reason: {revision.reason}</p>}<p className="pre-wrap">{revision.work}</p>
   <ul>{revision.headcounts.map((h,i)=><li key={i}>{h.trade}: {h.count} people</li>)}</ul>
   <p>Delays: {revision.delays||'None recorded'}</p><p>Equipment: {revision.equipment||'None recorded'}</p><p>Deliveries: {revision.deliveries||'None recorded'}</p>
   <p>Human weather correction: {revision.weather_correction||'None recorded; original source retained above'}</p>
   <ul>{revision.quantities.map(q=><li key={q.id}>{q.task} · {q.cost_code} · {q.quantity} {q.unit}</li>)}</ul>
   {row.annotations.filter(a=>a.revision_id===revision.id).map(a=><p key={a.id}>Photo annotation: {a.text} · {row.attachments.find(f=>f.id===a.file_id)?.name} · {a.x}%, {a.y}% · {a.by.name}</p>)}
  </section>)}
  <div className="photos">{row.attachments.map(file=>{const url=`/api/plinth/jobs/${jobId}/daily-logs/${row.id}/files/${file.id}`;return <figure key={file.id} style={{margin:0,minWidth:0}}>{file.mime==='video/mp4'?<video src={url} controls preload="metadata" style={{maxWidth:'100%'}}/>:<img src={url} alt={file.name}/>}<figcaption style={{overflowWrap:'anywhere'}}><a href={url}>Download original: {file.name}</a><p>{file.size} bytes · SHA-256 {file.checksum}</p></figcaption></figure>})}</div>
  <h4>Internal comments</h4>{row.comments.map(c=><p key={c.id}>{c.text} · {c.by.name} · {c.by.at}</p>)}
  {data.write&&<><Form submit="Add internal comment" action={f=>call('comment',{text:f.get('text')})}><Field label="Internal comment" name="text"/></Form>
   {row.attachments.some(f=>f.mime.startsWith('image/'))&&<details><summary>Annotate current photo revision</summary><Form submit="Save photo annotation" action={f=>call('annotate',{file_id:f.get('file_id'),x:Number(f.get('x')),y:Number(f.get('y')),text:f.get('text')})}>
    <label>Original photo<select name="file_id">{row.attachments.filter(f=>f.mime.startsWith('image/')).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><div className="fields"><Field label="Photo horizontal percent" name="x" type="number" min="0" max="100" defaultValue="50"/><Field label="Photo vertical percent" name="y" type="number" min="0" max="100" defaultValue="50"/></div><Field label="Photo annotation" name="text"/>
   </Form></details>}
   <details><summary>Correct this daily record</summary><Form key={current.id} submit="Save daily correction" action={f=>call('correct',{...fields(f),reason:f.get('reason')})}><DailyFields data={data} initial={current}/><Field label="Correction reason" name="reason"/></Form></details>
  </>}
  {data.review&&!current.review&&<Form submit="Review production inputs" action={f=>call('review',{reason:f.get('reason'),confirm:f.get('confirm')==='on'})}><Field label="Manager review reason" name="reason"/><label><input type="checkbox" name="confirm" required/> I reviewed this exact revision and its task and cost-code links.</label></Form>}
 </article>
}
function ProductionRows({data}:{data:DailyLogView}) {
 return <section aria-label="Reviewed daily production inputs"><h3>Reviewed daily production inputs</h3><p>Quantities are separate from schedule promises and financial postings. Corrected records need a fresh manager review.</p>
  {!data.production.length&&<p>No current reviewed quantities.</p>}
  {data.production.map(q=><p key={q.id}><a href={'?tab=Daily%20logs'}>{q.date} · {q.task}</a> · {q.cost_code} · {q.quantity} {q.unit} · revision {data.logs.find(l=>l.id===q.log_id)?.revisions.find(r=>r.id===q.revision_id)?.revision} · {q.reviewed_by.name}</p>)}
 </section>
}
export function DailyProductionInputs({job}:{job:JobProps['job']}) {
 const [data,setData]=useState<DailyLogView>()
 useEffect(()=>{void api('/jobs/'+job.id+'/daily-logs').then(setData).catch(()=>setData(undefined))},[job.id,job.version])
 return data?<section className="card"><ProductionRows data={data}/></section>:null
}
