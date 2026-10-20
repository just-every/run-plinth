import { requireJobManager } from './auth'
import { retainageSnapshot } from './retainage'
import { active, cents, need, object, recordApproval, stamp, sum, text, usdOnly, type Actor, type Input, type Job, type Stamp, type Variation } from './model'
import type { PricingSnapshot } from './pricing-model'
import type { SovApplication, SovApplicationLine, SovClaim, SovJob, SovLine, SovRevision, SovSources, SovStoredOrder } from './sov-model'

const purpose = 'Commercial schedule of values and progress application for external books. Not an invoice, licensed AIA form, or legal certification.'
/** Stable object order makes source comparisons independent of JSON property ordering. */
function canonical(value: unknown): string {
 if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
 if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
 return JSON.stringify(value) ?? 'null'
}
function reviewed(pricing: PricingSnapshot | undefined, amount: number, label: string): PricingSnapshot {
 need(pricing?.approved_by && pricing.approved_by.role !== 'agent' && pricing.tax?.rate?.human_reviewed === true && pricing.tax.rate.approved_by && pricing.tax.rate.approved_by.role !== 'agent' && pricing.tax.verification === 'human reviewed', `${label} needs an approved EST-003 pricing snapshot with human-reviewed tax before preparing a schedule of values`, 409, 'sov_pricing_required')
 need(pricing.total_cents === amount, `${label} pricing snapshot no longer matches its approved selling value`, 409, 'sov_pricing_stale')
 return structuredClone(pricing)
}
/** Includes only accepted/approved economics. Office pricing stays inside manager projections. */
export function sovSources(job: Job): SovSources {
 active(job); usdOnly(job)
 const accepted = job.quotes.filter(q => q.status === 'accepted')
 need(accepted.length === 1, 'Accept exactly one quote before preparing a schedule of values', 409, 'quote_required')
 const quote = accepted[0]!, pricing = reviewed(quote.pricing, quote.total_cents, 'Accepted quote')
 const included = quote.lines.filter(line => line.included !== false)
 need(included.length > 0 && included.every(line => typeof line.id === 'string' && line.id.trim().length > 0) && new Set(included.map(line => line.id)).size === included.length, 'Reviewed quote lines need unique stable ids before preparing a schedule of values', 409, 'sov_line_ids')
 need(sum(included.map(line => cents(line.total_cents, 'scheduled value', true))) === quote.total_cents, 'Accepted quote selling lines must reconcile to its approved total', 409, 'sov_balance')
 const variations = job.variations.filter(v => v.status === 'approved').map(raw => {
  const v = raw as Variation & { pricing?: PricingSnapshot; pricing_direction?: 'charge' | 'credit'; cost_code?: string }
  need(v.approved_by && v.approved_by.role !== 'agent', 'Change orders need their existing human approval', 409, 'sov_variation_required')
  need(v.amount_cents !== 0 && (v.amount_cents < 0) === (v.pricing_direction === 'credit'), 'Change order pricing direction must match its signed contract delta', 409, 'sov_pricing_stale')
  return { id: v.id, revision: v.revision, description: v.description, amount_cents: cents(v.amount_cents, 'change order value', true), ...(v.cost_code ? { cost_code: v.cost_code } : {}), pricing: reviewed(v.pricing, Math.abs(v.amount_cents), 'Approved change order'), pricing_direction: v.amount_cents < 0 ? 'credit' as const : 'charge' as const, approved_by: structuredClone(v.approved_by) }
 }).sort((a, b) => a.id.localeCompare(b.id))
 return { quote: { id: quote.id, revision: quote.revision, total_cents: quote.total_cents, lines: structuredClone(quote.lines), pricing, ...(quote.acceptance ? { acceptance: structuredClone(quote.acceptance) } : {}) }, variations }
}
function approvedClaims(job: Job): SovClaim[] {
 const claims = job.claims.filter(c => c.status !== 'draft') as SovClaim[]
 need(claims.every(c => c.sov), 'Earlier approved pay apps have no coded line history. A reviewed migration is required before using a schedule of values; prior progress cannot be invented.', 409, 'sov_legacy_history')
 return claims
}
function latestClaim(job: Job): SovClaim | undefined {
 return approvedClaims(job).reduce<SovClaim | undefined>((latest, claim) => !latest || claim.cumulative_cents > latest.cumulative_cents ? claim : latest, undefined)
}
function sourceLines(sources: SovSources): (Omit<SovLine, 'cost_code'> & { cost_code?: string })[] {
 return [...sources.quote.lines.filter(l => l.included !== false).map(line => ({ id: `quote:${line.id!}`, cost_code: line.cost_code, description: line.description, scheduled_cents: line.total_cents, source: { kind: 'quote' as const, id: sources.quote.id, revision: sources.quote.revision, line_id: line.id! } })), ...sources.variations.map(v => ({ id: `variation:${v.id}`, cost_code: v.cost_code, description: v.description, scheduled_cents: v.amount_cents, source: { kind: 'variation' as const, id: v.id, revision: v.revision } }))]
}
/** A human adopts a baseline; later revisions append approved changes without rewriting it. */
export function prepareSov(job: Job, actor: Actor, input: Input): SovRevision {
 requireJobManager(actor)
 const sources = sovSources(job), previous = (job as SovJob).sov?.at(-1), source_digest = canonical(sources), latest = latestClaim(job)
 need(!previous || previous.source_digest !== source_digest, 'Approved sources are unchanged; the existing schedule of values remains current', 409, 'sov_unchanged')
 if (previous) {
  need(canonical(previous.sources.quote) === canonical(sources.quote), 'The original accepted quote baseline cannot be rewritten', 409, 'sov_immutable')
  for (const source of previous.sources.variations) need(canonical(source) === canonical(sources.variations.find(v => v.id === source.id)), 'Previously scheduled approved changes cannot be removed or rewritten', 409, 'sov_immutable')
 }
 const assignments = input.code_assignments === undefined ? {} : object(input.code_assignments), fresh = sourceLines(sources)
 const available = previous ? [...previous.lines.map(old => { const line = fresh.find(row => row.id === old.id); need(line, 'A revision cannot remove original rows', 409, 'sov_immutable'); return line }), ...fresh.filter(line => !previous.lines.some(old => old.id === line.id))] : fresh
 need(Object.keys(assignments).every(id => available.some(line => line.id === id)), 'Cost code assignments must name current quote or change order source ids')
 const lines = available.map<SovLine>(line => {
  const old = previous?.lines.find(row => row.id === line.id)
  const cost_code = text(old?.cost_code ?? (line.cost_code?.trim() || assignments[line.id]), `Cost code for ${line.id}`, 40)
  need(assignments[line.id] === undefined || text(assignments[line.id], 'Cost code', 40) === cost_code, 'A frozen cost code cannot be reassigned', 409, 'sov_immutable')
  const next = { ...line, cost_code }
  need(!old || canonical(old) === canonical(next), 'Previously scheduled rows cannot be rewritten', 409, 'sov_immutable')
  const billed = latest?.sov?.lines.find(row => row.id === line.id)
  need(!billed || line.scheduled_cents >= billed.total_cents, 'A revision cannot hide previously approved line progress', 409, 'sov_progress')
  return next
 })
 need(!previous || previous.lines.every(old => lines.some(line => line.id === old.id)), 'A revision cannot remove original rows', 409, 'sov_immutable')
 const contract_cents = sum(lines.map(line => line.scheduled_cents))
 need(contract_cents >= (latest?.cumulative_cents ?? 0), 'Contract changes cannot reduce value below approved pay apps', 409, 'sov_balance')
 const by = stamp(actor), revision: SovRevision = { id: crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1, currency: 'USD', prepared_by: by, approved_by: structuredClone(by), source_digest, sources, lines, contract_cents }
 recordApproval(job, actor, 'sov', revision, revision)
 ;((job as SovJob).sov ??= []).push(revision)
 return revision
}
function currentRevision(job: Job): SovRevision {
 const revision = (job as SovJob).sov?.at(-1)
 need(revision, 'Prepare the schedule of values before preparing a coded progress application', 409, 'sov_required')
 need(revision.source_digest === canonical(sovSources(job)), 'Approved contract sources changed; prepare a new schedule of values revision', 409, 'sov_stale')
 return revision
}
const percent = (total: number, scheduled: number) => scheduled === 0 ? 0 : Math.round(total / scheduled * 10000) / 100

/** Find a feasible receipt allocation without counting the same PO money twice across rows. */
function allocateStored(lines: SovApplicationLine[], capacities: Map<string, number>) {
 const allocations = lines.map(() => new Map<string, number>()), used = new Map<string, number>()
 function send(index: number, amount: number, seen: Set<number>, blocked: Set<string>): number {
  if (seen.has(index)) return 0
  seen.add(index)
  let sent = 0
  for (const id of lines[index]!.order_ids) {
   if (blocked.has(id)) continue
   let free = (capacities.get(id) ?? 0) - (used.get(id) ?? 0)
   if (free < amount - sent) for (let other = 0; other < lines.length; other++) {
    const held = allocations[other]!.get(id) ?? 0
    if (other === index || held === 0 || seen.has(other)) continue
    const moved = send(other, Math.min(held, amount - sent - free), new Set(seen), new Set([...blocked, id]))
    if (moved) { allocations[other]!.set(id, held - moved); used.set(id, (used.get(id) ?? 0) - moved); free = (capacities.get(id) ?? 0) - (used.get(id) ?? 0) }
    if (free >= amount - sent) break
   }
   const moved = Math.min(free, amount - sent)
   if (moved > 0) { allocations[index]!.set(id, (allocations[index]!.get(id) ?? 0) + moved); used.set(id, (used.get(id) ?? 0) + moved); sent += moved }
   if (sent === amount) break
  }
  return sent
 }
 lines.forEach((line, i) => need(send(i, line.stored_cents, new Set(), new Set()) === line.stored_cents, 'Stored materials exceed the net receipts on their referenced issued POs, including references shared by other rows', 409, 'sov_stored_balance'))
 lines.forEach((line, i) => line.stored_orders.forEach(order => { order.allocated_cents = allocations[i]!.get(order.id) ?? 0 }))
}
function buildApplication(job: Job, input: Input, prepared_by: Stamp): SovApplication {
 const revision = currentRevision(job), previous = latestClaim(job)
 need(Array.isArray(input.lines) && input.lines.length === revision.lines.length, 'Include every current schedule of values row exactly once')
 const inputs = input.lines.map(object), ids = inputs.map(row => text(row.line_id, 'line_id', 200))
 need(new Set(ids).size === ids.length && ids.every(id => revision.lines.some(line => line.id === id)), 'Include every current schedule of values row exactly once')
 const capacities = new Map<string, number>()
 const lines = revision.lines.map<SovApplicationLine>(line => {
  const raw = inputs[ids.indexOf(line.id)]!, before = previous?.sov?.lines.find(row => row.id === line.id)
  const completed_cents = cents(raw.completed_cents, 'completed_cents', line.scheduled_cents < 0), stored_cents = cents(raw.stored_cents, 'stored_cents'), total_cents = sum([completed_cents, stored_cents]), previous_cents = before?.total_cents ?? 0
  if (line.scheduled_cents < 0) need(completed_cents === line.scheduled_cents && stored_cents === 0, 'Credit rows must carry their full approved negative value as completed and no stored materials', 409, 'sov_credit')
  else need(total_cents <= line.scheduled_cents && total_cents >= previous_cents, 'Cumulative completed plus stored progress must stay within the scheduled value and cannot drop below earlier approved line progress', 409, 'sov_progress')
  need(!before || total_cents >= before.total_cents, 'Previously approved line progress cannot be reversed', 409, 'sov_progress')
  const changed = !before ? completed_cents !== 0 || stored_cents !== 0 : completed_cents !== before.completed_cents || stored_cents !== before.stored_cents
  const evidence = text(raw.evidence, `Progress evidence for ${line.id}`, 4000, !changed)
  need(raw.order_ids === undefined || Array.isArray(raw.order_ids), 'order_ids must be an array of issued PO ids')
  const order_ids = ((raw.order_ids as unknown[] | undefined) ?? []).map(id => text(id, 'PO id', 100)).sort()
  need(new Set(order_ids).size === order_ids.length, 'Reference each PO only once per row')
  need(stored_cents === 0 || order_ids.length > 0, 'Stored materials require an issued PO with recorded receipts', 409, 'sov_stored_evidence')
  const stored_orders = order_ids.map<SovStoredOrder>(id => {
   const order = job.orders.find(o => o.id === id)
   need(order?.status === 'issued', 'Stored materials must reference an issued PO', 409, 'sov_stored_evidence')
   const receipts = order.receipts.map(r => ({ id: r.id, amount_cents: r.amount_cents, reference: r.reference })), returns = (order.returns ?? []).map(r => ({ id: r.id, amount_cents: r.amount_cents, reference: r.reference }))
   const received_cents = sum([...receipts.map(r => r.amount_cents), ...returns.map(r => -r.amount_cents)])
   need(received_cents >= 0, 'PO returns exceed recorded receipts', 409, 'sov_stored_evidence')
   capacities.set(id, received_cents)
   return { id, received_cents, allocated_cents: 0, receipts, returns }
  })
  return { ...structuredClone(line), previous_cents, completed_cents, stored_cents, current_cents: total_cents - previous_cents, total_cents, completion_percent: percent(total_cents, line.scheduled_cents), balance_cents: line.scheduled_cents - total_cents, evidence, order_ids, stored_orders }
 })
 need(!previous || previous.sov!.lines.every(old => lines.some(line => line.id === old.id)), 'Current rows cannot hide previously approved progress', 409, 'sov_progress')
 allocateStored(lines, capacities)
 const total_cents = sum(lines.map(line => line.total_cents)), previous_cents = sum(lines.map(line => line.previous_cents)), scheduled_cents = sum(lines.map(line => line.scheduled_cents))
 need(previous_cents === (previous?.cumulative_cents ?? 0), 'Earlier approved pay app totals do not reconcile to coded history', 409, 'sov_legacy_history')
 need(total_cents > previous_cents && total_cents <= scheduled_cents, 'Application total must exceed earlier approved applications and remain within the contract', 409, 'claim_balance')
 const application: SovApplication = { format: 'plinth-sov-application-v1', purpose, currency: 'USD', job_id: job.id, job_name: job.name, prepared_by: structuredClone(prepared_by), sov_revision: structuredClone(revision), ...(previous ? { previous_claim_id: previous.id } : {}), lines, scheduled_cents, previous_cents, completed_cents: sum(lines.map(line => line.completed_cents)), stored_cents: sum(lines.map(line => line.stored_cents)), current_cents: total_cents - previous_cents, total_cents, completion_percent: percent(total_cents, scheduled_cents), balance_cents: scheduled_cents - total_cents }
 const retainage = retainageSnapshot(job, application)
 return {...application,...(retainage ? {retainage} : {})}
}
/** Drafting records human-supplied work evidence; receipts never assert installation. */
export function prepareSovApplication(job: Job, actor: Actor, input: Input): SovApplication {
 requireJobManager(actor, true)
 return buildApplication(job, input, stamp(actor))
}
/** Recompute before human approval, pinning prior progress, sources, and net receipts. */
export function assertSovCurrent(job: Job, application: SovApplication): void {
 const input: Input = { lines: application.lines.map(line => ({ line_id: line.id, completed_cents: line.completed_cents, stored_cents: line.stored_cents, evidence: line.evidence, order_ids: line.order_ids })) }
 need(canonical(buildApplication(job, input, application.prepared_by)) === canonical(application), 'Sources, prior approved applications, or stored-material receipt evidence changed. Prepare a fresh application.', 409, 'sov_stale')
}
function csvCell(value: string | number): string {
 const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value)
 return `"${safe.replace(/"/g, '""')}"`
}
export function sovCsv(application: SovApplication): string {
 const rows: (string | number)[][] = [[application.purpose], ['Job', application.job_name, 'Currency', application.currency, 'SOV revision', application.sov_revision.revision, 'Accepted quote', application.sov_revision.sources.quote.id, 'Quote revision', application.sov_revision.sources.quote.revision], ['Line id', 'Cost code', 'Description', 'Scheduled cents', 'Previous cents', 'Completed to date cents', 'Stored to date cents', 'Current application cents', 'Total to date cents', 'Completion percent', 'Balance cents', 'Evidence', 'Issued PO ids', 'Source kind', 'Source id', 'Source revision', 'Source line id'], ...application.lines.map(l => [l.id, l.cost_code, l.description, l.scheduled_cents, l.previous_cents, l.completed_cents, l.stored_cents, l.current_cents, l.total_cents, l.completion_percent, l.balance_cents, l.evidence, l.order_ids.join('; '), l.source.kind, l.source.id, l.source.revision, l.source.line_id ?? '']), ['', '', 'TOTAL', application.scheduled_cents, application.previous_cents, application.completed_cents, application.stored_cents, application.current_cents, application.total_cents, application.completion_percent, application.balance_cents]]
 if (application.retainage) {
  rows.push(['Client retainage line', 'Prior withheld cents', 'Current withheld cents', 'Cumulative withheld cents', 'Released cents', 'Held cents', 'Prior net cents', 'Current net cents', 'Cumulative net cents'])
  for(const line of application.retainage.lines)rows.push([line.line_id,line.previous_withheld_cents,line.current_withheld_cents,line.cumulative_withheld_cents,line.cumulative_released_cents,line.held_cents,line.previous_net_cents,line.current_net_cents,line.cumulative_net_cents])
 }
 return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
