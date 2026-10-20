import type { Claim, Job, Line, Quote, Stamp } from './model'
import type { PricingSnapshot } from './pricing-model'

/** Commercial progress billing data, not a licensed AIA form or certification. */
export interface SovSource {
 kind: 'quote' | 'variation'
 id: string
 revision: number
 line_id?: string
}
export interface SovLine {
 id: string
 cost_code: string
 description: string
 scheduled_cents: number
 source: SovSource
}
export interface SovSources {
 quote: { id: string; revision: number; total_cents: number; lines: Line[]; pricing: PricingSnapshot; acceptance?: Quote['acceptance'] }
 variations: { id: string; revision: number; description: string; amount_cents: number; cost_code?: string; pricing: PricingSnapshot; pricing_direction: 'charge' | 'credit'; approved_by: Stamp }[]
}
export interface SovRevision {
 id: string
 revision: number
 currency: 'USD'
 prepared_by: Stamp
 approved_by: Stamp
 source_digest: string
 sources: SovSources
 lines: SovLine[]
 contract_cents: number
}
export interface SovStoredOrder {
 id: string
 received_cents: number
 allocated_cents: number
 receipts: { id: string; amount_cents: number; reference: string }[]
 returns: { id: string; amount_cents: number; reference: string }[]
}
export interface SovApplicationLine extends SovLine {
 previous_cents: number
 completed_cents: number
 stored_cents: number
 current_cents: number
 total_cents: number
 completion_percent: number
 balance_cents: number
 evidence: string
 order_ids: string[]
 stored_orders: SovStoredOrder[]
}
export interface SovApplication {
 format: 'plinth-sov-application-v1'
 purpose: string
 currency: 'USD'
 job_id: string
 job_name: string
 prepared_by: Stamp
 sov_revision: SovRevision
 previous_claim_id?: string
 lines: SovApplicationLine[]
 scheduled_cents: number
 previous_cents: number
 completed_cents: number
 stored_cents: number
 current_cents: number
 total_cents: number
 completion_percent: number
 balance_cents: number
}
export type SovJob = Job & { sov?: SovRevision[] }
export type SovClaim = Claim & { sov?: SovApplication }
