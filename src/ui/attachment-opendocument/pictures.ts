import { rasterSize } from '../attachment-formats/raster'
import { attr, elements, fail } from './common'
import type { OpenPackage } from './package'
function typeOf(bytes: Uint8Array): string | undefined {
 if (bytes.subarray(0, 8).join(',') === '137,80,78,71,13,10,26,10') return 'image/png'
 if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
 if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
}
export class Pictures {
 private read = new Map<string, Promise<string>>()
 private count = 0
 private total = 0
 constructor(private office: OpenPackage) {}
 async image(element: Element, label: string) {
  const { draft, archive } = this.office
  draft.check()
  const href = attr(element, 'xlink', 'href'), binary = elements(element, 'office', 'binary-data')
  if (href && binary.length || binary.length > 1) fail('an image has ambiguous binary sources.')
  let key: string, bytes: Uint8Array<ArrayBuffer> | undefined
  if (href) {
   const path = this.office.internal(href); if (!path) return
   key = path
   if (!this.read.has(key)) bytes = await archive.read(path)
  } else if (binary.length) {
   const encoded = (binary[0].textContent ?? '').replace(/\s/g, '')
   if (!encoded || encoded.length > 11_184_812 || !/^[a-z\d+/]*={0,2}$/i.test(encoded)) fail('an inline image has invalid base64 or exceeds 8 MiB.')
   let value: string
   try { value = atob(encoded) } catch { return fail('an inline image has invalid base64.') }
   bytes = Uint8Array.from(value, character => character.charCodeAt(0)); key = encoded
  } else { draft.notes.add(`An image in ${label} has no supported internal source and was not read.`); return }
  let work = this.read.get(key)
  if (!work) {
   if (++this.count > 40 || !bytes || bytes.length > 8 * 1024 * 1024 || (this.total += bytes.length) > 20 * 1024 * 1024) fail('raster pictures exceed 40 items, 8 MiB each or 20 MiB total.')
   const type = typeOf(bytes)
   if (!type) { draft.notes.add(`An unsupported picture in ${label} was not read. Only embedded PNG, JPEG and WebP are recognized.`); this.read.set(key, Promise.resolve('')); return }
   rasterSize(bytes, type)
   const raster = bytes
   work = (async () => { draft.hooks.progress(`Recognizing an embedded raster picture in ${label}…`); const text = await draft.hooks.recognizeImage(new Blob([raster], { type })); draft.check(); return draft.bound(text) })()
   this.read.set(key, work)
  }
  const text = await work; draft.check()
  if (text.trim()) draft.add(`${label} raster picture`, text)
  else draft.notes.add(`No text was recognized in an embedded raster picture in ${label}. Inspect the original.`)
 }
}
