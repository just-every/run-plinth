import { Compound } from './compound'
import { bounded, fail } from './types'

const versions = new Map([[0x00c1, [93, 0]], [0x00d9, [108, 2]], [0x0101, [136, 2]], [0x010c, [164, 2]], [0x0112, [183, 5]]])
const stories = [
 { field: 3, label: 'Main document' }, { field: 4, label: 'Footnotes' },
 { field: 5, label: 'Headers, footers and note separators' }, { field: 7, label: 'Annotations' },
 { field: 8, label: 'Endnotes' }, { field: 9, label: 'Main document text boxes' }, { field: 10, label: 'Header text boxes' },
]
const compressedMap: Record<number, number> = { 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9f: 0x0178 }

class Binary {
 private view: DataView
 constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
 span(at: number, length: number) {
  if (!Number.isSafeInteger(at) || !Number.isSafeInteger(length) || at < 0 || length < 0 || at + length > this.bytes.length) fail('a Word story structure is truncated or points outside its declared stream.')
 }
 u8(at: number) { this.span(at, 1); return this.bytes[at] }
 u16(at: number) { this.span(at, 2); return this.view.getUint16(at, true) }
 i16(at: number) { this.span(at, 2); return this.view.getInt16(at, true) }
 u32(at: number) { this.span(at, 4); return this.view.getUint32(at, true) }
 i32(at: number) { this.span(at, 4); return this.view.getInt32(at, true) }
}

function validUnicode(text: string) {
 for (let at = 0; at < text.length; at++) {
  const unit = text.charCodeAt(at)
  if (unit >= 0xd800 && unit <= 0xdbff) {
   const next = text.charCodeAt(++at)
   if (!(next >= 0xdc00 && next <= 0xdfff)) fail('a declared Word story contains invalid UTF-16. No replacement encoding was used.')
  } else if (unit >= 0xdc00 && unit <= 0xdfff) fail('a declared Word story contains an unpaired UTF-16 surrogate.')
 }
}

export function extractWordStories(source: Uint8Array): { text: string; notes: string[] } {
 const cfb = new Compound(source), word = new Binary(cfb.stream('WordDocument'))
 if (word.u16(0) !== 0xa5ec || !versions.has(word.u16(2))) fail('supplementary stories require a supported Word 97 or later FIB.')
 const flags = word.u16(10)
 if (flags & 0x8100) fail('encrypted or obfuscated Word stories are unsupported.')
 if (!(flags & 0x1000) || word.u8(19) & 1) fail('the Word character format is unsupported. Macintosh and pre-Unicode Word encodings are not guessed.')
 let at = 32
 const words = word.u16(at); at += 2
 if (words !== 14) fail('the Word FIB short-value structure is unsupported.')
 word.span(at, words * 2); at += words * 2
 const longs = word.u16(at); at += 2
 if (longs !== 22) fail('the Word FIB character-count structure is unsupported.')
 const longBase = at; word.span(at, longs * 4); at += longs * 4
 const pairs = word.u16(at); at += 2
 if (![93,108,136,164,183].includes(pairs)) fail('the Word FIB table-pointer structure is unsupported.')
 const pairBase = at; word.span(at, pairs * 8); at += pairs * 8
 const extraWords = word.u16(at); at += 2
 if (![0,2,5].includes(extraWords)) fail('the Word FIB extension length is unsupported.')
 word.span(at, extraWords * 2)
 const version = extraWords ? word.u16(at) : word.u16(2), expected = versions.get(version)
 if (!expected || expected[0] !== pairs || expected[1] !== extraWords || version < word.u16(2)) fail('the Word FIB version and declared structure lengths are inconsistent.')
 const fibEnd = at + extraWords * 2, meaningful = word.u32(longBase)
 if (meaningful < fibEnd || meaningful > word.bytes.length) fail('the Word meaningful-byte boundary is invalid.')
 if (word.i32(longBase + 6 * 4) !== 0) fail('the obsolete Word macro-story character range is unsupported.')
 const counts = stories.map(story => word.i32(longBase + story.field * 4))
 if (counts.some(count => count < 0) || !counts[0]) fail('Word story character counts are invalid or the main story is empty.')
 const total = counts.reduce((sum, count) => sum + count, 0), hasExtra = counts.slice(1).some(Boolean), terminal = total + Number(hasExtra)
 if (total > 100_000) fail('declared Word stories exceed 100,000 characters.')
 const table = new Binary(cfb.stream(flags & 0x0200 ? '1Table' : '0Table'))
 const start = word.u32(pairBase + 33 * 8), length = word.u32(pairBase + 33 * 8 + 4), end = start + length
 if (!length) fail('Word supplementary stories require the declared CLX piece table.')
 table.span(start, length); at = start
 let properties = 0
 while (at < end && table.u8(at) === 1) {
  if (++properties > 10_000 || at + 3 > end) fail('Word piece properties exceed their boundary or count limit.')
  const size = table.i16(at + 1)
  if (size < 0 || size > 0x3fa2 || at + 3 + size > end) fail('Word piece properties are malformed.')
  at += 3 + size
 }
 if (at + 5 > end || table.u8(at) !== 2) fail('the declared Word CLX has no valid piece-table record.')
 const size = table.u32(at + 1), pieceCount = (size - 4) / 12, cpBase = at + 5
 if (size < 16 || !Number.isInteger(pieceCount) || pieceCount > 10_000 || cpBase + size !== end) fail('the Word piece table is malformed or exceeds 10,000 pieces.')
 if (table.u32(cpBase) !== 0 || table.u32(cpBase + pieceCount * 4) !== terminal) fail('the Word piece-table character range does not match the declared stories.')
 const pieceBase = cpBase + (pieceCount + 1) * 4, pieces: string[] = []
 for (let piece = 0; piece < pieceCount; piece++) {
  const first = table.u32(cpBase + piece * 4), last = table.u32(cpBase + (piece + 1) * 4), descriptor = pieceBase + piece * 8
  const attributes = table.u16(descriptor), encoded = table.u32(descriptor + 2), compressed = Boolean(encoded & 0x40000000), fc = encoded & 0x3fffffff
  if (last <= first || last > terminal || encoded & 0x80000000 || attributes & 4 || compressed && fc % 2) fail('a Word piece has an invalid character range, flags or byte offset.')
  const position = compressed ? fc / 2 : fc, bytesPerChar = compressed ? 1 : 2, byteLength = (last - first) * bytesPerChar
  if (position < fibEnd || position + byteLength > meaningful) fail('a Word piece points outside the meaningful text bytes.')
  word.span(position, byteLength)
  const units: string[] = []
  for (let character = 0; character < last - first; character++) {
   const value = compressed ? word.u8(position + character) : word.u16(position + character * 2)
   units.push(String.fromCharCode(compressed ? compressedMap[value] ?? value : value))
  }
  const text = units.join('')
  if (attributes & 1 && text.includes('\r')) fail('a Word piece contradicts its paragraph-marker declaration.')
  pieces.push(text)
 }
 const logical = pieces.join('')
 validUnicode(logical)
 if (logical.length !== terminal || logical[counts[0] - 1] !== '\r' || hasExtra && logical[total] !== '\r') fail('Word story lengths or terminal paragraph guards are inconsistent.')
 let cp = counts[0]
 const output: string[] = []
 for (let story = 1; story < stories.length; story++) {
  const text = logical.slice(cp, cp + counts[story]); cp += counts[story]
  validUnicode(text)
  const cleaned = text.replace(/[\r\v\f]/g, '\n').replace(/\u0007/g, '\t').replace(/[\u0000-\u0006\u0008\u000e-\u001f]/g, ' ').trim()
  if (cleaned) output.push(`${stories[story].label}\n${cleaned}`)
 }
 return { text: bounded(output.join('\n\n')), notes: [
  'Supplementary Word text is read only from FIB-declared story ranges in the selected CLX piece table. Main-body text is supplied separately by the legacy reader; old and unreferenced stream bytes are not scanned.',
  'Headers, footers and note separators are grouped in their declared header subdocument. Individual note anchors, section placement, numbering, field evaluation, font glyphs, layout and tracked-change acceptance are not interpreted. Structural control markers are normalized; pictures and embedded objects are not read or recognized.',
 ] }
}
