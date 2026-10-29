import { cents, need, object, text, type Input } from './model'
import { decimal } from './estimate-math'
import type { Assembly, AssemblyPart, CatalogEntry, EstimateTemplate, VendorRate } from './catalog-model'
export function exact(value:unknown,name:string,positive=true):string { decimal(value,name,positive);return String(value) }
export function date(value:unknown):string {const raw=text(value,'Effective date',10);need(/^\d{4}-\d{2}-\d{2}$/.test(raw)&&Number.isFinite(Date.parse(raw))&&new Date(raw+'T00:00:00Z').toISOString().slice(0,10)===raw,'Use a valid YYYY-MM-DD date');return raw}
export function catalogValue(kind:CatalogEntry['kind'],input:Input):VendorRate|Assembly|EstimateTemplate {
 if(kind==='rate')return {vendor:text(input.vendor,'Vendor',200),effective_on:date(input.effective_on),unit:text(input.unit,'Rate unit',40),cost_cents:cents(input.cost_cents),sell_cents:cents(input.sell_cents),reference:text(input.reference,'Rate source reference',1000)}
 if(kind==='assembly') {
  need(Array.isArray(input.parts)&&input.parts.length>0&&input.parts.length<=100,'Provide 1–100 assembly parts')
  const parts:AssemblyPart[]=input.parts.map(value=>{const p=object(value);need(['labor','material','equipment','subcontract','other'].includes(String(p.category)),'Choose a cost category');return {id:text(p.id,'Part id',80),rate_id:text(p.rate_id,'Rate id',80),description:text(p.description,'Description',500),cost_code:text(p.cost_code,'Cost code',80),phase:text(p.phase,'Phase group',120),category:p.category as AssemblyPart['category'],units_per_dimension:exact(p.units_per_dimension,'Units per dimension'),productivity:exact(p.productivity,'Production units per rate unit'),waste_percent:exact(p.waste_percent,'Waste percentage',false),...(p.rate_factor===undefined?{}:{rate_factor:exact(p.rate_factor,'Reviewed unit rate factor')})}})
  need(new Set(parts.map(p=>p.id)).size===parts.length,'Part ids must be unique');return {unit:text(input.unit,'Dimension unit',40),parts}
 }
 need(input.kind==='house'||input.kind==='remodel','Choose house or remodel template')
 const dimensions=Object.fromEntries(Object.entries(object(input.dimensions)).map(([key,value])=>[text(key,'Dimension name',80),exact(value,'Dimension')]))
 need(Object.keys(dimensions).length>0&&Object.keys(dimensions).length<=50,'Provide 1–50 dimensions')
 need(Array.isArray(input.items)&&input.items.length>0&&input.items.length<=50,'Provide 1–50 template assemblies')
 const items=input.items.map(value=>{const row=object(value),dimension=text(row.dimension,'Dimension name',80);need(Object.hasOwn(dimensions,dimension),'Every assembly needs a defined dimension');return {id:text(row.id,'Template item id',80),assembly_id:text(row.assembly_id,'Assembly id',80),dimension}})
 need(new Set(items.map(i=>i.id)).size===items.length,'Template item ids must be unique');return {kind:input.kind,dimensions,items}
}
