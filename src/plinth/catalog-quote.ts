import { requireManager } from './auth'
import { exact, date } from './catalog-input'
import { catalogEntry } from './estimate-catalog'
import { decimal } from './estimate-math'
import { estimateLines } from './estimate-input'
import { need, object, recordApproval, stamp, text, type Actor, type Input, type Job } from './model'
import { prepareQuote } from './quotes'
import type { Assembly, CatalogSource, EstimateTemplate, VendorRate } from './catalog-model'
/** Decimal products retain every digit; division is deferred to the estimate's one rounding boundary. */
function product(...values:string[]):string {let n=1n,places=0;for(const v of values){const p=decimal(v,'Assembly factor',false);n*=p.numerator;places+=String(p.denominator).length-1}const raw=n.toString().padStart(places+1,'0');return places?raw.slice(0,-places)+'.'+raw.slice(-places):raw}
function wasteFactor(value:string):string {const r=decimal(value,'Waste percentage',false);const n=100n*r.denominator+r.numerator,places=String(r.denominator).length-1,raw=n.toString().padStart(places+1,'0');return places?raw.slice(0,-places)+'.'+raw.slice(-places):raw}
async function digest(value:unknown) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('')}
export async function catalogPreview(db:D1Database,job:Job,actor:Actor,input:Input) {
 requireManager(actor,true)
 const template=await catalogEntry(db,text(input.template_id,'Template id',80),'template'),definition=template.revisions.at(-1)!.value as EstimateTemplate
 const supplied=object(input.dimensions??definition.dimensions)
 need(Object.keys(supplied).length===Object.keys(definition.dimensions).length&&Object.keys(supplied).every(k=>Object.hasOwn(definition.dimensions,k)),'Supply exactly the template dimensions')
 const dimensions=Object.fromEntries(Object.keys(definition.dimensions).map(k=>[k,exact(supplied[k],k)])),as_of=date(input.as_of)
 const source:CatalogSource={template_id:template.id,template_version:template.version,dimensions,as_of,rates:[],assemblies:[]},lines:Input[]=[]
 for(const item of definition.items){const entry=await catalogEntry(db,item.assembly_id,'assembly'),assembly=entry.revisions.at(-1)!.value as Assembly;source.assemblies.push({id:entry.id,version:entry.version})
  for(const part of assembly.parts){const rate=await catalogEntry(db,part.rate_id,'rate'),revision=rate.revisions.filter(r=>(r.value as VendorRate).effective_on<=as_of).sort((a,b)=>(b.value as VendorRate).effective_on.localeCompare((a.value as VendorRate).effective_on)||b.version-a.version)[0];need(revision,`No dated rate for ${rate.name} on ${as_of}`,409,'rate_missing');const value=revision.value as VendorRate;source.rates.push({id:rate.id,version:revision.version})
   lines.push({id:`${item.id}:${part.id}`,description:part.description,quantity:dimensions[item.dimension],unit:assembly.unit,rate_unit:value.unit,cost_code:part.cost_code,phase:part.phase,category:part.category,cost_unit_cents:value.cost_cents,unit_cents:value.sell_cents,conversion:{numerator:product(part.units_per_dimension,wasteFactor(part.waste_percent)),denominator:product(part.productivity,'100')}})
  }
 }
 const estimate=estimateLines({lines}),current=job.quotes.at(-1)
 const proposal={...estimate,cost_catalog:source,notes:`${template.name} · ${definition.kind} · rates dated through ${as_of}`}
 return {proposal,template_name:template.name,previous_total_cents:current?.total_cents??0,total_delta_cents:estimate.total_cents-(current?.total_cents??0),sold:job.status!=='quoting',digest:await digest([job.id,job.version,proposal])}
}
export async function applyCatalog(db:D1Database,job:Job,actor:Actor,input:Input) {
 requireManager(actor)
 const preview=await catalogPreview(db,job,actor,input)
 need(input.digest===preview.digest,'Rates, assemblies, dimensions or quote changed; preview again before approving',409,'catalog_review')
 need(!preview.sold,'Sold estimates stay frozen; use a change order',409,'quote_frozen')
 const quote=prepareQuote(job,actor,preview.proposal);quote.cost_catalog=preview.proposal.cost_catalog
 recordApproval(job,actor,'estimate.catalog',{id:quote.id,revision:quote.revision,prepared_by:stamp(actor)},{quote_id:quote.id,source:quote.cost_catalog,lines:quote.lines,total_cents:quote.total_cents,cost_total_cents:quote.cost_total_cents})
 return quote
}
