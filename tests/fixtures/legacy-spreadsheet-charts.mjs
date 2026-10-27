// Original synthetic MS-XLS BIFF8 and MS-ODRAW bytes under Plinth's MIT license.
// Chart Sheet Substream 2.1.7.20.1: SERIESFORMAT, ATTACHEDLABEL and SERIESDATA.
import { compound, u16, u32 } from './legacy-documents/compound.mjs'
const cat = xs => Buffer.concat(xs), rec = (type, data = Buffer.alloc(0)) => cat([u16(type), u16(data.length), data])
const bof = type => rec(0x0809, cat([u16(0x600), u16(type), u16(0xdbb), u16(1997), u32(0x41), u32(6)]))
const begin = () => rec(0x1033), end = () => rec(0x1034), eof = () => rec(10)
const unicode = (s, short = false, wide = true) => cat([short ? Buffer.from([s.length]) : u16(s.length), Buffer.from([wide ? 1 : 0]), Buffer.from(s, wide ? 'utf16le' : 'latin1')])
const st = (s, wide = true) => rec(0x100d, cat([u16(0), unicode(s, true, wide)]))
const area = column => cat([Buffer.from([0x3b]), u16(0), u16(0), u16(1), u16(column), u16(column)])
const ai = (role, formula = Buffer.alloc(0)) => rec(0x1051, cat([Buffer.from([role, formula.length ? 2 : 1]), u16(0), u16(0), u16(formula.length), formula]))
const pos = () => rec(0x104f, cat([u16(2), u16(2), Buffer.alloc(16)]))
const number = (row, col, value) => { const b = Buffer.alloc(14); b.writeUInt16LE(row); b.writeUInt16LE(col, 2); b.writeDoubleLE(value, 6); return rec(0x0203, b) }
const label = (row, col, text, wide) => rec(0x0204, cat([u16(row), u16(col), u16(0), unicode(text, false, wide)]))
const dim = () => rec(0x0200, cat([u32(0), u32(2), u16(0), u16(1), u16(0)]))
function attached(text) {
 const properties = Buffer.alloc(32); properties[0] = 2; properties[1] = 2; properties.writeUInt16LE(1, 2)
 return cat([rec(0x1025, properties), begin(), pos(), ai(0), st(text), rec(0x1027, cat([u16(1), u16(0), u16(0)])), end()])
}
function chart(title, series, category, value, standalone = false, loose = '') {
 const setup = Buffer.alloc(34); setup.writeUInt16LE(1); setup.writeUInt16LE(100, 2); setup.writeUInt16LE(1, 6); setup.writeUInt16LE(1, 8)
 const margin = Buffer.alloc(8); margin.writeDoubleLE(0.75)
 const page = cat([rec(0x14, unicode('')), rec(0x15, unicode('')), rec(0x83, u16(0)), rec(0x84, u16(0)), ...[0x26, 0x27, 0x28, 0x29].map(t => rec(t, margin)), rec(0xa1, setup)])
 const seriesRecords = cat([rec(0x1003, cat([u16(3), u16(1), u16(2), u16(2), u16(1), u16(0)])), begin(), ai(0), st(series, false), ai(1, area(0)), ai(2, area(1)), ai(3), rec(0x1045, u16(0)), end()])
 const bar = cat([rec(0x1014, Buffer.alloc(20)), begin(), rec(0x1017, cat([u16(0), u16(150), u16(0)])), rec(0x1022, u16(0)), end()])
 const axes = cat([rec(0x1041, cat([u16(0), Buffer.alloc(16)])), begin(), pos(), bar, end()])
 const chartGroup = cat([rec(0x1002, cat([u32(0), u32(0), u32(400), u32(300)])), begin(), rec(0xa0, cat([u16(1), u16(1)])), rec(0x1064, cat([u32(65536), u32(65536)])), seriesRecords, rec(0x1044, cat([u16(0), Buffer.from([0])])), rec(0x1046, u16(1)), axes, attached(title), ...(loose ? [st(loose)] : []), end()])
 const cache = cat([dim(), rec(0x1065, u16(1)), number(0, 0, value), number(1, 0, value + 1), rec(0x1065, u16(2)), label(0, 0, category + ' 荷重', true), label(1, 0, 'saved category', false), rec(0x1065, u16(3))])
 const window = standalone ? rec(0x023e, cat([u16(0x6b6), u16(0), u16(0), u16(0x40), u16(0), u16(0), u16(0), u32(0)])) : Buffer.alloc(0)
 return cat([bof(0x20), page, rec(0x33, u16(3)), rec(0x1001, u16(0)), chartGroup, cache, window, eof()])
}
const art = (type, bytes, version = 0, instance = 0) => cat([u16(version | instance << 4), u16(type), u32(bytes.length), bytes])
function drawing(objects) {
 const group = art(0xf004, cat([art(0xf009, Buffer.alloc(16), 1), art(0xf00a, cat([u32(1024), u32(5)]), 2)]), 15)
 const shapes = objects.map((object, n) => {
  const anchor = Buffer.alloc(18); anchor.writeUInt16LE(1, 2); anchor.writeUInt16LE(1, 6); anchor.writeUInt16LE(5, 10); anchor.writeUInt16LE(10, 14)
  return art(0xf004, cat([art(0xf00a, cat([u32(1025 + n), u32(0xa00 | (object.deleted ? 8 : 0))]), 2, 75), art(0xf00b, Buffer.alloc(0), 3), art(0xf010, anchor), art(0xf011, Buffer.alloc(0))]), 15)
 })
 const children = cat([group, ...shapes]), dg = art(0xf008, cat([u32(objects.length + 1), u32(1024 + objects.length)]), 0, 1)
 const prefix = cat([u16(15), u16(0xf002), u32(dg.length + 8 + children.length), dg, u16(15), u16(0xf003), u32(children.length), group])
 return cat(objects.flatMap((object, n) => [rec(0xec, cat([...(n ? [] : [prefix]), shapes[n]])), rec(0x5d, cat([u16(0x15), u16(0x12), u16(5), u16(n + 1), u16(0x4011), Buffer.alloc(12), Buffer.alloc(4)])), object.chart]))
}
export function legacySpreadsheetCharts() {
 const terms = Array.from({length: 7}, (_, n) => `synthetic-plinth-${10401 + n}`), absent = Array.from({length: 5}, (_, n) => `synthetic-plinth-${10501 + n}`)
 const embedded = chart(terms[1], terms[2], terms[3], 243.75, false, absent[4]), dead = chart(absent[0], 'deleted series', 'deleted category', 999)
 const worksheet = cat([bof(0x10), rec(0x81, u16(0)), dim(), rec(0xfd, cat([u16(0), u16(0), u16(0), u32(0)])), drawing([{chart: embedded}, {chart: dead, deleted: true}]), st(absent[1]), eof()])
 const source = cat([bof(0x10), rec(0x81, u16(0)), dim(), number(0, 0, 1), number(1, 0, 2), label(0, 1, 'source label', false), label(1, 1, 'source label two', false), eof()])
 const separate = chart(terms[4], terms[5], terms[6], 617.5, true), orphan = chart(absent[2], 'unlisted series', 'unlisted category', 888, true)
 const bound = (name, type, offset) => rec(0x85, cat([u32(offset), Buffer.from([0, type, name.length, 0]), Buffer.from(name)]))
 const globals = (a, b, c) => cat([bof(5), rec(0x42, u16(1200)), bound('PlotHost', 0, a), bound('SavedSource', 0, b), bound('ChartTab', 2, c), rec(0x1ae, cat([u16(3), u16(0x401)])), rec(0x17, cat([u16(1), u16(0), u16(1), u16(1)])), rec(0xfc, cat([u32(1), u32(1), unicode(terms[0])])), eof()])
 const size = globals(0, 0, 0).length, workbook = cat([globals(size, size + worksheet.length, size + worksheet.length + source.length), worksheet, source, separate, orphan])
 return { name: 'synthetic-plinth-10600.xls', mime: 'application/vnd.ms-excel', bytes: compound({Workbook: workbook, 'Revision Log': st(absent[3])}), terms, absent, required: ['243.75', '617.5', 'saved category', '荷重', 'PlotHost embedded chart 1', 'ChartTab chart sheet'] }
}
