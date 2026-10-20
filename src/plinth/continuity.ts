import { requireJobManager } from './auth'
import { find, need, stamp, type Actor, type Job } from './model'
import { prepareOrder } from './operations'
import { selectionOrderInput } from './selections'
import type { BudgetRevision } from './budget-model'
import type { Continuity } from './continuity-model'

export function enqueueContinuity(job: Job, actor: Actor, budget: BudgetRevision) {
 const rows = job.continuity ??= []
 if (rows.some(w => w.source.kind === budget.source.kind && w.source.id === budget.source.id)) return
 rows.push({ id: crypto.randomUUID(), source: structuredClone(budget.source), budget_id: budget.id, created_by: stamp(actor), stage: 'schedule' })
}
/** One bounded draft per request. Artifact and checkpoint are saved in the same optimistic D1 transaction. */
export function resumeContinuity(job: Job, actor: Actor, id: string): Continuity {
 requireJobManager(actor, true)
 const row = find(job.continuity ?? [], id), budget = find(job.budgets ?? [], row.budget_id)
 const change = row.source.kind === 'variation' ? find(job.variations, row.source.id) : undefined
 if (row.stage === 'schedule') {
  row.schedule = { id: crypto.randomUUID(), status: 'proposed', calendar_day_impact: change ? change.allowance_change?.impacts.schedule_days ?? null : 0, reference: change?.allowance_change?.impacts.impact_reference ?? (change ? 'Date impact not recorded; review before publishing' : 'Accepted sale schedule choice retained in the original budget'), tasks: structuredClone(job.schedules.filter(s => s.status !== 'cancelled')), ...(change?.allowance_change ? { selection_revision_id: change.allowance_change.selection_revision_id } : {}) }
  row.stage = 'purchasing'
 } else if (row.stage === 'purchasing') {
  const allowance = change?.allowance_change
  let order_id: string | undefined
  if (allowance) {
   const existing = job.orders.find(o => o.source?.kind === 'selection' && o.source.selection_id === allowance.selection_id && o.source.revision_id === allowance.selection_revision_id && o.status !== 'cancelled')
   order_id = existing?.id ?? prepareOrder(job, actor, selectionOrderInput(job, allowance.selection_id, allowance.selection_revision_id, {})).id
  }
  row.purchasing = { id: crypto.randomUUID(), status: 'draft', ...(order_id ? { order_id } : {}), lines: structuredClone(budget.billing_lines.filter(l => row.source.kind === 'quote' || l.id.startsWith('variation:' + row.source.id))), label: order_id ? 'Linked selection PO; separate human issue and send required' : 'Purchasing scope draft; review supplier, quantities and costs before preparing an order' }
  row.stage = 'billing'
 } else if (row.stage === 'billing') {
  row.billing = { id: crypto.randomUUID(), status: 'draft', purpose: 'Next native progress application adjustment for external books. Not an invoice or earned progress. Review SOV, tax and work evidence before approval.', budget: structuredClone(budget), adjustment_cents: change?.amount_cents ?? budget.contract_cents, claim_ids: [] }
  row.stage = 'complete'
 }
 return row
}
/** A new real application names prepared adjustments only when its reconciliation includes that source. */
export function linkContinuityClaim(job: Job, claim: Job['claims'][number]) {
 for (const row of job.continuity ?? []) {
  if (!row.billing || row.billing.claim_ids.length) continue
  const included = row.source.kind === 'quote' ? claim.reconciliation.accepted_quote_id === row.source.id : claim.reconciliation.variations.some(v => v.id === row.source.id)
  if (included) row.billing.claim_ids.push(claim.id)
 }
}
