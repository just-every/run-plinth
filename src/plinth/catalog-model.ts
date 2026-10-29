import type { Stamp } from './model'
import type { EstimateCategory } from './estimate-model'
export interface VendorRate { vendor:string; effective_on:string; unit:string; cost_cents:number; sell_cents:number; reference:string }
export interface AssemblyPart { id:string; rate_id:string; description:string; cost_code:string; phase:string; category:EstimateCategory; units_per_dimension:string; productivity:string; waste_percent:string; rate_factor?:string }
export interface Assembly { unit:string; parts:AssemblyPart[] }
export interface EstimateTemplate { kind:'house'|'remodel'; dimensions:Record<string,string>; items:{id:string;assembly_id:string;dimension:string}[] }
export interface CatalogRevision { version:number; name:string; reason:string; approved_by:Stamp; value:VendorRate|Assembly|EstimateTemplate }
export interface CatalogEntry { id:string; kind:'rate'|'assembly'|'template'; version:number; name:string; revisions:CatalogRevision[] }
export interface CatalogSource { template_id:string; template_version:number; dimensions:Record<string,string>; as_of:string; rates:{id:string;version:number}[]; assemblies:{id:string;version:number}[] }
