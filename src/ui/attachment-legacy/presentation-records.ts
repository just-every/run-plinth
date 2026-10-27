import { fail } from './types'

export type PresentationRecord = { at: number; body: number; end: number; type: number; instance: number; container: boolean }

/** Offset-directed MS-PPT reads: dead persist objects are never traversed. */
export class PresentationRecords {
 private view: DataView
 private records = new Map<number, PresentationRecord>()
 private lists = new Map<number, PresentationRecord[]>()
 constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
 span(at: number, size: number, end = this.bytes.length) {
  if (!Number.isSafeInteger(at) || !Number.isSafeInteger(size) || at < 0 || size < 0 || end > this.bytes.length || at + size > end) fail('a PowerPoint reference or record is outside its declared boundary.')
 }
 u16(at: number) { this.span(at, 2); return this.view.getUint16(at, true) }
 u32(at: number) { this.span(at, 4); return this.view.getUint32(at, true) }
 read(at: number, end = this.bytes.length): PresentationRecord {
  this.span(at, 8, end)
  const cached = this.records.get(at)
  if (cached) { this.span(at, cached.end - at, end); return cached }
  if (this.records.size >= 100_000) fail('PowerPoint exceeds 100,000 reachable records.')
  const size = this.u32(at + 4); this.span(at + 8, size, end)
  const header = this.u16(at), record = { at, body: at + 8, end: at + 8 + size, type: this.u16(at + 2), instance: header >>> 4, container: (header & 15) === 15 }
  this.records.set(at, record); return record
 }
 children(parent: PresentationRecord): PresentationRecord[] {
  if (!parent.container) fail('a PowerPoint container is required.')
  const cached = this.lists.get(parent.at); if (cached) return cached
  const children: PresentationRecord[] = []
  for (let at = parent.body; at < parent.end;) { const child = this.read(at, parent.end); children.push(child); at = child.end }
  this.lists.set(parent.at, children); return children
 }
 child(parent: PresentationRecord, type: number, instance?: number, required = true): PresentationRecord | undefined {
  const matches = this.children(parent).filter(record => record.type === type && (instance === undefined || record.instance === instance))
  if (matches.length > 1 || required && matches.length !== 1) fail('a required PowerPoint child record is missing or ambiguous.')
  return matches[0]
 }
 atom(record: PresentationRecord | undefined, type: number, size: number): PresentationRecord {
  if (!record || record.container || record.type !== type || record.end - record.body !== size) fail('a PowerPoint atom has an invalid type or declared size.')
  return record
 }
 container(record: PresentationRecord, types: number[]): PresentationRecord {
  if (!record.container || record.instance !== 0 || !types.includes(record.type)) fail('a current PowerPoint object has an invalid type.')
  return record
 }
}
