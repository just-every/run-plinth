import { Inflate } from 'pako'
import { fail } from './common'
import type { TiffPage } from './tiff-header'

export function inflateTiff(buffer: ArrayBuffer, page: TiffPage) {
 const original = new Uint8Array(buffer), output = new Uint8Array(8 + page.rowBytes * page.height), offsets: number[] = [], lengths: number[] = []
 output.set(original.subarray(0, 8))
 let at = 8
 for (let index = 0; index < page.offsets.length; index++) {
  const expected = page.rowBytes * Math.min(page.rows, page.height - index * page.rows), start = at
  const inflater = new Inflate({ chunkSize: 16384 })
  inflater.onData = chunk => {
   if (at - start + chunk.length > expected) fail('a TIFF deflate strip exceeds its declared pixel span.')
   output.set(chunk, at); at += chunk.length
  }
  const compressed = original.subarray(page.offsets[index], page.offsets[index] + page.lengths[index])
  inflater.push(compressed, true)
  if (inflater.err || at - start !== expected) fail('a TIFF deflate strip is damaged or has an inconsistent decoded size.')
  offsets.push(start); lengths.push(expected)
 }
 return { buffer: output.buffer, tags: { ...page.tags, t259: [1], t273: offsets, t279: lengths } }
}
