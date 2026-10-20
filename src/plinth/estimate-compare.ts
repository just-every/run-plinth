import type { Line, Quote } from './model'

const scopeKeys = ['description', 'quantity', 'unit_cents', 'cost_unit_cents', 'cost_code', 'phase', 'category', 'unit', 'rate_unit', 'conversion', 'alternate_group', 'alternate_option', 'included', 'total_cents', 'cost_total_cents', 'product_source'] as const
const identity = (line: Line, index: number) => line.id ?? `legacy-line-${index}`
const cost = (quote: Quote) => {
 const selected = quote.lines.filter(line => line.included !== false)
 return selected.every(line => line.cost_total_cents !== undefined) ? selected.reduce((total, line) => total + line.cost_total_cents!, 0) : null
}
/** Stable line ids distinguish changed scope, removals and additions across revisions. */
export function compareEstimates(before: Quote, after: Quote) {
 const oldLines = new Map(before.lines.map((line, index) => [identity(line, index), line]))
 const newLines = new Map(after.lines.map((line, index) => [identity(line, index), line]))
 const changes = [...new Set([...oldLines.keys(), ...newLines.keys()])].flatMap(id => {
  const previous = oldLines.get(id), current = newLines.get(id)
  const fields = scopeKeys.filter(key => JSON.stringify(previous?.[key]) !== JSON.stringify(current?.[key]))
  return fields.length ? [{ id, kind: !previous ? 'added' : !current ? 'removed' : 'changed', description: current?.description ?? previous!.description, fields, before: previous ?? null, after: current ?? null }] : []
 })
 const beforeCost = cost(before), afterCost = cost(after)
 return { before_revision: before.revision, after_revision: after.revision, changes, total_delta_cents: after.total_cents - before.total_cents, cost_delta_cents: beforeCost === null || afterCost === null ? null : afterCost - beforeCost,
  before_total_cents: before.total_cents, after_total_cents: after.total_cents,
  inclusions: { before: before.inclusions ?? [], after: after.inclusions ?? [] }, exclusions: { before: before.exclusions ?? [], after: after.exclusions ?? [] },
  alternate_selections: { before: before.alternate_selections ?? {}, after: after.alternate_selections ?? {} },
 }
}
