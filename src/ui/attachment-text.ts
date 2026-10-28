/// <reference types="vite/client" />
import type { Worker as OcrWorker } from 'tesseract.js'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url'
import ocrCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url'
import englishUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url'

const MAX_BYTES = 20 * 1024 * 1024, MAX_PIXELS = 16_000_000, MAX_TEXT = 100_000
export type Result = { text: string; notes: string[] }
export type Run = { signal: AbortSignal; progress: (message: string) => void; cleanup: (() => void)[] }

function check(run: Run) { run.signal.throwIfAborted() }
function disposeWith(run: Run, dispose: () => void) {
 if (run.signal.aborted) dispose()
 else run.cleanup.push(dispose)
}
export async function untilStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
 let stop: () => void = () => {}
 const stopped = new Promise<never>((_, reject) => {
  stop = () => reject(signal.reason)
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
 })
 try { return await Promise.race([work, stopped]) }
 finally { signal.removeEventListener('abort', stop) }
}
function boundedText(text: string) {
 if (text.length > MAX_TEXT) throw new Error('Extracted text exceeds 100,000 characters. No text was copied. Supply a reviewed transcription manually.')
 return text
}

async function original(href: string, run: Run) {
 const url = new URL(href, window.location.href)
 if (url.origin !== window.location.origin) throw new Error('Extraction requires an original file from this installation.')
 const response = await fetch(url, { signal: run.signal, credentials: 'same-origin', mode: 'same-origin', redirect: 'error' })
 if (!response.ok) throw new Error(`Original file could not be read (${response.status}).`)
 if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Original file exceeds the 20 MB browser extraction limit.')
 if (!response.body) throw new Error('This browser could not read the original file stream.')
 const reader = response.body.getReader(), parts: Uint8Array<ArrayBuffer>[] = []
 let length = 0
 try {
  while (true) {
   check(run)
   const chunk = await reader.read()
   if (chunk.done) break
   length += chunk.value.length
   if (length > MAX_BYTES) throw new Error('Original file exceeds the 20 MB browser extraction limit.')
   parts.push(chunk.value)
  }
 } finally { await reader.cancel(); reader.releaseLock() }
 return new Blob(parts, { type: response.headers.get('content-type')?.split(';')[0] ?? '' })
}

const ocrWorkers = new WeakMap<Run, Promise<OcrWorker>>()
function ocr(run: Run) {
 check(run)
 let pending = ocrWorkers.get(run)
 if (!pending) { pending = createOcr(run); ocrWorkers.set(run, pending) }
 return pending
}
async function createOcr(run: Run) {
 run.progress('Loading local English OCR…')
 const { createWorker } = await import('tesseract.js')
 check(run)
 // The pinned core embeds its WASM and needs no companion asset.
 // langPath appends /eng.traineddata.gz. A query preserves Vite's hashed asset path.
 // Resource configuration follows the pinned Tesseract worker implementation.
 const langPath = new URL(englishUrl, window.location.href).href + (englishUrl.includes('?') ? '&' : '?') + 'model='
 let released = false
 const pending = createWorker('eng', 1, {
  workerPath: ocrWorkerUrl, corePath: ocrCoreUrl, langPath, workerBlobURL: false, cacheMethod: 'none',
  logger: message => { if (!run.signal.aborted) run.progress(`English OCR: ${message.status} (${Math.round(message.progress * 100)}%)`) },
  // Errors are handled by the awaited operation, never thrown as unhandled events.
  errorHandler: () => {},
 })
 let worker: OcrWorker | undefined
 const release = () => { released = true; if (worker) void worker.terminate() }
 disposeWith(run, release)
 worker = await pending
 if (released || run.signal.aborted) { await worker.terminate(); check(run); throw new Error('OCR was stopped.') }
 return worker
}

async function pdfText(file: Blob, password: string, everyPage: boolean, run: Run): Promise<Result> {
 const pdfjs = await import('pdfjs-dist')
 check(run)
 pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
 const data = new Uint8Array(await file.arrayBuffer())
 check(run)
 const task = pdfjs.getDocument({ data, password: password || undefined, stopAtErrors: true, useWasm: false })
 disposeWith(run, () => { void task.destroy() })
 const pdf = await task.promise
 check(run)
 const parts: string[] = [], empty: number[] = []
 let worker: OcrWorker | undefined, ocrPages = 0
 for (let number = 1; number <= pdf.numPages; number++) {
  check(run)
  run.progress(`Reading PDF page ${number} of ${pdf.numPages}…`)
  const page = await pdf.getPage(number)
  try {
   const content = await page.getTextContent()
   let text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
   if (everyPage || !text) {
    worker ??= await ocr(run)
    check(run)
    run.progress(`Recognizing PDF page ${number} of ${pdf.numPages}…`)
    const viewport = page.getViewport({ scale: 2 })
    if (Math.ceil(viewport.width) * Math.ceil(viewport.height) > MAX_PIXELS) throw new Error(`PDF page ${number} exceeds the 16 megapixel rendering limit. No text was copied.`)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not create a PDF canvas.')
    try {
     const render = page.render({ canvas, canvasContext: context, viewport })
     const cancelRender = () => render.cancel()
     run.signal.addEventListener('abort', cancelRender, { once: true })
     try { await render.promise } finally { run.signal.removeEventListener('abort', cancelRender) }
     check(run)
     text = (await worker.recognize(canvas)).data.text.trim()
     ocrPages++
    } finally { canvas.width = 0; canvas.height = 0 }
   }
   if (text) parts.push(`Page ${number}\n${text}`)
   else empty.push(number)
   boundedText(parts.join('\n\n'))
  } finally { page.cleanup() }
 }
 return { text: parts.join('\n\n'), notes: [
  `Processed ${pdf.numPages} PDF pages; ${ocrPages} used English OCR. Reading order, tables, handwriting and symbols need review.`,
  ...(!everyPage ? ['Embedded text was used where present. Images on those pages were not read; choose OCR every page to read the rendered page instead.'] : []),
  ...(empty.length ? [`No text was recognized on pages ${empty.join(', ')}. Check these pages manually.`] : []),
 ] }
}

async function imageText(file: Blob, run: Run): Promise<Result> {
 if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
  const { rasterSize } = await import('./attachment-formats/raster')
  rasterSize(new Uint8Array(await file.arrayBuffer()), file.type)
  check(run)
 }
 const image = await createImageBitmap(file)
 try {
  if (image.width * image.height > MAX_PIXELS) throw new Error('This image exceeds the 16 megapixel OCR limit.')
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not create an image canvas.')
  try {
   context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0)
   const worker = await ocr(run)
   check(run)
   const result = await worker.recognize(canvas)
   return { text: boundedText(result.data.text.trim()), notes: ['English OCR is an unverified draft. Check words, handwriting, numbers, tables and reading order against the original.'] }
  } finally { canvas.width = 0; canvas.height = 0 }
 } finally { image.close() }
}

async function extract(file: Blob, name: string, password: string, everyPage: boolean, run: Run): Promise<Result> {
 const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
 if (new TextDecoder().decode(bytes).includes('%PDF-')) return pdfText(file, password, everyPage, run)
 if (/\.(docx|xlsx|pptx)$/i.test(name) || [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 ].includes(file.type)) {
  const { extractOffice } = await import('./attachment-office')
  check(run)
  return extractOffice(file, name, { signal: run.signal, check: () => check(run), progress: run.progress,
   recognizeImage: async image => (await imageText(image, run)).text, boundedText })
 }
 const openDocument = await import('./attachment-opendocument')
 if (openDocument.handlesOpenDocument(name, file.type)) return openDocument.extractOpenDocument(file, name, { signal: run.signal, check: () => check(run), progress: run.progress,
  recognizeImage: async image => (await imageText(image, run)).text, boundedText })
 const legacy = await import('./attachment-legacy')
 if (legacy.handlesLegacy(name, file.type)) return legacy.extractLegacy(file, name, { signal: run.signal, check: () => check(run), progress: run.progress,
  recognizeImage: async image => (await imageText(image, run)).text, boundedText })
 const other = await import('./attachment-formats')
 if (other.handlesOther(name, file.type)) return other.extractOther(file, name, { signal: run.signal, check: () => check(run), progress: run.progress,
  recognizeImage: async image => (await imageText(image, run)).text, boundedText })
 if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || /\.(png|jpe?g|webp)$/i.test(name)) return imageText(file, run)
 throw new Error('Browser extraction supports PDF, modern and legacy Office files, OpenDocument packages, TIFF, RTF, encoded text, HTML, SVG, PNG, JPEG and WebP. Supply other formats as reviewed text manually.')
}


export async function extractAttachmentText(href: string, name: string, password: string, everyPage: boolean, run: Run) {
 const file = await original(href, run); check(run)
 return extract(file, name, password, everyPage, run)
}

/** Read one exact plan page; proposals retain source coordinates and OCR confidence. */
export async function recognizeDrawing(href:string,pageNumber:number,run:Run){
 const file=await original(href,run),pdfjs=await import('pdfjs-dist')
 pdfjs.GlobalWorkerOptions.workerSrc=pdfWorkerUrl
 const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),stopAtErrors:true,useWasm:false})
 disposeWith(run,()=>{void task.destroy()})
 const pdf=await task.promise,page=await pdf.getPage(pageNumber),source=page.getViewport({scale:1})
 let scale=Math.min(2,Math.sqrt(MAX_PIXELS/(source.width*source.height))),viewport=page.getViewport({scale})
 // Fit architectural sheets before allocation, including integer canvas rounding.
 while(Math.ceil(viewport.width)*Math.ceil(viewport.height)>MAX_PIXELS){scale*=0.999;viewport=page.getViewport({scale})}
 const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height)
 try{
  const context=canvas.getContext('2d');if(!context)throw new Error('Drawing canvas unavailable.')
  const render=page.render({canvas,canvasContext:context,viewport}),cancel=()=>render.cancel()
  run.signal.addEventListener('abort',cancel,{once:true})
  try{await untilStopped(render.promise,run.signal)}finally{run.signal.removeEventListener('abort',cancel)}
  const worker=await ocr(run),result=await untilStopped(worker.recognize(canvas,{}, {blocks:true}),run.signal)
  check(run)
  const regions=(result.data.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.map(l=>({text:l.text.trim(),x:l.bbox.x0/scale,y:l.bbox.y0/scale,width:(l.bbox.x1-l.bbox.x0)/scale,height:(l.bbox.y1-l.bbox.y0)/scale,confidence:l.confidence})))).filter(r=>r.text&&r.width>0&&r.height>0)
  if(!regions.length)throw new Error('No text was recognized. This page needs manual review; no proposal was saved.')
  return {text:boundedText(result.data.text.trim()),regions}
 }finally{canvas.width=0;canvas.height=0;page.cleanup()}
}
