import type { ReportFieldValue } from './report-field-model'
import type { ReportResult } from './report-query'

// PDF's standard Courier font uses WinAnsi. Preserve unsupported characters as explicit Unicode escapes rather than dropping them.
const winAnsi = new Map([... '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map((character, index) => [character, [128,130,131,132,133,134,135,136,137,138,139,140,142,145,146,147,148,149,150,151,152,153,154,155,156,158,159][index]]))
const width = 88, pageLines = 48
function printable(value: string): string {
 return [...value].map(character => {
  const code = character.codePointAt(0)!
  if (code >= 32 && code <= 126 || code >= 160 && code <= 255 || winAnsi.has(character)) return character
  return `\\u{${code.toString(16).toUpperCase()}}`
 }).join('')
}
function hex(value: string): string {
 return [...value].map(character => (winAnsi.get(character) ?? character.charCodeAt(0)).toString(16).padStart(2, '0')).join('')
}
function valueText(value: ReportFieldValue): string {
 if (value === null) return 'Not set'
 if (typeof value === 'object') return `${value.currency} ${value.amount_cents} integer cents`
 return typeof value === 'string' ? JSON.stringify(value) : String(value)
}
/** A self-contained, paginated PDF of the already-authorized query; no independent data reads or broader scope. */
export function reportPdf(report: ReportResult, name: string): Uint8Array<ArrayBuffer> {
 const lines: string[] = []
 const add = (value = '') => {
  const visible = printable(value)
  if (!visible.length) { lines.push(''); return }
  for (let offset = 0; offset < visible.length; offset += width) lines.push(visible.slice(offset, offset + width))
 }
 const annotation = report.annotation
 add(name)
 add(annotation.extent)
 add(`Record scope: ${annotation.record_scope}`)
 add(`Matched records: ${annotation.count}; authorized scoped records: ${annotation.scope_count}`)
 add(`Filter mode: ${annotation.filter_mode}`)
 add('Characters outside WinAnsi are shown as Unicode escapes. Text values are JSON quoted.')
 add()
 add('Requested record IDs:')
 if (annotation.requested_record_ids === null) add('All currently authorized records in this record scope.')
 else if (!annotation.requested_record_ids.length) add('[]')
 else annotation.requested_record_ids.forEach(id => add(id))
 add('Authorized scope record IDs:')
 if (!annotation.scope_record_ids.length) add('[]')
 else annotation.scope_record_ids.forEach(id => add(id))
 add('Matched record IDs:')
 if (!annotation.matched_record_ids.length) add('[]')
 else annotation.matched_record_ids.forEach(id => add(id))
 add()
 add('Exact filters (all conditions must match):')
 if (!annotation.filters.length) add('[]')
 for (const filter of annotation.filters) add(JSON.stringify(filter))
 add('Filter columns:')
 for (const column of report.filter_columns) add(JSON.stringify(column))
 add('Selected columns, in order:')
 for (const column of report.columns) add(JSON.stringify(column))
 add()
 add('Money totals (unknown values excluded; currencies remain separate):')
 if (!report.money_totals.length) add('None')
 for (const total of report.money_totals) add(`${total.column_id}: ${total.currency} ${total.amount_cents} integer cents; ${total.count} set values`)
 add()
 add('Matching records:')
 if (!report.rows.length) add('None')
 for (const row of report.rows) {
  add(`Record: ${JSON.stringify(row.label)}`)
  add(`Record ID: ${row.id}; currency: ${row.currency ?? 'Not set'}`)
  for (const column of report.columns) add(`${column.name} [${column.id}]: ${valueText(row.values[column.id] ?? null)}`)
  add()
 }
 const pages = Array.from({ length: Math.max(1, Math.ceil(lines.length / pageLines)) }, (_, index) => lines.slice(index * pageLines, (index + 1) * pageLines))
 const objects: string[] = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>']
 const pageIds: number[] = []
 for (const [index, page] of pages.entries()) {
  const pageId = objects.length + 1, streamId = pageId + 1
  pageIds.push(pageId)
  const stream = `BT /F1 10 Tf 13 TL 36 756 Td <${hex('Plinth scoped saved view')}> Tj 0 -24 Td\n${page.map(line => `<${hex(line)}> Tj T*`).join('\n')}\nET\nBT /F1 10 Tf 36 36 Td <${hex(`Page ${index + 1} of ${pages.length}`)}> Tj ET\n`
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`)
  // All object and stream syntax is ASCII, so character positions are exact byte offsets.
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`)
 }
 objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
 objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`
 let document = '%PDF-1.4\n', offsets = [0]
 objects.forEach((object, index) => { offsets.push(document.length); document += `${index + 1} 0 obj\n${object}\nendobj\n` })
 const xref = document.length
 document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 return new TextEncoder().encode(document)
}
