// Original synthetic BIFF8 and OfficeArt bytes, authored under Plinth's MIT license.
// MS-XLS 2.4.170/179/181/329; MS-ODRAW 2.2.13/14/40. No third-party document data.
import { compound, u16, u32 } from './legacy-documents/compound.mjs'
const join = parts => Buffer.concat(parts)
const rec = (type, body = Buffer.alloc(0)) => join([u16(type), u16(body.length), body])
const bof = type => rec(0x0809, join([u16(0x600), u16(type), u16(0xdbb), u16(1997), u32(0x41), u32(6)]))
const str = text => join([u16(text.length), Buffer.from([1]), Buffer.from(text, 'utf16le')])
const art = (type, body, version = 0, instance = 0) => join([u16(version | instance << 4), u16(type), u32(body.length), body])
const head = (type, length, version = 15) => join([u16(version), u16(type), u32(length)])
const txt = text => {
 const first = text.slice(0, 10), second = text.slice(10), runs = Buffer.alloc(16); runs.writeUInt16LE(text.length, 8)
 const payload = Buffer.alloc(18); payload.writeUInt16LE(0x12, 0); payload.writeUInt16LE(text.length, 10); payload.writeUInt16LE(16, 12)
 return join([rec(0x01b6, payload), rec(0x003c, join([Buffer.from([0]), Buffer.from(first, 'latin1')])), rec(0x003c, join([Buffer.from([1]), Buffer.from(second, 'utf16le')])), rec(0x003c, runs)])
}
function drawing(objects, drawingId) {
 const group = art(0xf004, join([art(0xf009, Buffer.alloc(16), 1), art(0xf00a, join([u32(drawingId * 1024), u32(5)]), 2)]), 15)
 const shapes = objects.map(({ id, kind = 0x19, deleted, text }, n) => {
  const anchor = Buffer.alloc(18); anchor.writeUInt16LE(n + 1, 2); anchor.writeUInt16LE(n + 1, 6); anchor.writeUInt16LE(n + 4, 10); anchor.writeUInt16LE(n + 4, 14)
  const body = join([art(0xf00a, join([u32(drawingId * 1024 + n + 1), u32(0xa00 | (deleted ? 8 : 0))]), 2, 202), art(0xf00b, Buffer.alloc(0), 3), art(0xf010, anchor), art(0xf011, Buffer.alloc(0))])
  const textbox = art(0xf00d, Buffer.alloc(0)), prefix = join([head(0xf004, body.length + textbox.length), body])
  const cmo = join([u16(0x15), u16(0x12), u16(kind), u16(id), u16(0x4011), Buffer.alloc(12)])
  const nts = kind === 0x19 ? join([u16(0x0d), u16(0x16), Buffer.from([id, ...Array(15).fill(0)]), u16(0), Buffer.alloc(4)]) : Buffer.alloc(0)
  return { size: prefix.length + textbox.length, chunks: [prefix, textbox], object: rec(0x005d, join([cmo, nts, Buffer.alloc(4)])), text: txt(text) }
 })
 const children = group.length + shapes.reduce((sum, s) => sum + s.size, 0), dg = art(0xf008, join([u32(objects.length + 1), u32(drawingId * 1024 + objects.length)]), 0, drawingId)
 const prefix = join([head(0xf002, dg.length + 8 + children), dg, head(0xf003, children), group])
 return join(shapes.flatMap((shape, n) => [rec(0x00ec, join([...(n ? [] : [prefix]), shape.chunks[0]])), shape.object, rec(0x00ec, shape.chunks[1]), shape.text]))
}
const note = (row, col, id, author, flags = 0) => rec(0x001c, join([u16(row), u16(col), u16(flags), u16(id), str(author), Buffer.alloc(1)]))
const cell = (row, index) => rec(0x00fd, join([u16(row), u16(0), u16(0), u32(index)]))
export function legacySpreadsheetComments() {
 const terms = [10101, 10102, 10103, 10104].map(n => `synthetic-plinth-${n}`), absent = [10201, 10202, 10203, 10204, 10205].map(n => `synthetic-plinth-${n}`)
 const sheet = (name, content) => join([bof(0x10), rec(0x0081, u16(0)), rec(0x0200, join([u32(0), u32(4), u16(0), u16(4), u16(0)])), ...content, rec(0x000a)])
 const first = sheet('CommentsEast', [cell(0, 0), drawing([{ id: 1, text: `${terms[1]} — 荷重 café` }, { id: 2, deleted: true, text: absent[0] }, { id: 3, kind: 6, text: absent[1] }], 1), txt(absent[2]), note(2, 2, 1, 'synthetic-plinth-1'), note(3, 3, 2, 'synthetic-plinth-1')])
 const second = sheet('CommentsWest', [cell(0, 1), drawing([{ id: 1, text: `${terms[3]} — façade Ω` }], 2), note(1, 1, 1, 'synthetic-plinth-2', 0x80)])
 const bound = (name, start) => rec(0x0085, join([u32(start), Buffer.from([0, 0, name.length, 0]), Buffer.from(name)]))
 const sst = rec(0x00fc, join([u32(3), u32(3), str(terms[0]), str(terms[2]), str(absent[4])]))
 const globals = (a, b) => join([bof(5), rec(0x0042, u16(1200)), bound('CommentsEast', a), bound('CommentsWest', b), sst, rec(0x000a)])
 const size = globals(0, 0).length, workbook = join([globals(size, size + first.length), first, second, sheet('Unreferenced', [cell(0, 2)])])
 // A separate revision log is not a current worksheet and must never be harvested.
 const revision = join([rec(0x001c, Buffer.from(absent[3], 'utf16le'))])
 return { name: 'synthetic-plinth-10300.xls', mime: 'application/vnd.ms-excel', bytes: compound({ Workbook: workbook, 'Revision Log': revision }), terms, absent, required: ['CommentsEast!C3', 'CommentsWest!B2', '荷重 café', 'façade Ω'] }
}
