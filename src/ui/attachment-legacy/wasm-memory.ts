import { fail } from './types'
// Preserve code and data sections. Narrow only the module's own linear-memory
// declaration before instantiation; no changes to originals or library sources.
export function limitedMemory(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
 let at = 8
 function number(end: number) {
  let value = 0, shift = 0
  for (let n = 0; n < 5 && at < end; n++, shift += 7) {
   const byte = bytes[at++]!; value += (byte & 127) * 2 ** shift
   if (!(byte & 128)) return value
  }
  return fail('the bundled reader has an invalid memory declaration.')
 }
 function encoded(value: number) {
  const output: number[] = []
  do { const byte = value & 127; value = Math.floor(value / 128); output.push(byte | (value ? 128 : 0)) } while (value)
  return output
 }
 if (bytes.length < 8 || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) !== 0x6d736100) fail('the bundled reader is not a WASM module.')
 while (at < bytes.length) {
  const start = at, id = bytes[at++]!, size = number(bytes.length), end = at + size
  if (end > bytes.length) fail('the bundled reader has a truncated section.')
  if (id !== 5) { at = end; continue }
  if (number(end) !== 1) fail('the bundled reader has an unsupported memory layout.')
  const flags = number(end), minimum = number(end), maximum = flags === 1 ? number(end) : 4096
  if (flags > 1 || at !== end || minimum > 4096) fail('the bundled reader has an unsupported memory layout.')
  const memory = [1, 1, ...encoded(minimum), ...encoded(Math.min(maximum, 4096))]
  const section = [5, ...encoded(memory.length), ...memory]
  const result = new Uint8Array(bytes.length - (end - start) + section.length)
  result.set(bytes.subarray(0, start)); result.set(section, start); result.set(bytes.subarray(end), start + section.length)
  return result
 }
 return fail('the bundled reader did not declare its own bounded memory.')
}
