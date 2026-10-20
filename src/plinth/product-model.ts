import type { Attachment, Stamp } from './model'
export interface ProductRevision {
 id: string; revision: number; name: string; sku: string; supplier: string; source_url: string; dimensions: string; image: Attachment; cost_quote_cents: number; lead_days: number; captured_on: string; valid_until: string; discontinued: boolean; evidence: string; prepared_by: Stamp; reviewed_by?: Stamp
}
export interface SupplierProduct { id: string; revisions: ProductRevision[] }
export type ProductSource = ProductRevision & { product_id: string }
export const productWarnings = (source: ProductRevision, today = new Date().toISOString().slice(0,10)) => [...(source.discontinued ? ['Discontinued'] : []), ...(today > source.valid_until ? ['Price stale: capture validity expired'] : []), ...(!source.reviewed_by ? ['Capture needs human review'] : [])]
