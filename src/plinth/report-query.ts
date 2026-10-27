import { parsePortfolioScope, type PortfolioScope } from './portfolio-scope'
import { need, object, sum, text, type Currency, type Input } from './model'
import { parseFieldValue, reportFieldType, reportIdentity, reportScope, type ReportColumn, type ReportFieldValue, type ReportMoney, type ReportRecordScope, type ReportValues } from './report-field-model'

export type ReportOperator = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_set' | 'is_unset'
export interface ReportFilter { column_id: string; operator: ReportOperator; value?: ReportFieldValue }
export interface ReportScope { record_scope: ReportRecordScope; record_ids: string[] | null }
export interface ReportView {
 id: string
 name: string
 created_by: string
 sharing: 'personal' | 'shared'
 scope: ReportScope
 filters: ReportFilter[]
 selected_columns: string[]
 portfolio?: PortfolioScope
}
/** Records and available columns are supplied by the authorized integration boundary. */
export interface ReportRecord { id: string; record_scope: ReportRecordScope; label: string; currency?: Currency; values: ReportValues }
export interface ReportResult {
 annotation: {
  portfolio?:PortfolioScope
  record_scope: ReportRecordScope
  requested_record_ids: string[] | null
  scope_record_ids: string[]
  matched_record_ids: string[]
  scope_count: number
  count: number
  filters: ReportFilter[]
  filter_mode: 'all'
  extent: 'Supplied records only; filters and record scope apply. This is not a complete migration or portfolio export.'
 }
 columns: ReportColumn[]
 filter_columns: ReportColumn[]
 rows: { id: string; label: string; currency: Currency | null; values: ReportValues }[]
 money_totals: { column_id: string; currency: Currency; amount_cents: number; count: number }[]
}
function strings(value: unknown, name: string, max: number): string[] {
 need(Array.isArray(value) && value.length <= max, `${name} must contain at most ${max} IDs`)
 const ids = value.map(id => reportIdentity(id, name))
 need(new Set(ids).size === ids.length, `${name} IDs must be unique`)
 return ids
}
function availableColumns(columns: ReportColumn[]): void {
 need(columns.length > 0 && columns.length <= 250, 'Supply between 1 and 250 available columns')
 for (const column of columns) { reportIdentity(column.id, 'column id'); text(column.name, 'column name', 120); reportFieldType(column.type) }
 need(new Set(columns.map(column => column.id)).size === columns.length, 'Column IDs must be unique')
}
function columnFor(columns: ReportColumn[], id: string): ReportColumn {
 const column = columns.find(candidate => candidate.id === id)
 need(column, `Unknown or unavailable column: ${id}`, 400, 'unknown_field')
 return column
}
export function parseReportFilters(value: unknown, columns: ReportColumn[]): ReportFilter[] {
 need(Array.isArray(value) && value.length <= 20, 'filters must contain at most 20 conditions')
 return value.map(raw => {
  const input = object(raw), column_id = reportIdentity(input.column_id, 'column_id'), column = columnFor(columns, column_id)
  const operator = input.operator
  need(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_set', 'is_unset'].includes(String(operator)), 'Unsupported filter operator')
  if (operator === 'is_set' || operator === 'is_unset') {
   need(input.value === undefined, `${operator} does not take a value`)
   return { column_id, operator }
  }
  need(operator !== 'contains' || column.type === 'text', 'contains requires a text column')
  need(!['gt', 'gte', 'lt', 'lte'].includes(String(operator)) || ['number', 'date', 'money'].includes(column.type), 'Ordered comparisons require a number, date, or money column')
  const parsed = parseFieldValue(column, input.value)
  need(parsed !== null, 'A filter value is required; use is_unset to find empty values')
  return { column_id, operator: operator as ReportOperator, value: parsed }
 })
}
/** This validates shape and references only; ownership and sharing permissions belong to the caller. */
export function parseReportView(input: Input, columns: ReportColumn[], createdBy: string, previous?: ReportView): ReportView {
 availableColumns(columns)
 if (previous) {
  need(input.id === undefined || input.id === previous.id, 'View id cannot change', 409, 'immutable_view')
  need(input.created_by === undefined || input.created_by === previous.created_by, 'View creator cannot change', 409, 'immutable_view')
 } else need(input.created_by === undefined || input.created_by === createdBy, 'View creator must match the supplied creator')
 const merged = { ...previous, ...input }, scope = object(merged.scope)
 const portfolio=parsePortfolioScope(merged.portfolio)
 need(!portfolio||scope.record_scope==='job','Portfolio selections require job scope')
 const sharing = merged.sharing
 need(sharing === 'personal' || sharing === 'shared', 'sharing must be personal or shared')
 const selected_columns = strings(merged.selected_columns, 'selected_columns', 50)
 need(selected_columns.length > 0, 'Select at least one column')
 selected_columns.forEach(id => columnFor(columns, id))
 const filters=parseReportFilters(merged.filters ?? [], columns)
 if(portfolio?.snapshot_id)need([...selected_columns,...filters.map(f=>f.column_id)].every(id=>id.startsWith('portfolio.')||['native.stage','native.delayed','native.contract'].includes(id)),'Historical portfolio reports cannot mix current custom fields')
 need(scope.record_ids === null || Array.isArray(scope.record_ids), 'scope.record_ids must be an explicit ID list or null for all supplied records')
 return { id: previous?.id ?? (input.id === undefined ? crypto.randomUUID() : reportIdentity(input.id)), name: text(merged.name, 'view name', 120),
  created_by: previous?.created_by ?? text(createdBy, 'creator', 100), sharing,
  scope: { record_scope: reportScope(scope.record_scope), record_ids: scope.record_ids === null ? null : strings(scope.record_ids, 'scope.record_ids', 10000) },
  filters, selected_columns,...(portfolio?{portfolio}:{}) }
}
function matches(actual: ReportFieldValue, filter: ReportFilter): boolean {
 if (filter.operator === 'is_set') return actual !== null
 if (filter.operator === 'is_unset') return actual === null
 if (actual === null) return false
 let left: string | number | boolean = typeof actual === 'object' ? actual.amount_cents : actual
 const expected = filter.value!
 const right = typeof expected === 'object' && expected !== null ? expected.amount_cents : expected
 if (typeof actual === 'object' && (typeof expected !== 'object' || expected === null || actual.currency !== expected.currency)) return false
 if (filter.operator === 'contains') return String(left).toLocaleLowerCase('en-US').includes(String(right).toLocaleLowerCase('en-US'))
 if (filter.operator === 'eq') return left === right
 if (filter.operator === 'neq') return left !== right
 if (typeof left === 'boolean' || right === null || right === undefined || typeof right === 'boolean') return false
 if (filter.operator === 'gt') return left > right
 if (filter.operator === 'gte') return left >= right
 if (filter.operator === 'lt') return left < right
 return left <= right
}
export function queryReport(records: ReportRecord[], columns: ReportColumn[], view: ReportView): ReportResult {
 need(records.length <= 10000, 'A report supports at most 10000 supplied records')
 const parsed = parseReportView(view as unknown as Input, columns, view.created_by, view)
 const candidates = records.filter(record => record.record_scope === parsed.scope.record_scope)
 need(new Set(candidates.map(record => record.id)).size === candidates.length, 'Supplied record IDs must be unique within scope')
 const requested = parsed.scope.record_ids
 if (requested) need(requested.every(id => candidates.some(record => record.id === id)), 'Requested scope contains an unavailable record', 400, 'record_scope')
 const scoped = candidates.filter(record => requested === null || requested.includes(record.id))
 const selected = parsed.selected_columns.map(id => ({ ...columnFor(columns, id) }))
 const used = [...new Set([...parsed.selected_columns, ...parsed.filters.map(filter => filter.column_id)])]
 const normalized = scoped.map(record => {
  const values: ReportValues = Object.create(null)
  for (const id of used) values[id] = parseFieldValue(columnFor(columns, id), record.values[id] ?? null, record.currency)
  return { ...record, values }
 })
 const matching = normalized.filter(record => parsed.filters.every(filter => matches(record.values[filter.column_id], filter)))
 const money_totals: ReportResult['money_totals'] = []
 const rows = matching.map(record => {
  const values: ReportValues = Object.create(null)
  for (const column of selected) values[column.id] = record.values[column.id]
  return { id: record.id, label: record.label, currency: record.currency ?? null, values }
 })
 for (const column of selected.filter(column => column.type === 'money')) {
  const groups = new Map<Currency, number[]>()
  for (const row of rows) {
   const value = row.values[column.id] as ReportMoney | null
   if (value !== null) groups.set(value.currency, [...groups.get(value.currency) ?? [], value.amount_cents])
  }
  for (const [currency, amounts] of groups) money_totals.push({ column_id: column.id, currency, amount_cents: sum(amounts), count: amounts.length })
 }
 return { annotation: { ...(parsed.portfolio?{portfolio:parsed.portfolio}:{}),record_scope: parsed.scope.record_scope, requested_record_ids: requested === null ? null : [...requested], scope_record_ids: scoped.map(record => record.id),
  matched_record_ids: rows.map(record => record.id), scope_count: scoped.length, count: rows.length, filters: parsed.filters, filter_mode: 'all',
  extent: 'Supplied records only; filters and record scope apply. This is not a complete migration or portfolio export.' }, columns: selected, filter_columns: [...new Set(parsed.filters.map(f=>f.column_id))].map(id=>({...columnFor(columns,id)})), rows, money_totals }
}
/** Quoting alone does not stop spreadsheet formula execution, so prefix dangerous cells. */
export function reportCsvCell(value: unknown): string {
 const raw = String(value ?? '')
 const safe = /^[\u0000-\u0020]*[=+\-@]/.test(raw) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw
 return `"${safe.replaceAll('"', '""')}"`
}
export function reportCsv(report: ReportResult): string {
 const annotation = report.annotation
 const rows: unknown[][] = [
  ['annotation', 'extent', annotation.extent], ['annotation', 'record_scope', annotation.record_scope],
  ['annotation', 'requested_record_ids', JSON.stringify(annotation.requested_record_ids)],
  ['annotation', 'scope_record_ids', JSON.stringify(annotation.scope_record_ids)], ['annotation', 'matched_record_ids', JSON.stringify(annotation.matched_record_ids)],
  ['annotation', 'scope_count', annotation.scope_count], ['annotation', 'count', annotation.count],
  ['annotation', 'filter_mode', annotation.filter_mode], ['annotation', 'filters', JSON.stringify(annotation.filters)],
  ['annotation', 'selected_columns', JSON.stringify(report.columns)],
  ['annotation','portfolio',JSON.stringify(annotation.portfolio??null)],
 ]
 for (const total of report.money_totals) rows.push(['money_total', total.column_id, total.currency, total.amount_cents, total.count])
 rows.push(['record_id', 'record_name', 'record_currency', ...report.columns.map(column => `${column.name} [${column.id}; ${column.type === 'money' ? 'currency and integer cents' : column.type}]`)])
 for (const row of report.rows) rows.push([row.id, row.label, row.currency, ...report.columns.map(column => {
  const value = row.values[column.id]
  return value !== null && typeof value === 'object' ? `${value.currency} ${value.amount_cents}` : value
 })])
 return rows.map(row => row.map(reportCsvCell).join(',')).join('\r\n') + '\r\n'
}
