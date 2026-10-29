import { Buffer } from 'node:buffer'
import { canonicalJson, sha256, type SourceBundle } from '../modules/import-kit/src/d1/index.ts'
import { DomainError, need } from './model.ts'

export const IMPORT_NAMESPACE = 'accepted-jobs-csv'
export const IMPORT_VERSION = 'accepted-jobs-csv-v1'
export const IMPORT_LIMITS = { bytes: 262_144, rows: 100 } as const
export const IMPORT_HEADER = ['external_id', 'title', 'client_email', 'site_address', 'quote_cents', 'accepted_on'] as const
export const CURRENCY_HEADER = [...IMPORT_HEADER, 'currency'] as const
export type SourceDeclaration = { sourceSystem: string; extractionScope: string; extractedAt: string; verified: false }
export interface AcceptedJobRow { external_id: string; title: string; client_email: string; site_address: string; quote_cents: string; accepted_on: string; currency?: 'USD' | 'AUD'; source_declaration?: SourceDeclaration }
export interface CellLocation { artifact: string; row: number; column: number; line: number; character: number; pointer: string }
export interface CsvCell { value: string; location: CellLocation }
export interface CsvDiagnostic { code: string; message: string; location: CellLocation; field?: string }
export interface CsvInspection { sha256: string; bytes: number; header: CsvCell[]; table: CsvCell[][]; rows: AcceptedJobRow[]; diagnostics: CsvDiagnostic[]; declaration?: SourceDeclaration }
const invalid = (message: string): never => { throw new DomainError('invalid_csv', message) }

export function sourceDeclaration(input: unknown): SourceDeclaration | undefined {
  if (input === undefined) return undefined
  need(input && typeof input === 'object' && !Array.isArray(input), 'Source declaration must be an object')
  const value = input as Record<string, unknown>
  need(Object.keys(value).every(key => ['sourceSystem', 'extractionScope', 'extractedAt', 'verified'].includes(key)), 'Unsupported source declaration field')
  const text = (key: string, max: number) => {
    need(typeof value[key] === 'string' && value[key].length <= max && !/[\u0000-\u001f\u007f]/.test(value[key] as string), 'Provide bounded source declaration text')
    return (value[key] as string).trim()
  }
  const sourceSystem = text('sourceSystem', 120), extractionScope = text('extractionScope', 500), extractedAt = text('extractedAt', 40)
  need(!extractedAt || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(extractedAt) && Number.isFinite(Date.parse(extractedAt)) && new Date(extractedAt).toISOString().replace('.000Z', 'Z') === extractedAt.replace('.000Z', 'Z')), 'Extraction time must be a valid UTC timestamp')
  need(value.verified === undefined || value.verified === false, 'Source declarations are always unverified')
  return sourceSystem || extractionScope || extractedAt ? { sourceSystem, extractionScope, extractedAt, verified: false } : undefined
}

/** Record and column are one-based CSV coordinates; line and character identify
 * the start of each cell in the exact original, including quoted newlines. */
function cells(csv: string): { table: CsvCell[][]; diagnostics: CsvDiagnostic[] } {
  const table: CsvCell[][] = [], row: CsvCell[] = [], diagnostics: CsvDiagnostic[] = []
  let field = '', quoted = false, closed = false, line = 1, character = 1
  const location = (): CellLocation => ({ artifact: 'accepted-jobs.csv', row: table.length + 1, column: row.length + 1, line, character, pointer: '/columns/' + row.length })
  let start = location()
  const cell = () => { row.push({ value: field, location: start }); field = ''; closed = false }
  const finish = () => { cell(); table.push(row.splice(0)); if (table.length > IMPORT_LIMITS.rows + 1) invalid('CSV exceeds 100 data rows') }
  const problem = (message: string) => { if (!diagnostics.some(d => d.location.row === start.row && d.location.column === start.column)) diagnostics.push({ code: 'MALFORMED_CSV', message, location: start }) }
  for (let i = csv.charCodeAt(0) === 0xfeff ? 1 : 0; i < csv.length; i++) {
    const c = csv[i]
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { field += '"'; i++; character++ }
      else if (c === '"') { quoted = false; closed = true }
      else field += c
    } else if (c === ',') { cell(); start = { ...location(), character: character + 1 } }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && csv[i + 1] === '\n') i++
      finish(); line++; character = 1; start = location(); continue
    } else if (c === '"' && !field && !closed) quoted = true
    else { if (closed || c === '"') problem('Malformed CSV quoting'); field += c }
    if (c === '\n') { line++; character = 1 } else if (c !== '\r' || csv[i + 1] !== '\n') character++
  }
  if (quoted) problem('Unclosed CSV quote')
  if (field.length || row.length || closed || quoted) finish()
  return { table, diagnostics }
}

/** Parse workbook CSV with the same quoting diagnostics as accepted-job CSV. */
export function csvCells(csv: string): string[][] {
  const parsed = cells(csv)
  if (parsed.diagnostics.length) invalid(parsed.diagnostics[0].message)
  return parsed.table.map(row => row.map(cell => cell.value))
}

export function inspectAcceptedJobs(csv: string, declaration?: SourceDeclaration): CsvInspection {
  if (typeof csv !== 'string' || !csv.length) invalid('Upload a CSV file')
  const bytes = Buffer.from(csv, 'utf8')
  if (bytes.length > IMPORT_LIMITS.bytes) invalid('CSV exceeds 256 KiB')
  if (csv.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(csv)) invalid('CSV contains invalid text')
  const parsed = cells(csv), header = parsed.table.shift() ?? [], table = parsed.table, diagnostics = parsed.diagnostics
  const columns = header.map(cell => cell.value)
  const allowed: readonly string[] = columns.join(',') === CURRENCY_HEADER.join(',') ? CURRENCY_HEADER : IMPORT_HEADER
  const at = (row: number, column: number): CellLocation => ({ artifact: 'accepted-jobs.csv', row, column, line: row, character: 1, pointer: '/columns/' + (column - 1) })
  for (const cell of header) if (!(CURRENCY_HEADER as readonly string[]).includes(cell.value)) diagnostics.push({ code: 'UNSUPPORTED_FIELD', message: 'Unsupported field: ' + cell.value, field: cell.value, location: cell.location })
  if (columns.join(',') !== allowed.join(',')) diagnostics.push({ code: 'INVALID_HEADER', message: 'Expected header: ' + IMPORT_HEADER.join(',') + ' (optionally followed by ,currency)', location: header[0]?.location ?? at(1, 1) })
  if (!table.length) diagnostics.push({ code: 'EMPTY_CSV', message: 'CSV must contain at least one job', location: at(2, 1) })
  const rows: AcceptedJobRow[] = [], seen = new Set<string>()
  for (const [index, fields] of table.entries()) {
    const rowNumber = index + 2
    const issue = (code: string, message: string, key = 'external_id') => {
      const column = Math.max(0, columns.indexOf(key))
      diagnostics.push({ code, message: 'Row ' + rowNumber + ': ' + message, field: key, location: fields[column]?.location ?? at(rowNumber, column + 1) })
    }
    if (fields.length !== columns.length) issue('INVALID_ROW', 'expected ' + columns.length + ' fields')
    const row = Object.fromEntries(columns.map((key, i) => [key, fields[i]?.value ?? ''])) as unknown as AcceptedJobRow
    rows.push({ ...row, ...(declaration ? { source_declaration: declaration } : {}) })
    if (columns.join(',') !== allowed.join(',')) continue
    if (row.currency !== undefined && row.currency !== 'USD' && row.currency !== 'AUD') issue('INVALID_ROW', 'currency must be USD or AUD (historical)', 'currency')
    for (const key of ['external_id', 'title', 'client_email'] as const) if (!row[key].trim() || row[key] !== row[key].trim()) issue('INVALID_ROW', key + ' is required without surrounding spaces', key)
    for (const [key, max] of [['external_id', 200], ['title', 200], ['site_address', 500], ['client_email', 254]] as const) if (row[key].length > max) issue('INVALID_ROW', 'field exceeds its supported length', key)
    if (/[\x00-\x1f\x7f]/.test(row.external_id)) issue('INVALID_ROW', 'invalid external_id')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.client_email)) issue('INVALID_ROW', 'invalid client_email', 'client_email')
    if (!/^(0|[1-9]\d*)$/.test(row.quote_cents) || !Number.isSafeInteger(Number(row.quote_cents)) || Number(row.quote_cents) > 1_000_000_000_000) issue('INVALID_ROW', 'quote_cents must be whole nonnegative cents', 'quote_cents')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.accepted_on) || !Number.isFinite(Date.parse(row.accepted_on)) || new Date(row.accepted_on).toISOString().slice(0, 10) !== row.accepted_on) issue('INVALID_ROW', 'accepted_on must be a valid YYYY-MM-DD date', 'accepted_on')
    if (seen.has(row.external_id)) issue('DUPLICATE_ID', 'duplicate external_id')
    seen.add(row.external_id)
  }
  return { sha256: sha256(bytes), bytes: bytes.length, header, table, rows, diagnostics, ...(declaration ? { declaration } : {}) }
}

export function acceptedJobsSource(csv: string, declaration?: SourceDeclaration, legacy = false): { source: SourceBundle; rows: AcceptedJobRow[]; inspection: CsvInspection } {
  const inspection = inspectAcceptedJobs(csv, declaration)
  if (inspection.diagnostics.length) throw new DomainError('invalid_csv', inspection.diagnostics[0].message, 400, { inspection })
  const { rows, sha256: hash, bytes: size } = inspection
  return { rows, inspection, source: {
    diagnostics: [],
    artifacts: [{ name: 'accepted-jobs.csv', sha256: hash, size, original: { status: 'available', base64: Buffer.from(csv, 'utf8').toString('base64') } }],
    records: rows.map((row, index) => {
      const coordinates = { row: index + 2, columns: inspection.table[index].map((cell, i) => ({ field: inspection.header[i].value, column: i + 1, line: cell.location.line, character: cell.location.character })) }
      const payload = { ...row, ...(!legacy ? { source_coordinates: coordinates } : {}) }
      return { namespace: IMPORT_NAMESPACE, kind: 'accepted-job', sourceId: row.external_id, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: hash, location: { artifact: 'accepted-jobs.csv', row: index + 2 } }
    }),
  } }
}
