import type { OfficeHooks, OfficeResult } from '../attachment-office/types'
import { fail, MAX_INPUT } from './common'
import { bom, decodeText } from './encoding'
import { extractHtml } from './html'
import { extractRtf } from './rtf'
import { extractSvg } from './svg'
import { extractTiff } from './tiff'

const plain = /\.(txt|text|csv|tsv|md|log)$/i
export function handlesOther(name: string, type: string) {
 return /\.(tiff?|rtf|html?|xhtml|svg)$/i.test(name) || plain.test(name) || /^(image\/(tiff|svg\+xml)|application\/(rtf|xhtml\+xml)|text\/(rtf|plain|html|csv|tab-separated-values|markdown))(;|$)/i.test(type)
}

export async function extractOther(file: Blob, name: string, hooks: OfficeHooks): Promise<OfficeResult> {
 try {
  hooks.check()
  if (file.size > MAX_INPUT) fail('the original exceeds the 20 MiB extraction limit.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  hooks.check()
  const type = file.type.split(';')[0].toLowerCase()
  if (/\.tiff?$/i.test(name) || type === 'image/tiff') return await extractTiff(bytes, hooks)
  if (/\.rtf$/i.test(name) || ['text/rtf','application/rtf'].includes(type)) return await extractRtf(bytes, hooks)
  if (/\.svg$/i.test(name) || type === 'image/svg+xml') return await extractSvg(bytes, hooks)
  if (/\.(html?|xhtml)$/i.test(name) || ['text/html','application/xhtml+xml'].includes(type)) return await extractHtml(bytes, hooks)
  if (plain.test(name) || ['text/plain','text/csv','text/tab-separated-values','text/markdown'].includes(type)) {
   const declared = /charset\s*=\s*['"]?([\w-]+)/i.exec(file.type)?.[1] ?? 'utf-8', result = decodeText(bytes, declared)
   const text = hooks.boundedText(result.text)
   if (text.includes('\0')) fail('plain text contains binary nulls or lacks a supported encoding declaration.')
   return { text, notes: [`Plain text was decoded as ${bom(bytes) ?? result.encoding}. Its content was not interpreted as markup or executed.`] }
  }
  return fail('this format has no supported local extractor.')
 } catch (error) {
  hooks.check()
  if (error instanceof Error && /^(File extraction: |Extracted text)/.test(error.message)) throw error
  return fail('the file could not be decoded or recognized. Nothing was copied. Inspect the original and supply reviewed text manually.')
 }
}
