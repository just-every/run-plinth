import { active, cents, find, need, object, recordApproval, stamp, sum, text, usdOnly, type Actor, type Input, type Job } from './model'
import type { RetainageMilestone, RetainageReference } from './retainage-model'
import { supplierRetainageBalance, type SupplierRetainagePlan, type SupplierRetainageRelease, type SupplierRetainageSubcontract } from './supplier-retainage-model'

export { supplierRetainageBalance } from './supplier-retainage-model'

// Match the native subcontract/lien-waiver office boundary, including refusal of PMs and bearer agents.
const office = (actor: Actor) => need(actor.role === 'owner' || actor.role === 'admin', 'Only an owner or administrator manages supplier retainage', 403, 'forbidden')
function strings(value: unknown, name: string): string[] {
 need(Array.isArray(value), `${name} must be an array of contract requirements`)
 const rows = value.map(v => text(v, name, 2000))
 need(new Set(rows).size === rows.length, `${name} cannot repeat a requirement`)
 return rows
}
function references(value: unknown, requirements: string[], name: string): RetainageReference[] {
 need(value === undefined || Array.isArray(value), `${name} must be an array`)
 const rows = ((value as unknown[] | undefined) ?? []).map(value => {
  const raw = object(value)
  return { requirement: text(raw.requirement, 'requirement', 2000), reference: text(raw.reference, 'source reference', 4000) }
 })
 need(rows.length === requirements.length && new Set(rows.map(r => r.requirement)).size === rows.length && requirements.every(requirement => rows.some(r => r.requirement === requirement)), 'Provide exactly one source reference for every configured milestone requirement', 409, 'retainage_evidence')
 return requirements.map(requirement => rows.find(r => r.requirement === requirement)!)
}
function optionalReference(value: unknown, name: string): string | undefined {
 return value === undefined ? undefined : text(value, name, 4000)
}

/** A person records immutable signed supplier terms before the first gross draw or payment.
 * The source reference names the signed contract; recording it does not verify its legal sufficiency. */
export function configureSupplierRetainage(job: Job, actor: Actor, subId: string, input: Input): SupplierRetainagePlan {
 office(actor); active(job); usdOnly(job)
 const sub: SupplierRetainageSubcontract = find(job.subcontracts ?? [], subId)
 need(!sub.retainage, 'Signed supplier retainage terms are immutable', 409, 'retainage_immutable')
 need(!sub.draws?.length, 'Configure supplier retainage before the first draw or payment', 409, 'retainage_history')
 const contract_reference = text(input.contract_reference, 'contract_reference', 4000), rate_bps = input.rate_bps
 need(typeof rate_bps === 'number' && Number.isInteger(rate_bps) && rate_bps >= 0 && rate_bps <= 10000, 'Retainage basis points must be integers from 0 to 10000')
 need(Array.isArray(input.milestones) && input.milestones.length > 0, 'Configure at least one supplier contract release milestone')
 const milestones = input.milestones.map<RetainageMilestone>(value => {
  const raw = object(value)
  need(raw.final === undefined || typeof raw.final === 'boolean', 'final must be a boolean')
  return { id: text(raw.id, 'milestone id', 200), name: text(raw.name, 'milestone name', 500), completion_requirements: strings(raw.completion_requirements, 'completion_requirements'), waiver_requirements: strings(raw.waiver_requirements, 'waiver_requirements'), final: raw.final === true }
 })
 need(new Set(milestones.map(m => m.id)).size === milestones.length, 'Milestone ids must be unique')
 const by = stamp(actor), plan: SupplierRetainagePlan = { id: crypto.randomUUID(), revision: 1, subcontract_id: sub.id, contract_reference, rate_bps, milestones, prepared_by: by, approved_by: structuredClone(by) }
 recordApproval(job, actor, 'supplier_retainage.plan', plan, plan)
 sub.retainage = { plan, releases: [] }
 return plan
}

/** The office records human-reviewed completion/waiver source references, never legal certification.
 * Releases alter only this supplier's contractual hold; they do not record or send funds. */
export function releaseSupplierRetainage(job: Job, actor: Actor, subId: string, input: Input): SupplierRetainageRelease {
 office(actor); active(job); usdOnly(job)
 const sub: SupplierRetainageSubcontract = find(job.subcontracts ?? [], subId), state = sub.retainage
 need(state, 'Configure supplier retainage before a release', 409, 'retainage_required')
 const milestone_id = text(input.milestone_id, 'milestone_id', 200), milestone = state.plan.milestones.find(m => m.id === milestone_id)
 need(milestone, 'Use a configured supplier retainage milestone', 409, 'retainage_milestone')
 need(!state.releases.some(r => r.milestone_id === milestone_id), 'This supplier milestone has already been released', 409, 'retainage_duplicate')
 const draw_id = text(input.draw_id, 'draw_id', 200), latest = sub.draws?.at(-1)
 need(latest && latest.id === draw_id && latest.amount_cents > 0 && (latest.requested_by.role === 'owner' || latest.requested_by.role === 'admin'), 'Release against the latest human-requested supplier draw', 409, 'retainage_draw_stale')
 const balance = supplierRetainageBalance(sub)!
 const completion_references = references(input.completion_references, milestone.completion_requirements, 'completion_references'), waiver_references = references(input.waiver_references, milestone.waiver_requirements, 'waiver_references')
 const completion_reference = text(input.completion_reference ?? completion_references[0]?.reference, 'completion_reference', 4000), waiver_reference = optionalReference(input.waiver_reference ?? waiver_references[0]?.reference, 'waiver_reference')
 need(!milestone.final || waiver_reference, 'Final supplier release requires a reviewed final waiver source reference', 409, 'retainage_evidence')
 need(Array.isArray(input.lines) && input.lines.length > 0, 'Specify positive supplier retainage release cents by draw')
 const lines = input.lines.map(value => {
  const raw = object(value), draw_id = text(raw.draw_id, 'draw_id', 200), amount_cents = cents(raw.amount_cents), line = balance.draws.find(d => d.draw_id === draw_id)
  need(line && amount_cents > 0 && amount_cents <= line.held_cents, 'Each supplier release must be positive and within the draw’s unreleased hold', 409, 'retainage_balance')
  return { draw_id, amount_cents }
 })
 need(new Set(lines.map(l => l.draw_id)).size === lines.length, 'Release each supplier draw at most once')
 const amount_cents = sum(lines.map(l => l.amount_cents))
 if (milestone.final) need(latest.final && sub.amount_cents !== undefined && balance.gross_cents === sub.amount_cents && amount_cents === balance.held_cents, 'Final supplier release requires a final draw, the full awarded gross amount, and release of all remaining hold', 409, 'retainage_final')
 const by = stamp(actor), release: SupplierRetainageRelease = { id: crypto.randomUUID(), plan_id: state.plan.id, plan_revision: state.plan.revision, subcontract_id: sub.id, milestone_id, milestone: structuredClone(milestone), source_draw_id: latest.id, source_draw: structuredClone({ id: latest.id, number: latest.number, through_date: latest.through_date, amount_cents: latest.amount_cents, final: latest.final, requested_by: latest.requested_by }), lines, amount_cents, ...(completion_reference ? { completion_reference } : {}), ...(waiver_reference ? { waiver_reference } : {}), completion_references, waiver_references, prepared_by: by, approved_by: structuredClone(by) }
 recordApproval(job, actor, 'supplier_retainage.release', release, release)
 state.releases.push(release)
 return release
}
