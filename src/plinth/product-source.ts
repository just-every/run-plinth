import { find, need, text, type Job } from './model'
import { productWarnings, type ProductSource } from './product-model'

/** Only references into this job can become commercial source snapshots; client bodies cannot invent evidence. */
export function productSource(job:Job,productId:unknown,revisionId:unknown):ProductSource {
 const product=find(job.products??[],text(productId,'product_id',100)),revision=find(product.revisions,text(revisionId,'product_revision_id',100))
 need(revision.reviewed_by,'Review the supplier capture before using it',409,'product_unreviewed')
 return {...structuredClone(revision),product_id:product.id}
}
export function productStatus(job:Job,source:ProductSource){const latest=job.products?.find(p=>p.id===source.product_id)?.revisions.at(-1);return [...productWarnings(source),...(latest&&latest.id!==source.id?['Newer supplier capture exists; original specification retained']:[]),...(latest?.discontinued&&!source.discontinued?['Supplier now reports discontinued']:[])]}
/** Existing client selection fields stay intact; only embedded office supplier economics/notes are removed. */
export function publicProductSources<T>(value:T):T {
 if(Array.isArray(value))return value.map(publicProductSources) as T
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,child])=>{
  if(key==='product_source'&&child&&typeof child==='object'){const {cost_quote_cents,evidence,...source}=child as ProductSource;return [key,source]}
  return [key,publicProductSources(child)]
 })) as T
 return value
}
