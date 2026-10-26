import 'pdfjs-dist/build/pdf.worker.mjs'
import { getDocument } from 'pdfjs-dist'

export interface FileText {
 text: string
 status: 'complete' | 'no_text' | 'unsupported' | 'failed' | 'limited'
 detail?: string
}

// Original custody already limits files to 2 MiB. Extraction additionally stops
// at 200 pages, 1,000,000 UTF-16 characters or 15 seconds. Limited text is a
// searchable prefix, never a claim that the entire original was examined.
const MAX_BYTES = 2 * 1024 * 1024
const MAX_PAGES = 200
const MAX_TEXT = 1_000_000
const MAX_MS = 15_000
const textual = new Set([
 'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values',
 'text/xml', 'application/xml', 'application/json', 'application/ld+json',
])

// No remote font, CMap or WASM resource is permitted, even if a later PDF.js
// default changes. This is the library's resource-provider interface, not a
// substitute parser or a DOM implementation.
class EmbeddedResourcesOnly {
 async fetch(): Promise<never> { throw new Error('External PDF resources are disabled') }
}

function pdfRuntimeSupported() {
 const hasMethod = (value: object, name: string) => typeof Reflect.get(value, name) === 'function'
 // These are required by the installed standard PDF.js build. Do not modify
 // shared runtime prototypes to emulate a newer engine.
 return hasMethod(Map.prototype, 'getOrInsertComputed') && hasMethod(Promise, 'try') &&
  hasMethod(Math, 'sumPrecise') && hasMethod(Uint8Array.prototype, 'toHex')
}

/** Extract original embedded text; image-only files require a separate OCR workflow. */
export async function extractFileText(bytes: Uint8Array, mime: string): Promise<FileText> {
 if (bytes.byteLength > MAX_BYTES) return { text: '', status: 'limited', detail: 'File exceeds the 2 MiB extraction limit' }
 const parts = mime.toLowerCase().split(';').map(part => part.trim())
 const type = parts[0]!
 if (textual.has(type)) {
  const charset = parts.slice(1).find(part => part.startsWith('charset='))?.slice(8).replace(/^"|"$/g, '')
  if (charset && charset !== 'utf-8' && charset !== 'utf8' && charset !== 'us-ascii') return { text: '', status: 'unsupported', detail: 'Only UTF-8 text is supported' }
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { return { text: '', status: 'failed', detail: 'File is not valid UTF-8 text' } }
  if (text.length > MAX_TEXT) return { text: text.slice(0, MAX_TEXT), status: 'limited', detail: 'Text exceeds the 1,000,000 character extraction limit' }
  return { text, status: text.trim() ? 'complete' : 'no_text' }
 }
 if (type !== 'application/pdf') return { text: '', status: 'unsupported', detail: 'No embedded-text extractor for this media type' }
 if (!pdfRuntimeSupported()) return { text: '', status: 'failed', detail: 'PDF extraction requires newer native JavaScript collection and numeric APIs' }

 // The imported PDF.js worker module provides its own in-process transport.
 // Passing original bytes by copy prevents transfer from changing custody.
 let task: ReturnType<typeof getDocument>
 try { task = getDocument({
  data: bytes.slice(),
  BinaryDataFactory: EmbeddedResourcesOnly,
  useWorkerFetch: false,
  useWasm: false,
  useSystemFonts: false,
  disableFontFace: true,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  enableXfa: false,
  stopAtErrors: true,
  disableAutoFetch: true,
  disableRange: true,
  disableStream: true,
  verbosity: 0,
 }) } catch { return { text: '', status: 'failed', detail: 'PDF embedded-text parser could not be initialized' } }
 let destruction: Promise<void> | undefined
 const destroy = () => destruction ??= task.destroy()
 let timedOut = false
 const timer = setTimeout(() => { timedOut = true; void destroy().catch(() => {}) }, MAX_MS)
 const chunks: string[] = []
 let length = 0
 let result: FileText
 try {
  const pdf = await task.promise
  let limited = false
  for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
   if (timedOut) break
   const page = await pdf.getPage(n)
   const reader = page.streamTextContent({ disableNormalization: true }).getReader()
   try {
    while (!limited && !timedOut) {
     const chunk = await reader.read()
     if (chunk.done) break
     for (const item of chunk.value.items) {
      if (!('str' in item)) continue
      const value = item.str + (item.hasEOL ? '\n' : ' ')
      const available = MAX_TEXT - length
      if (value.length > available) { chunks.push(value.slice(0, available)); length = MAX_TEXT; limited = true; break }
      chunks.push(value); length += value.length
     }
    }
   } finally {
    await reader.cancel()
    reader.releaseLock()
    page.cleanup()
   }
   if (limited) break
   if (n < pdf.numPages) {
    if (length === MAX_TEXT) { limited = true; break }
    chunks.push('\n'); length++
   }
  }
  const text = chunks.join('')
  result = timedOut ? { text, status: 'limited', detail: 'PDF extraction reached its 15 second time limit' }
   : limited ? { text, status: 'limited', detail: 'PDF text exceeds the 1,000,000 character extraction limit' }
   : pdf.numPages > MAX_PAGES ? { text, status: 'limited', detail: 'PDF exceeds the 200 page extraction limit' }
   : { text, status: text.trim() ? 'complete' : 'no_text' }
 } catch {
  // Parser errors may include document data. Return only fixed, content-free detail.
  result = timedOut ? { text: chunks.join(''), status: 'limited', detail: 'PDF extraction reached its 15 second time limit' }
   : { text: '', status: 'failed', detail: 'PDF embedded text could not be extracted' }
 } finally {
  clearTimeout(timer)
  try { await destroy() }
  catch { result = { text: '', status: 'failed', detail: 'PDF extraction resources could not be released' } }
 }
 return result
}
