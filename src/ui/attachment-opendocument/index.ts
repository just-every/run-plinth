import type { OfficeHooks, OfficeResult } from '../attachment-office/types'
import { Archive } from '../attachment-office/archive'
import { Draft, elements, fail, is, OpenDocumentError } from './common'
import { MIMES, OpenPackage } from './package'
import { Reader } from './reader'
export function handlesOpenDocument(name: string, type: string): boolean {
 return /\.(odt|ods|odp)$/i.test(name) || Object.values(MIMES).some(mime => mime === type.toLowerCase().split(';')[0]!.trim())
}
export async function extractOpenDocument(file: Blob, name: string, hooks: OfficeHooks): Promise<OfficeResult> {
 try {
  hooks.check()
  if (!handlesOpenDocument(name, file.type)) fail('choose an ODT, ODS or ODP package.')
  const draft = new Draft(hooks)
  hooks.progress('Opening the local OpenDocument package…')
  const archive = await Archive.open(file, hooks), office = new OpenPackage(archive, draft), { kind, content } = await office.open()
  const bodies = elements(content, 'office', 'body')
  if (bodies.length !== 1) fail('the document must contain one body.')
  const main = [...bodies[0].children].filter(element => is(element, 'office', kind))
  if (main.length !== 1) fail('the body does not match the package MIME declaration.')
  const reader = new Reader(office)
  hooks.progress(`Reading stored OpenDocument ${kind} content…`)
  await reader.backgrounds(content, 'Stored content background or fill')
  await reader.walk(main[0], kind === 'text' ? 'Document body' : kind === 'spreadsheet' ? 'Workbook' : 'Presentation')
  await reader.styles()
  draft.notes.add('OpenDocument extraction reads stored text, formulas, cached values, notes, comments and supported embedded raster pictures. English OCR is an unverified draft; fields, chart objects, vector artwork, reading order, numbering and visual layout require review.')
  draft.notes.add('Limits: 20 MiB original, 2,000 ZIP entries, 64 MiB ZIP expansion, 16 MiB per entry, 8 MiB per XML part, 100,000 XML elements per part, depth 256, 40 raster pictures at 8 MiB each and 20 MiB total, 16 megapixels per raster, 100,000 output characters and five minutes under the parent abort signal.')
  draft.check()
  return draft.result()
 } catch (error) {
  hooks.check()
  if (error instanceof OpenDocumentError) throw error
  if (error instanceof Error && /^(Office extraction: |File extraction: )/.test(error.message)) return fail(error.message.replace(/^(Office extraction: |File extraction: )/, ''))
  if (error instanceof Error && error.message.startsWith('Extracted text')) return fail('extracted text exceeds its limit. Nothing was copied.')
  return fail('a package part could not be decoded or recognized. Nothing was copied. Inspect the original before supplying reviewed text.')
 }
}
