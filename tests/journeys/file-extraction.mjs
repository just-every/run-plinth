import { protectedDocument } from '../fixtures/unextractable-documents.mjs'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { captureExtraction, extractionApi, finishExtraction, pageTerms } from '../plinth/file-extraction-support.mjs'

const base = process.env.PLINTH_URL, shots = process.env.PLINTH_SCREENSHOTS
assert.ok(base && shots && process.env.PLINTH_STATE)
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
await mkdir(shots, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLINTH_CHROMIUM_PATH, args: ['--use-mock-keychain', '--password-store=basic', ...(process.env.PLINTH_CHROMIUM_PATH ? ['--no-sandbox'] : [])] })
try {
 const owner = await browser.newContext({ storageState: process.env.PLINTH_STATE }), page = await owner.newPage()
 const f = {
  owner: 'owner',
  json: async (path, { method = 'GET', body } = {}) => { const r = await owner.request.fetch(base + path, { method, headers: { origin: base }, ...(body === undefined ? {} : { data: body }) }); return { status: r.status(), value: await r.json() } },
  request: async (path, { method = 'GET', body } = {}) => { const r = await owner.request.fetch(base + path, { method, headers: { origin: base }, ...(body === undefined ? {} : { data: body }) }); return new Response(await r.body(), { status: r.status(), headers: r.headers() }) },
 }
 const created = await f.json('/api/plinth/jobs', { method: 'POST', body: { name: 'Native extraction custody', client_email: ['client', 'dev.localhost'].join('@'), address: 'Synthetic site' } })
 assert.equal(created.status, 201)
 const job = created.value.job, c = await captureExtraction(f, job), api = extractionApi(f, c)
 const open = async text => { await page.goto(base + `/app?job=${job.id}&tab=Decision%20search`); await page.getByLabel('Search text', { exact: true }).fill(text); await page.getByRole('button', { name: 'Search decisions', exact: true }).click(); await expect(page.getByText(text ? '1 matching records' : '4 matching records', { exact: true })).toBeVisible() }
 const row = page.locator('[data-extraction-source="files:' + c.file.id + '"]')
 await page.setViewportSize({ width: 1440, height: 1000 })
 await open(c.file.name)
 await expect(row.locator(':scope > p[role="status"]')).toHaveText('File text: queued · PDF embedded text · 0 of unknown pages')
 await row.getByRole('button', { name: 'Process next PDF step', exact: true }).click()
 await expect(row.locator(':scope > p[role="status"]')).toHaveText('File text: queued · PDF embedded text · 25 of 251 pages')
 await open(c.file.name)
 await expect(row.locator(':scope > p[role="status"]')).toHaveText('File text: queued · PDF embedded text · 25 of 251 pages')
 await page.route('**' + c.path, route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Connection unavailable. Retry this step.' }) }) : route.continue())
 await row.getByRole('button', { name: 'Process next PDF step', exact: true }).click()
 await expect(row.getByRole('alert')).toHaveText('Connection unavailable. Retry this step.')
 assert.equal((await api.read()).value.extraction.progress, 25)
 await page.unroute('**' + c.path)
 await row.getByRole('button', { name: 'Process next PDF step', exact: true }).click()
 await expect(row.locator(':scope > p[role="status"]')).toHaveText('File text: queued · PDF embedded text · 50 of 251 pages')
 const checkpoint = (await api.read()).value.extraction
 const concurrent = await Promise.all([api.action(checkpoint, 'continue'), api.action(checkpoint, 'continue')])
 assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409])
 await finishExtraction(f, c)
 await open(pageTerms[250])
 await expect(row.locator(':scope > p[role="status"]')).toHaveText('File text: complete · PDF embedded text · 251 of 251 pages')
 await expect(page.getByText(/synthetic-plinth-page-251-9580/).filter({ hasText: pageTerms[250] })).not.toHaveCount(0)
 const client = await browser.newContext({ storageState: process.env.PLINTH_CLIENT_STATE })
 assert.deepEqual(await (await client.request.get(base + c.root + '/decision-search?' + new URLSearchParams({ q: pageTerms[250] }))).json(), { results: [], count: 0 })
 assert.equal((await client.request.get(base + c.path)).status(), 404)
 assert.equal((await client.request.get(base + c.root + '/correspondence/files/' + c.file.id)).status(), 404)
 const failed = await captureExtraction(f, job, [], protectedDocument), failureApi = extractionApi(f, failed)
 const failedStep = await failureApi.action((await failureApi.read()).value.extraction, 'continue')
 assert.equal(failedStep.status, 200); assert.equal(failedStep.value.extraction.status, 'failed'); assert.equal(failedStep.value.extraction.progress, 0)
 await open('')
 await expect(page.locator('[data-extraction-source]')).toHaveCount(2)
 const failureRow = page.locator('[data-extraction-source="files:' + failed.file.id + '"]')
 await expect(failureRow.locator(':scope > p[role="status"]')).toHaveText('File text: failed · PDF embedded text · 0 of unknown pages')
 await failureRow.getByRole('button', { name: 'Retry native extraction', exact: true }).click()
 await expect(failureRow.locator(':scope > p[role="status"]')).toHaveText('File text: queued · PDF embedded text · 0 of unknown pages')
 await failureRow.getByRole('button', { name: 'Process next PDF step', exact: true }).click()
 await expect(failureRow.locator(':scope > p[role="status"]')).toHaveText('File text: failed · PDF embedded text · 0 of unknown pages')
 for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 1100 })
  const panel = page.getByRole('heading', { name: 'Find a decision', exact: true }).locator('..')
  await expect(failureRow.getByRole('button', { name: 'Retry native extraction', exact: true })).toBeVisible()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  assert.ok(await failureRow.locator('p').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 13))
  if (width === 390) {
   const menu = page.getByRole('button', { name: 'Open menu', exact: true }); await menu.hover()
   await expect.poll(() => menu.evaluate(el => getComputedStyle(el, '::after').visibility)).toBe('visible')
   await menu.focus(); assert.equal(await menu.evaluate(el => getComputedStyle(el, '::after').visibility), 'visible')
  }
  await panel.screenshot({ path: shots + '/DOC-009-extraction-' + width + '.png', animations: 'disabled' })
 }
 const current = (await f.json(c.root)).value.job
 assert.equal((await f.json(c.root, { method: 'DELETE', body: { expected_version: current.version } })).status, 200)
 assert.equal((await api.read()).status, 404); assert.equal((await failureApi.read()).status, 404)
 assert.equal((await api.search(pageTerms[0])).status, 404)
 await client.close(); await owner.close()
 console.log('DOC-009 native extraction PASS: original 251-page PDF terms exactly once, durable bounded steps, interruption, concurrent continuation, visible failure and retry, private-source refusal, unchanged original bytes and erasure; screens at 1440 and 390. Native process restart and inactive archive recovery run in the CLI archive journey.')
} finally { await browser.close() }
