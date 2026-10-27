import { Inflate } from 'pako'
import { fail } from './common'
import { tiffSegmentBytes } from './tiff-header'
import type { TiffPage } from './tiff-header'

export function inflateTiff(buffer: ArrayBuffer, page: TiffPage) {
 const original = new Uint8Array(buffer), output = new Uint8Array(8 + page.storageBytes), offsets: number[] = [], lengths: number[] = []
 output.set(original.subarray(0, 8))
 let at = 8
 for (let index = 0; index < page.offsets.length; index++) {
  const expected = tiffSegmentBytes(page, index), start = at
  const inflater = new Inflate({ chunkSize: 16384 })
  inflater.onData = chunk => {
   if (at - start + chunk.length > expected) fail('a TIFF deflate segment exceeds its declared pixel span.')
   output.set(chunk, at); at += chunk.length
  }
  const compressed = original.subarray(page.offsets[index], page.offsets[index] + page.lengths[index])
  inflater.push(compressed, true)
  if (inflater.err || at - start !== expected) fail('a TIFF deflate segment is damaged or has an inconsistent decoded size.')
  offsets.push(start); lengths.push(expected)
 }
 const storage = page.tiled ? { t324: offsets, t325: lengths } : { t273: offsets, t279: lengths }
 return { buffer: output.buffer, tags: { ...page.tags, t259: [1], ...storage } }
}

function lzwSize(bytes: Uint8Array, expected: number) {
 const lengths = new Uint32Array(4096)
 for (let index = 0; index < 256; index++) lengths[index] = 1
 let bit = 0, width = 9, next = 258, previous = -1, written = 0, cleared = false
 while (bit + width <= bytes.length * 8) {
  let code = 0
  for (let index = 0; index < width; index++, bit++) code = code * 2 + ((bytes[bit >>> 3] >>> (7 - (bit & 7))) & 1)
  if (code === 256) { width = 9; next = 258; previous = -1; cleared = true; continue }
  if (!cleared) fail('a TIFF LZW segment lacks its initial clear code.')
  if (code === 257) {
   if (written !== expected || Math.ceil(bit / 8) !== bytes.length) fail('a TIFF LZW segment has an inconsistent decoded size or trailing data.')
   return
  }
  if (previous < 0 && code > 255 || code > next || code === next && previous < 0) fail('a TIFF LZW segment references an invalid dictionary entry.')
  const length = code === next ? lengths[previous] + 1 : lengths[code]
  if (!length || (written += length) > expected) fail('a TIFF LZW segment exceeds its declared pixel span.')
  if (previous >= 0) {
   if (next >= 4096) fail('a TIFF LZW dictionary exceeds its supported 12-bit span.')
   lengths[next++] = lengths[previous] + 1
   if (next + 1 === 2 ** width && width < 12) width++
  }
  previous = code
 }
 fail('a TIFF LZW segment is truncated or lacks its end code.')
}

export function checkTiffSegments(buffer: ArrayBuffer, page: TiffPage) {
 if (![5,32773].includes(page.compression)) return
 for (let index = 0; index < page.offsets.length; index++) {
  const bytes = new Uint8Array(buffer, page.offsets[index], page.lengths[index]), expected = tiffSegmentBytes(page, index)
  if (page.compression === 5) { lzwSize(bytes, expected); continue }
  let at = 0, written = 0
  while (at < bytes.length) {
   const code = bytes[at++]
   if (code === 128) continue
   const count = code < 128 ? code + 1 : 257 - code
   at += code < 128 ? count : 1; written += count
   if (at > bytes.length || written > expected) fail('a TIFF PackBits segment is truncated or exceeds its declared pixel span.')
  }
  if (written !== expected) fail('a TIFF PackBits segment has an inconsistent decoded size.')
 }
}
