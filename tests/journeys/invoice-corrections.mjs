import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

const base = process.env.PLINTH_URL, shots = process.env.PLINTH_SCREENSHOTS
const ownerOpen = process.env.PLINTH_OWNER_OPEN, clientOpen = process.env.PLINTH_CLIENT_OPEN
const ownerState = process.env.PLINTH_STATE, clientState = process.env.PLINTH_CLIENT_STATE
assert.ok(base && shots && ((ownerOpen && clientOpen) || (ownerState && clientState)), 'Provide the disposable native app, screenshot directory and private owner and client sign-in')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Use a disposable local installation')
await mkdir(shots, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
try {
 const owner = await browser.newContext(ownerOpen ? {} : { storageState: ownerState })
 const client = await browser.newContext(clientOpen ? {} : { storageState: clientState })
 const page = await owner.newPage(), clientPage = await client.newPage()
 for (const [entry, url] of [[page, ownerOpen], [clientPage, clientOpen]]) if (url) {
  await entry.goto(url)
  await entry.waitForURL(u => !u.pathname.startsWith('/auth/') && !u.pathname.startsWith('/__dev/'))
  await entry.goto(base + '/app')
  if (new URL(entry.url()).pathname === '/setup') {
   await entry.getByLabel('Your name', { exact: true }).fill('Synthetic Plinth builder')
   await entry.getByRole('checkbox').check()
   await entry.getByRole('button', { name: 'Finish setup', exact: true }).click()
   await entry.waitForURL(u => u.pathname !== '/setup')
  }
 }
 const request = async (path, body, context = owner) => {
  const response = await context.request.fetch(base + '/api/plinth' + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin: base }, ...(body === undefined ? {} : { data: body }) })
  const value = await response.json()
  assert.ok(response.ok(), `${path}: ${response.status()} ${JSON.stringify(value)}`)
  return value
 }
 for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 1100 }); await clientPage.setViewportSize({ width, height: 1100 })
  let job = (await request('/jobs', { name: `Maple Street remodel corrections ${width} · ${Date.now()}`, address: '2480 Maple Street, Burlington, VT 05401', client_email: 'client@dev.localhost', time_zone: 'America/New_York' })).job
  const read = async () => job = (await request(`/jobs/${job.id}`)).job
  const act = async (path, body = {}, context = owner) => {
   const result = await request(`/jobs/${job.id}${path}`, { expected_version: job.version, ...body }, context)
   if (result.job) job = result.job
   return result.record
  }
  await act('/quotes', { lines: [{ id: 'synthetic-plinth-scope-5', description: 'Whole-home remodeling under signed base agreement', cost_code: '06-100', category: 'material', phase: 'Remodel', quantity: '1', unit: 'job', unit_cents: 48000000, cost_unit_cents: 32000000 }] })
  const rate = (await request('/pricing-rates', { jurisdiction: 'Builder-reviewed fixture tax schedule', kind: 'sales', percent: '10', effective_on: '2026-01-01', reference: 'synthetic-plinth-tax-5', human_reviewed: true })).rate
  const pricing = { basis: 'sell', as_of: '2026-10-21', rules: [], tax: { rate_id: rate.id, taxable_line_ids: [], exemption_reference: 'Reviewed base agreement exemption' } }
  const preview = await request(`/jobs/${job.id}/pricing/preview`, { expected_version: job.version, ...pricing })
  await act('/pricing/apply', { ...pricing, digest: preview.preview.digest })
  await act(`/quotes/${job.quotes.at(-1).id}/accept`, { method: 'signed', evidence: 'Returned signed remodel agreement with separate addition and draw terms', schedule_choice: { kind: 'none', reason: 'Superintendent will plan dates separately' } })
  const change = { description: 'Client-approved upgraded kitchen millwork', direction: 'charge', basis: 'sell', as_of: '2026-10-21', lines: [{ id: 'synthetic-plinth-change-5', description: 'Added taxable kitchen millwork', cost_code: '06-100', category: 'material', phase: 'Kitchen', quantity: '1', unit: 'job', unit_cents: 1100000, cost_unit_cents: 700000 }], rules: [], tax: { rate_id: rate.id, taxable_line_ids: ['synthetic-plinth-change-5'] } }
  const changePreview = await request(`/jobs/${job.id}/variation-pricing/preview`, { expected_version: job.version, ...change })
  await act('/variation-pricing/apply', { ...change, digest: changePreview.preview.digest })
  await act(`/variations/${job.variations.at(-1).id}/approve`, {}, client)
  await read()
  const changeLine = 'variation:' + job.variations.at(-1).id, originalLine = 'quote:synthetic-plinth-scope-5'
  await act('/sov', { code_assignments: { [changeLine]: '06-100' } })
  const issueMilestone = async (completed, description) => {
   const claim = await act('/claims', { description, lines: [{ line_id: originalLine, completed_cents: completed, stored_cents: 0, evidence: 'Superintendent reviewed installed base scope' }, { line_id: changeLine, completed_cents: 1210000, stored_cents: 0, evidence: 'Client-approved millwork installed and inspected' }] })
   await act(`/claims/${claim.id}/approve`); await act(`/claims/${claim.id}/issue`)
   const invoice = await act('/invoices', { kind: 'milestone', description, source_application_id: claim.id, recipient_email: job.client_email, due_on: '2026-11-04', terms: 'Fourteen calendar days under the signed agreement' })
   await act(`/invoices/${invoice.id}/issue`)
   return job.invoices.find(i => i.id === invoice.id)
  }
  const paid = await issueMilestone(0, 'Approved kitchen addition'), original = structuredClone(paid.issued)
  await act(`/invoices/${paid.id}/receipt`, { amount_cents: 1210000, received_on: '2026-10-22', reference: 'synthetic-plinth-settlement-5', method: 'bank', confirm: true })
  const openRecord = async id => {
   await page.goto(base + `/app?job=${job.id}&tab=Billing`)
   const record = page.locator('#invoice-' + id)
   await record.locator(':scope > summary').click()
   return record
  }
  const openCorrections = async record => {
   await record.locator('summary').filter({ hasText: /^Corrections and refunds$/ }).click()
  }
  const screenshot = async (label, target) => {
   await target.scrollIntoViewIfNeeded()
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label} fits ${width}`)
   await page.screenshot({ path: `${shots}/BILL-005-${label}-${width}.png`, animations: 'disabled' })
  }
  const confirm = async (record, label) => {
   const review = record.getByRole('region', { name: 'Review invoice correction', exact: true })
   await expect(review.getByRole('heading', { name: 'Review ' + label, exact: true })).toBeVisible()
   await screenshot(label.replaceAll(' ', '-'), review)
   await review.getByRole('checkbox').check()
   await review.getByRole('button', { name: 'Confirm ' + label, exact: true }).click()
   await expect(record.getByText('Final invoice decision recorded.', { exact: true })).toBeVisible()
   await read()
  }
  let record = await openRecord(paid.id)
  await openCorrections(record)
  const creditReason = 'Private negotiated millwork adjustment and office review'
  const correction = async (kind, amount, description) => {
   await record.getByLabel('Correction type').selectOption(kind)
   await record.getByLabel('Public correction description', { exact: true }).fill(description)
   await record.getByLabel('Private correction reason', { exact: true }).fill(creditReason)
   await record.getByLabel('Correction amount for ' + paid.issued.lines.find(l => l.gross_cents > 0).description + ' (USD)', { exact: true }).fill(amount)
   await record.getByRole('button', { name: 'Review correction document', exact: true }).click()
   const before = (await request(`/jobs/${job.id}`)).job.invoices.find(i => i.id === paid.id)
   assert.equal(before.corrections?.length ?? 0, kind === 'credit' ? 0 : 1, 'Preparation creates no final document')
   await confirm(record, kind + ' document')
  }
  await correction('credit', '3300', 'Agreed partial kitchen millwork credit')
  let current = job.invoices.find(i => i.id === paid.id)
  assert.equal(current.balance.due_cents, -330000); assert.equal(current.corrections[0].document.tax_cents, -30000)
  await expect(record.getByText('Customer credit', { exact: true })).toBeVisible()
  await correction('debit', '1100', 'Restore the accepted portion of the millwork credit')
  current = job.invoices.find(i => i.id === paid.id)
  assert.equal(current.balance.due_cents, -220000); assert.equal(current.corrections[1].document.tax_cents, 10000); assert.deepEqual(current.issued, original)
  await record.locator('summary').filter({ hasText: /^Refund a Stripe payment$/ }).click()
  await expect(record.getByText('No settled Stripe payment is available for this invoice.', { exact: true })).toBeVisible()
  await record.locator('summary').filter({ hasText: current.corrections[0].document.number }).click()
  await expect(record.getByText('Private reason: ' + creditReason, { exact: true }).first()).toBeVisible()
  await screenshot('linked-documents', record)
  const download = page.waitForEvent('download')
  await record.getByRole('button', { name: 'Download correction document', exact: true }).first().click()
  assert.equal((await download).suggestedFilename(), current.corrections[0].document.number + '.json')
  const originalPage = await owner.newPage()
  await originalPage.goto(base + `/api/plinth/jobs/${job.id}/invoices/${paid.id}/document.html`)
  await expect(originalPage.getByRole('heading', { name: 'Invoice ' + original.number, exact: true })).toBeVisible()
  await originalPage.close()
  const residual = await issueMilestone(12000000, 'Separate disputed base-scope draw')
  await act(`/invoices/${residual.id}/receipt`, { amount_cents: 10000000, received_on: '2026-10-23', reference: 'synthetic-plinth-settlement-6', method: 'check', confirm: true })
  record = await openRecord(residual.id); await openCorrections(record)
  await record.locator('summary').filter({ hasText: /^Write off a disputed residual$/ }).click()
  await record.getByLabel('Write-off amount (USD)', { exact: true }).fill('20000')
  await record.getByLabel('Private write-off reason', { exact: true }).fill('Private disputed residual accepted as uncollectible')
  await record.getByLabel('Private dispute reference', { exact: true }).fill('synthetic-plinth-dispute-5')
  await record.getByRole('button', { name: 'Review residual write-off', exact: true }).click()
  await confirm(record, 'residual write-off')
  const written = job.invoices.find(i => i.id === residual.id)
  assert.equal(written.balance.due_cents, 0); assert.equal(written.balance.written_off_cents, 2000000); assert.deepEqual(written.issued, residual.issued)
  await record.locator('summary').filter({ hasText: /^Disputed residual written off/ }).click()
  await screenshot('private-write-off', record)
  const deposit = await act('/invoices', { kind: 'deposit', description: 'Unused deposit request', amount_cents: 4800000, recipient_email: job.client_email, due_on: '2026-11-04', terms: 'Deposit under signed agreement' })
  await act(`/invoices/${deposit.id}/issue`)
  record = await openRecord(deposit.id); await openCorrections(record)
  assert.equal(await record.getByText('Write off a disputed residual', { exact: true }).count(), 0)
  await record.locator('summary').filter({ hasText: /^Void this invoice$/ }).click()
  await record.getByLabel('Public void description', { exact: true }).fill('Unused duplicate deposit request voided')
  await record.getByLabel('Private void reason', { exact: true }).fill('Private duplicate request review')
  await record.getByRole('button', { name: 'Review invoice void', exact: true }).click()
  await confirm(record, 'invoice void')
  assert.equal(job.invoices.find(i => i.id === deposit.id).balance.due_cents, 0)
  await expect(record.getByText('This invoice was voided by a linked credit.', { exact: true })).toBeVisible()
  await clientPage.goto(base + `/app?job=${job.id}&tab=Billing`)
  const clientRecord = clientPage.locator('#invoice-' + paid.id)
  await clientRecord.locator(':scope > summary').click()
  const credit = job.invoices.find(i => i.id === paid.id).corrections[0].document
  await clientRecord.locator('summary').filter({ hasText: credit.number }).click()
  await expect(clientRecord.getByText(credit.description, { exact: true })).toBeVisible()
  for (const privateText of [creditReason, 'Private disputed residual accepted as uncollectible', 'synthetic-plinth-dispute-5', 'Private duplicate request review', 'Corrections and refunds']) assert.equal(await clientPage.getByText(privateText, { exact: false }).count(), 0)
  const denied = await client.request.post(base + `/api/plinth/jobs/${job.id}/invoices/${paid.id}/credit`, { headers: { origin: base }, data: { expected_version: job.version, operation_id: crypto.randomUUID(), description: 'Client cannot correct invoice', reason: 'Private reason', lines: [{ invoice_line_id: changeLine, amount_cents: 1 }], confirm: true } })
  assert.equal(denied.status(), 403)
  assert.equal(await clientPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await clientRecord.scrollIntoViewIfNeeded(); await clientPage.screenshot({ path: `${shots}/BILL-005-client-documents-${width}.png`, animations: 'disabled' })
  for (const control of await page.locator('button.icon-button:visible').all()) {
   const tip = await control.getAttribute('data-tip'); assert.ok(tip && tip.split(' ').length >= 2 && tip.split(' ').length <= 4)
   await control.hover(); await page.waitForTimeout(350)
   await expect.poll(() => control.evaluate(el => getComputedStyle(el, '::after').visibility)).toBe('visible')
   await page.mouse.move(0, 0); await control.blur(); await page.keyboard.press('Tab'); await control.focus(); assert.equal(await control.evaluate(el => getComputedStyle(el, '::after').visibility), 'visible', 'Keyboard focus shows the tooltip immediately')
   await control.blur()
  }
 }
 await owner.close(); await client.close()
 console.log('BILL-005 PASS: installed correction review, linked credit and debit tax, immutable originals, private residual write-off, deposit void, client isolation and tooltip audit at 1440 and 390')
} finally { await browser.close() }
