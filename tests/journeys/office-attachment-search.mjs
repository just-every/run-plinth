import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { wordDocument, wordTerms } from '../fixtures/office-documents.mjs'
import { searchDocument } from '../fixtures/search-document.mjs'
import { spreadsheetDocument, sheetTerms } from '../fixtures/spreadsheet-document.mjs'
import { presentationDocument, slideTerms } from '../fixtures/presentation-document.mjs'
import { originalEmail } from './meeting-mail.mjs'

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
  { name: 'extended-source.pdf', mime: 'application/pdf', bytes: searchDocument([...Array.from({ length: 200 }, () => 'Reviewed construction source'), 'synthetic-plinth-extended-9209']), terms: ['synthetic-plinth-extended-9209'], state: 'limited' },
 ]
 for (const [index, variant] of variants.entries()) {
  const raw = originalEmail({ from: 'synthetic-plinth-530@example.com', to: 'builder@example.com', subject: `Private extended original ${index}`, text: 'Original construction document for review.', file: variant })
  const captured = await owner.request.post(base + `/api/plinth/jobs/${job.id}/correspondence`, { headers: { origin: base }, data: { kind: 'capture', confirm: true, original_base64: raw.toString('base64') } })
  assert.equal(captured.status(), 201)
  await page.goto(base + `/app?job=${job.id}&tab=Decision%20search`)
  const search = async value => { await page.getByLabel('Search text', { exact: true }).fill(value); await page.getByRole('button', { name: 'Search decisions', exact: true }).click() }
  await search(variant.terms.at(-1)); await expect(page.getByText('0 matching records', { exact: true })).toBeVisible()
  await search(variant.name); await expect(page.getByText('1 matching records', { exact: true })).toBeVisible()
  await expect(page.getByText(new RegExp(`File text: ${variant.state}`))).toBeVisible()
  await page.getByText('Index metadata', { exact: true }).click(); await page.getByText('Supplied attachment text', { exact: true }).click(); await page.getByText('Extract text in this browser', { exact: true }).click()
  await page.getByRole('button', { name: 'Extract draft text', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'Unverified extracted draft', exact: true })
  await expect(draft).toBeVisible({ timeout: 180000 }); const generated = await draft.inputValue()
  for (const term of variant.terms) assert.ok(generated.includes(term), `The original ${term} was extracted before any human edit`)
  await capture(page, `attachment-office-extracted-${index}`)
  await page.getByRole('button', { name: 'Use text in editor', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Human-supplied transcription', exact: true })).toHaveValue(generated)
  await page.getByRole('button', { name: 'Review complete supplied text', exact: true }).click()
  const review = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Review complete supplied text', exact: true }) })
  await expect(review.locator('pre')).toHaveText(generated); await review.getByRole('checkbox').check()
  await review.getByRole('button', { name: 'Confirm and save supplied text', exact: true }).click(); await expect(review).toHaveCount(0)
  await search(variant.terms.at(-1)); await expect(page.getByText('1 matching records', { exact: true })).toBeVisible()
  await expect(page.getByText(/Human-supplied transcription · Revision 1/)).toBeVisible(); await capture(page, `attachment-office-search-${index}`)
  let source
  for (const term of variant.terms) {
   const result = await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/decision-search?` + new URLSearchParams({ q: term }))).json()
   assert.equal(result.count, 1); source ??= result.results[0].source; assert.equal(result.results[0].source, source)
   assert.equal(result.results[0].extraction.status, variant.state)
   assert.deepEqual(Buffer.from(await (await owner.request.get(base + result.results[0].files[0].href)).body()), variant.bytes)
  }
  const history = await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/decision-search/transcriptions?` + new URLSearchParams({ source }))).json()
  assert.equal(history.revisions[0].text, generated, 'Actual extracted output, without replacement fixture text, is retained exactly')
  assert.equal((await client.request.get(base + `/api/plinth/jobs/${job.id}/decision-search?` + new URLSearchParams({ q: variant.terms.at(-1) })).then(response => response.json())).count, 0)
  assert.equal((await client.request.get(base + `/api/plinth/jobs/${job.id}/decision-search/transcriptions?` + new URLSearchParams({ source }))).status(), 404)
 }
}
