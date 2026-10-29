import type { RecoveryField, RecoveryManifest, reconcileRecovery } from './recovery-inventory'
import { reportCsvCell } from './report-query'
import { textPdf } from './report-pdf'
import { tableXlsx } from './report-xlsx'

type Comparison = ReturnType<typeof reconcileRecovery>
type Cell = string | number | boolean | null | undefined
const controlColumns = ['currency','issued_invoices','issued_gross_cents','corrections_cents','receipts_cents','deposit_applications_cents','write_offs_cents','posted_cost_cents'] as const
/** Every row comes from the same owner-authorized snapshot used by the manifest or comparison. */
export function recoveryReport(manifest: RecoveryManifest, format: 'csv' | 'xlsx' | 'pdf', comparison?: Comparison, fields:RecoveryField[]=[]): Response {
 const title = comparison ? 'Plinth recovery comparison' : 'Plinth native recovery inventory'
 const rows: Cell[][] = [
  ['Report', title], ['Format', manifest.format],
  ['Boundary', 'Confidential native inventory. This is not an archive or proof of source authenticity. No records or authority are changed.'],
  ['Money units', 'All amounts are integer minor units; currencies remain separate. Controls are not receivable balances or external accounting reconciliation.'],
 ]
 if (comparison) {
  rows.push(['Comparison', comparison.matches ? 'Inventory matches' : 'Inventory differences found'], ['Notice', comparison.notice], ['Coverage matches', comparison.coverage_match], ['Controls match', comparison.control_totals.match])
  for (const section of ['records','files'] as const) for (const disposition of ['missing','extra','mismatched'] as const) {
   rows.push(['Difference count', section, disposition, comparison[section][disposition].length])
   for (const identity of comparison[section][disposition]) rows.push(['Difference', section, disposition, identity])
  }
  for (const identity of comparison.unverified_files) rows.push(['Integrity failure', identity])
 }
 rows.push(['Financial controls', 'Origin', ...controlColumns])
 for (const origin of (comparison ? ['source','current'] : ['current']) as ('source' | 'current')[]) {
  const controls = comparison ? comparison.control_totals[origin] : manifest.controls
  for (const control of controls) rows.push(['Control', origin, ...controlColumns.map(key => control[key])])
 }
 rows.push(['Coverage', 'Table', 'Record count'])
 for (const table of manifest.tables) rows.push(['Table', table.name, table.count])
 rows.push(['Records', 'Kind', 'Identity', 'Revision', 'SHA-256'])
 for (const record of manifest.records) rows.push(['Record', record.kind, record.identity, record.revision ?? null, record.sha256])
 rows.push(['Originals', 'Identity', 'Actual bytes', 'Actual SHA-256', 'Declared bytes', 'Declared SHA-256', 'Integrity verified'])
 for (const file of manifest.files) rows.push(['Original', file.identity, file.size, file.sha256, file.declared_size, file.declared_sha256, file.verified])
 rows.push(['Native source fields', 'Record identity', 'Field path', 'Type', 'Value'])
 for(const field of fields)rows.push(['Field',field.identity,field.path,field.type,field.value])
 rows.push(['Original representation','Original payload bytes are represented by measured sizes and SHA-256 checksums. Download the originals through their native doors or use the CLI archive.'])
 for (const exclusion of manifest.exclusions) rows.push(['Exclusion', exclusion])
 const body = format === 'pdf' ? textPdf(title, rows.map(row => row.map(value => value === null || value === undefined ? 'Not recorded' : String(value)).join(' | '))) : format === 'xlsx' ? tableXlsx(rows, 'Recovery report') : rows.map(row => row.map(value=>typeof value==='number'?String(value):reportCsvCell(value)).join(',')).join('\r\n') + '\r\n'
 const type = format === 'pdf' ? 'application/pdf' : format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8'
 return new Response(body, {headers: {'cache-control':'private, no-store','x-content-type-options':'nosniff','content-type':type,'content-disposition':`attachment; filename=plinth-recovery-${comparison ? 'comparison' : 'inventory'}.${format}`}})
}
