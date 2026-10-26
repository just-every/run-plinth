import { costs, period } from './cost-model'
import { requireOpenCostPeriod } from './cost-periods'
import { need, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'
import { wallClock } from './time-zone'

export interface RefundPosting { received_on: string; posting_period?: string; adjustment_reference?: string; approved_by: Stamp }
/** Freeze the source date and reviewed open period before instructing the processor. */
export function refundPosting(job: Job, actor: Actor, input: Input): RefundPosting {
 const received_on = wallClock(Date.now(), job.time_zone ?? 'UTC').date, source = received_on.slice(0, 7)
 const closed = costs(job).periods?.some(p => p.period === source)
 need(!closed || input.posting_period !== undefined, 'Accounting period is closed; choose an open posting_period and adjustment_reference', 409, 'cost_period_closed')
 if (input.posting_period === undefined) return { received_on, approved_by: stamp(actor) }
 const posting_period = period(input.posting_period)
 requireOpenCostPeriod(job, posting_period)
 return { received_on, posting_period, adjustment_reference: text(input.adjustment_reference, 'Late adjustment evidence', 2000), approved_by: stamp(actor) }
}

/** Reconciliation uses the durable human booking decision, including delayed or repeated responses. */
export function postRefund(job: Job, source_id: string, posting: RefundPosting) {
 if (!posting.posting_period) { requireOpenCostPeriod(job, posting.received_on.slice(0, 7)); return }
 requireOpenCostPeriod(job, posting.posting_period)
 ;(costs(job).finance_periods ??= {})[source_id] = posting.posting_period
 job.approvals.push({ id: crypto.randomUUID(), kind: 'cost.period.adjustment', subject_id: source_id, revision: 1,
  prepared_by: posting.approved_by, approved_by: posting.approved_by, decision: 'approved', snapshot: {
   source_id, source_period: posting.received_on.slice(0, 7), posting_period: posting.posting_period, reason: posting.adjustment_reference,
  },
 })
}
