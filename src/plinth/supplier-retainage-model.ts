import { cents, need, sum, type Stamp } from './model'
import type { Draw } from './lien-waiver-model'
import type { RetainageMilestone, RetainageReference } from './retainage-model'
import type { Subcontract } from './subcontracts'

/** Signed supplier terms apply only to this awarded scope's native gross draws. */
export interface SupplierRetainagePlan {
 id: string
 revision: 1
 subcontract_id: string
 contract_reference: string
 rate_bps: number
 milestones: RetainageMilestone[]
 prepared_by: Stamp
 approved_by: Stamp
}
export type SupplierDrawSource = Pick<Draw, 'id' | 'number' | 'through_date' | 'amount_cents' | 'final' | 'requested_by'>
export interface SupplierRetainageRelease {
 id: string
 plan_id: string
 plan_revision: 1
 subcontract_id: string
 milestone_id: string
 milestone: RetainageMilestone
 source_draw_id: string
 source_draw: SupplierDrawSource
 lines: { draw_id: string; amount_cents: number }[]
 amount_cents: number
 completion_reference?: string
 waiver_reference?: string
 completion_references: RetainageReference[]
 waiver_references: RetainageReference[]
 prepared_by: Stamp
 approved_by: Stamp
}
export interface SupplierRetainageState { plan: SupplierRetainagePlan; releases: SupplierRetainageRelease[] }
export type SupplierRetainageSubcontract = Subcontract & { retainage?: SupplierRetainageState }
export interface SupplierRetainageAmounts {
 gross_cents: number
 withheld_cents: number
 released_cents: number
 held_cents: number
 net_payable_cents: number
}
export interface SupplierRetainageDrawBalance extends SupplierRetainageAmounts { draw_id: string }
export interface SupplierRetainageBalance extends SupplierRetainageAmounts { draws: SupplierRetainageDrawBalance[] }

/** An independent supplier ledger over actual gross draw records; client SOV/retainage is never read.
 * Net payable describes the contractual balance, never a transfer or recorded partial payment. */
export function supplierRetainageBalance(sub: SupplierRetainageSubcontract): SupplierRetainageBalance | undefined {
 const state = sub.retainage
 if (!state) return undefined
 const sourceDraws = sub.draws ?? [], rate = state.plan.rate_bps
 need(Number.isInteger(rate) && rate >= 0 && rate <= 10000, 'Supplier retainage rate is invalid', 409, 'retainage_history')
 need(new Set(sourceDraws.map(d => d.id)).size === sourceDraws.length, 'Supplier draw history repeats a source', 409, 'retainage_history')
 need(state.releases.every(r => r.lines.every(l => sourceDraws.some(d => d.id === l.draw_id))), 'Supplier retainage release has a missing draw source', 409, 'retainage_history')
 const draws = sourceDraws.map<SupplierRetainageDrawBalance>(draw => {
  const gross_cents = cents(draw.amount_cents)
  need(gross_cents > 0 && (draw.requested_by.role === 'owner' || draw.requested_by.role === 'admin'), 'Supplier retainage requires positive human-requested native draws', 409, 'retainage_history')
  // Round each supplier draw independently, half-up to one cent.
  const withheld_cents = Number((BigInt(gross_cents) * BigInt(rate) + 5000n) / 10000n)
  const released_cents = sum(state.releases.flatMap(r => r.lines.filter(l => l.draw_id === draw.id).map(l => cents(l.amount_cents))))
  need(released_cents <= withheld_cents, 'Supplier releases exceed the draw hold', 409, 'retainage_history')
  const held_cents = withheld_cents - released_cents
  return { draw_id: draw.id, gross_cents, withheld_cents, released_cents, held_cents, net_payable_cents: gross_cents - held_cents }
 })
 return { draws, gross_cents: sum(draws.map(d => d.gross_cents)), withheld_cents: sum(draws.map(d => d.withheld_cents)), released_cents: sum(draws.map(d => d.released_cents)), held_cents: sum(draws.map(d => d.held_cents)), net_payable_cents: sum(draws.map(d => d.net_payable_cents)) }
}
