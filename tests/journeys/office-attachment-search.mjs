import { chartDocument, chartTerms } from '../fixtures/chart-document.mjs'
import { wordDocument, wordTerms } from '../fixtures/office-documents.mjs'
import { searchDocument } from '../fixtures/search-document.mjs'
import { spreadsheetDocument, sheetTerms } from '../fixtures/spreadsheet-document.mjs'
import { presentationDocument, slideTerms } from '../fixtures/presentation-document.mjs'
import { reviewExtractedAttachments } from './review-extracted-attachment.mjs'

/** Read actual Office stories, pixels and a PDF beyond the server extraction window before review. */
export async function officeAttachmentSearch({ base, page, owner, client, job, capture }) {
 const image = async text => Buffer.from(await page.evaluate(value => {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 180
  const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 1200, 180)
  context.fillStyle = 'black'; context.font = '48px sans-serif'; context.fillText(value, 30, 100)
  return canvas.toDataURL('image/png').split(',')[1]
 }, text), 'base64')
 const variants = [
  { name: 'complete-site-stories.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: await wordDocument(await image('WIRING CLEARANCE 48 INCHES')), terms: [...wordTerms, 'WIRING'], state: 'unsupported' },
  { name: 'stored-site-cells.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: await spreadsheetDocument(await image('FRAMING CLEARANCE 48 INCHES')), terms: sheetTerms, state: 'unsupported' },
  { name: 'stored-site-slides.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: await presentationDocument(await image('VENTILATION CLEARANCE 48 INCHES')), terms: slideTerms, state: 'unsupported' },
  { name: 'stored-site-chart.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: await chartDocument(), terms: chartTerms, state: 'unsupported' },
  { name: 'extended-source.pdf', mime: 'application/pdf', bytes: searchDocument(Array.from({ length: 201 }, (_, page) => `synthetic-plinth-extended-page-${String(page + 1).padStart(3, '0')}-9209`)), terms: ['synthetic-plinth-extended-page-001-9209', 'synthetic-plinth-extended-page-101-9209', 'synthetic-plinth-extended-page-201-9209'], required: Array.from({ length: 201 }, (_, page) => `synthetic-plinth-extended-page-${String(page + 1).padStart(3, '0')}-9209`), state: 'limited' },
 ]
 await reviewExtractedAttachments({base,page,owner,client,job,capture,variants,capturePrefix:'attachment-office'})
}
