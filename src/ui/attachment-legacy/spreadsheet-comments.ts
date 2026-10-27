import { bounded, fail } from './types'
import { workbook, unicode, checkedText, u16, type Biff } from './spreadsheet-records'
import { commentShapes } from './spreadsheet-drawings'
import { spreadsheetCharts } from './spreadsheet-charts'
/** MS-XLS 2.4.329: text and formatting are separate immediate Continue sets. */
function txo(records: Biff[], index: number): string {
 const b = records[index]!.data
 if (b.length < 18) return fail('Excel comment text properties are truncated.')
 const count = u16(b, 10), runs = u16(b, 12), formula = u16(b, 16)
 if (formula % 2 || formula + 18 !== b.length || (!count && runs !== 0) || (count && (runs < 16 || runs % 8))) fail('Excel comment text lengths are inconsistent.')
 let remaining = count, text = '', n = index + 1
 while (remaining) {
  const r = records[n++], data = r?.data
  if (r?.type !== 0x003c || !data?.length || data[0]! & 254) fail('Excel comment text continuation is missing or invalid.')
  const width = data[0]! & 1 ? 2 : 1, chars = (data.length - 1) / width
  if (!Number.isInteger(chars) || !chars || chars > remaining) fail('Excel comment text continuation exceeds its declared length.')
  const values: number[] = []
  for (let at = 1; at < data.length; at += width) values.push(width === 2 ? u16(data, at) : data[at]!)
  text += String.fromCharCode(...values); remaining -= chars
 }
 const format = new Uint8Array(runs); let used = 0
 while (used < runs) {
  const r = records[n++]
  if (r?.type !== 0x003c || !r.data.length || used + r.data.length > runs) fail('Excel comment formatting continuation is missing or invalid.')
  format.set(r.data, used); used += r.data.length
 }
 if (records[n]?.type === 0x003c) fail('Excel comment continuations exceed their declared length.')
 if (runs) {
  let prior = 0
  for (let at = 0; at < runs; at += 8) { const char = u16(format, at); if (char < prior || char > count) fail('Excel comment formatting positions are invalid.'); prior = char }
  if (u16(format, runs - 8) !== count) fail('Excel comment formatting terminator is invalid.')
 }
 return checkedText(text)
}
export function spreadsheetComments(source: Uint8Array): { text: string; notes: string[]; source: Uint8Array<ArrayBuffer> } {
 const { sheets, charts, source: current } = workbook(source), parts: string[] = []; let total = 0
 for (const sheet of sheets) {
  const shapes = commentShapes(sheet.records), seen = new Set<number>(), cells = new Set<string>()
  for (const record of sheet.records) if (record.type === 0x001c) {
   const b = record.data
   if (b.length < 12) fail('an Excel cell comment anchor is truncated.')
   const row = u16(b, 0), col = u16(b, 2), flags = u16(b, 4), id = u16(b, 6), author = unicode(b, 8), key = `${row}:${col}`
   if (col > 255 || !author.text.length || author.text.length > 54 || author.end + 1 !== b.length || seen.has(id) || cells.has(key)) fail('Excel cell comment anchors are ambiguous or invalid.')
   seen.add(id); cells.add(key)
   const shape = shapes.get(id)
   if (!shape || shape.txo === undefined) fail('a required Excel cell comment has no unambiguous drawing text.')
   if (shape.deleted) continue
   const text = txo(sheet.records, shape.txo), column = col < 26 ? String.fromCharCode(65 + col) : String.fromCharCode(64 + Math.floor(col / 26)) + String.fromCharCode(65 + col % 26)
   const label = `${sheet.name}!${column}${row + 1} comment${sheet.hidden ? ' (hidden sheet)' : ''}${flags & 0x180 ? ' (hidden cell)' : ''} — ${author.text}`
   const part = `${label}\n${text}`; total += part.length + 2
   if (total > 100_000) fail('stored Excel comments exceed 100,000 characters.')
   parts.push(part)
  }
 }
 const chartText = spreadsheetCharts(charts)
 return { source: current, text: bounded([...parts, chartText.text].filter(Boolean).join('\n\n')), notes: ['Cell values come only from current non-chart sheet records. Unlisted sheets, loose chart records and revision-history streams are excluded. Comments come from current worksheet cells and their matching active drawing notes. Rich formatting and layout are not extracted.', ...chartText.notes] }
}
