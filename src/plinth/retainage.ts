import { requireJobManager } from './auth'
import { active, cents, need, object, recordApproval, stamp, sum, text, usdOnly, type Actor, type Claim, type Input, type Job } from './model'
import type { SovApplication, SovApplicationLine } from './sov-model'
import { sovSources } from './sov'
import type { RetainageAmounts, RetainageJob, RetainageLineSnapshot, RetainageMilestone, RetainagePlan, RetainageReference, RetainageRelease, RetainageRule, RetainageSnapshot } from './retainage-model'

function canonical(value: unknown): string {
 if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
 if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
 return JSON.stringify(value) ?? 'null'
}
function strings(value: unknown, name: string): string[] {
 need(Array.isArray(value), `${name} must be an array of contract requirements`)
 const result = value.map(v => text(v, name, 2000))
 need(new Set(result).size === result.length, `${name} cannot repeat a requirement`)
 return result
}
function bps(value: unknown): number {
 need(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10000, 'Retainage basis points must be integers from 0 to 10000')
 return value
}
/** Existing contract terms stay fixed; later SOV additions receive explicitly approved new rules. */
export function configureRetainage(job: Job, actor: Actor, input: Input): RetainagePlan {
 requireJobManager(actor); active(job); usdOnly(job)
 const state = (job as RetainageJob).retainage, old = state?.plan, sov = job.sov?.at(-1)
 need(old || !job.claims.some(c => c.status !== 'draft'), 'Configure retainage before the first approved pay app', 409, 'retainage_history')
 need(sov, 'Prepare an approved schedule of values before configuring retainage', 409, 'sov_required')
 need(sov.source_digest === canonical(sovSources(job)), 'Refresh the schedule of values before configuring retainage', 409, 'sov_stale')
 const contract_reference = text(input.contract_reference, 'contract_reference', 4000)
 need(!old || old.contract_reference === contract_reference, 'The approved retainage contract reference is immutable', 409, 'retainage_immutable')
 need(Array.isArray(input.rules), 'Provide retainage rules for every positive SOV line')
 const rules = input.rules.map<RetainageRule>(value => {
  const raw = object(value), line_id = text(raw.line_id, 'line_id', 200), line = sov.lines.find(l => l.id === line_id)
  need(line, 'Retainage rules must identify current SOV lines')
  const work_bps = bps(raw.work_bps), stored_bps = bps(raw.stored_bps)
  need(line.scheduled_cents > 0 || work_bps === 0 && stored_bps === 0, 'Credit and zero-value lines cannot carry retainage')
  return { line_id, work_bps, stored_bps }
 })
 need(new Set(rules.map(r => r.line_id)).size === rules.length && sov.lines.every(l => l.scheduled_cents <= 0 || rules.some(r => r.line_id === l.id)), 'Include every positive SOV line exactly once')
 for (const line of sov.lines) if (!rules.some(r => r.line_id === line.id)) rules.push({ line_id: line.id, work_bps: 0, stored_bps: 0 })
 need(Array.isArray(input.milestones) && input.milestones.length > 0, 'Configure at least one contract release milestone')
 const milestones = input.milestones.map<RetainageMilestone>(value => {
  const raw = object(value)
  need(raw.final === undefined || typeof raw.final === 'boolean', 'final must be a boolean')
  return { id: text(raw.id, 'milestone id', 200), name: text(raw.name, 'milestone name', 500), completion_requirements: strings(raw.completion_requirements, 'completion_requirements'), waiver_requirements: strings(raw.waiver_requirements, 'waiver_requirements'), final: raw.final === true }
 })
 need(new Set(milestones.map(m => m.id)).size === milestones.length, 'Milestone ids must be unique')
 if (old) {
  need(old.rules.every(r => canonical(r) === canonical(rules.find(next => next.line_id === r.line_id))) && old.milestones.every(m => canonical(m) === canonical(milestones.find(next => next.id === m.id))), 'Existing retainage rates and milestones cannot be changed or removed', 409, 'retainage_immutable')
  need(rules.length > old.rules.length || milestones.length > old.milestones.length, 'Retainage terms are unchanged', 409, 'retainage_unchanged')
 }
 const by = stamp(actor), plan: RetainagePlan = { id: old?.id ?? crypto.randomUUID(), revision: (old?.revision ?? 0) + 1, contract_reference, sov_revision_id: sov.id, rules, milestones, prepared_by: by, approved_by: structuredClone(by) }
 recordApproval(job, actor, 'retainage_plan', plan, plan)
 ;(job as RetainageJob).retainage = { plan, releases: state?.releases ?? [] }
 return plan
}
function withheld(line: SovApplicationLine | undefined, rules: RetainageRule[]): { work: number; stored: number; total: number } {
 if (!line) return { work: 0, stored: 0, total: 0 }
 const rule = rules.find(r => r.line_id === line.id)
 need(line.scheduled_cents <= 0 || rule, 'Approve an appended retainage rule for every newly added positive SOV line', 409, 'retainage_rule_required')
 if (line.scheduled_cents <= 0) return { work: 0, stored: 0, total: 0 }
 const rounded = (amount: number, rate: number) => Number((BigInt(cents(amount)) * BigInt(rate) + 5000n) / 10000n)
 const work = rounded(line.completed_cents, rule!.work_bps), stored = rounded(line.stored_cents, rule!.stored_bps)
 return { work, stored, total: sum([work, stored]) }
}
function approved(job: Job): Claim[] { return job.claims.filter(c => c.status !== 'draft') }
function previousClaim(job: Job, application: SovApplication): Claim | undefined {
 if (!application.previous_claim_id) { need(application.previous_cents === 0, 'Previous retainage history is missing', 409, 'retainage_history'); return undefined }
 const previous = approved(job).find(c => c.id === application.previous_claim_id)
 need(previous?.sov && previous.cumulative_cents === application.previous_cents, 'Previous approved retainage history does not reconcile', 409, 'retainage_history')
 return previous
}
/** Recompute a preview without mutating the immutable snapshot stored on an approved application. */
export function retainageSnapshot(job: Job, application: SovApplication): RetainageSnapshot | undefined {
 const state = (job as RetainageJob).retainage
 if (!state) return undefined
 const prior = previousClaim(job, application), ancestors = new Set<string>()
 let cursor = prior
 while (cursor) {
  need(!ancestors.has(cursor.id) && cursor.sov, 'Approved retainage history is invalid', 409, 'retainage_history')
  ancestors.add(cursor.id)
  const previousId = cursor.sov.previous_claim_id
  cursor = previousId ? approved(job).find(c => c.id === previousId) : undefined
  need(!previousId || cursor, 'Approved retainage ancestry is missing a source claim', 409, 'retainage_history')
 }
 const source = approved(job).find(c => c.sov && c.cumulative_cents === application.total_cents && c.sov.previous_claim_id === application.previous_claim_id && canonical(c.sov.lines) === canonical(application.lines))
 const priorReleases = state.releases.filter(r => ancestors.has(r.source_claim_id)), releases = state.releases.filter(r => ancestors.has(r.source_claim_id) || r.source_claim_id === source?.id)
 const released = (rows: RetainageRelease[], id: string) => sum(rows.flatMap(r => r.lines.filter(l => l.line_id === id).map(l => l.amount_cents)))
 const lines = application.lines.map<RetainageLineSnapshot>(line => {
  const before = prior?.sov?.lines.find(l => l.id === line.id), previous = withheld(before, state.plan.rules), current = withheld(line, state.plan.rules), cumulative_released_cents = released(releases, line.id)
  need(current.total >= cumulative_released_cents, 'Earned retainage cannot fall below already released value on a line', 409, 'retainage_balance')
  const previous_net_cents = sum([before?.total_cents ?? 0, -previous.total, released(priorReleases, line.id)]), cumulative_net_cents = sum([line.total_cents, -current.total, cumulative_released_cents])
  return { line_id: line.id, gross_cents: line.total_cents, work_withheld_cents: current.work, stored_withheld_cents: current.stored, previous_withheld_cents: previous.total, current_withheld_cents: current.total - previous.total, cumulative_withheld_cents: current.total, cumulative_released_cents, held_cents: current.total - cumulative_released_cents, previous_net_cents, current_net_cents: cumulative_net_cents - previous_net_cents, cumulative_net_cents }
 })
 const keys: (keyof RetainageAmounts)[] = ['gross_cents', 'previous_withheld_cents', 'current_withheld_cents', 'cumulative_withheld_cents', 'cumulative_released_cents', 'held_cents', 'previous_net_cents', 'current_net_cents', 'cumulative_net_cents']
 const totals = Object.fromEntries(keys.map(key => [key, sum(lines.map(line => line[key]))])) as unknown as RetainageAmounts
 return { plan_id: state.plan.id, plan_revision: state.plan.revision, contract_reference: state.plan.contract_reference, release_ids: releases.map(r => r.id), lines, ...totals }
}
/** Current client balance includes releases recorded after the final gross draw. No funds transfer is asserted. */
export function currentRetainageBalance(job: Job): RetainageSnapshot | undefined {
 const latest = approved(job).reduce<Claim | undefined>((a, b) => !a || b.cumulative_cents > a.cumulative_cents ? b : a, undefined)
 return latest?.sov ? retainageSnapshot(job, latest.sov) : undefined
}
function references(value: unknown, requirements: string[], name: string): RetainageReference[] {
 need(value === undefined || Array.isArray(value), `${name} must be an array`)
 const rows = ((value as unknown[] | undefined) ?? []).map(value => { const raw = object(value); return { requirement: text(raw.requirement, 'requirement', 2000), reference: text(raw.reference, 'source reference', 4000) } })
 need(rows.length === requirements.length && new Set(rows.map(r => r.requirement)).size === rows.length && requirements.every(requirement => rows.some(r => r.requirement === requirement)), 'Provide exactly one source reference for every configured milestone requirement', 409, 'retainage_evidence')
 return requirements.map(requirement => rows.find(r => r.requirement === requirement)!)
}
/** A human records contract-specific evidence; Plinth does not certify statutory waiver sufficiency. */
export function releaseRetainage(job: Job, actor: Actor, input: Input): RetainageRelease {
 requireJobManager(actor); active(job); usdOnly(job)
 const state = (job as RetainageJob).retainage
 need(state, 'Configure retainage before a release', 409, 'retainage_required')
 const milestone_id = text(input.milestone_id, 'milestone_id', 200), milestone = state.plan.milestones.find(m => m.id === milestone_id)
 need(milestone, 'Use a configured retainage milestone', 409, 'retainage_milestone')
 need(!state.releases.some(r => r.milestone_id === milestone_id), 'This milestone has already been released', 409, 'retainage_duplicate')
 const claim_id = text(input.claim_id, 'claim_id', 200), claim = approved(job).find(c => c.id === claim_id), latest = approved(job).reduce<Claim | undefined>((a, b) => !a || b.cumulative_cents > a.cumulative_cents ? b : a, undefined)
 need(claim?.sov && claim.approved_by && claim.approved_by.role !== 'agent' && claim.id === latest?.id, 'Release against the latest human-approved earned pay app', 409, 'retainage_claim_stale')
 const balance = retainageSnapshot(job, claim.sov)!
 const completion_references = references(input.completion_references, milestone.completion_requirements, 'completion_references'), waiver_references = references(input.waiver_references, milestone.waiver_requirements, 'waiver_references')
 const completion_reference = text(input.completion_reference ?? completion_references[0]?.reference, 'completion_reference', 4000)
 const waiver_reference = input.waiver_reference === undefined && !waiver_references.length && !milestone.final ? undefined : text(input.waiver_reference ?? waiver_references[0]?.reference, 'waiver_reference', 4000)
 need(Array.isArray(input.lines) && input.lines.length > 0, 'Specify positive retainage release cents by SOV line')
 const lines = input.lines.map(value => {
  const raw = object(value), line_id = text(raw.line_id, 'line_id', 200), amount_cents = cents(raw.amount_cents), line = balance.lines.find(l => l.line_id === line_id)
  need(line && amount_cents > 0 && amount_cents <= line.held_cents, 'Each release must be positive and within the line’s unreleased earned hold', 409, 'retainage_balance')
  return { line_id, amount_cents }
 })
 need(new Set(lines.map(l => l.line_id)).size === lines.length, 'Release each line at most once')
 const amount_cents = sum(lines.map(l => l.amount_cents))
 if (milestone.final) {
  need(claim.sov.sov_revision.source_digest === canonical(sovSources(job)), 'Approve final completion against the current contract sources before final release', 409, 'retainage_claim_stale')
  need(claim.sov.total_cents === claim.sov.scheduled_cents && claim.sov.lines.every(l => l.stored_cents === 0) && amount_cents === balance.held_cents, 'Final release requires full approved completion, no stored materials, and release of the remaining held balance', 409, 'retainage_final')
 }
 const by = stamp(actor), release: RetainageRelease = { id: crypto.randomUUID(), plan_id: state.plan.id, plan_revision: state.plan.revision, milestone_id, milestone: structuredClone(milestone), source_claim_id: claim.id, lines, amount_cents, completion_reference, ...(waiver_reference ? { waiver_reference } : {}), completion_references, waiver_references, prepared_by: by, approved_by: structuredClone(by) }
 recordApproval(job, actor, 'retainage_release', release, release)
 state.releases.push(release)
 return release
}
