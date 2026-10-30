import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { installedWorker } from '../../scripts/verify/installed-worker.mjs'
import { inspectThreadedDraft } from '../journeys/office-attachment-search.mjs'
import { orphanTerms } from '../fixtures/spreadsheet-document.mjs'

/** Review actual browser output in the installation that the CLI will archive. */
export async function reviewStoredWorkbook(source, jobId, fileName, original) {
 const messages = []
 const worker = await installedWorker(async request => {
  assert.equal(request.url, 'https://api.resend.com/emails', 'Workbook review has no provider effect except requested native sign-in')
  messages.push(await request.json())
  return Response.json({ id: 'synthetic-plinth-workbook-signin' })
 }, { persistTo: source, migrate: false })
 let browser
 try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLINTH_CHROMIUM_PATH, args: ['--use-mock-keychain', '--password-store=basic', ...(process.env.PLINTH_CHROMIUM_PATH ? ['--no-sandbox'] : [])] })
  const owner = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await owner.newPage(), base = worker.origin
  const signIn = await owner.request.post(base + '/auth/magic-link', { headers: { origin: base }, data: { email: ['builder', 'example.com'].join('@'), returnTo: '/app' } })
  assert.equal(signIn.status(), 202)
  const link = messages.at(-1).text.match(/https?:\/\/[^\s<>]+/g).find(value => new URL(value).pathname === '/auth/confirm')
  assert.ok(link, 'Native sign-in reaches the synthetic provider inbox')
  try {
   await page.goto(link)
   await page.getByRole('button', { name: 'Confirm', exact: true }).click()
   await page.waitForURL(value => !value.pathname.startsWith('/auth/'))
  } catch { throw new Error('Workbook native sign-in failed; private link withheld') }
  if (new URL(page.url()).pathname === '/setup') {
   await page.getByLabel('Your name', { exact: true }).fill('Synthetic Plinth builder')
   await page.getByRole('checkbox').check()
   await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
   await page.waitForURL('**/app')
  }
  const sent = messages.length, outbound = []
  page.on('request', request => { const url = new URL(request.url()); if (url.protocol.startsWith('http') && url.origin !== base) outbound.push(url.origin) })
  await page.goto(base + `/app?job=${jobId}&tab=Decision%20search`)
  await page.getByLabel('Search text', { exact: true }).fill(fileName)
  await page.getByRole('button', { name: 'Search decisions', exact: true }).click()
  await expect(page.getByText('1 matching records', { exact: true })).toBeVisible()
  for (const name of ['Index metadata', 'Supplied attachment text', 'Extract text in this browser']) await page.getByText(name, { exact: true }).click()
  await page.getByRole('button', { name: 'Extract draft text', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'Unverified extracted draft', exact: true })
  await expect(draft.or(page.getByRole('alert'))).toBeVisible({ timeout: 120000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(draft).toBeVisible()
  const generated = await draft.inputValue()
  inspectThreadedDraft(generated)
  for (const term of orphanTerms) assert.ok(!generated.includes(term), 'Unreferenced content stays excluded')
  await page.getByRole('button', { name: 'Use text in editor', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Human-supplied transcription', exact: true })).toHaveValue(generated)
  const previewResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/decision-search/transcription-preview'))
  await page.getByRole('button', { name: 'Review complete supplied text', exact: true }).click()
  const preview = await previewResponse
  assert.equal(preview.status(), 200)
  assert.equal((await preview.json()).text, generated)
  const review = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Review complete supplied text', exact: true }) })
  await expect(review.locator('pre')).toHaveText(generated)
  await review.getByRole('checkbox').check()
  const saveResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/decision-search/transcriptions'))
  await review.getByRole('button', { name: 'Confirm and save supplied text', exact: true }).click()
  assert.equal((await saveResponse).status(), 200)
  await expect(review).toHaveCount(0)
  const lookup = await (await owner.request.get(base + `/api/plinth/jobs/${jobId}/decision-search?` + new URLSearchParams({ q: fileName }))).json()
  const hit = lookup.results[0]
  assert.equal(lookup.count, 1)
  assert.equal(hit.extraction.status, 'unsupported', 'Supplementary review never replaces original extraction state')
  const history = await (await owner.request.get(base + `/api/plinth/jobs/${jobId}/decision-search/transcriptions?` + new URLSearchParams({ source: hit.source }))).json()
  assert.deepEqual(history.revisions.map(row => row.text), [generated])
  assert.deepEqual(Buffer.from(await (await owner.request.get(base + hit.files[0].href)).body()), original)
  assert.deepEqual(outbound, [], 'Stored workbook extraction stays local')
  assert.equal(messages.length, sent, 'Extraction and review make no outbound effect')
  return generated
 } finally { await browser?.close(); await worker.close() }
}
