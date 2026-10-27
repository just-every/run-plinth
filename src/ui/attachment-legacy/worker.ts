/// <reference types="vite/client" />
import init, { WasmDocument } from 'office-oxide-wasm/web'
import wasmUrl from '../../../node_modules/office-oxide-wasm/web/office_oxide_bg.wasm?url'
import { additionalText } from './ir'
import { preflight } from './preflight'
import { extractWordStories } from './word-stories'
import { limitedMemory } from './wasm-memory'
import { bounded, fail, LegacyError, LIMITS, type Reply, type Request } from './types'
const scope = self as unknown as { location: Location; postMessage(value: Reply): void; onmessage: ((event: MessageEvent<Request>) => void) | null }
let started = false
scope.onmessage = async event => {
 if (started) return
 started = true
 let document: WasmDocument | undefined
 try {
  const { bytes, format } = event.data
  if (!(bytes instanceof ArrayBuffer) || !['doc', 'xls', 'ppt'].includes(format) || bytes.byteLength > 20 * 1024 * 1024) fail('the original or format exceeds the reader boundary.')
  const source = new Uint8Array(bytes), notes = preflight(source, format)
  const stories = format === 'doc' ? extractWordStories(source) : {text:'',notes:[]}
  scope.postMessage({ progress: 'Loading the bundled legacy Office reader…' })
  const url = new URL(wasmUrl, scope.location.href)
  if (url.origin !== scope.location.origin) fail('the reader asset must come from this installation.')
  const response = await fetch(url, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error' })
  if (!response.ok || Number(response.headers.get('content-length')) > 8 * 1024 * 1024) fail('the bundled reader could not be loaded within its asset limit.')
  const wasm = new Uint8Array(await response.arrayBuffer())
  if (wasm.length > 8 * 1024 * 1024) fail('the bundled reader exceeds its asset limit.')
  await init({ module_or_path: await WebAssembly.compile(limitedMemory(wasm)) })
  scope.postMessage({ progress: 'Reading stored legacy Office text…' })
  document = new WasmDocument(source, format)
  const plain = bounded(document.plainText()), extra = additionalText(document.toIr(), plain)
  const text = bounded([plain.trim(), extra.text, stories.text].filter(Boolean).join('\n\n'))
  if (!text.trim()) fail('no supported stored text was recovered. The original may contain unreadable text, images or unsupported parts; this does not mean it is empty.')
  scope.postMessage({ result: { text, notes: [...notes, ...extra.notes, ...stories.notes, LIMITS] } })
 } catch (error) {
  // Third-party exceptions may include document content. Never return them.
  scope.postMessage({ error: error instanceof LegacyError ? error.message : 'Legacy extraction: this original could not be decoded within the reader limits. Nothing was copied.' })
 } finally { document?.free() }
}
