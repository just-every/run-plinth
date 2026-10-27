import { compound, u16, u32 } from './compound.mjs'
const record = (type, body = Buffer.alloc(0), instance = 0, container = false) => Buffer.concat([u16(instance * 16 + (container ? 15 : 0)), u16(type), u32(body.length), body])
export function presentationDocument() {
 const title = 'Legacy slide synthetic-plinth-9403', body = 'Stored slide body synthetic-plinth-9405'
 const text = (type, value) => Buffer.concat([record(0x0f9f, u32(type)), record(0x0fa0, Buffer.from(value, 'utf16le'))])
 const slidePersist = Buffer.concat([u32(2), u32(4), u32(2), u32(256), u32(0)])
 const slideList = record(0x0ff0, Buffer.concat([record(0x03f3, slidePersist), text(0, title), text(1, body)]), 0, true)
 const atom = Buffer.alloc(40); atom.writeUInt32LE(5760, 0); atom.writeUInt32LE(4320, 4); atom.writeUInt32LE(4320, 8); atom.writeUInt32LE(5760, 12); atom.writeUInt16LE(1, 32)
 const document = record(0x03e8, Buffer.concat([record(0x03e9, atom), slideList]), 0, true)
 const slideAtom = Buffer.alloc(24); slideAtom.writeUInt16LE(7, 20)
 const shape = Buffer.concat([record(0x0f9e, u32(0)), record(0x0f9e, u32(1))])
 const slide = record(0x03ee, Buffer.concat([record(0x03ef, slideAtom), record(0xf00d, shape, 0, true)]), 0, true)
 const directoryOffset = document.length + slide.length
 const directory = record(0x1772, Buffer.concat([u32((2 << 20) | 1), u32(0), u32(document.length)]))
 const editBody = Buffer.alloc(28); editBody.writeUInt32LE(256, 0); editBody.writeUInt32LE(0x03f40000, 4); editBody.writeUInt32LE(directoryOffset, 12); editBody.writeUInt32LE(1, 16); editBody.writeUInt32LE(3, 20)
 const edit = record(0x0ff5, editBody), stream = Buffer.concat([document, slide, directory, edit])
 const user = Buffer.alloc(24); user.writeUInt32LE(20, 0); user.writeUInt32LE(0xe391c05f, 4); user.writeUInt32LE(directoryOffset + directory.length, 8); user.writeUInt16LE(0x03f4, 14); user[16] = 3; user.writeUInt32LE(8, 20)
 return compound({ 'PowerPoint Document': stream, 'Current User': record(0x0ff6, user) })
}
