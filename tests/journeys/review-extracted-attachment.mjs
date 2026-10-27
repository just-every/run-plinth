import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { originalEmail } from './meeting-mail.mjs'

/** Save actual local extraction output and prove current source grants still govern search and originals. */
export async function reviewExtractedAttachments({ base, page, owner, client, job, capture, variants, capturePrefix }) {
 for (const [index, variant] of variants.entries()) {
  const raw = originalEmail({ from: 'synthetic-plinth-530@example.com', to: 'builder@example.com', subject: `Private ${capturePrefix} original ${index}`, text: 'Original construction document for review.', file: variant })
  const captured = await owner.request.post(base + `/api/plinth/jobs/${job.id}/correspondence`, { headers: { origin: base }, data: { kind: 'capture', confirm: true, original_base64: raw.toString('base64') } })
  assert.equal(captured.status(), 201)
  await page.goto(base + `/app?job=${job.id}&tab=Decision%20search`)
  const search = async value => { await page.getByLabel('Search text', { exact: true }).fill(value); await page.getByRole('button', { name: 'Search decisions', exact: true }).click() }
  await search(variant.terms.at(-1)); await expect(page.getByText('0 matching records', { exact: true })).toBeVisible()
  await search(variant.name); await expect(page.getByText('1 matching records', { exact: true })).toBeVisible()
  if (variant.state) await expect(page.getByText(new RegExp(`File text: ${variant.state}`))).toBeVisible()
  await page.getByText('Index metadata', { exact: true }).click(); await page.getByText('Supplied attachment text', { exact: true }).click(); await page.getByText('Extract text in this browser', { exact: true }).click()
  await page.getByRole('button', { name: 'Extract draft text', exact: true }).click()
  if (variant.denial) {
   await expect(page.getByRole('alert').filter({hasText:variant.denial})).toBeVisible()
   await expect(page.getByRole('textbox',{name:'Human-supplied transcription',exact:true})).toHaveValue('')
   await expect(page.getByRole('textbox',{name:'Unverified extracted draft',exact:true})).toHaveCount(0)
   await capture(page, `${capturePrefix}-refused-${index}`)
   const lookup = await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/decision-search?` + new URLSearchParams({q:variant.name}))).json()
   assert.equal(lookup.count,1)
   assert.deepEqual(Buffer.from(await (await owner.request.get(base + lookup.results[0].files[0].href)).body()),variant.bytes)
   const revisions = await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/decision-search/transcriptions?` + new URLSearchParams({source:lookup.results[0].source}))).json()
   assert.deepEqual(revisions.revisions,[])
   continue
  }
  const draft = page.getByRole('textbox', { name: 'Unverified extracted draft', exact: true })
  await expect(draft).toBeVisible({ timeout: 180000 }); const generated = await draft.inputValue()
  for (const term of [...variant.terms, ...(variant.required ?? [])]) assert.ok(generated.includes(term), `The original ${term} was extracted before any human edit`)
  if (variant.absent) for (const term of variant.absent) assert.ok(!generated.includes(term), `Inactive content ${term} is excluded`)
  await capture(page, `${capturePrefix}-extracted-${index}`)
  await page.getByRole('button', { name: 'Use text in editor', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Human-supplied transcription', exact: true })).toHaveValue(generated)
  await page.getByRole('button', { name: 'Review complete supplied text', exact: true }).click()
  const review = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Review complete supplied text', exact: true }) })
  await expect(review.locator('pre')).toHaveText(generated); await review.getByRole('checkbox').check()
  await review.getByRole('button', { name: 'Confirm and save supplied text', exact: true }).click(); await expect(review).toHaveCount(0)
  await search(variant.terms.at(-1)); await expect(page.getByText('1 matching records', { exact: true })).toBeVisible()
  await expect(page.getByText(/Human-supplied transcription · Revision 1/)).toBeVisible(); await capture(page, `${capturePrefix}-search-${index}`)
  let source
  for (const term of variant.terms) {
   const result = await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/decision-search?` + new URLSearchParams({ q: term }))).json()
   assert.equal(result.count, 1); source ??= result.results[0].source; assert.equal(result.results[0].source, source)
   if (variant.state) assert.equal(result.results[0].extraction.status, variant.state)
   assert.deepEqual(Buffer.from(await (await owner.request.get(base + result.results[0].files[0].href)).body()), variant.bytes)
  }
  for (const term of variant.absent ?? []) {
   const excluded = await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/decision-search?` + new URLSearchParams({q:term}))).json()
   assert.equal(excluded.count,0,'Inactive source content stays absent from saved search')
  }
  const history = await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/decision-search/transcriptions?` + new URLSearchParams({ source }))).json()
  assert.equal(history.revisions[0].text, generated, 'Actual extracted output, without replacement fixture text, is retained exactly')
  assert.equal((await client.request.get(base + `/api/plinth/jobs/${job.id}/decision-search?` + new URLSearchParams({ q: variant.terms.at(-1) })).then(response => response.json())).count, 0)
  assert.equal((await client.request.get(base + `/api/plinth/jobs/${job.id}/decision-search/transcriptions?` + new URLSearchParams({ source }))).status(), 404)
 }
}
