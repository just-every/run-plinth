import { Compound } from './compound'
import { fail } from './types'
import { spreadsheetSource } from './spreadsheet-source'
export type Biff = { type: number; data: Uint8Array; start: number; end: number }
export type Sheet = { name: string; hidden: number; records: Biff[] }
export const u16 = (b: Uint8Array, n: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(n, true)
export const u32 = (b: Uint8Array, n: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(n, true)
export function checkedText(text: string): string {
 for (let n = 0; n < text.length; n++) {
  const code = text.charCodeAt(n)
  if (!code || code >= 0xdc00 && code <= 0xdfff) fail('stored Excel text contains invalid Unicode.')
  if (code >= 0xd800 && code <= 0xdbff) {
   const next = text.charCodeAt(++n)
   if (!(next >= 0xdc00 && next <= 0xdfff)) fail('stored Excel text contains invalid Unicode.')
  }
 }
 return text
}
export function unicode(b: Uint8Array, at: number, short = false): { text: string; end: number } {
 if (at + (short ? 2 : 3) > b.length) return fail('an Excel Unicode string is truncated.')
 const count = short ? b[at]! : u16(b, at), flagAt = at + (short ? 1 : 2), flag = b[flagAt]!
 const end = flagAt + 1 + count * (flag & 1 ? 2 : 1)
 if (flag & 254 || end > b.length) return fail('an Excel Unicode string is invalid.')
 const chars: number[] = []
 for (let n = flagAt + 1; n < end; n += flag & 1 ? 2 : 1) chars.push(flag & 1 ? u16(b, n) : b[n]!)
 return { text: checkedText(String.fromCharCode(...chars)), end }
}
/** MS-XLS 2.4.28: follow declared sheets, never search stream slack or revision logs. */
export function workbook(source: Uint8Array) {
 const cfb = new Compound(source), bytes = cfb.stream(cfb.has('Workbook') ? 'Workbook' : 'Book')
 let visited = 0; const started = Date.now(), occupied = new Set<number>()
 const record = (at: number): Biff => {
  if (++visited > 100_000 || Date.now() - started > 300_000 || at + 4 > bytes.length) return fail('the current Excel records exceed their boundary or traversal limit.')
  const type = u16(bytes, at), length = u16(bytes, at + 2), end = at + 4 + length
  if (length > 8224 || end > bytes.length) return fail('a current Excel record is truncated or oversized.')
  if (occupied.has(at)) return fail('current Excel sheet streams overlap.')
  occupied.add(at)
  if (type === 0x002f) return fail('encrypted binary Excel workbooks are unsupported.')
  return { type, data: bytes.subarray(at + 4, end), start: at, end }
 }
 const bof = (r: Biff, kind: number) => { if (r.type !== 0x0809 || r.data.length < 16 || u16(r.data, 0) !== 0x0600 || u16(r.data, 2) !== kind) fail('a declared BIFF8 Excel substream is invalid.') }
 const globals: Biff[] = []; let at = 0; const first = record(at); bof(first, 5); globals.push(first); at = first.end
 while (true) { const r = record(at); globals.push(r); at = r.end; if (r.type === 0x0809) fail('the Excel globals contain a nested substream.'); if (r.type === 10) break }
 const globalEnd = at, sheets: Sheet[] = [], starts = new Set<number>(), names = new Set<string>(), ranges: { bound: Biff; start: number; end: number }[] = []
 for (const bound of globals.filter(r => r.type === 0x0085)) {
  const b = bound.data
  if (b.length < 8) fail('a declared Excel sheet is truncated.')
  const start = u32(b, 0), hidden = b[4]! & 3, kind = b[5]!, decoded = unicode(b, 6, true), name = decoded.text
  if (!name || name.length > 31 || hidden > 2 || decoded.end !== b.length || start < globalEnd || starts.has(start) || names.has(name.toLowerCase())) fail('declared Excel sheet scopes are ambiguous.')
  starts.add(start); names.add(name.toLowerCase())
  if (kind !== 0 && kind !== 2 && kind !== 1 && kind !== 6) fail('the declared Excel sheet kind is unsupported.')
  const root = record(start); bof(root, kind === 2 ? 0x20 : kind === 1 ? 0x40 : kind === 6 ? 6 : 0x10)
  const records: Biff[] = []; let cursor = root.end, depth = 1
  while (depth) {
   const r = record(cursor); cursor = r.end
   if (r.type === 0x0809) { if (r.data.length < 16 || u16(r.data, 0) !== 0x0600 || u16(r.data, 2) !== 0x20 || ++depth > 16) fail('an Excel nested substream is unsupported.'); continue }
   if (r.type === 10) { depth--; continue }
   if (depth === 1) records.push(r)
  }
  ranges.push({ bound, start, end: cursor })
  if (kind === 0) {
   const ws = records.filter(r => r.type === 0x0081)
   if (ws.length > 1 || ws.some(r => r.data.length !== 2)) fail('Excel worksheet properties are ambiguous.')
   if (!ws.length || !(u16(ws[0]!.data, 0) & 0x10)) sheets.push({ name, hidden, records })
  }
 }
 if (!starts.size) fail('the Excel workbook has no declared current sheets.')
 // Record-start membership alone cannot detect a malicious offset into a payload.
 const intervals = [...occupied].map(start => [start, start + 4 + u16(bytes, start + 2)]).sort((a, b) => a[0]! - b[0]!)
 for (let n = 1; n < intervals.length; n++) if (intervals[n]![0]! < intervals[n - 1]![1]!) fail('current Excel record ranges overlap.')
 const size = globalEnd + ranges.reduce((sum, r) => sum + r.end - r.start, 0), current = new Uint8Array(size)
 current.set(bytes.subarray(0, globalEnd)); let position = globalEnd
 for (const range of ranges) {
  new DataView(current.buffer).setUint32(range.bound.start + 4, position, true)
  current.set(bytes.subarray(range.start, range.end), position); position += range.end - range.start
 }
 return { sheets, source: spreadsheetSource(current) }
}
