/** Optional additions keep archived and imported quantity/price quotes readable. */
export type EstimateCategory = 'labor' | 'material' | 'equipment' | 'subcontract' | 'other'
export interface EstimateLineFields {
 id?: string
 cost_code?: string
 phase?: string
 category?: EstimateCategory
 unit?: string
 rate_unit?: string
 conversion?: { numerator: string; denominator: string }
 cost_unit_cents?: number
 cost_total_cents?: number
 alternate_group?: string
 alternate_option?: string
 included?: boolean
}
export interface EstimateQuoteFields {
 pricing?: import('./pricing-model').PricingSnapshot
 selling_adjusted?: boolean
 cost_catalog?: import('./catalog-model').CatalogSource
 cost_total_cents?: number
 inclusions?: string[]
 exclusions?: string[]
 alternate_selections?: Record<string, string>
}
