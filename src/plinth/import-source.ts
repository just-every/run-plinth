import { Buffer } from 'node:buffer'
import { canonicalJson, sha256, type SourceBundle } from '../modules/import-kit/src/d1/index.ts'
import { DomainError } from './model.ts'

export const IMPORT_NAMESPACE = 'accepted-jobs-csv'
export const IMPORT_VERSION = 'accepted-jobs-csv-v1'
export const IMPORT_LIMITS = { bytes: 262_144, rows: 100 } as const
export const IMPORT_HEADER = ['external_id', 'title', 'client_email', 'site_address', 'quote_cents', 'accepted_on'] as const
export interface AcceptedJobRow { external_id: string; title: string; client_email: string; site_address: string; quote_cents: string; accepted_on: string }
const invalid = (message: string): never => { throw new DomainError('invalid_csv', message) }

/** RFC 4180 quoting, including embedded newlines and doubled quotes. No trimming
 * or reserialization of the retained original bytes. */
function cells(csv: string): string[][] {
  const rows: string[][] = [], row: string[] = []
  let field = '', quoted = false, closed = false
  const cell = () => { row.push(field); field = ''; closed = false }
  const line = () => { cell(); rows.push(row.splice(0)); if (rows.length > IMPORT_LIMITS.rows + 1) invalid('CSV exceeds 100 data rows') }
  for (let i = csv.charCodeAt(0) === 0xfeff ? 1 : 0; i < csv.length; i++) {
    const c = csv[i]
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') { quoted = false; closed = true }
      else field += c
    } else if (c === ',') cell()
    else if (c === '\n' || c === '\r') { if (c === '\r' && csv[i + 1] === '\n') i++; line() }
    else if (c === '"' && !field && !closed) quoted = true
    else { if (closed || c === '"') invalid('Malformed CSV quoting'); field += c }
  }
  if (quoted) invalid('Unclosed CSV quote')
  if (field.length || row.length || closed) line()
  return rows
}

export function acceptedJobsSource(csv: string): { source: SourceBundle; rows: AcceptedJobRow[] } {
  if (typeof csv !== 'string' || !csv.length) invalid('Upload a CSV file')
  const bytes = Buffer.from(csv, 'utf8')
  if (bytes.length > IMPORT_LIMITS.bytes) invalid('CSV exceeds 256 KiB')
  if (csv.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(csv)) invalid('CSV contains invalid text')
  const table = cells(csv), header = table.shift()
  if (!header || header.join(',') !== IMPORT_HEADER.join(',')) invalid(`Expected header: ${IMPORT_HEADER.join(',')}`)
  if (!table.length) invalid('CSV must contain at least one job')
  const seen = new Set<string>()
  const rows = table.map((fields, index): AcceptedJobRow => {
    const rowNumber = index + 2
    if (fields.length !== IMPORT_HEADER.length) invalid(`Row ${rowNumber}: expected six fields`)
    const row = Object.fromEntries(IMPORT_HEADER.map((key, i) => [key, fields[i]])) as unknown as AcceptedJobRow
    for (const key of ['external_id', 'title', 'client_email'] as const) if (!row[key].trim() || row[key] !== row[key].trim()) invalid(`Row ${rowNumber}: ${key} is required without surrounding spaces`)
    if (row.external_id.length > 200 || row.title.length > 200 || row.site_address.length > 500 || row.client_email.length > 254) invalid(`Row ${rowNumber}: a field exceeds its supported length`)
    if (/[\x00-\x1f\x7f]/.test(row.external_id)) invalid(`Row ${rowNumber}: invalid external_id`)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.client_email)) invalid(`Row ${rowNumber}: invalid client_email`)
    if (!/^(0|[1-9]\d*)$/.test(row.quote_cents) || !Number.isSafeInteger(Number(row.quote_cents)) || Number(row.quote_cents) > 1_000_000_000_000) invalid(`Row ${rowNumber}: quote_cents must be whole nonnegative AUD cents`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.accepted_on) || !Number.isFinite(Date.parse(row.accepted_on)) || new Date(row.accepted_on).toISOString().slice(0, 10) !== row.accepted_on) invalid(`Row ${rowNumber}: accepted_on must be a valid YYYY-MM-DD date`)
    if (seen.has(row.external_id)) invalid(`Row ${rowNumber}: duplicate external_id`)
    seen.add(row.external_id)
    return row
  })
  const hash = sha256(bytes)
  return { rows, source: {
    diagnostics: [],
    artifacts: [{ name: 'accepted-jobs.csv', sha256: hash, size: bytes.length, original: { status: 'available', base64: bytes.toString('base64') } }],
    records: rows.map((row, index) => ({ namespace: IMPORT_NAMESPACE, kind: 'accepted-job', sourceId: row.external_id, payload: { ...row }, payloadHash: sha256(canonicalJson(row)), artifactHash: hash, location: { artifact: 'accepted-jobs.csv', row: index + 2 } })),
  } }
}
