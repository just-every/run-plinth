import { compound, u16, u32 } from './legacy-documents/compound.mjs'

export function legacyWordStories() {
 const terms = ['synthetic-plinth-9800', 'synthetic-plinth-9801', 'synthetic-plinth-9802', 'synthetic-plinth-9803', 'synthetic-plinth-9804', 'synthetic-plinth-9805', 'synthetic-plinth-9806', 'café', 'Ω', 'synthetic-plinth-9807']
 const main = 'Retained main document paragraph.\r'
 const header = `Header ${terms[1]}\r\r`, footer = `Footer ${terms[2]}\r\r`
 const parts = [
  { text: main, compressed: false, field: 3 },
  { text: `Footnote ${terms[0]} café\r\r`, compressed: true, field: 4 },
  { text: header + footer + '\r', compressed: false, field: 5 },
  { text: `Annotation ${terms[3]}\r\r`, compressed: true, field: 7 },
  { text: `Endnote ${terms[4]} Ω\r\r`, compressed: false, field: 8 },
  { text: `Text box ${terms[5]} café\r`, compressed: true, field: 9 },
  { text: `Header text box ${terms[6]} ${terms[9]} Ω\r`, compressed: false, field: 10 },
 ]
 const word = Buffer.alloc(4096), cp = [0], descriptors = []
 let offset = 1024
 for (let index = 0; index < parts.length; index++) {
  const part = parts[index], stored = part.text + (index === parts.length - 1 ? '\r' : '')
  if (!part.compressed && offset % 2) offset++
  const bytes = Buffer.from(stored, part.compressed ? 'latin1' : 'utf16le')
  descriptors.push(Buffer.concat([u16(0), u32(part.compressed ? (offset * 2) | 0x40000000 : offset), u16(0)]))
  bytes.copy(word, offset); offset += bytes.length
  cp.push(cp.at(-1) + stored.length)
  word.writeUInt32LE(part.text.length, 64 + part.field * 4)
 }
 const pieceTable = Buffer.concat([...cp.map(u32), ...descriptors]), clx = Buffer.concat([Buffer.from([2]), u32(pieceTable.length), pieceTable])
 const boundaries = [0,0,0,0,0,0,0,0,header.length,header.length,header.length + footer.length,header.length + footer.length,header.length + footer.length,header.length + footer.length + 1]
 const headerTable = Buffer.concat(boundaries.map(u32)), table = Buffer.concat([clx, headerTable])
 word.writeUInt16LE(0xa5ec, 0); word.writeUInt16LE(0x00c1, 2); word.writeUInt16LE(0x0409, 6)
 word.writeUInt16LE(0x1200, 10); word.writeUInt16LE(0x00bf, 12)
 word.writeUInt32LE(1024, 24); word.writeUInt32LE(offset, 28)
 word.writeUInt16LE(14, 32); word.writeUInt16LE(22, 62); word.writeUInt32LE(offset, 64); word.writeUInt16LE(93, 152)
 const pairs = 154
 word.writeUInt32LE(clx.length, pairs + 11 * 8); word.writeUInt32LE(headerTable.length, pairs + 11 * 8 + 4)
 word.writeUInt32LE(0, pairs + 33 * 8); word.writeUInt32LE(clx.length, pairs + 33 * 8 + 4)
 return { name: 'retained-word-stories.doc', mime: 'application/msword', bytes: compound({ WordDocument: word, '1Table': table }), terms }
}
