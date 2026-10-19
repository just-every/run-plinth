import { requireJobManager, requireManager } from './auth'
import { date } from './catalog-input'
import { need, object, usdOnly, recordApproval, stamp, text, type Actor, type Input, type Job, type Quote } from './model'
import { calculatePricing, pricingPercent, pricingRules, type PricingRate, type PricingRateRevision, type PricingSnapshot } from './pricing-model'
import { prepareQuote } from './quotes'
import { readClock, transaction } from './store'

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
export async function pricingRate(db: D1Database, id: string): Promise<PricingRate> {
 const row = await db.prepare('SELECT data FROM pl_pricing_rates WHERE id=?').bind(id).first<{ data: string }>()
 need(row, 'Reviewed tax rate not found', 404, 'not_found'); return JSON.parse(row.data) as PricingRate
}
/** Only a signed-in human manager records reviewed rates; bearer credentials remain preview-only. */
export async function pricingResponse(request: Request, db: D1Database, actor: Actor, parts: string[], readBody: (request: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[0] !== 'pricing-rates') return null
 requireManager(actor, request.method === 'GET'); need(parts.length <= 2, 'Unknown pricing rate route', 404, 'not_found')
 if (request.method === 'GET') {
  if (parts[1]) return Response.json({ rate: await pricingRate(db, parts[1]) }, { headers })
  const rows = await db.prepare('SELECT data FROM pl_pricing_rates ORDER BY rowid').all<{ data: string }>()
  return Response.json({ rates: rows.results.map(row => JSON.parse(row.data)) }, { headers })
 }
 need(request.method === 'POST', 'Method not allowed', 405)
 const input = await readBody(request), clock = await readClock(db), previous = parts[1] ? await pricingRate(db, parts[1]) : undefined
 if (previous) need(input.expected_version === previous.version, 'Tax rate changed; reload before recording a revision', 409, 'stale_version')
 need(input.human_reviewed === true, 'Confirm that a person reviewed the rate and source evidence')
 need(input.kind === 'sales' || input.kind === 'use', 'Choose sales or use tax')
 const version = (previous?.version ?? 0) + 1
 const revision: PricingRateRevision = { version, effective_on: date(input.effective_on), jurisdiction: text(input.jurisdiction, 'Tax jurisdiction', 200), kind: input.kind, percent: pricingPercent(input.percent, 'Tax rate', 100), reference: text(input.reference, 'Reviewed rate source reference', 2000), human_reviewed: true, approved_by: stamp(actor) }
 const rate: PricingRate = { id: previous?.id ?? crypto.randomUUID(), version, revisions: [...(previous?.revisions ?? []), revision] }
 const data = JSON.stringify(rate); need(data.length <= 2_000_000, 'Tax rate history is too large')
 const writes = previous ? [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_pricing_rates WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(rate.id, previous.version), db.prepare('UPDATE pl_pricing_rates SET version=?,data=? WHERE id=?').bind(version, data, rate.id)] : [db.prepare('INSERT INTO pl_pricing_rates(id,version,data) VALUES(?,?,?)').bind(rate.id, version, data)]
 await transaction(db, actor, null, writes, clock)
 return Response.json({ rate }, { status: previous ? 200 : 201, headers })
}
async function digest(value: unknown) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('') }
export async function previewPricing(db: D1Database, job: Job, actor: Actor, input: Input) {
 requireJobManager(actor, true); usdOnly(job)
 const current = job.quotes.at(-1); need(current, 'Prepare an estimate before pricing', 409, 'quote_required')
 need(input.quote_id === undefined || input.quote_id === current.id, 'Price the current quote revision', 409, 'revision')
 need(input.basis === undefined || input.basis === 'sell' || input.basis === 'cost', 'Choose sell or cost pricing basis')
 const basis = input.basis === 'cost' ? 'cost' as const : 'sell' as const
 const existing = (current as Quote & { pricing?: PricingSnapshot }).pricing
 const base_lines = structuredClone(existing?.base_lines ?? current.lines)
 // Legacy imported lines had no ids. Their stable position supplies preview custody.
 base_lines.forEach((line, index) => { line.id ??= `legacy-${index + 1}` })
 const included = base_lines.filter(line => line.included !== false), rules = pricingRules(input.rules ?? [], included), tax = object(input.tax)
 need(tax.provider === undefined || tax.provider === 'manual', 'Tax provider calculation is unavailable; no provider-verified tax can be claimed', 503, 'tax_provider_unavailable')
 const as_of = date(input.as_of), rate = await pricingRate(db, text(tax.rate_id, 'Reviewed tax rate id', 100))
 const revision = rate.revisions.filter(row => row.effective_on <= as_of).sort((a, b) => b.effective_on.localeCompare(a.effective_on) || b.version - a.version)[0]
 need(revision, 'No human-reviewed rate exists for this date', 409, 'rate_missing')
 need(Array.isArray(tax.taxable_line_ids) && tax.taxable_line_ids.every(id => typeof id === 'string' && included.some(line => line.id === id)), 'Review the taxable included line ids')
 const taxable_line_ids = included.filter(line => (tax.taxable_line_ids as string[]).includes(line.id!)).map(line => line.id!)
 need(taxable_line_ids.length === tax.taxable_line_ids.length, 'Taxable line ids must be unique')
 const exemption_reference = text(tax.exemption_reference, 'Exemption evidence reference', 2000, taxable_line_ids.length === included.length)
 const calculated = calculatePricing(base_lines, basis, rules, revision.percent, taxable_line_ids)
 const pricing: PricingSnapshot = { basis, base_quote_id: current.id, base_quote_revision: current.revision, base_lines, rules, stages: calculated.stages, tax: { rate_id: rate.id, rate_version: revision.version, rate_record_version: rate.version, rate: revision, as_of, provider: 'manual', verification: 'human reviewed', taxable_line_ids, exemption_reference, taxable_cents: calculated.taxable_cents, exempt_cents: calculated.exempt_cents, tax_cents: calculated.tax_cents }, subtotal_cents: calculated.subtotal_cents, total_cents: calculated.total_cents }
 const proposal = { lines: calculated.lines, total_cents: calculated.total_cents, cost_total_cents: current.cost_total_cents, alternate_selections: current.alternate_selections, inclusions: current.inclusions, exclusions: current.exclusions, notes: current.notes, ...(current.cost_catalog ? { cost_catalog: current.cost_catalog } : {}), pricing }
 return { proposal, previous_total_cents: current.total_cents, total_delta_cents: calculated.total_cents - current.total_cents, sold: job.status !== 'quoting', digest: await digest([job.id, job.version, proposal]) }
}
export async function applyPricing(db: D1Database, job: Job, actor: Actor, input: Input) {
 requireJobManager(actor); usdOnly(job)
 const preview = await previewPricing(db, job, actor, input)
 need(input.digest === preview.digest, 'Quote, pricing inputs or reviewed rate revisions changed; preview again before approving', 409, 'pricing_review')
 need(!preview.sold, 'Sold estimates stay frozen; use a change order', 409, 'quote_frozen')
 // prepareQuote validates native measurement fields and creates the next immutable revision.
 const quote = prepareQuote(job, actor, { ...preview.proposal, lines: preview.proposal.pricing.base_lines }) as Quote & { pricing: PricingSnapshot }
 quote.lines = preview.proposal.lines; quote.total_cents = preview.proposal.total_cents; quote.selling_adjusted = true
 if (preview.proposal.cost_catalog) quote.cost_catalog = preview.proposal.cost_catalog
 quote.pricing = { ...preview.proposal.pricing, approved_by: stamp(actor) }
 recordApproval(job, actor, 'estimate.pricing', quote, { quote_id: quote.id, revision: quote.revision, pricing: quote.pricing, lines: quote.lines, total_cents: quote.total_cents, cost_total_cents: quote.cost_total_cents })
 return quote
}
