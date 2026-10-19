import { cents, need, object, sum, text, type Input, type Line } from './model'
import { standardConversion } from './us-conventions'
import { decimal, lineCents, measurement } from './estimate-math'
import type { EstimateCategory } from './estimate-model'

const categories: EstimateCategory[] = ['labor', 'material', 'equipment', 'subcontract', 'other']
export function scopeTerms(value: unknown, name: string): string[] {
 if (value === undefined) return []
 need(Array.isArray(value) && value.length <= 100, `${name} must contain at most 100 entries`)
 return value.map(entry => text(entry, name, 1000))
}
export function estimateLines(input: Input) {
 need(Array.isArray(input.lines) && input.lines.length > 0 && input.lines.length <= 100, 'Provide 1–100 quote lines')
 const lines: Line[] = input.lines.map(value => {
  const row = object(value), quantity = measurement(row.quantity), unit_cents = cents(row.unit_cents, 'unit_cents')
  const line: Line = { id: row.id === undefined ? crypto.randomUUID() : text(row.id, 'Line id', 100), description: text(row.description, 'description', 500), quantity, unit_cents, total_cents: 0 }
  const coded = ['cost_code', 'phase', 'category', 'unit', 'rate_unit', 'conversion', 'cost_unit_cents', 'alternate_group', 'alternate_option'].some(key => row[key] !== undefined)
  if (coded) {
   line.cost_code = text(row.cost_code, 'Cost code', 80)
   line.phase = text(row.phase, 'Phase', 120)
   need(categories.includes(row.category as EstimateCategory), 'Choose labor, material, equipment, subcontract or other')
   line.category = row.category as EstimateCategory
   line.unit = text(row.unit, 'Measurement unit', 40)
   line.rate_unit = text(row.rate_unit ?? row.unit, 'Rate unit', 40)
   if (row.conversion !== undefined) {
    const conversion = object(row.conversion)
    decimal(conversion.numerator, 'Conversion numerator'); decimal(conversion.denominator, 'Conversion denominator')
    line.conversion = { numerator: String(conversion.numerator), denominator: String(conversion.denominator) }
   }
   if (!line.conversion) { const standard = standardConversion(line.unit, line.rate_unit); if (standard) line.conversion = standard }
   need(line.unit === line.rate_unit || line.conversion, 'Different measurement and rate units require an explicit exact conversion (in, ft, yd, mm, cm, m and sq in, sq ft, sq yd, sq m convert automatically)')
   if (row.cost_unit_cents !== undefined) line.cost_unit_cents = cents(row.cost_unit_cents, 'cost_unit_cents')
   const group = text(row.alternate_group, 'Alternate group', 100, true), option = text(row.alternate_option, 'Alternate option', 100, true)
   need(!!group === !!option, 'An alternate needs both a group and option')
   if (group) { line.alternate_group = group; line.alternate_option = option }
  }
  line.total_cents = lineCents(quantity, unit_cents, line.conversion)
  if (line.cost_unit_cents !== undefined) line.cost_total_cents = lineCents(quantity, line.cost_unit_cents, line.conversion)
  return line
 })
 need(new Set(lines.map(line => line.id)).size === lines.length, 'Estimate line ids must be unique')
 const selections: Record<string, string> = Object.create(null)
 if (input.alternate_selections !== undefined) {
  for (const [group, choice] of Object.entries(object(input.alternate_selections))) {
   const option = text(choice, 'Selected alternate option', 100)
   need(lines.some(line => line.alternate_group === group && line.alternate_option === option), 'Selected alternate must match an estimate group and option')
   selections[group] = option
  }
 }
 for (const line of lines) line.included = !line.alternate_group || selections[line.alternate_group] === line.alternate_option
 const included = lines.filter(line => line.included)
 need(included.length > 0, 'Select at least one estimate line')
 const total_cents = sum(included.map(line => line.total_cents))
 const cost_total_cents = included.every(line => line.cost_total_cents !== undefined) ? sum(included.map(line => line.cost_total_cents!)) : undefined
 return { lines, total_cents, ...(cost_total_cents === undefined ? {} : { cost_total_cents }), alternate_selections: selections, inclusions: scopeTerms(input.inclusions, 'Inclusions'), exclusions: scopeTerms(input.exclusions, 'Exclusions') }
}
