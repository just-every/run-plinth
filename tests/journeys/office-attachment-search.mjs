import { chartDocument, chartTerms } from '../fixtures/chart-document.mjs'
import { wordDocument, wordTerms } from '../fixtures/office-documents.mjs'
import { searchDocument } from '../fixtures/search-document.mjs'
import assert from 'node:assert/strict'
import { spreadsheetDocument, sheetTerms, threadedRecords, orphanTerms } from '../fixtures/spreadsheet-document.mjs'
import { png } from '../fixtures/unextractable-documents.mjs'
import { presentationDocument, slideTerms } from '../fixtures/presentation-document.mjs'
import { reviewExtractedAttachments } from './review-extracted-attachment.mjs'

export function inspectThreadedDraft(generated) {
 for (const record of threadedRecords) {
  const section = generated.split('\n\n').find(section => section.startsWith(`Sheet ${record.sheet} cell ${record.cell} threaded comment ${record.id}\n`))
  assert.ok(section, `Exact sheet, cell and identity for ${record.text}`)
  const root = record.parent || record.id
  assert.ok(section.includes(`Thread ${root}; parent ${record.parent || 'none (root)'}`))
  assert.ok(section.includes(`stored author ${record.author} (person ${record.person}); stored date ${record.date}\n${record.text}`))
 }
 assert.ok(generated.includes('Sheet Cabinet clearances comment A1 by Synthetic Plinth\nsynthetic-plinth-comment-9303'), 'Classic comments stay distinct')
 assert.ok(generated.includes('Sheet Cabinet clearances comment C1 by tc=Synthetic Plinth note\nsynthetic-plinth-classic-author-9318'), 'A classic stored author name is not mistaken for a thread identifier')
 assert.ok(generated.includes(`classic fallback for thread ${threadedRecords[0].id} (stored mirrored text) B1`), 'Classic mirrored fallback is retained and labeled')
}

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
  { name: 'stored-site-cells.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: await spreadsheetDocument(await image('FRAMING CLEARANCE 48 INCHES')), terms: sheetTerms, absent: orphanTerms, state: 'unsupported', inspect: inspectThreadedDraft },
  { name: 'stored-site-slides.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: await presentationDocument(await image('VENTILATION CLEARANCE 48 INCHES')), terms: slideTerms, state: 'unsupported' },
  { name: 'stored-site-chart.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: await chartDocument(), terms: chartTerms, state: 'unsupported' },
  { name: 'extended-source.pdf', mime: 'application/pdf', bytes: searchDocument(Array.from({ length: 201 }, (_, page) => `synthetic-plinth-extended-page-${String(page + 1).padStart(3, '0')}-9209`)), terms: ['synthetic-plinth-extended-page-001-9209', 'synthetic-plinth-extended-page-101-9209', 'synthetic-plinth-extended-page-201-9209'], required: Array.from({ length: 201 }, (_, page) => `synthetic-plinth-extended-page-${String(page + 1).padStart(3, '0')}-9209`), state: 'limited' },
 ]
 await reviewExtractedAttachments({base,page,owner,client,job,capture,variants,capturePrefix:'attachment-office'})
 const diagnoses = [
  ['missing-author', /missing stored author/], ['missing-parent', /missing parent/], ['duplicate-id', /identifiers are duplicated/], ['duplicate-person', /person identifiers are duplicated/],
  ['cross-sheet', /crosses sheet boundaries/], ['cross-cell', /different cell/], ['cycle', /form a cycle/], ['missing-date', /stored date is missing or invalid/], ['bad-cell', /cell reference is missing or invalid/],
  ['past-last-column', /cell reference is missing or invalid/], ['past-last-row', /cell reference is missing or invalid/], ['duplicate-root', /multiple threaded comment roots/],
  ['sheet-relationship', /document relationship is missing or unsupported/], ['sheet-namespace', /document relationship is missing or unsupported/], ['reused-part', /referenced by multiple sheets/], ['duplicate-relationship', /duplicate threaded comment relationships/],
  ['sheet-inventory-namespace', /one supported current sheet inventory/], ['nested-sheet-entry', /sheet inventory structure or namespace is unsupported/],
  ['namespace', /namespace or structure is unsupported/], ['child-namespace', /child namespace is unsupported/], ['person-namespace', /inventory namespace or structure is unsupported/], ['relationship-namespace', /relationship namespace is unsupported/],
  ['missing-inventory', /one internal person inventory/], ['external-comments', /require internal relationships/], ['external-people', /require internal relationships/],
  ['comment-limit', /10,000-comment processing limit/], ['person-limit', /2,000-person processing limit/], ['reply-limit', /64-level reply processing limit/],
 ]
 const invalid = []
 for (const [damage, denial] of diagnoses) invalid.push({name:`stored-thread-${damage}.xlsx`,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:await spreadsheetDocument(png,damage),terms:[`synthetic-plinth-denied-${damage}`],denial,diagnostic:true})
 await reviewExtractedAttachments({base,page,owner,client,job,capture,variants:invalid,capturePrefix:'attachment-thread-diagnostic'})
}
