import type { Job, Stamp } from './model'

export interface RetainageRule { line_id: string; work_bps: number; stored_bps: number }
export interface RetainageMilestone {
 id: string
 name: string
 completion_requirements: string[]
 waiver_requirements: string[]
 final: boolean
}
export interface RetainagePlan {
 id: string
 revision: number
 contract_reference: string
 sov_revision_id: string
 rules: RetainageRule[]
 milestones: RetainageMilestone[]
 prepared_by: Stamp
 approved_by: Stamp
}
export interface RetainageReference { requirement: string; reference: string }
export interface RetainageRelease {
 id: string
 plan_id: string
 plan_revision: number
 milestone_id: string
 milestone: RetainageMilestone
 source_claim_id: string
 lines: { line_id: string; amount_cents: number }[]
 amount_cents: number
 completion_reference: string
 waiver_reference?: string
 completion_references: RetainageReference[]
 waiver_references: RetainageReference[]
 prepared_by: Stamp
 approved_by: Stamp
}
export interface RetainageAmounts {
 gross_cents: number
 previous_withheld_cents: number
 current_withheld_cents: number
 cumulative_withheld_cents: number
 cumulative_released_cents: number
 held_cents: number
 previous_net_cents: number
 current_net_cents: number
 cumulative_net_cents: number
}
export interface RetainageLineSnapshot extends RetainageAmounts {
 line_id: string
 work_withheld_cents: number
 stored_withheld_cents: number
}
/** Client contract withholding only; these amounts assert neither supplier liability nor funds paid. */
export interface RetainageSnapshot extends RetainageAmounts {
 plan_id: string
 plan_revision: number
 contract_reference: string
 release_ids: string[]
 lines: RetainageLineSnapshot[]
}
export interface RetainageState { plan: RetainagePlan; releases: RetainageRelease[] }
export type RetainageJob = Job & { retainage?: RetainageState }
