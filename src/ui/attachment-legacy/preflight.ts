import { Compound } from './compound'
import { presentationGraph } from './presentation-graph'
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
export function preflight(bytes: Uint8Array, format: LegacyFormat) {
 const cfb = new Compound(bytes)
 if (cfb.has('EncryptedPackage')) fail('encrypted Office packages require their original modern-format reader.')
 for (const name of ['WordDocument', 'Workbook', 'Book', 'PowerPoint Document', 'Current User']) if (cfb.names.filter(value => value.toLowerCase() === name.toLowerCase()).length > 1) fail('nested document streams are ambiguous and unsupported.')
 const presentation = format === 'ppt' ? presentationGraph(cfb) : undefined
 if (format === 'doc') word(cfb)
 else if (format === 'xls') spreadsheet(cfb)
 return { presentation, notes: ['The local reader does not execute macros, follow external links, recognize image text or recursively extract embedded OLE payloads.',
  ...(format === 'doc' ? ['This reader combines main Word text with declared footnotes, grouped headers and footers, annotations, endnotes and text boxes. Individual anchors, fields, layout, tracked-change acceptance, images and embedded objects are not interpreted.'] : []),
  ...(format === 'xls' ? ['This reader extracts stored Excel cell values and cached formula results. Formatting, formula expressions, comments, chart content, drawings and embedded objects are not fully read. Cached results are not recalculated.'] : []),
 ] }
}
