import { requireJobManager } from './auth'
import { estimateLines } from './estimate-input'
import { reviewedPricing } from './estimate-pricing'
import { active, need, recordApproval, stamp, text, usdOnly, type Actor, type Input, type Job } from './model'
import { prepareVariation } from './quotes'

async function digest(value: unknown) {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(b => b.toString(16).padStart(2, '0')).join('')
}
/** A priced change retains the same reviewed stages and tax as EST-003. */
export async function previewVariationPricing(db: D1Database, job: Job, actor: Actor, input: Input) {
 requireJobManager(actor, true); active(job); usdOnly(job)
 need(input.direction === 'charge' || input.direction === 'credit', 'Choose charge or credit')
 const quote = job.quotes.find(q => q.status === 'accepted')!
 const source = estimateLines(input), description = text(input.description, 'Change scope', 4000)
 const { calculated, pricing } = await reviewedPricing(db, input, source.lines, quote)
 const proposal = { description, amount_cents: input.direction === 'credit' ? -calculated.total_cents : calculated.total_cents, pricing, pricing_direction: input.direction }
 need(proposal.amount_cents !== 0, 'A change order must change the contract amount')
 return { proposal, digest: await digest([job.id, job.version, proposal]) }
}
export async function preparePricedVariation(db: D1Database, job: Job, actor: Actor, input: Input) {
 requireJobManager(actor)
 const preview = await previewVariationPricing(db, job, actor, input)
 need(preview.digest === input.digest, 'Job, change scope or reviewed tax changed; preview again', 409, 'pricing_review')
 const row = prepareVariation(job, actor, preview.proposal)
 row.pricing = { ...preview.proposal.pricing, approved_by: stamp(actor) }
 row.pricing_direction = preview.proposal.pricing_direction as 'charge' | 'credit'
 recordApproval(job, actor, 'variation.pricing', row, { description: row.description, amount_cents: row.amount_cents, pricing: row.pricing, direction: row.pricing_direction })
 return row
}
