import { requireJobManager } from './auth'
import { allowanceComparison, type AllowanceChange } from './allowance-model'
import { estimateLines } from './estimate-input'
import { reviewedPricing } from './estimate-pricing'
import { active, need, recordApproval, stamp, text, usdOnly, type Actor, type Input, type Job } from './model'
import { prepareVariation } from './quotes'

async function digest(value: unknown) {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function previewAllowanceChange(db: D1Database, job: Job, actor: Actor, input: Input) {
 requireJobManager(actor, true); active(job); usdOnly(job)
 const comparison = allowanceComparison(job, text(input.selection_id, 'Selection id', 100), text(input.revision_id, 'Selection revision id', 100))
 need(!job.variations.some(v => v.allowance_change?.selection_id === comparison.selection_id && v.allowance_change.selection_revision_id === comparison.selection_revision_id), 'An allowance change already exists for this selection revision', 409, 'allowance_applied')
 need(comparison.amount_cents !== 0, 'This choice has no incremental allowance charge or credit', 409, 'allowance_balanced')
 const schedule_days = input.schedule_days
 need(typeof schedule_days === 'number' && Number.isInteger(schedule_days) && Math.abs(schedule_days) <= 3650, 'Review schedule impact in whole calendar days, from -3650 to 3650')
 need(input.impacts_reviewed === true, 'Confirm review of price, procurement and schedule impacts', 400, 'allowance_review')
 const impacts = { schedule_days, impact_reference: text(input.impact_reference, 'Reviewed impact reference', 2000), human_reviewed: true as const }
 const source = estimateLines(input)
 need(source.lines.filter(l => l.included !== false).every(l => l.cost_code === comparison.cost_code), 'Price the selection cost code only', 400, 'allowance_code')
 const quote = job.quotes.find(q => q.status === 'accepted')!
 const { calculated, pricing } = await reviewedPricing(db, input, source.lines, quote)
 need(calculated.total_cents === Math.abs(comparison.amount_cents), 'Final reviewed price including tax must equal the exact incremental selection price less allowance', 400, 'allowance_price')
 const change: AllowanceChange = { ...comparison, impacts }
 const s = comparison.selection_snapshot
 const proposal = { description: `${s.room}: ${s.category} — ${s.option.name}. ${s.option.specifications}`, amount_cents: comparison.amount_cents, pricing, pricing_direction: comparison.amount_cents < 0 ? 'credit' as const : 'charge' as const, allowance_change: change }
 return { proposal, digest: await digest([job.id, job.version, proposal]) }
}

/** Preparation creates only the client proposal; approval and PO authority keep their existing doors. */
export async function applyAllowanceChange(db: D1Database, job: Job, actor: Actor, input: Input) {
 requireJobManager(actor)
 const preview = await previewAllowanceChange(db, job, actor, input)
 need(input.digest === preview.digest, 'Selection, job, pricing or reviewed impacts changed; preview again', 409, 'allowance_review')
 const row = prepareVariation(job, actor, preview.proposal)
 row.pricing = { ...preview.proposal.pricing, approved_by: stamp(actor) }
 row.pricing_direction = preview.proposal.pricing_direction
 row.allowance_change = { ...preview.proposal.allowance_change, reviewed_by: stamp(actor) }
 recordApproval(job, actor, 'variation.pricing', row, { description: row.description, amount_cents: row.amount_cents, pricing: row.pricing, pricing_direction: row.pricing_direction, allowance_change: row.allowance_change })
 return row
}
