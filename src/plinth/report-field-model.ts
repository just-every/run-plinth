import { cents, need, object, text, type Currency, type Input } from './model'

export type ReportRecordScope = 'job' | 'customer' | 'vendor' | 'financial'
export type ReportFieldType = 'text' | 'number' | 'date' | 'boolean' | 'money'
export interface ReportMoney { amount_cents: number; currency: Currency }
export type ReportFieldValue = string | number | boolean | ReportMoney | null
export type ReportValues = Record<string, ReportFieldValue>
export interface ReportColumn { id: string; name: string; type: ReportFieldType }
export interface ReportFieldDefinition extends ReportColumn {
 record_scope: ReportRecordScope
 required_at_stages: string[]
}

export function reportScope(value: unknown): ReportRecordScope {
 need(value === 'job' || value === 'customer' || value === 'vendor' || value === 'financial', 'record_scope must be job, customer, vendor, or financial')
 return value
}
export function reportIdentity(value: unknown, name = 'id'): string {
 const id = text(value, name, 100)
 need(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(id), `${name} must use letters, numbers, dots, underscores, colons, or hyphens`)
 return id
}
export function reportFieldType(value: unknown): ReportFieldType {
 need(value === 'text' || value === 'number' || value === 'date' || value === 'boolean' || value === 'money', 'type must be text, number, date, boolean, or money')
 return value
}
export function reportCurrency(value: unknown): Currency {
 need(value === 'USD' || value === 'AUD', 'Money requires an explicit USD or AUD currency', 400, 'currency')
 return value
}
/** IDs, scope and type are stable; renaming a definition preserves existing values and views. */
export function parseFieldDefinition(input: Input, previous?: ReportFieldDefinition): ReportFieldDefinition {
 if (previous) {
  for (const key of ['id', 'record_scope', 'type'] as const) need(input[key] === undefined || input[key] === previous[key], `Field ${key} cannot change`, 409, 'immutable_field')
 }
 const merged = { ...previous, ...input }, stages = merged.required_at_stages ?? []
 need(Array.isArray(stages) && stages.length <= 20, 'required_at_stages must contain at most 20 stages')
 const required = stages.map(stage => text(stage, 'required stage', 80))
 need(new Set(required).size === required.length, 'Required stages must be unique')
 return { id: previous?.id ?? (input.id === undefined ? crypto.randomUUID() : reportIdentity(input.id)),
  record_scope: reportScope(merged.record_scope), name: text(merged.name, 'field name', 120),
  type: reportFieldType(merged.type), required_at_stages: required }
}
export function validateFieldDefinitions(definitions: ReportFieldDefinition[]): void {
 need(definitions.length <= 200, 'At most 200 custom field definitions are supported')
 const ids = new Set<string>(), names = new Set<string>()
 for (const definition of definitions) {
  const parsed = parseFieldDefinition(definition as unknown as Input)
  const name = `${parsed.record_scope}:${parsed.name.toLowerCase()}`
  need(!ids.has(parsed.id) && !names.has(name), 'Field IDs and names within each record scope must be unique', 409, 'field_conflict')
  ids.add(parsed.id); names.add(name)
 }
}
/** Empty values are represented by null; false and zero are present values. */
export function parseFieldValue(column: ReportColumn, value: unknown, currency?: Currency): ReportFieldValue {
 if (value === null) return null
 if (column.type === 'text') {
  need(typeof value === 'string' && value.length <= 4000, `${column.name} must be text of at most 4000 characters`)
  return value.trim() || null
 }
 if (column.type === 'number') {
  need(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000, `${column.name} must be a finite number within the supported range`)
  return value
 }
 if (column.type === 'boolean') {
  need(typeof value === 'boolean', `${column.name} must be true or false`)
  return value
 }
 if (column.type === 'date') {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${column.name} must be a calendar date (YYYY-MM-DD)`)
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  need(Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value, `${column.name} must be a valid calendar date`)
  return value
 }
 need(column.type === 'money', 'Unknown field type')
 const money = object(value), unit = reportCurrency(money.currency)
 need(currency === undefined || currency === unit, `${column.name} must use the record's ${currency} currency`, 400, 'currency')
 return { amount_cents: cents(money.amount_cents, column.name, true), currency: unit }
}
/** Apply a partial value edit. Unknown IDs and fields belonging to another scope are refused. */
export function parseFieldValues(input: unknown, definitions: ReportFieldDefinition[], scope: ReportRecordScope, currency?: Currency, previous: ReportValues = {}): ReportValues {
 const patch = object(input), result: ReportValues = Object.create(null)
 need(Object.keys(patch).length <= 200 && Object.keys(previous).length <= 200, 'At most 200 field values are supported')
 for (const [id, value] of Object.entries({ ...previous, ...patch })) {
  const field = definitions.find(definition => definition.id === id && definition.record_scope === scope)
  need(field, `Unknown custom field: ${id}`, 400, 'unknown_field')
  result[id] = parseFieldValue(field, value, currency)
 }
 return result
}
/** The caller supplies the destination stage of the real existing record transition. */
export function requireFieldsAtStage(definitions: ReportFieldDefinition[], scope: ReportRecordScope, stage: string, values: ReportValues): void {
 const missing = definitions.filter(field => field.record_scope === scope && field.required_at_stages.includes(stage)
  && (values[field.id] === undefined || values[field.id] === null || (typeof values[field.id] === 'string' && !(values[field.id] as string).trim())))
 need(!missing.length, `Complete required fields before ${stage}: ${missing.map(field => field.name).join(', ')}`, 409, 'required_fields', { stage, field_ids: missing.map(field => field.id) })
}
