import { cents, need, object, sum, text, type Line, type Stamp } from './model'
import { decimal } from './estimate-math'

export interface PricingRateRevision {
 version: number; effective_on: string; jurisdiction: string; kind: 'sales' | 'use'; percent: string; reference: string; human_reviewed: true; approved_by: Stamp
}
export interface PricingRate { id: string; version: number; revisions: PricingRateRevision[] }
export interface PricingRule { scope: 'line' | 'phase' | 'project'; key?: string; overhead_percent: string; method: 'markup' | 'margin'; percent: string; discount_percent: string }
export interface PricingStage { kind: 'overhead' | 'markup' | 'margin' | 'discount' | 'tax'; scope: PricingRule['scope']; key?: string; percent: string; base_cents: number; adjustment_cents: number; total_cents: number; line_ids: string[] }
export interface PricingSnapshot {
 basis: 'cost' | 'sell'; base_quote_id: string; base_quote_revision: number; base_lines: Line[]; rules: PricingRule[]; stages: PricingStage[]
 tax: { rate_id: string; rate_version: number; rate_record_version: number; rate: PricingRateRevision; as_of: string; provider: 'manual'; verification: 'human reviewed'; taxable_line_ids: string[]; exemption_reference: string; taxable_cents: number; exempt_cents: number; tax_cents: number }
 subtotal_cents: number; total_cents: number; approved_by?: Stamp
}
/** Percentages stay exact decimals through the stage boundary. */
export function pricingPercent(value: unknown, name: string, limit = 1000, exclusive = false): string {
 const parsed = decimal(value ?? '0', name, false)
 need(exclusive ? parsed.numerator < BigInt(limit) * parsed.denominator : parsed.numerator <= BigInt(limit) * parsed.denominator, `${name} must be ${exclusive ? 'less than' : 'at most'} ${limit}%`)
 return String(value ?? '0')
}
export function pricingRules(value: unknown, lines: Line[]): PricingRule[] {
 need(Array.isArray(value) && value.length <= 201, 'Provide an array of at most 201 pricing rules')
 const seen = new Set<string>()
 return value.map<PricingRule>(raw => {
  const row = object(raw)
  need(row.scope === 'line' || row.scope === 'phase' || row.scope === 'project', 'Choose line, phase or project pricing scope')
  const scope = row.scope, key = scope === 'project' ? undefined : text(row.key, 'Scope key', 120)
  need(scope !== 'project' || row.key === undefined || row.key === '', 'Project rules cannot have a scope key')
  need(scope === 'project' || lines.some(line => scope === 'line' ? line.id === key : line.phase === key), 'Pricing scope must identify an included line or phase')
  const identity = JSON.stringify([scope, key]); need(!seen.has(identity), 'Only one pricing rule per line, phase or project is allowed'); seen.add(identity)
  need(row.method === undefined || row.method === 'markup' || row.method === 'margin', 'Choose markup or target margin')
  return { scope, ...(key === undefined ? {} : { key }), overhead_percent: pricingPercent(row.overhead_percent, 'Overhead'), method: row.method === 'margin' ? 'margin' : 'markup', percent: pricingPercent(row.percent, 'Markup or margin', row.method === 'margin' ? 100 : 1000, row.method === 'margin'), discount_percent: pricingPercent(row.discount_percent, 'Discount', 100) }
 }).sort((a, b) => ['line', 'phase', 'project'].indexOf(a.scope) - ['line', 'phase', 'project'].indexOf(b.scope) || (a.key ?? '').localeCompare(b.key ?? ''))
}
function rounded(n: bigint, d: bigint): number { return cents(Number((2n * n + d) / (2n * d))) }
/** Allocate a rounded stage total proportionally; largest remainders win in source-line order. */
function distribute(total: number, indices: number[], amounts: number[]): number[] {
 if (!indices.length) { need(total === 0, 'A nonzero stage requires included lines'); return [] }
 const base = sum(indices.map(index => amounts[index]!))
 if (base === 0) { need(total === 0, 'Cannot allocate a nonzero total to zero-value lines'); return indices.map(() => 0) }
 const rows = indices.map((index, order) => { const product = BigInt(total) * BigInt(amounts[index]!); return { order, value: Number(product / BigInt(base)), remainder: product % BigInt(base) } })
 let remaining = total - sum(rows.map(row => row.value))
 const ranked = [...rows].sort((a, b) => a.remainder === b.remainder ? a.order - b.order : a.remainder > b.remainder ? -1 : 1)
 for (const row of ranked) if (remaining > 0) { row.value++; remaining-- }
 return rows.map(row => row.value)
}
/** All overhead stages precede all markup/margin stages, then all discounts, then tax.
 * Within a stage line → phase → project compounds deliberately; duplicates are refused.
 * Each scoped stage rounds half-up once, then allocates cents without changing its total.
 */
export function calculatePricing(lines: Line[], basis: PricingSnapshot['basis'], rules: PricingRule[], taxPercent: string, taxableIds: string[]) {
 const included = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.included !== false)
 const amounts = lines.map(line => {
  if (line.included === false) return 0
  need(basis !== 'cost' || line.cost_total_cents !== undefined, 'Cost pricing requires a recorded cost for every included line')
  return cents(basis === 'cost' ? line.cost_total_cents : line.total_cents)
 }), stages: PricingStage[] = []
 const apply = (kind: PricingStage['kind'], scope: PricingRule['scope'], key: string | undefined, percent: string, indices: number[]) => {
  const base_cents = sum(indices.map(index => amounts[index]!)), p = decimal(percent, 'Percentage', false), hundred = 100n * p.denominator
  const total_cents = kind === 'margin' ? rounded(BigInt(base_cents) * hundred, hundred - p.numerator) : kind === 'discount' ? sum([base_cents, -rounded(BigInt(base_cents) * p.numerator, hundred)]) : sum([base_cents, rounded(BigInt(base_cents) * p.numerator, hundred)])
  const allocated = distribute(total_cents, indices, amounts)
  indices.forEach((index, order) => { amounts[index] = allocated[order]! })
  stages.push({ kind, scope, ...(key === undefined ? {} : { key }), percent, base_cents, adjustment_cents: total_cents - base_cents, total_cents, line_ids: indices.map(index => lines[index]!.id!) })
 }
 for (const stage of ['overhead', 'price', 'discount'] as const) for (const rule of rules) {
  const indices = included.filter(({ line }) => rule.scope === 'project' || (rule.scope === 'line' ? line.id === rule.key : line.phase === rule.key)).map(({ index }) => index)
  apply(stage === 'price' ? rule.method : stage, rule.scope, rule.key, stage === 'price' ? rule.percent : stage === 'overhead' ? rule.overhead_percent : rule.discount_percent, indices)
 }
 const subtotal_cents = sum(amounts), taxableIndices = included.filter(({ line }) => taxableIds.includes(line.id!)).map(({ index }) => index)
 const taxable_cents = sum(taxableIndices.map(index => amounts[index]!)), exempt_cents = subtotal_cents - taxable_cents
 apply('tax', 'project', undefined, taxPercent, taxableIndices)
 const total_cents = sum(amounts), tax_cents = total_cents - subtotal_cents
 const selling_lines = lines.map((line, index) => ({ ...structuredClone(line), total_cents: line.included === false ? line.total_cents : amounts[index]! }))
 return { lines: selling_lines, stages, subtotal_cents, total_cents, taxable_cents, exempt_cents, tax_cents }
}
