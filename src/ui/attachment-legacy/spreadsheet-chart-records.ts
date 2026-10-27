import { fail } from './types'
import { u16, type Biff } from './spreadsheet-records'
export type ChartNode = { record: Biff; children?: ChartNode[] }
const wrapped = new Set([0x31, 0x3c, 0x1007, 0x100a, 0x100d, 0x1024, 0x1025, 0x1026, 0x1027, 0x1032, 0x1033, 0x1034, 0x103c, 0x104f, 0x1050, 0x1051, 0x1060, 0x1066])
/** MS-XLS 2.1.7.20.1 and 2.4.130: balance semantic groups, unwrap explicit FRTs only. */
export function chartRecords(records: Biff[]): ChartNode[] {
 const items = records.map(record => {
  if (record.type !== 0x0851) return record
  const b = record.data
  if (b.length < 12 || u16(b, 0) !== 0x0851) return fail('an Excel chart record wrapper is invalid.')
  const type = u16(b, 4), size = u16(b, 6), end = 8 + size, padded = Math.max(12, end)
  if (!wrapped.has(type) || padded !== b.length || b.subarray(end).some(v => v !== 0)) return fail('an Excel chart record wrapper is truncated or unsupported.')
  return { ...record, type, data: b.subarray(8, end) }
 })
 let index = 0, visited = 0
 function read(depth: number): ChartNode[] {
  if (depth > 64) return fail('Excel chart groups exceed their depth limit.')
  const result: ChartNode[] = []
  while (index < items.length) {
   if (++visited > 100_000) fail('Excel chart groups exceed their record limit.')
   const record = items[index++]!
   if (record.type === 0x1034) { if (!depth || record.data.length) fail('Excel chart group terminators are invalid.'); return result }
   if (record.type === 0x1033) fail('an Excel chart group has no owning record.')
   const node: ChartNode = { record }
   if (items[index]?.type === 0x1033) { if (items[index]!.data.length) fail('an Excel chart group header is invalid.'); index++; node.children = read(depth + 1) }
   result.push(node)
  }
  if (depth) fail('an Excel chart group is unterminated.')
  return result
 }
 return read(0)
}
