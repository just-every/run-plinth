import { cents, find, need, sum, type Job, type Stamp, type Variation } from './model'
import { selected, type SelectionOption, type SelectionRevision } from './selection-model'

/** The recorded client decision is copied, never a pointer to mutable procurement state. */
export interface AllowanceSelectionSnapshot {
 revision: number; room: string; category: string; allowance_cents: number; decision_on: string; lead_days: number
 option: SelectionOption; acceptance: { by: Stamp; statement: string }
}
export interface AllowanceChange {
 selection_id: string; selection_revision_id: string; selection_snapshot: AllowanceSelectionSnapshot; cost_code: string
 economic_delta_cents: number; prior_variation_id?: string; prior_economic_delta_cents: number; amount_cents: number
 impacts: { schedule_days: number; impact_reference: string; human_reviewed: true }; reviewed_by?: Stamp
}

function snapshot(revision: SelectionRevision): AllowanceSelectionSnapshot {
 need(revision.signature, 'Record the exact client choice first', 409, 'selection_unsigned')
 return structuredClone({ revision: revision.revision, room: revision.room, category: revision.category, allowance_cents: revision.allowance_cents, decision_on: revision.decision_on, lead_days: revision.lead_days, option: revision.signature.option, acceptance: { by: revision.signature.by, statement: revision.signature.statement } })
}

export function allowanceComparison(job: Job, selectionId: string, revisionId: string) {
 const { selection, revision, option } = selected(job, selectionId, revisionId)
 need(selection.revisions.at(-1) === revision, 'Review the latest recorded selection revision', 409, 'selection_revision')
 const original = selection.revisions[0]!, plan = job.budgets?.[0]?.allowances.find(a => a.cost_code === original.cost_code)
 if (plan) {
  need(revision.cost_code === original.cost_code && revision.allowance_cents === original.allowance_cents, 'A replacement cannot rewrite the original cost code or allowance allocation', 409, 'allowance_baseline')
  const allocated = sum((job.selections ?? []).filter(s => s.revisions[0]?.cost_code === original.cost_code).map(s => s.revisions[0]!.allowance_cents))
  need(allocated === plan.amount_cents, 'Selection allowances for this cost code must reconcile to the accepted budget allocation', 409, 'allowance_baseline')
 }
 const prior = job.variations.filter(v => v.status === 'approved' && v.allowance_change?.selection_id === selectionId).at(-1)
 const prior_economic_delta_cents = prior?.allowance_change?.economic_delta_cents ?? 0
 const economic_delta_cents = sum([option.price_cents, -revision.allowance_cents])
 return { selection_id: selectionId, selection_revision_id: revisionId, selection_snapshot: snapshot(revision), cost_code: revision.cost_code, economic_delta_cents, ...(prior ? { prior_variation_id: prior.id } : {}), prior_economic_delta_cents, amount_cents: sum([economic_delta_cents, -prior_economic_delta_cents]) }
}

/** Called inside the ordinary client approval transaction before any contract or budget effect. */
export function assertAllowanceChange(job: Job, variation: Variation) {
 const change = variation.allowance_change
 if (!change) return
 const current = allowanceComparison(job, change.selection_id, change.selection_revision_id)
 for (const key of ['selection_snapshot', 'cost_code', 'economic_delta_cents', 'prior_variation_id', 'prior_economic_delta_cents', 'amount_cents'] as const)
  need(JSON.stringify(change[key]) === JSON.stringify(current[key]), 'Selection or approved allowance baseline changed; prepare a fresh allowance change', 409, 'allowance_stale')
 need(!job.variations.some(v => v.id !== variation.id && v.status === 'approved' && v.allowance_change?.selection_revision_id === change.selection_revision_id && v.allowance_change.selection_id === change.selection_id), 'This selection revision already changed the contract', 409, 'allowance_applied')
 need(change.reviewed_by && change.impacts.human_reviewed === true && Number.isInteger(change.impacts.schedule_days) && Math.abs(change.impacts.schedule_days) <= 3650 && change.impacts.impact_reference.trim(), 'A manager must review price and schedule impacts', 409, 'allowance_review')
 need(variation.amount_cents === change.amount_cents && variation.pricing?.total_cents === Math.abs(change.amount_cents) && variation.pricing_direction === (change.amount_cents < 0 ? 'credit' : 'charge'), 'The priced change must equal the exact incremental allowance adjustment', 409, 'allowance_price')
 cents(variation.amount_cents, 'Allowance adjustment', true)
 // The immutable presentation approval is the source of the recorded client choice.
 const source = find(job.selections ?? [], change.selection_id).revisions.find(r => r.id === change.selection_revision_id)!
 need(source.options.some(o => JSON.stringify(o) === JSON.stringify(change.selection_snapshot.option)), 'The accepted option differs from the presented terms', 409, 'selection_terms')
}

/** Cost codes are office metadata; signed client prices and reviewed date impacts are public. */
export function clientAllowanceChange(change: AllowanceChange) {
 const { cost_code, ...visible } = change
 return visible
}
