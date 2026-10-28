import type { Assembly, CatalogEntry, EstimateTemplate } from '../plinth/catalog-model'
import { Field } from './shared'
export function lessonValue(entry:CatalogEntry,form:FormData):Assembly|EstimateTemplate{
 const current=entry.revisions.at(-1)!.value
 if(entry.kind==='assembly'){const assembly=current as Assembly;return {...assembly,parts:assembly.parts.map((p,i)=>({...p,productivity:String(form.get('productivity-'+i)),units_per_dimension:String(form.get('units-'+i)),waste_percent:String(form.get('waste-'+i))}))}}
 const template=current as EstimateTemplate;return {...template,dimensions:Object.fromEntries(Object.keys(template.dimensions).map(k=>[k,String(form.get('dimension-'+k))]))}
}
export function CatalogLessonFields({entry}:{entry:CatalogEntry}){
 if(entry.kind==='assembly'){const value=entry.revisions.at(-1)!.value as Assembly;return <>{value.parts.map((part,i)=><section className="record" key={part.id}><h4>{part.description}</h4><p>{part.cost_code} · {part.phase} · {part.category} · Dimension unit {value.unit}</p><Field label={`Production units per rate unit ${i+1}`} name={'productivity-'+i} defaultValue={part.productivity}/><Field label={`Units per dimension ${i+1}`} name={'units-'+i} defaultValue={part.units_per_dimension}/><Field label={`Waste percent ${i+1}`} name={'waste-'+i} defaultValue={part.waste_percent}/></section>)}</>}
 const value=entry.revisions.at(-1)!.value as EstimateTemplate;return <>{Object.entries(value.dimensions).map(([key,n])=><Field key={key} label={'Default dimension: '+key} name={'dimension-'+key} defaultValue={n}/>)}</>
}
export function CatalogLessonReview({kind,value,catalog}:{kind:string;value:Assembly|EstimateTemplate;catalog:CatalogEntry[]}){
 if(kind==='assembly'){const assembly=value as Assembly;return <><p>Dimension unit: {assembly.unit}</p>{assembly.parts.map(p=><section className="record" key={p.id}><h4>{p.description}</h4><p>{p.cost_code} · {p.phase} · {p.category}</p><p>Production units per rate unit: {p.productivity}</p><p>Units per dimension: {p.units_per_dimension} · Waste percent: {p.waste_percent}</p></section>)}</>}
 const template=value as EstimateTemplate;return <><p>Template kind: {template.kind}</p>{Object.entries(template.dimensions).map(([k,n])=><p key={k}>{k}: {n}</p>)}{template.items.map(i=><p key={i.id}>{catalog.find(e=>e.id===i.assembly_id)?.name??i.assembly_id} · {i.dimension}</p>)}</>
}
