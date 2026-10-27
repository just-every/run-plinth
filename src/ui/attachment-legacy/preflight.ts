import { Compound } from './compound'
import { fail, type LegacyFormat } from './types'
const u16 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(at, true)
const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true)
function word(cfb: Compound) {
 const bytes = cfb.stream('WordDocument')
 if (bytes.length < 0x1aa || u16(bytes, 0) !== 0xa5ec || u16(bytes, 2) < 0xc1) fail('only Word 97 and later binary main text is supported.')
 if (u16(bytes, 10) & 0x8100) fail('encrypted or obfuscated binary Word files are unsupported.')
 if (u32(bytes, 0x4c) > 100_000) fail('the Word main story exceeds 100,000 characters.')
 const table = cfb.stream(u16(bytes, 10) & 512 ? '1Table' : '0Table'), start = u32(bytes, 0x1a2), length = u32(bytes, 0x1a6)
 if (!length || start + length > table.length) fail('the Word piece table is missing or truncated.')
}
function spreadsheet(cfb: Compound) {
 const bytes = cfb.stream(cfb.has('Workbook') ? 'Workbook' : 'Book')
 if (bytes.length < 8 || u16(bytes, 0) !== 0x0809 || u16(bytes, 4) !== 0x0600) fail('only BIFF8 binary Excel workbooks are supported.')
 let at = 0, records = 0, rows = 0, columns = 0, total = 0
 const cellTypes = new Set([0x0006, 0x0201, 0x0203, 0x0204, 0x0205, 0x00d6, 0x027e, 0x00fd, 0x00bd, 0x00be])
 while (at < bytes.length) {
  if (at + 4 > bytes.length || ++records > 100_000) fail('the Excel record boundary or record limit was exceeded.')
  const type = u16(bytes, at), length = u16(bytes, at + 2), body = at + 4
  if (body + length > bytes.length) fail('an Excel record is truncated.')
  if (type === 0x002f) fail('encrypted binary Excel workbooks are unsupported.')
  if (type === 0x000a) { total += rows * columns; rows = 0; columns = 0 }
  if (cellTypes.has(type)) {
   if (length < 6) fail('an Excel cell record is truncated.')
   rows = Math.max(rows, u16(bytes, body) + 1)
   const column = type === 0x00bd || type === 0x00be ? u16(bytes, body + length - 2) : u16(bytes, body + 2)
   columns = Math.max(columns, column + 1)
   if (column > 255 || total + rows * columns > 250_000) fail('the Excel allocated grid exceeds 250,000 cells.')
  }
  if (type === 0x00fc && (length < 8 || u32(bytes, body + 4) > 100_000)) fail('the Excel shared string table exceeds its limit.')
  at = body + length
 }
}
type Record = { at: number; body: number; end: number; type: number; instance: number; container: boolean }
function presentation(cfb: Compound) {
 const bytes = cfb.stream('PowerPoint Document'), user = cfb.stream('Current User')
 if (user.length < 28 || u16(user, 2) !== 0x0ff6) fail('a current PowerPoint user-edit record is required.')
 if (u32(user, 12) !== 0xe391c05f) fail('encrypted or unsupported PowerPoint user-edit records cannot be read.')
 const all = new Map<number, Record>(); let count = 0
 function record(at: number, end: number): Record {
  if (at + 8 > end || ++count > 100_000) return fail('the PowerPoint record boundary or record limit was exceeded.')
  const finish = at + 8 + u32(bytes, at + 4)
  if (finish > end) return fail('a PowerPoint record is truncated.')
  return { at, body: at + 8, end: finish, type: u16(bytes, at + 2), instance: u16(bytes, at) >> 4, container: (u16(bytes, at) & 15) === 15 }
 }
 function walk(start: number, end: number, depth: number) {
  if (depth > 64) fail('PowerPoint nesting exceeds 64 levels.')
  for (let at = start; at < end;) { const r = record(at, end); all.set(at, r); if (r.container) walk(r.body, r.end, depth + 1); at = r.end }
 }
 walk(0, bytes.length, 0)
 const offsets = new Map<number, number>(), seen = new Set<number>(); let edit = u32(user, 16), documentId = 0
 for (let n = 0; ; n++) {
  if (n >= 256 || seen.has(edit)) fail('the PowerPoint user-edit chain exceeds its limit or is cyclic.')
  seen.add(edit); const r = all.get(edit)
  if (!r || r.type !== 0x0ff5 || r.container || r.end - r.body < 28) fail('the PowerPoint current edit is invalid.')
  if (!n) documentId = u32(bytes, r.body + 16)
  if (r.end - r.body >= 32 && u32(bytes, r.body + 28)) fail('encrypted binary PowerPoint files are unsupported.')
  const directory = all.get(u32(bytes, r.body + 12))
  if (!directory || directory.type !== 0x1772) fail('the PowerPoint persist directory is missing.')
  for (let at = directory.body; at < directory.end;) {
   if (at + 4 > directory.end) fail('the PowerPoint persist directory is truncated.')
   const head = u32(bytes, at), id = head & 0xfffff, size = head >>> 20; at += 4
   if (!size || at + size * 4 > directory.end || offsets.size + size > 10_000) fail('the PowerPoint persist directory exceeds its bounds.')
   for (let i = 0; i < size; i++, at += 4) if (!offsets.has(id + i)) offsets.set(id + i, u32(bytes, at))
  }
  edit = u32(bytes, r.body + 8); if (!edit) break
 }
 const document = all.get(offsets.get(documentId) ?? -1)
 if (!document || document.type !== 0x03e8 || !document.container) fail('the current PowerPoint document is missing.')
 const children = [...all.values()].filter(r => r.at >= document.body && r.at < document.end)
 const slides = children.find(r => r.type === 0x0ff0 && r.instance === 0 && r.container)
 if (!slides) fail('the current PowerPoint slide list is missing.')
 let slideCount = 0
 for (const r of all.values()) if (r.at >= slides.body && r.at < slides.end && r.type === 0x03f3) {
  if (r.end - r.body < 20) fail('a PowerPoint slide reference is truncated.')
  const slide = all.get(offsets.get(u32(bytes, r.body)) ?? -1)
  if (!slide || slide.type !== 0x03ee || !slide.container) fail('a current PowerPoint slide could not be resolved.')
  slideCount++
 }
 if (!slideCount) fail('the current PowerPoint deck contains no resolvable slides.')
}
export function preflight(bytes: Uint8Array, format: LegacyFormat): string[] {
 const cfb = new Compound(bytes)
 if (cfb.has('EncryptedPackage')) fail('encrypted Office packages require their original modern-format reader.')
 for (const name of ['WordDocument', 'Workbook', 'Book', 'PowerPoint Document', 'Current User']) if (cfb.names.filter(value => value.toLowerCase() === name.toLowerCase()).length > 1) fail('nested document streams are ambiguous and unsupported.')
 if (format === 'doc') word(cfb)
 else if (format === 'xls') spreadsheet(cfb)
 else presentation(cfb)
 return ['The local reader does not execute macros, follow external links, recognize image text or recursively extract embedded OLE payloads.',
  ...(format === 'doc' ? ['This reader combines main Word text with declared footnotes, grouped headers and footers, annotations, endnotes and text boxes. Individual anchors, fields, layout, tracked-change acceptance, images and embedded objects are not interpreted.'] : []),
  ...(format === 'xls' ? ['This reader extracts stored Excel cell values and cached formula results. Formatting, formula expressions, comments, chart content, drawings and embedded objects are not fully read. Cached results are not recalculated.'] : []),
  ...(format === 'ppt' ? ['This reader extracts current slide text and text exposed by its structured model. Separate notes slides, masters, comments, charts and embedded objects are not fully read.'] : []),
 ]
}
