import { fail } from './types'

export const ZIP_LIMITS = { bytes: 20 * 1024 * 1024, entries: 2000, expanded: 64 * 1024 * 1024, entry: 16 * 1024 * 1024, xml: 8 * 1024 * 1024 }
export type ZipEntry = { size: number; crc: number }

export function directory(bytes: Uint8Array<ArrayBuffer>): Map<string, ZipEntry> {
 if (bytes.length > ZIP_LIMITS.bytes) fail('the original exceeds 20 MiB.')
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
 const u16 = (at: number) => view.getUint16(at, true), u32 = (at: number) => view.getUint32(at, true)
 if (bytes[0] === 0xd0 && bytes[1] === 0xcf) fail('encrypted Office containers and legacy binary Office files are unsupported. Supply an unencrypted modern Office file or reviewed text.')
 if (bytes.length < 22 || u32(0) !== 0x04034b50) fail('this is not a supported Office ZIP container.')
 let end = -1
 for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
  if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break }
 }
 if (end < 0) fail('the ZIP directory is missing or damaged.')
 const count = u16(end + 10), start = u32(end + 16), size = u32(end + 12)
 if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) fail('split ZIP archives are unsupported.')
 if (count === 0xffff || start === 0xffffffff || size === 0xffffffff) fail('ZIP64 archives are unsupported.')
 if (!count || count > ZIP_LIMITS.entries || start + size !== end) fail('the ZIP directory is invalid or exceeds 2,000 entries.')
 const entries = new Map<string, ZipEntry>(), spans: [number, number][] = []
 let at = start, expanded = 0
 const nameAt = (offset: number, length: number) => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length)) }
  catch { return fail('ZIP entry names must use valid UTF-8.') }
 }
 for (let index = 0; index < count; index++) {
  if (at + 46 > end || u32(at) !== 0x02014b50) fail('the ZIP directory is malformed.')
  const flags = u16(at + 8), method = u16(at + 10), compressed = u32(at + 20), uncompressed = u32(at + 24)
  const nameLength = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32), local = u32(at + 42)
  if (flags & 0x41) fail('encrypted ZIP entries are unsupported.')
  if (![0, 8].includes(method) || u16(at + 34)) fail('this ZIP compression or disk layout is unsupported.')
  if ([compressed, uncompressed, local].includes(0xffffffff)) fail('ZIP64 entries are unsupported.')
  if (at + 46 + nameLength + extra + comment > end) fail('a ZIP directory entry is truncated.')
  const name = nameAt(at + 46, nameLength)
  if (!name || name.startsWith('/') || name.includes('\\') || /[\x00-\x1f:]/.test(name) || name.split('/').some(part => part === '..' || part === '.') || entries.has(name)) fail('a ZIP entry has an unsafe or duplicate name.')
  expanded += uncompressed
  if (uncompressed > ZIP_LIMITS.entry || expanded > ZIP_LIMITS.expanded) fail('ZIP expansion exceeds 16 MiB per entry or 64 MiB total.')
  if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) fail('a ZIP local header is invalid.')
  const localName = u16(local + 26), localExtra = u16(local + 28), dataEnd = local + 30 + localName + localExtra + compressed
  if (dataEnd > start || nameAt(local + 30, localName) !== name) fail('ZIP local data does not match its directory.')
  spans.push([local, dataEnd])
  entries.set(name, { size: uncompressed, crc: u32(at + 16) })
  at += 46 + nameLength + extra + comment
 }
 if (at !== end) fail('the ZIP directory size is inconsistent.')
 spans.sort((a, b) => a[0] - b[0])
 for (let index = 1; index < spans.length; index++) if (spans[index][0] < spans[index - 1][1]) fail('ZIP entries overlap.')
 return entries
}
