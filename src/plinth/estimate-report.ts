import { requireJobManager } from './auth'
import { currencyOf, find, sum, type Actor, type Job, type Line, type Quote } from './model'

const included = (line: Line) => line.included !== false
const cost = (lines: Line[]) => lines.every(line => line.cost_total_cents !== undefined) ? sum(lines.map(line => line.cost_total_cents!)) : null
export function estimateTotals(quote: Quote) {
 const lines = quote.lines.filter(included)
 return { total_cents: quote.total_cents, cost_total_cents: cost(lines) }
}
/** Legacy uncoded lines remain explicit and export their original stored cents. */
export function costCodeReport(job: Job, actor: Actor, quoteId: string) {
 requireJobManager(actor)
 const quote = find(job.quotes, quoteId)
 const grouped = new Map<string, { cost_code: string | null; phase: string | null; category: string | null; lines: Line[] }>()
 for (const line of quote.lines.filter(included)) {
  const keys = { cost_code: line.cost_code ?? null, phase: line.phase ?? null, category: line.category ?? null }, key = JSON.stringify(keys)
  const group = grouped.get(key) ?? { ...keys, lines: [] }
  group.lines.push(line); grouped.set(key, group)
 }
 return {
  format: 'plinth-estimate-cost-codes-v1', currency: currencyOf(job), job_id: job.id, job_name: job.name, quote_id: quote.id, revision: quote.revision, status: quote.status,
  rounding: quote.pricing ? 'Base measurements round half-up once per line. Scoped pricing stages round half-up, then allocate cents proportionally by largest remainder in source-line order; final line totals include reviewed tax.' : 'Exact quantity × conversion numerator ÷ conversion denominator × integer rate cents; round half-up once per line, then sum included lines.',
  ...(quote.pricing ? { pricing: quote.pricing } : {}),
  alternate_selections: quote.alternate_selections ?? {}, inclusions: quote.inclusions ?? [], exclusions: quote.exclusions ?? [],
  lines: quote.lines.map(line => ({ ...line, included: included(line) })),
  cost_codes: [...grouped.values()].map(group => ({ cost_code: group.cost_code, phase: group.phase, category: group.category, line_count: group.lines.length, cost_total_cents: cost(group.lines), total_cents: sum(group.lines.map(line => line.total_cents)) })),
  ...estimateTotals(quote),
 }
}
export type CostCodeReport = ReturnType<typeof costCodeReport>
const csvCell = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"'
export function costCodeCsv(report: CostCodeReport): string {
 const headings = ['row_type', 'currency', 'quote_id', 'revision', 'cost_code', 'phase', 'category', 'line_id', 'description', 'quantity', 'unit', 'rate_unit', 'conversion_numerator', 'conversion_denominator', 'cost_unit_cents', 'unit_cents', 'cost_total_cents', 'total_cents', 'included', 'alternate_group', 'alternate_option']
 const rows: Record<string, unknown>[] = report.lines.map(line => ({ row_type: 'line', ...line, line_id: line.id, conversion_numerator: line.conversion?.numerator ?? '1', conversion_denominator: line.conversion?.denominator ?? '1' }))
 rows.push(...report.cost_codes.map(group => ({ row_type: 'code_total', ...group })), { row_type: 'estimate_total', cost_total_cents: report.cost_total_cents, total_cents: report.total_cents })
 return [headings, ...rows.map(row => { const record: Record<string, unknown> = { currency: report.currency, quote_id: report.quote_id, revision: report.revision, ...row }; return headings.map(key => record[key]) })].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
/** Apply to both job quotes and approval snapshots at the authorized client boundary. */
export function projectEstimateCosts<T>(value: T): T {
 if (Array.isArray(value)) return value.map(projectEstimateCosts) as T
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('cost_') && !['phase', 'category', 'pricing', 'pricing_direction'].includes(key) && !key.toLowerCase().includes('margin')).map(([key, child]) => [key, projectEstimateCosts(key === 'product_source' && child && typeof child==='object' ? Object.fromEntries(Object.entries(child).filter(([field])=>field!=='evidence')) : key === 'lines' && Array.isArray(child) ? child.filter(line => !line || typeof line !== 'object' || line.included !== false) : child)])) as T
 return value
}
