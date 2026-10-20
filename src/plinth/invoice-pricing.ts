import { cents, find, need, sum, type Job } from './model'
import { calculatePricing, type PricingSnapshot } from './pricing-model'
import { retainageSnapshot } from './retainage'
import { sovSources } from './sov'
import { invoiceRows, type Invoice, type InvoiceSources, type InvoiceTaxLine } from './invoice-model'

const clone = <T>(value: T): T => structuredClone(value)
export const invoiceDigest = (sources: InvoiceSources) => JSON.stringify(sources)
/** A rounded cumulative share minus prior allocation closes to the reviewed source cent exactly. */
function share(amount: number, tax: number, gross: number): number {
 need(gross > 0 && amount >= 0 && amount <= gross, 'Invoice allocation must remain within reviewed selling value', 409, 'invoice_tax_balance')
 const sign = tax < 0 ? -1n : 1n, magnitude = BigInt(Math.abs(tax))
 return cents(Number(sign * ((2n * BigInt(amount) * magnitude + BigInt(gross)) / (2n * BigInt(gross)))), 'allocated source tax', true)
}
function sourceTax(pricing: PricingSnapshot) {
 const priced = calculatePricing(pricing.base_lines, pricing.basis, pricing.rules, pricing.tax.rate.percent, pricing.tax.taxable_line_ids)
 const before = calculatePricing(pricing.base_lines, pricing.basis, pricing.rules, '0', pricing.tax.taxable_line_ids)
 need(pricing.approved_by && pricing.tax.provider === 'manual' && pricing.tax.verification === 'human reviewed' && pricing.tax.rate.human_reviewed && pricing.approved_by.role !== 'agent', 'Reviewed human pricing and tax are required', 409, 'invoice_pricing')
 need(priced.total_cents === pricing.total_cents && priced.tax_cents === pricing.tax.tax_cents && priced.subtotal_cents === pricing.subtotal_cents, 'Reviewed source pricing does not reconcile', 409, 'invoice_pricing')
 return priced.lines.filter(l => l.included !== false).map(line => ({ line, tax: line.total_cents - find(before.lines.map(l => ({ ...l, id: l.id! })), line.id!).total_cents }))
}
export function invoiceSources(job: Job, source_application_id?: string): InvoiceSources {
 const contract = sovSources(job), original_budget = job.budgets?.[0], current_budget = job.budgets?.at(-1)
 need(original_budget && current_budget, 'An accepted original and current budget are required before invoicing', 409, 'invoice_budget')
 need(original_budget.source.kind === 'quote' && original_budget.source.id === contract.quote.id && original_budget.source.revision === contract.quote.revision && original_budget.contract_cents === contract.quote.total_cents, 'Original budget must match the accepted quote', 409, 'invoice_budget')
 const calculated = sourceTax(contract.quote.pricing)
 need(contract.quote.lines.filter(l => l.included !== false).every(l => calculated.some(t => t.line.id === l.id && t.line.total_cents === l.total_cents)), 'Accepted selling lines do not match reviewed pricing', 409, 'invoice_pricing')
 const amount = sum([contract.quote.total_cents, ...contract.variations.map(v => v.amount_cents)])
 need(current_budget.contract_cents === amount && sum(current_budget.billing_lines.map(l => l.scheduled_cents)) === amount, 'Current budget must reconcile to approved contract sources', 409, 'invoice_budget')
 need(contract.variations.every(v => job.budgets!.some(b => b.source.kind === 'variation' && b.source.id === v.id && b.source.revision === v.revision)), 'Approved changes must be represented in the current budget', 409, 'invoice_budget')
 const claim = source_application_id ? find(job.claims, source_application_id) : undefined
 if (claim) {
  need(claim.status === 'exported' && claim.export?.sov && claim.exported_by && claim.approved_by, 'A milestone invoice requires one issued coded application', 409, 'invoice_application')
  const historical = claim.export.sov.sov_revision.sources, sourceBudget = job.budgets!.find(b=>b.revision===claim.reconciliation.budget_revision)
  need(JSON.stringify(historical.quote) === JSON.stringify(contract.quote) && historical.variations.every(old=>contract.variations.some(current=>JSON.stringify(current)===JSON.stringify(old))) && sourceBudget?.contract_cents === claim.export.sov.scheduled_cents && claim.cumulative_cents <= current_budget.contract_cents, 'Issued application source history must remain intact inside the current approved contract', 409, 'invoice_stale')
 }
 return clone({ contract, original_budget, current_budget, allowance_changes: job.variations.filter(v => v.status === 'approved' && v.allowance_change).map(v => v.allowance_change!), ...(claim ? { application: claim.export!.sov!, ...(job.retainage ? { retainage: { state: job.retainage, current: retainageSnapshot(job, claim.export!.sov!)! } } : {}) } : {}), tax_verification: 'Human reviewed source; no provider verification or legal certification' as const, cost_uncertainty: current_budget.codes.some(c => c.cost_cents === null) ? 'Some source costs remain unknown; invoice selling values do not establish actual cost or profit.' : 'Recorded source costs are staff evidence, not independently verified actual costs.' })
}
/** Deposits disclose a quote-tax share and earn no revenue; milestones allocate earned source tax separately. */
export function invoiceLines(job: Job, row: Pick<Invoice, 'id' | 'kind' | 'amount_cents' | 'source_application_id'>, sources: InvoiceSources): InvoiceTaxLine[] {
 const quote = sources.contract.quote, taxes = sourceTax(quote.pricing)
 if (row.kind === 'deposit') {
  const gross = sources.current_budget.contract_cents, tax = sum([quote.pricing.tax.tax_cents, ...sources.contract.variations.map(v=>v.pricing.tax.tax_cents * (v.amount_cents < 0 ? -1 : 1))])
  need(gross > 0 && row.amount_cents <= gross, 'Deposit must fit the current approved contract', 409, 'invoice_balance')
  const previous = invoiceRows(job).filter(i => i.id !== row.id && i.kind === 'deposit' && i.issued)
  const before = sum(previous.map(i => i.issued!.gross_cents)), after = sum([before, row.amount_cents])
  need(after <= gross, 'Issued deposit requests exceed the current approved contract', 409, 'invoice_balance')
  const tax_cents = share(after, tax, gross) - sum(previous.map(i => i.issued!.tax_cents))
  return [{ id: `deposit:${quote.id}`, description: 'Deposit against accepted quote: ' + taxes.map(t => t.line.description).join('; '), source_id: quote.id, source_revision: quote.revision, gross_cents: row.amount_cents, subtotal_cents: row.amount_cents - tax_cents, tax_cents, reviewed_source_gross_cents: gross, reviewed_source_tax_cents: tax }]
 }

 const app = sources.application!
 return app.lines.map(line => {
  const variation = line.source.kind === 'variation' ? sources.contract.variations.find(v => v.id === line.source.id) : undefined
  const tax = variation ? sum(sourceTax(variation.pricing).map(l => l.tax)) * (variation.amount_cents < 0 ? -1 : 1) : taxes.find(t => t.line.id === line.source.line_id)?.tax
  need(tax !== undefined, 'Application line lacks reviewed tax provenance', 409, 'invoice_pricing')
  const previous = invoiceRows(job).filter(i => i.id !== row.id && i.kind === 'milestone' && i.source_application_id && i.issued)
  const priorGross = sum(previous.map(i => i.issued!.lines.find(l => l.id === line.id)?.gross_cents ?? 0)), priorTax = sum(previous.map(i => i.issued!.lines.find(l => l.id === line.id)?.tax_cents ?? 0))
  need(priorGross === line.previous_cents, 'Invoice earlier issued applications before this one', 409, 'invoice_order')
  const tax_cents = line.scheduled_cents < 0 ? tax - priorTax : line.scheduled_cents === 0 ? 0 : share(line.total_cents, tax, line.scheduled_cents) - priorTax
  return { id: line.id, description: line.description, source_id: line.source.id, source_revision: line.source.revision, ...(line.source.line_id ? { source_line_id: line.source.line_id } : {}), gross_cents: line.current_cents, subtotal_cents: line.current_cents - tax_cents, tax_cents, reviewed_source_gross_cents: line.scheduled_cents, reviewed_source_tax_cents: tax }
 })
}
