import { Archive } from './archive'
import { OfficePackage } from './package'
import { extractPresentation } from './presentation'
import { extractSpreadsheet } from './spreadsheet'
import { Draft, fail, type OfficeHooks, type OfficeResult } from './types'
import { extractWord } from './word'
import { inSpace } from './xml'

export type { OfficeHooks, OfficeResult } from './types'

export async function extractOffice(file: Blob, name: string, hooks: OfficeHooks): Promise<OfficeResult> {
 try {
  hooks.check(); hooks.progress('Opening local Office package…')
  if (!/\.(docx|xlsx|pptx)$/i.test(name) && !/application\/vnd\.openxmlformats-officedocument\./i.test(file.type)) fail('only modern DOCX, XLSX and PPTX packages are supported.')
  const draft = new Draft(hooks), office = new OfficePackage(await Archive.open(file, hooks), draft)
  const main = await office.main(), document = await office.xml(main), root = document.documentElement
  office.audit()
  if (root.localName === 'document' && inSpace(root, 'word')) await extractWord(office, main)
  else if (root.localName === 'workbook' && inSpace(root, 'sheet')) await extractSpreadsheet(office, main)
  else if (root.localName === 'presentation' && inSpace(root, 'slide')) await extractPresentation(office, main)
  else fail('the main document is not a supported Word document, workbook or presentation.')
  hooks.check()
  draft.notes.add('Office extraction reads stored text and supported embedded raster pictures without executing active content or following external links. OCR, reading order, stored alternatives and omitted objects require review against the original.')
  draft.notes.add('Office limits: 20 MiB original, 64 MiB expanded contents and 40 unique raster pictures. The displayed text, image and time limits also apply. Very complex packages or unsupported parts may be refused.')
  return draft.result()
 } catch (error) {
  hooks.check()
  if (error instanceof Error && error.message.startsWith('Office extraction: ')) throw error
  if (error instanceof Error && error.message.startsWith('Extracted text')) throw error
  return fail('a package part could not be decoded or recognized. Nothing was copied. Inspect the original and supply reviewed text manually.')
 }
}
