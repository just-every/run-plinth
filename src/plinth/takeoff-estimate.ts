import { requireEstimating } from './auth'
import { catalogPreview } from './catalog-quote'
import { catalogEntry } from './estimate-catalog'
import { decimal } from './estimate-math'
import { standardConversion } from './us-conventions'
import { combined } from './takeoff-geometry'
import { digest } from './attachments'
import { need, object, recordApproval, text, type Actor, type Input, type Job } from './model'
import { prepareQuote } from './quotes'
import type { Assembly, EstimateTemplate } from './catalog-model'

/** A dimension means one physical unit. Conversions occur from retained measured units before catalog pricing. */
export async function previewTakeoff(db:D1Database,job:Job,actor:Actor,input:Input){
 requireEstimating(actor,true)
 const source=combined(job.takeoff??[],input),template=await catalogEntry(db,text(input.template_id,'Template id',100),'template'),definition=template.revisions.at(-1)!.value as EstimateTemplate
 const dimensions:Record<string,string>={},conversions:Record<string,{from:string;to:string;numerator:string;denominator:string}>={}
 need(Object.keys(source.dimensions).length===Object.keys(definition.dimensions).length&&Object.keys(definition.dimensions).every(key=>Object.hasOwn(source.dimensions,key)),'Measured dimensions must match exactly the selected template dimensions')
 for(const item of definition.items){const assembly=(await catalogEntry(db,item.assembly_id,'assembly')).revisions.at(-1)!.value as Assembly
  const from=source.units[item.dimension]!,to=assembly.unit
  need(!conversions[item.dimension]||conversions[item.dimension]!.to===to,'Assemblies sharing a template dimension must use the same measurement unit')
  const conversion=from===to?{numerator:'1',denominator:'1'}:standardConversion(from,to);need(conversion,`Measurement ${item.dimension} uses ${from}; template assembly uses incompatible ${to}`)
  conversions[item.dimension]={from,to,...conversion}
  const q=decimal(source.dimensions[item.dimension],'Measured dimension'),n=decimal(conversion.numerator,'Conversion numerator'),d=decimal(conversion.denominator,'Conversion denominator')
  const numerator=q.numerator*n.numerator*d.denominator*1_000_000n,denominator=q.denominator*n.denominator*d.numerator,micro=(numerator*2n+denominator)/(2n*denominator)
  need(micro>0n,'Converted measurement is below the supported precision');dimensions[item.dimension]=`${micro/1_000_000n}.${String(micro%1_000_000n).padStart(6,'0')}`
 }
 const catalog=await catalogPreview(db,job,actor,{template_id:template.id,as_of:input.as_of,dimensions})
 const previous_dimensions=job.quotes.at(-1)?.takeoff_source?.dimensions??{}
 const dimension_changes=Object.entries(dimensions).map(([dimension,after])=>({dimension,before:previous_dimensions[dimension]??null,after,unit:conversions[dimension]!.to}))
 const reviewedSource={...source,dimensions,previous_dimensions,dimension_changes,conversions,catalog:structuredClone(catalog.proposal.cost_catalog),assembly_snapshots:await Promise.all(catalog.proposal.cost_catalog.assemblies.map(async a=>{const entry=await catalogEntry(db,a.id,'assembly');return {id:entry.id,revision:entry.revisions.find(r=>r.version===a.version)!}}))}
 return {catalog,source:reviewedSource,digest:await digest(new TextEncoder().encode(JSON.stringify([job.id,job.version,catalog,reviewedSource])))}
}
export async function applyTakeoff(db:D1Database,job:Job,actor:Actor,input:Input){requireEstimating(actor);const preview=await previewTakeoff(db,job,actor,input);need(input.digest===preview.digest,'Drawings, annotations, calibration or prices changed; preview again before approval',409,'takeoff_stale');need(!preview.catalog.sold,'Accepted estimates are immutable; review the measured impact and use a change order',409,'quote_frozen');const quote=prepareQuote(job,actor,preview.catalog.proposal);quote.cost_catalog=preview.catalog.proposal.cost_catalog;quote.takeoff_source=preview.source;recordApproval(job,actor,'estimate.takeoff',quote,{quote_id:quote.id,source:quote.takeoff_source,lines:quote.lines,total_cents:quote.total_cents,cost_total_cents:quote.cost_total_cents});return quote}
