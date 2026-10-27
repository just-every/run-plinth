import { fail } from './types'
import { u16, u32, type Biff } from './spreadsheet-records'
export type CommentShape = { id: number; deleted: boolean; txo?: number; object: number }
/** MS-XLS 2.4.170 and MS-ODRAW 2.2.14: client markers belong to one shape. */
export function commentShapes(records: Biff[], objectKind = 0x19): Map<number, CommentShape> {
 const chunks: Uint8Array[] = [], boundaries = new Map<number, number>(); let length = 0
 for (let n = 0; n < records.length; n++) if (records[n]!.type === 0x00ec) {
  chunks.push(records[n]!.data); length += records[n]!.data.length
  while (records[n + 1]?.type === 0x003c) { n++; chunks.push(records[n]!.data); length += records[n]!.data.length }
  boundaries.set(length, n + 1)
 }
 const bytes = new Uint8Array(length); let offset = 0
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
 const output = new Map<number, CommentShape>(), identifiers = new Set<number>(); let nodes = 0
 type Shape = { id?: number; kind?: number; deleted?: boolean; txo?: number; fsp?: boolean; object?: number }
 function walk(start: number, end: number, depth: number, shape?: Shape) {
  if (depth > 64) fail('Excel drawings exceed their depth limit.')
  let at = start
  while (at < end) {
   if (++nodes > 100_000 || at + 8 > end) fail('an Excel drawing exceeds its record boundary or limit.')
   const version = u16(bytes, at) & 15, type = u16(bytes, at + 2), size = u32(bytes, at + 4), next = at + 8 + size
   if (next > end) fail('an Excel drawing shape is truncated.')
   if (version === 15) {
    if (![0xf002, 0xf003, 0xf004].includes(type)) fail('an Excel drawing container is unsupported.')
    const child = type === 0xf004 ? {} as Shape : undefined
    walk(at + 8, next, depth + 1, child)
    if (child?.id !== undefined) {
     if (!child.fsp || identifiers.has(child.id)) fail('Excel drawing object identifiers are ambiguous.')
     identifiers.add(child.id)
     if (child.kind === objectKind) output.set(child.id, { id: child.id, deleted: !!child.deleted, txo: child.txo, object: child.object! })
    }
   } else if (shape && type === 0xf00a) {
    if (size !== 8 || version !== 2 || shape.fsp) fail('an Excel drawing shape identifier is invalid.')
    shape.fsp = true; shape.deleted = !!(u32(bytes, at + 12) & 8)
   } else if (shape && (type === 0xf011 || type === 0xf00d)) {
    const index = boundaries.get(next), r = index === undefined ? undefined : records[index]
    if (size || version || index === undefined || !r) fail('an Excel drawing client marker has no matching record.')
    if (type === 0xf011) {
     if (r.type !== 0x005d || r.data.length < 22 || u16(r.data, 0) !== 0x15 || u16(r.data, 2) !== 0x12 || shape.id !== undefined) fail('an Excel shape has ambiguous object properties.')
     shape.kind = u16(r.data, 4); shape.id = u16(r.data, 6); shape.object = index
     if (shape.kind === 0x19 && (r.data.length < 52 || u16(r.data, 22) !== 0x000d || u16(r.data, 24) !== 0x16)) fail('an Excel comment object is truncated.')
    } else {
     if (r.type !== 0x01b6 || shape.txo !== undefined) fail('an Excel shape has ambiguous text properties.')
     shape.txo = index
    }
   }
   at = next
  }
 }
 if (length) walk(0, length, 0)
 return output
}
