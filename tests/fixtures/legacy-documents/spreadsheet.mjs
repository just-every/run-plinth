import { compound, u16, u32 } from './compound.mjs'
const record = (type, body = Buffer.alloc(0)) => Buffer.concat([u16(type), u16(body.length), body])
const bof = type => record(0x0809, Buffer.concat([u16(0x0600), u16(type), u16(0x0dbb), u16(1997), u32(0x41), u32(6)]))
export function spreadsheetDocument() {
 const term = 'synthetic-plinth-9402', name = 'Fixture', string = Buffer.concat([u16(term.length), Buffer.from([1]), Buffer.from(term, 'utf16le')])
 const sst = record(0x00fc, Buffer.concat([u32(1), u32(1), string]))
 const bounds = position => record(0x0085, Buffer.concat([u32(position), Buffer.from([0, 0, name.length, 0]), Buffer.from(name)]))
 const prefix = Buffer.concat([bof(5), record(0x0042, u16(1200)), bounds(0), sst, record(0x000a)])
 const globals = Buffer.concat([bof(5), record(0x0042, u16(1200)), bounds(prefix.length), sst, record(0x000a)])
 const dimensions = record(0x0200, Buffer.concat([u32(0), u32(2), u16(0), u16(1), u16(0)]))
 const cell = record(0x00fd, Buffer.concat([u16(0), u16(0), u16(0), u32(0)]))
 const number = Buffer.alloc(14); number.writeUInt16LE(1); number.writeDoubleLE(42.5, 6)
 return compound({ Workbook: Buffer.concat([globals, bof(0x10), dimensions, cell, record(0x0203, number), record(0x000a)]) })
}
