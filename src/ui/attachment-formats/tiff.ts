import type { OfficeHooks } from '../attachment-office/types'
import { Draft, fail } from './common'

type Reply = { kind: 'ready'; pages: number; notes: string[] } | { kind: 'page'; blob: Blob } | { kind: 'error'; message: string }

export async function extractTiff(bytes: Uint8Array<ArrayBuffer>, hooks: OfficeHooks) {
 hooks.check()
 const draft = new Draft(hooks), worker = new Worker(new URL('./tiff-worker.ts', import.meta.url), { type: 'module' })
 const request = (message: unknown, transfer: Transferable[] = []) => new Promise<Reply>((resolve, reject) => {
  const cleanup = () => { worker.removeEventListener('message', receive); worker.removeEventListener('error', failed); hooks.signal.removeEventListener('abort', aborted) }
  const aborted = () => { cleanup(); reject(hooks.signal.reason) }
  const failed = () => { cleanup(); reject(new Error('File extraction: the local TIFF decoder worker failed.')) }
  const receive = (event: MessageEvent<Reply>) => {
   cleanup()
   if (event.data.kind === 'error') reject(new Error(event.data.message))
   else resolve(event.data)
  }
  worker.addEventListener('message', receive); worker.addEventListener('error', failed); hooks.signal.addEventListener('abort', aborted, { once: true })
  if (hooks.signal.aborted) aborted()
  else worker.postMessage(message, transfer)
 })
 const stop = () => worker.terminate()
 hooks.signal.addEventListener('abort', stop, { once: true })
 try {
  const ready = await request({ kind: 'open', buffer: bytes.buffer }, [bytes.buffer])
  if (ready.kind !== 'ready') fail('the TIFF decoder returned an unexpected page inventory.')
  for (const note of ready.notes) draft.notes.add(note)
  for (let index = 0; index < ready.pages; index++) {
   hooks.check(); hooks.progress(`Decoding TIFF page ${index + 1} of ${ready.pages}…`)
   const page = await request({ kind: 'page', index })
   if (page.kind !== 'page') fail('the TIFF decoder returned an unexpected page response.')
   hooks.check(); hooks.progress(`Recognizing TIFF page ${index + 1} of ${ready.pages}…`)
   const text = await hooks.recognizeImage(page.blob)
   hooks.check()
   if (text.trim()) draft.add(`TIFF page ${index + 1}`, text)
   else draft.notes.add(`No text was recognized on TIFF page ${index + 1}. Check it manually.`)
  }
  draft.notes.add(`Read ${ready.pages} main TIFF pages with local OCR. Orientation was applied. OCR words, tables, handwriting, symbols and reading order require review.`)
  draft.notes.add('TIFF limits: 200 pages, 16 megapixels per page, 64 megapixels total, 1,024 tags per page and 20,000 tags total. Tiled, JPEG-compressed, planar, raw camera, signed and floating-point TIFF images are unsupported.')
  return draft.result()
 } finally { hooks.signal.removeEventListener('abort', stop); worker.terminate() }
}
