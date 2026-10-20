// EST-001 / EST-007: native measured-estimate preparation and revision review on the installed workspace.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
const base = process.env.PLINTH_URL, state = process.env.PLINTH_STATE, clientState = process.env.PLINTH_CLIENT_STATE, shots = process.env.PLINTH_SCREENSHOTS
assert.ok(base && state && clientState && shots, 'Set installation URL, private owner/client storage states and an external evidence directory')
await mkdir(shots, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
try {
 const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 1100 } }), clientContext = await browser.newContext({ storageState: clientState, viewport: { width: 390, height: 1100 } })
 const page = await context.newPage(), clientPage = await clientContext.newPage()
 const session = await (await clientContext.request.get(base + '/auth/session')).json(), email = session.operator.email
 const post = async (path, body) => {
  const response = await context.request.post(base + '/api/plinth' + path, { headers: { origin: base }, data: body })
  assert.ok(response.ok(), path + ' ' + await response.text()); return response.json()
 }
 const capture = async (phase, target = page) => {
  for (const width of [1440, 390]) {
   await target.setViewportSize({ width, height: 1100 }); await target.waitForTimeout(250); await target.evaluate(() => scrollTo(0, 0))
   assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), phase + ' at ' + width + ' has no horizontal page overflow')
   await target.screenshot({ path: `${shots}/EST-001-${phase}-${width}.png`, fullPage: true, animations: 'disabled' })
  }
 }
 let { job } = await post('/jobs', { name: 'Measured multi-trade kitchen remodel ' + Date.now(), client_email: email, address: '2480 Maple Street, Burlington, VT 05401' })
 await page.goto(`${base}/app?job=${job.id}&tab=Quote`)
 await page.getByText('Build a measured estimate', { exact: true }).click()
 const input = (label, index) => page.getByRole('region',{name:`Estimate line ${index}`,exact:true}).getByLabel(`${label} ${index}`, { exact: true })
 const specs = [
  { description: 'Framing crew', code: '06-100', phase: 'Structure', category: 'labor', quantity: '2.5', unit: 'hour', rateUnit: 'hour', numerator: '1', denominator: '1', cost: '20.01', sell: '30.01' },
  { description: 'Trim measured in inches', code: '06-200', phase: 'Finishes', category: 'material', quantity: '18.125', unit: 'inch', rateUnit: 'foot', numerator: '1', denominator: '12', cost: '8.01', sell: '12.01' },
  { description: 'Equipment fractional hire', code: '01-500', phase: 'Structure', category: 'equipment', quantity: '0.1', unit: 'hour', rateUnit: 'day', numerator: '1', denominator: '3', cost: '0.15', sell: '0.45' },
  { description: 'Electrical subcontract', code: '26-100', phase: 'Rough-in', category: 'subcontract', quantity: '1.333333333333333333', unit: 'each', rateUnit: 'each', numerator: '1', denominator: '1', cost: '90.01', sell: '120.01' },
  { description: 'Permit administration', code: '01-200', phase: 'Preparation', category: 'other', quantity: '1', unit: 'each', rateUnit: 'each', numerator: '1', denominator: '1', cost: '0.25', sell: '0.50' },
  { description: 'Oak finish', code: '09-600', phase: 'Finishes', category: 'material', quantity: '10.125', unit: 'sq ft', rateUnit: 'sq ft', numerator: '1', denominator: '1', cost: '2.25', sell: '3.75', group: 'Floor finish', option: 'Oak' },
  { description: 'Tile finish', code: '09-600', phase: 'Finishes', category: 'material', quantity: '10.125', unit: 'sq ft', rateUnit: 'sq ft', numerator: '1', denominator: '1', cost: '3.25', sell: '5.25', group: 'Floor finish', option: 'Tile' },
 ]
 for (const [offset, spec] of specs.entries()) {
  const index = offset + 1
  if (offset) await page.getByRole('button', { name: 'Add estimate line', exact: true }).click()
  for (const [label, value] of [['Description', spec.description], ['Cost code', spec.code], ['Phase', spec.phase], ['Quantity', spec.quantity], ['Measurement unit', spec.unit], ['Rate unit', spec.rateUnit], ['Conversion numerator', spec.numerator], ['Conversion denominator', spec.denominator], ['Unit cost', spec.cost], ['Unit selling price', spec.sell]]) await input(label, index).fill(value)
  await input('Cost category', index).selectOption(spec.category)
  if (spec.group) { await input('Alternate group', index).fill(spec.group); await input('Alternate option', index).fill(spec.option) }
 }
 await page.getByLabel('Selected option: Floor finish', { exact: true }).selectOption('Oak')
 await page.getByLabel('Inclusions (one per line)', { exact: true }).fill('Install and protect finishes')
 await page.getByLabel('Exclusions (one per line)', { exact: true }).fill('Unforeseen concealed defects')
 await capture('measured-editor')
 await page.getByRole('button', { name: 'Prepare measured estimate revision', exact: true }).click()
 await expect(page.getByRole('heading', { name: 'Quote 1', exact: true })).toBeVisible()
 await page.reload()
 await expect(page.getByRole('cell', { name: /^Trim measured in inches/ })).toBeVisible()
 job = (await (await context.request.get(base + '/api/plinth/jobs/' + job.id)).json()).job
 const first = structuredClone(job.quotes[0])
 assert.equal(first.lines.find(line => line.category === 'equipment').cost_total_cents, 1)
 assert.equal(first.lines.find(line => line.description === 'Tile finish').included, false)
 await page.getByText('Revise measured estimate', { exact: true }).click()
 await input('Quantity', 1).fill('3.75')
 await input('Phase', 1).fill('Structure revised')
 await page.getByLabel('Selected option: Floor finish', { exact: true }).selectOption('Tile')
 await page.getByLabel('Inclusions (one per line)', { exact: true }).fill('Install and protect finishes\nAdditional framing bay')
 await page.getByLabel('Exclusions (one per line)', { exact: true }).fill('Existing electrical repairs')
 await page.getByRole('button', { name: 'Prepare measured estimate revision', exact: true }).click()
 await expect(page.getByRole('heading', { name: 'Quote 2', exact: true })).toBeVisible()
 await page.getByText('Compare estimate revisions', { exact: true }).click()
 const comparison = page.getByText('Compare estimate revisions', { exact: true }).locator('..')
 await expect(comparison.getByRole('list', { name: 'Changed estimate scope' })).toContainText('quantity: 2.5 → 3.75')
 await expect(comparison).toContainText('Structure revised')
 job = (await (await context.request.get(base + '/api/plinth/jobs/' + job.id)).json()).job
 const current = job.quotes.at(-1), usd = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
 await expect(comparison).toContainText(`Selling total: ${usd(first.total_cents)} → ${usd(current.total_cents)}`)
 await expect(comparison).toContainText(`Selling change: ${usd(current.total_cents - first.total_cents)}`)
 await expect(comparison).toContainText(`Cost change: ${usd(current.cost_total_cents - first.cost_total_cents)}`)
 await expect(comparison).toContainText('Additional framing bay')
 await expect(comparison).toContainText('Existing electrical repairs')
 await capture('revision-comparison')
 for (const extension of ['json', 'csv']) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: `Export cost-code ${extension.toUpperCase()} · quote 2`, exact: true }).click()])
  await download.saveAs(`${shots}/EST-001-cost-codes.${extension}`)
 }
 const report = JSON.parse(await readFile(`${shots}/EST-001-cost-codes.json`, 'utf8'))
 assert.equal(report.cost_codes.reduce((sum, row) => sum + row.total_cents, 0), report.total_cents)
 assert.equal(report.cost_codes.reduce((sum, row) => sum + row.cost_total_cents, 0), report.cost_total_cents)
 assert.equal(report.lines.find(row => row.description === 'Oak finish').included, false)
 assert.equal(report.lines.find(row => row.description === 'Tile finish').included, true)
 job = (await (await context.request.get(base + '/api/plinth/jobs/' + job.id)).json()).job
 assert.deepEqual(job.quotes[0], { ...first, status: 'superseded' })
 const second = structuredClone(job.quotes[1])
 await page.getByLabel('Client acceptance reference', { exact: true }).fill('Client signed the measured revision and selected Tile finish')
 await page.getByRole('combobox',{name:/^Acceptance schedule choice/}).selectOption('none')
 await page.getByLabel('No-tasks reason',{exact:true}).fill('Plan construction dates after the estimate is accepted')
 await page.getByRole('button', { name: 'Record client acceptance', exact: true }).click()
 await expect.poll(async()=>((await (await context.request.get(base+'/api/plinth/jobs/'+job.id)).json()).job.quotes.at(-1).status)).toBe('accepted')
 await page.reload()
 await expect(page.getByRole('heading', { name: 'Quote 2', exact: true })).toBeVisible()
 await expect(page.getByRole('button', { name: 'Prepare measured estimate revision', exact: true })).toHaveCount(0)
 await capture('accepted-estimate')
 await clientPage.goto(`${base}/app?job=${job.id}&tab=Quote`)
 await expect(clientPage.getByRole('heading', { name: 'Quote 2', exact: true })).toBeVisible()
 await expect(clientPage.getByText('Existing electrical repairs', { exact: true })).toBeVisible()
 await expect(clientPage.getByRole('link', { name: /Export cost-code/ })).toHaveCount(0)
 await expect(clientPage.getByText('Included line cost:', { exact: false })).toHaveCount(0)
 const visible = (await (await clientContext.request.get(base + '/api/plinth/jobs/' + job.id)).json()).job
 assert.equal(visible.quotes[0].total_cents, second.total_cents)
 assert.ok(!JSON.stringify(visible).includes('cost_unit_cents') && !JSON.stringify(visible).includes('cost_total_cents'))
 assert.equal((await clientContext.request.get(`${base}/api/plinth/jobs/${job.id}/quotes/${second.id}/cost-codes.json`)).status(), 403)
 await capture('client-selling-scope', clientPage)
 console.log('EST-001 browser journey passed at 1440 and 390: five cost categories, exact fractional measurement/conversion, selected finish, revised quantities/scope comparison, cost-code JSON/CSV and fixed accepted selling terms')
 await context.close(); await clientContext.close()
} finally { await browser.close() }
