import type { Draft } from './common'
import { fail, MAX_PIXELS } from './common'

export function rasterSize(bytes: Uint8Array, type: string) {
 let width = 0, height = 0
 if (type === 'image/png') {
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte) || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') fail('an inline PNG header is malformed.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  width = view.getUint32(16); height = view.getUint32(20)
 } else if (type === 'image/webp') {
  if (bytes.length < 30 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') fail('a WebP header is malformed.')
  const format = String.fromCharCode(...bytes.subarray(12, 16))
  if (format === 'VP8X') { width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) }
  else if (format === 'VP8L' && bytes[20] === 47) { width = 1 + bytes[21] + ((bytes[22] & 63) << 8); height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10) }
  else if (format === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { width = (bytes[26] | bytes[27] << 8) & 16383; height = (bytes[28] | bytes[29] << 8) & 16383 }
  else fail('the WebP frame layout is unsupported.')
 } else if (type === 'image/jpeg') {
  if (bytes[0] !== 255 || bytes[1] !== 216) fail('an inline JPEG header is malformed.')
  for (let at = 2; at + 4 < bytes.length;) {
   if (bytes[at++] !== 255) fail('an inline JPEG marker is malformed.')
   while (bytes[at] === 255) at++
   const marker = bytes[at++]
   if (marker === 217 || marker === 218) break
   if (marker === 1 || marker >= 208 && marker <= 215) continue
   const length = (bytes[at] << 8) | bytes[at + 1]
   if (length < 2 || at + length > bytes.length) fail('an inline JPEG segment is truncated.')
   if ([192,193,194].includes(marker)) {
    if (length < 8 || bytes[at + 2] !== 8) fail('the inline JPEG sample layout is unsupported.')
    height = (bytes[at + 3] << 8) | bytes[at + 4]; width = (bytes[at + 5] << 8) | bytes[at + 6]
    break
   }
   at += length
  }
 } else fail('the raster header format is unsupported.')
 if (!width || !height || width * height > MAX_PIXELS) fail('an inline raster picture has no supported dimensions or exceeds 16 megapixels.')
 return { width, height }
}

export class InlinePictures {
 private count = 0
 private bytes = 0
 constructor(private draft: Draft) {}
 async read(bytes: Uint8Array<ArrayBuffer>, type: string, label: string) {
  this.draft.hooks.check()
  if (++this.count > 40 || (this.bytes += bytes.length) > 20 * 1024 * 1024 || bytes.length > 8 * 1024 * 1024) fail('inline pictures exceed 40 items, 8 MiB each or 20 MiB total.')
  rasterSize(bytes, type)
  this.draft.hooks.progress(`Recognizing ${label.toLowerCase()}…`)
  const text = await this.draft.hooks.recognizeImage(new Blob([bytes], { type }))
  this.draft.hooks.check()
  if (text.trim()) this.draft.add(label, text)
  else this.draft.notes.add(`No text was recognized in ${label}. Inspect it manually.`)
 }
 async data(uri: string, label: string) {
  const match = /^data:(image\/(?:png|jpeg));base64,([a-z\d+/=\s]+)$/i.exec(uri)
  if (!match) fail('only base64 inline PNG and JPEG picture data is supported.')
  const encoded = match[2].replace(/\s/g, '')
  if (encoded.length > 12 * 1024 * 1024) fail('an inline picture exceeds its encoded size limit.')
  let binary: string
  try { binary = atob(encoded) } catch { return fail('inline picture base64 data is malformed.') }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  await this.read(bytes, match[1].toLowerCase(), label)
 }
}
