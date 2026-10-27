import { fail } from './types'
const END = 0xfffffffe, FREE = 0xffffffff, MAX = 20 * 1024 * 1024
type Entry = { name: string; kind: number; left: number; right: number; child: number; start: number; size: number }
/** Bounded MS-CFB stream access used for validation before handing bytes to WASM. */
export class Compound {
 private view: DataView
 private sectorSize: number
 private sectors: number
 private fat: number[] = []
 private miniFat: number[] = []
 private mini = new Uint8Array()
 private entries: Entry[] = []
 private roots = new Map<string, Entry>()
 readonly names: string[] = []
 constructor(private bytes: Uint8Array) {
  this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 512 || bytes.length > MAX || bytes.subarray(0, 8).join(',') !== '208,207,17,224,161,177,26,225') fail('the original is not a supported compound Office file.')
  const version = this.u16(26), shift = this.u16(30)
  if (this.u16(28) !== 0xfffe || !((version === 3 && shift === 9) || (version === 4 && shift === 12)) || this.u16(32) !== 6 || this.u32(56) !== 4096) fail('the compound header is unsupported.')
  this.sectorSize = 2 ** shift; this.sectors = Math.floor(bytes.length / this.sectorSize) - 1
  if (bytes.length % this.sectorSize) fail('the compound original is truncated.')
  const fatIds: number[] = []
  for (let n = 0; n < 109; n++) { const id = this.u32(76 + n * 4); if (id !== FREE) fatIds.push(id) }
  let difat = this.u32(68); const seen = new Set<number>(), difatCount = this.u32(72)
  if (difatCount > this.sectors) fail('the compound sector table exceeds the original.')
  for (let n = 0; n < difatCount; n++) {
   if (seen.has(difat)) fail('the compound sector table is cyclic.')
   seen.add(difat); const block = this.sector(difat)
   for (let offset = 0; offset < block.length - 4; offset += 4) { const id = this.at32(block, offset); if (id !== FREE) fatIds.push(id) }
   difat = this.at32(block, block.length - 4)
  }
  if (fatIds.length !== this.u32(44) || fatIds.length > this.sectors || new Set(fatIds).size !== fatIds.length) fail('the compound sector table is inconsistent.')
  for (const id of fatIds) { const block = this.sector(id); for (let offset = 0; offset < block.length; offset += 4) this.fat.push(this.at32(block, offset)) }
  const directory = this.chain(this.u32(48), this.fat, this.sectorSize, undefined, 4096 * 128)
  let declared = 0
  for (let at = 0; at + 128 <= directory.length; at += 128) {
   const record = directory.subarray(at, at + 128), length = this.at16(record, 64), kind = record[66]!
   if (![0, 1, 2, 5].includes(kind) || kind && (length < 2 || length > 64 || length % 2)) fail('the compound directory is invalid.')
   const name = kind ? new TextDecoder('utf-16le', { fatal: true }).decode(record.subarray(0, length - 2)) : ''
   const size = this.at32(record, 120) + this.at32(record, 124) * 2 ** 32
   if (kind && (!Number.isSafeInteger(size) || size > MAX)) fail('a compound stream exceeds 20 MiB.')
   if (kind === 2) declared += size
   if (declared > 64 * 1024 * 1024) fail('compound streams exceed the 64 MiB expansion limit.')
   this.entries.push({ name, kind, left: this.at32(record, 68), right: this.at32(record, 72), child: this.at32(record, 76), start: this.at32(record, 116), size })
   if (kind) this.names.push(name)
  }
  const root = this.entries[0]
  if (root?.kind !== 5) fail('the compound root is missing.')
  this.mini = this.chain(root.start, this.fat, this.sectorSize, root.size, MAX)
  const miniTable = this.chain(this.u32(60), this.fat, this.sectorSize, this.u32(64) * this.sectorSize, MAX)
  for (let at = 0; at < miniTable.length; at += 4) this.miniFat.push(this.at32(miniTable, at))
  const pending = [root.child], visited = new Set<number>()
  while (pending.length) {
   const id = pending.pop()!; if (id === FREE) continue
   if (visited.has(id) || id >= this.entries.length) fail('the compound directory tree is invalid.')
   visited.add(id); const entry = this.entries[id]!
   if (!entry.kind || this.roots.has(entry.name.toLowerCase())) fail('the compound directory contains an ambiguous stream.')
   this.roots.set(entry.name.toLowerCase(), entry); pending.push(entry.left, entry.right)
  }
 }
 private u16(at: number) { return this.view.getUint16(at, true) }
 private u32(at: number) { return this.view.getUint32(at, true) }
 private at16(bytes: Uint8Array, at: number) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(at, true) }
 private at32(bytes: Uint8Array, at: number) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true) }
 private sector(id: number): Uint8Array {
  if (id >= this.sectors) fail('a compound sector points outside the original.')
  return this.bytes.subarray((id + 1) * this.sectorSize, (id + 2) * this.sectorSize)
 }
 private chain(start: number, table: number[], unit: number, size: number | undefined, maximum: number): Uint8Array<ArrayBuffer> {
  if (size === 0) return new Uint8Array()
  if (size !== undefined && size > maximum) fail('a compound stream exceeds its allocation limit.')
  const chunks: Uint8Array[] = [], seen = new Set<number>(); let id = start, length = 0
  while (id !== END) {
   if (id >= table.length || seen.has(id)) fail('a compound stream chain is invalid or cyclic.')
   seen.add(id)
   const bytes = unit === this.sectorSize ? this.sector(id) : this.mini.subarray(id * unit, (id + 1) * unit)
   if (bytes.length !== unit || length + unit > maximum) fail('a compound stream exceeds its allocation limit.')
   chunks.push(bytes); length += unit; id = table[id]!
  }
  if (size !== undefined && (size > length || length - size >= unit)) fail('a compound stream has inconsistent declared length.')
  const output = new Uint8Array(size ?? length); let at = 0
  for (const bytes of chunks) { output.set(bytes.subarray(0, output.length - at), at); at += Math.min(bytes.length, output.length - at) }
  return output
 }
 has(name: string) { return this.roots.has(name.toLowerCase()) }
 stream(name: string): Uint8Array<ArrayBuffer> {
  const entry = this.roots.get(name.toLowerCase())
  if (!entry || entry.kind !== 2) return fail('the required document stream is missing.')
  return this.chain(entry.start, entry.size < 4096 ? this.miniFat : this.fat, entry.size < 4096 ? 64 : this.sectorSize, entry.size, MAX)
 }
}
