import { compound, u16, u32 } from './compound.mjs'
export function wordDocument() {
 const text = 'Legacy Word fixture synthetic-plinth-9401.\rSecond paragraph.\r', encoded = Buffer.from(text, 'utf16le'), offset = 1024
 const word = Buffer.alloc(4096), pieces = Buffer.concat([u32(0), u32(text.length), u16(0), u32(offset), u16(0)])
 const table = Buffer.concat([Buffer.from([2]), u32(pieces.length), pieces])
 word.writeUInt16LE(0xa5ec, 0); word.writeUInt16LE(0x00c1, 2); word.writeUInt16LE(0x0409, 6); word.writeUInt16LE(0x1000, 10)
 word.writeUInt32LE(offset, 24); word.writeUInt32LE(offset + encoded.length, 28)
 word.writeUInt16LE(14, 32); word.writeUInt16LE(22, 62); word.writeUInt32LE(word.length, 64); word.writeUInt32LE(text.length, 76)
 word.writeUInt16LE(93, 152); word.writeUInt32LE(0, 0x1a2); word.writeUInt32LE(table.length, 0x1a6); encoded.copy(word, offset)
 return compound({ WordDocument: word, '0Table': table })
}
