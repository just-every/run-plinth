import type { OfficeHooks, OfficeResult } from '../attachment-office/types'
import { fail, type LegacyFormat, type Reply, type Request } from './types'
const media: Record<string, LegacyFormat> = { 'application/msword': 'doc', 'application/vnd.ms-excel': 'xls', 'application/vnd.ms-powerpoint': 'ppt' }
function format(name: string, type: string): LegacyFormat | undefined {
 const extension = /\.(doc|xls|ppt)$/i.exec(name)?.[1]?.toLowerCase() as LegacyFormat | undefined
 return extension ?? media[type.toLowerCase().split(';')[0]!.trim()]
}
export function handlesLegacy(name: string, type: string): boolean { return !!format(name, type) }
export async function extractLegacy(file: Blob, name: string, hooks: OfficeHooks): Promise<OfficeResult> {
 hooks.check()
 const kind = format(name, file.type)
 if (!kind) fail('choose a binary Word document, Excel workbook or PowerPoint presentation.')
 if (!file.size || file.size > 20 * 1024 * 1024) fail('the original must contain between one byte and 20 MiB.')
 hooks.progress('Opening local legacy Office reader…')
 const bytes = await file.arrayBuffer()
 hooks.check()
 return new Promise<OfficeResult>((resolve, reject) => {
  let worker: Worker
  try { worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'plinth-legacy-extraction' }) }
  catch { reject(new Error('Legacy extraction: this browser could not start the local reader.')); return }
  let finished = false
  const end = (error?: Error, result?: OfficeResult) => {
   if (finished) return
   finished = true; clearTimeout(timer); hooks.signal.removeEventListener('abort', abort); worker.terminate()
   if (error) reject(error); else resolve(result!)
  }
  const abort = () => end(new Error('Legacy extraction: stopped before a result was copied.'))
  const timer = setTimeout(() => end(new Error('Legacy extraction: the five minute reading limit was reached. Nothing was copied.')), 300_000)
  worker.onmessage = (event: MessageEvent<Reply>) => {
   try {
    hooks.check()
    const reply = event.data
    if ('progress' in reply) hooks.progress(reply.progress)
    else if ('error' in reply) end(new Error(reply.error.startsWith('Legacy extraction: ') ? reply.error : 'Legacy extraction: the local reader failed. Nothing was copied.'))
    else if ('result' in reply && typeof reply.result.text === 'string' && Array.isArray(reply.result.notes)) end(undefined, { text: hooks.boundedText(reply.result.text), notes: reply.result.notes })
    else end(new Error('Legacy extraction: the local reader returned an invalid result.'))
   } catch (error) { end(error instanceof Error ? error : new Error('Legacy extraction: the result could not be copied.')) }
  }
  worker.onerror = event => { event.preventDefault(); end(new Error('Legacy extraction: the local reader could not decode this original within its resource limits. Nothing was copied.')) }
  worker.onmessageerror = () => end(new Error('Legacy extraction: the local reader could not deliver its result.'))
  hooks.signal.addEventListener('abort', abort, { once: true })
  if (hooks.signal.aborted) { abort(); return }
  try { worker.postMessage({ bytes, format: kind } satisfies Request, [bytes]) }
  catch { end(new Error('Legacy extraction: the original could not be passed to the local reader.')) }
 })
}
