import JSZip from 'jszip'
import type { OfficeHooks } from './types'
import { fail } from './types'
import { directory, ZIP_LIMITS, type ZipEntry } from './zip-directory'

interface ByteStream {
 on(event: 'data', callback: (chunk: Uint8Array) => void): ByteStream
 on(event: 'error', callback: (error: unknown) => void): ByteStream
 on(event: 'end', callback: () => void): ByteStream
 pause(): ByteStream
 resume(): ByteStream
}
type StreamFile = JSZip.JSZipObject & { internalStream(type: 'uint8array'): ByteStream }

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
 let value = index
 for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
 return value >>> 0
})

export class Archive {
 private cache = new Map<string, Promise<Uint8Array<ArrayBuffer>>>()
 private expanded = 0
 private constructor(private zip: JSZip, readonly entries: Map<string, ZipEntry>, readonly hooks: OfficeHooks) {}
 static async open(file: Blob, hooks: OfficeHooks) {
  hooks.check()
  if (file.size > ZIP_LIMITS.bytes) fail('the original exceeds 20 MiB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  hooks.check()
  const entries = directory(bytes)
  const zip = await JSZip.loadAsync(bytes, { createFolders: false })
  hooks.check()
  if (Object.keys(zip.files).length !== entries.size) fail('the ZIP entry inventory is inconsistent.')
  return new Archive(zip, entries, hooks)
 }
 has(path: string) { return this.entries.has(path) }
 read(path: string): Promise<Uint8Array<ArrayBuffer>> {
  this.hooks.check()
  const cached = this.cache.get(path)
  if (cached) return cached
  const entry = this.entries.get(path), file = this.zip.file(path)
  if (!entry || !file) fail('a required package part is missing.')
  const work = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
   const stream = (file as StreamFile).internalStream('uint8array'), chunks: Uint8Array[] = []
   let length = 0, crc = 0xffffffff, finished = false
   const rejectOnce = (error: unknown) => {
    if (finished) return
    finished = true; stream.pause(); this.hooks.signal.removeEventListener('abort', abort); reject(error)
   }
   const abort = () => rejectOnce(this.hooks.signal.reason)
   this.hooks.signal.addEventListener('abort', abort, { once: true })
   stream.on('data', chunk => {
    if (finished) return
    try {
     this.hooks.check()
     length += chunk.length; this.expanded += chunk.length
     if (length > entry.size || length > ZIP_LIMITS.entry || this.expanded > ZIP_LIMITS.expanded) fail('actual ZIP expansion exceeds its declared size or extraction limits.')
     for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
     chunks.push(chunk)
    } catch (error) { rejectOnce(error) }
   }).on('error', () => rejectOnce(new Error('Office extraction: ZIP entry decompression failed.'))).on('end', () => {
    if (finished) return
    if (length !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) { rejectOnce(new Error('Office extraction: a ZIP entry failed its size or checksum check.')); return }
    finished = true; this.hooks.signal.removeEventListener('abort', abort)
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    resolve(bytes)
   })
   if (this.hooks.signal.aborted) abort()
   else stream.resume()
  })
  this.cache.set(path, work)
  return work
 }
}
