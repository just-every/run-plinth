import * as UTIF from 'utif2'
import { fail, MAX_PIXELS } from './common'
import { tiffHeader } from './tiff-header'
import type { TiffPage } from './tiff-header'
import { checkTiffSegments, inflateTiff } from './tiff-inflate'
import { rasterSize } from './raster'

type Request = { kind: 'open'; buffer: ArrayBuffer } | { kind: 'page'; index: number }
const scope = self as unknown as { onmessage: (event: MessageEvent<Request>) => void; postMessage(message: unknown): void }
let buffer: ArrayBuffer, header: ReturnType<typeof tiffHeader>

function jpegTables(bytes: Uint8Array, start: number, end: number, marker: number, tables: Set<string>, global: Set<string>) {
 while (start < end) {
  const info = bytes[start++], kind = info >>> 4, id = info & 15, key = `${marker}:${marker === 219 ? id : info}`
  if (id > 3 || kind > 1 || global.has(key)) fail('TIFF JPEG tables are invalid or redefine a shared table.')
  tables.add(key)
  if (marker === 219) start += 64 * (kind + 1)
  else {
   if (start + 16 > end) fail('a TIFF JPEG Huffman table is truncated.')
   let count = 0, available = 1
   for (let index = 0; index < 16; index++) {
    const length = bytes[start++]; count += length; available = available * 2 - length
    if (available < 0) fail('a TIFF JPEG Huffman table is oversubscribed.')
   }
   if (!count || count > 256) fail('a TIFF JPEG Huffman table has an invalid symbol count.')
   start += count
  }
  if (start > end) fail('a TIFF JPEG table extends outside its declared marker.')
 }
}

function jpegFrame(bytes: Uint8Array, page: TiffPage, height: number, global: Set<string>, tablesOnly = false) {
 if (bytes[0] !== 255 || bytes[1] !== 216) fail('a TIFF JPEG stream lacks its start marker.')
 if (!tablesOnly) {
  const size = rasterSize(bytes, 'image/jpeg')
  if (size.width !== page.width || size.height !== height) fail('a TIFF JPEG frame disagrees with its checked strip dimensions.')
 }
 const local = new Set<string>(), scanned = new Set<number>(), ids: number[] = []
 const sample = page.tags.t262[0] === 6 ? page.tags.t530 ?? [2,2] : [1,1]
 let at = 2, frame = false, scans = 0, adobe: number | undefined
 while (at < bytes.length) {
  if (bytes[at++] !== 255) fail('a TIFF JPEG marker is malformed.')
  while (bytes[at] === 255) at++
  const marker = bytes[at++]
  if (marker === 217) {
   if (at !== bytes.length || (tablesOnly ? !local.size : !frame || scanned.size !== 3)) fail('a TIFF JPEG stream is incomplete or has trailing data.')
   if (!tablesOnly && (page.tags.t262[0] === 2 ? adobe !== 0 && ids.join(',') !== '82,71,66' : adobe === 0 || ids.join(',') === '82,71,66')) fail('TIFF JPEG color metadata disagrees with the supported decoder color transform.')
   return tablesOnly ? local : new Set([ids.join(',')])
  }
  if (at + 2 > bytes.length) fail('a TIFF JPEG marker is truncated.')
  const length = (bytes[at] << 8) | bytes[at + 1], end = at + length
  if (length < 2 || end > bytes.length) fail('a TIFF JPEG marker extends outside its segment.')
  if (marker === 219 || marker === 196) jpegTables(bytes, at + 2, end, marker, local, global)
  else if (tablesOnly) fail('TIFF shared JPEG tables contain unsupported markers or image data.')
  else if (marker === 192 || marker === 193) {
   if (frame || length !== 17 || bytes[at + 2] !== 8 || bytes[at + 7] !== 3) fail('TIFF JPEG requires one 8-bit, three-component sequential frame.')
   const h = (bytes[at + 3] << 8) | bytes[at + 4], w = (bytes[at + 5] << 8) | bytes[at + 6]
   if (w !== page.width || h !== height || ![1,2].includes(sample[0]) || ![1,2].includes(sample[1]) || sample[0] === 1 && sample[1] !== 1) fail('TIFF JPEG dimensions or sampling are inconsistent or unsupported.')
   if (Math.ceil(w / (8 * sample[0])) * 8 * sample[0] * Math.ceil(h / (8 * sample[1])) * 8 * sample[1] > MAX_PIXELS) fail('TIFF JPEG block padding exceeds 16 megapixels.')
   for (let index = 0; index < 3; index++) {
    const pos = at + 8 + index * 3, id = bytes[pos], factors = bytes[pos + 1], expected = index === 0 ? sample[0] * 16 + sample[1] : 17
    if (ids.includes(id) || factors !== expected || bytes[pos + 2] > 3) fail('TIFF JPEG components or sampling factors are inconsistent or unsupported.')
    ids.push(id)
   }
   if (page.offsets.length > 1 && page.rows % (8 * sample[1])) fail('TIFF JPEG strip rows must align with the checked MCU height.')
   frame = true
  } else if (marker === 218) {
   const count = bytes[at + 2]
   if (!frame || ++scans > 3 || count < 1 || count > 3 || length !== 6 + count * 2 || bytes[end - 3] !== 0 || bytes[end - 2] !== 63 || bytes[end - 1] !== 0) fail('TIFF JPEG scans are malformed or use unsupported progressive coding.')
   for (let index = 0; index < count; index++) {
    const id = bytes[at + 3 + index * 2], selector = bytes[at + 4 + index * 2]
    if (!ids.includes(id) || scanned.has(id) || selector >>> 4 > 3 || (selector & 15) > 3) fail('TIFF JPEG scan components or table selectors are invalid.')
    scanned.add(id)
   }
   at = end
   while (at < bytes.length) {
    if (bytes[at++] !== 255) continue
    const begin = at - 1
    while (bytes[at] === 255) at++
    const code = bytes[at]
    if (code === 0 || code >= 208 && code <= 215) { at++; continue }
    at = begin; break
   }
   continue
  } else if (marker === 221) {
   if (length !== 4) fail('a TIFF JPEG restart interval is malformed.')
  } else if (marker >= 224 && marker <= 239 || marker === 254) {
   if (marker === 238 && length >= 14 && String.fromCharCode(...bytes.subarray(at + 2, at + 7)) === 'Adobe') {
    if (adobe !== undefined || bytes[at + 13] > 1) fail('TIFF JPEG Adobe color metadata is unsupported or duplicated.')
    adobe = bytes[at + 13]
   }
  } else fail('TIFF JPEG uses unsupported markers. Progressive, lossless, arithmetic and dynamic-height JPEG are not decoded.')
  at = end
 }
 return fail('a TIFF JPEG stream lacks its end marker.')
}

function checkJpeg(page: TiffPage) {
 if (page.compression !== 7) return
 let global = new Set<string>(), signature: string | undefined
 if (page.tags.t347) {
  const tables = Uint8Array.from(page.tags.t347)
  global = jpegFrame(tables, page, 0, global, true)
  for (let index = 0; index < tables.length - 2; index++) {
   if (tables[index] === 255 && tables[index + 1] === 217) fail('TIFF shared JPEG tables contain an ambiguous end sequence unsupported by the local codec.')
  }
 }
 for (let index = 0; index < page.offsets.length; index++) {
  const bytes = new Uint8Array(buffer, page.offsets[index], page.lengths[index])
  const current = [...jpegFrame(bytes, page, Math.min(page.rows, page.height - index * page.rows), global)][0]
  if (signature !== undefined && signature !== current) fail('TIFF JPEG strip component identifiers are inconsistent.')
  signature = current
 }
}

async function pageBlob(index: number) {
 const page = header.pages[index]
 if (!page) fail('a TIFF page request is invalid.')
 checkJpeg(page); checkTiffSegments(buffer, page)
 const normalized = [8,32946].includes(page.compression) ? inflateTiff(buffer, page) : { buffer, tags: page.tags }
 const image = { ...normalized.tags } as unknown as UTIF.IFD
 UTIF.decodeImage(normalized.buffer, image)
 if (image.width !== page.width || image.height !== page.height || image.data?.length !== page.rowBytes * page.height) fail('TIFF decoder output does not match the checked page dimensions.')
 const rgba = UTIF.toRGBA8(image)
 if (rgba.length !== page.width * page.height * 4) fail('TIFF decoder did not produce the expected raster surface.')
 const source = new OffscreenCanvas(page.width, page.height), context = source.getContext('2d')
 if (!context) fail('this browser cannot create a local TIFF raster surface.')
 context.putImageData(new ImageData(new Uint8ClampedArray(rgba), page.width, page.height), 0, 0)
 const rotated = page.orientation >= 5, output = new OffscreenCanvas(rotated ? page.height : page.width, rotated ? page.width : page.height), target = output.getContext('2d')
 if (!target) fail('this browser cannot orient a local TIFF page.')
 const w = page.width, h = page.height
 const transforms: number[][] = [[1,0,0,1,0,0],[-1,0,0,1,w,0],[-1,0,0,-1,w,h],[1,0,0,-1,0,h],[0,1,1,0,0,0],[0,1,-1,0,h,0],[0,-1,-1,0,h,w],[0,-1,1,0,0,w]]
 target.fillStyle = '#fff'; target.fillRect(0, 0, output.width, output.height)
 const [a,b,c,d,e,f] = transforms[page.orientation - 1]
 target.setTransform(a,b,c,d,e,f); target.drawImage(source, 0, 0)
 const blob = await output.convertToBlob({ type: 'image/png' })
 source.width = source.height = output.width = output.height = 0
 return blob
}

scope.onmessage = event => {
 void (async () => {
  if (event.data.kind === 'open') {
   buffer = event.data.buffer; header = tiffHeader(buffer)
   scope.postMessage({ kind: 'ready', pages: header.pages.length, notes: header.notes })
  } else scope.postMessage({ kind: 'page', blob: await pageBlob(event.data.index) })
 })().catch(error => scope.postMessage({ kind: 'error', message: error instanceof Error && error.message.startsWith('File extraction: ') ? error.message : 'File extraction: TIFF decoding failed. The codec or raster data may be unsupported or damaged.' }))
}
