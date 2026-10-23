import { useEffect, useState } from 'react'
import type { CatalogEntry, EstimateTemplate } from '../plinth/catalog-model'
import type { JobProps } from './job'
import { api, Action, Field, Form, money } from './shared'
import { AssemblyForm, RateForm, TemplateForm } from './catalog-forms'
/** `rates` is false for an estimator: they price from the reviewed catalog; owners and administrators maintain it. */
export function EstimateCatalog({job,mutate,rates=true}:Pick<JobProps,'job'|'mutate'>&{rates?:boolean}) {
 const [entries,setEntries]=useState<CatalogEntry[]>([]),[error,setError]=useState(''),[id,setId]=useState(''),[preview,setPreview]=useState<any>(),[review,setReview]=useState<any>()
 const refresh=async()=>{const result=await api('/estimate-catalog');setEntries(result.entries);setPreview(undefined)}
 useEffect(()=>{refresh().catch(e=>setError(e.message))},[])
 const template=entries.find(e=>e.id===id),definition=template?.revisions.at(-1)?.value as EstimateTemplate|undefined
 return <details className="side-section"><summary>Catalogs, assemblies and estimate templates</summary><p>Maintain reusable source rates and dimensions. Preview changes on each job, then explicitly approve a new draft revision. Sold estimates remain unchanged.</p>{error&&<p role="alert">{error}</p>}
 {rates&&<><RateForm entries={entries} refresh={refresh}/><AssemblyForm entries={entries} refresh={refresh}/><TemplateForm entries={entries} refresh={refresh}/></>}
 <h3>Price this job from a template</h3><label>Estimate template<select aria-label="Estimate template" value={id} onChange={e=>{setId(e.target.value);setPreview(undefined)}}><option value="">Choose template</option>{entries.filter(e=>e.kind==='template').map(e=><option key={e.id} value={e.id}>{e.name} · revision {e.version}</option>)}</select></label>
 {definition&&<Form key={id} reset={false} submit="Preview template and rate impact" action={async f=>{const input={template_id:id,as_of:f.get('as_of'),dimensions:Object.fromEntries(Object.keys(definition.dimensions).map(k=>[k,f.get('dimension-'+k)]))};setPreview(undefined);const result=await mutate('/estimate-template/preview',input);setReview(input);setPreview({...result.preview,job_version:job.version})}}><Field label="Rate selection date" name="as_of" type="date" defaultValue={new Date().toISOString().slice(0,10)}/>{Object.entries(definition.dimensions).map(([key,value])=><Field key={key} label={`Dimension: ${key}`} name={'dimension-'+key} defaultValue={value}/>)}</Form>}
 {preview&&<section className="record"><h3>Reviewed impact: {preview.template_name}</h3><p>Previous {money(preview.previous_total_cents)} → proposed {money(preview.proposal.total_cents)} · change {money(preview.total_delta_cents)}</p><p>Cost {money(preview.proposal.cost_total_cents)}</p><ul>{preview.proposal.lines.map((line:any)=><li key={line.id}>{line.phase} / {line.cost_code}: {line.description} · {line.quantity} {line.unit} · cost {money(line.cost_total_cents)} · sell {money(line.total_cents)}</li>)}</ul><p>Rate revisions: {preview.proposal.cost_catalog.rates.map((r:any)=>`${entries.find(e=>e.id===r.id)?.name??r.id} #${r.version}`).join(', ')}</p>{preview.sold?<p className="notice">Sold estimate: impact only. No approved amount changes.</p>:<Action action={async()=>{if(preview.job_version!==job.version)throw new Error('Job changed; preview again');await mutate('/estimate-template/apply',{...review,digest:preview.digest});setPreview(undefined)}}>Approve draft estimate update</Action>}</section>}
 </details>
}
