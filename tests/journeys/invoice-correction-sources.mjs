import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { costFixture } from '../plinth/cost-support.mjs'

/** Exercise both signed source directions through the installed correction review. */
export async function correctionSourceJourney({ base, owner, page, width, shots }) {
 const f = { owner: 'owner', json: async (path, options = {}) => {
  const r = await owner.request.fetch(base + path, { method: options.method ?? 'GET', headers: { origin: base }, ...(options.body ? { data: options.body } : {}) })
  return { status: r.status(), value: await r.json() }
 } }
 const run = crypto.randomUUID()
 const c = await costFixture(f, { taxPercent: '10' })
 const bill = (await c.ok('/costs/bills', c.bill('synthetic-plinth-browser-bill-' + run))).record
 await c.ok(`/costs/bills/${bill.id}/review`, { reason: 'Reviewed delivered material and source evidence' }); await c.ok(`/costs/bills/${bill.id}/post`)
 const entries = (await c.ledger()).rows.flatMap(r => r.sources.actual).filter(e => e.source_kind)
 const config = { contract_reference: 'Reviewed material handling agreement', fee_bps: 2000, cap_cents: 100000, entry_ids: entries.map(e => e.id), excluded_entry_ids: [] }
 const input = { kind: 'cost_plus', description: 'Delivered framing actuals', recipient_email: c.job.client_email, due_on: '2026-11-23', terms: 'Reviewed original agreement', cost_billing: config }
 const first = (await c.ok('/invoices', input)).record; await c.ok(`/invoices/${first.id}/issue`)
 const credit = (await c.ok('/costs/bills', { ...c.bill('synthetic-plinth-browser-negative-' + run), kind: 'credit', credit_of: bill.id, lines: [{ cost_code: '06-100', description: 'Returned taxable framing material', subtotal_cents: 1000, taxable: true, matches: [{ order_id: c.order.id, receipt_id: c.receipts[0].id, cost_code: '06-100', amount_cents: 1000 }] }] })).record
 await c.ok(`/costs/bills/${credit.id}/post`)
 const creditEntries = (await c.ledger()).rows.flatMap(r => r.sources.actual).filter(e => e.source_id === credit.id)
 const negative = (await c.ok('/invoices', { ...input, description: 'Standalone returned material credit', cost_billing: { ...config, entry_ids: creditEntries.map(e => e.id) } })).record
 await c.ok(`/invoices/${negative.id}/issue`)
 const original = structuredClone(c.job.invoices.find(i => i.id === negative.id).issued), source = original.lines.find(l => l.gross_cents < 0)
 const open = async (job, id) => {
  await page.goto(base + `/app?job=${job.id}&tab=Billing`)
  const record = page.locator('#invoice-' + id)
  await record.locator(':scope > summary').click(); await record.locator('summary').filter({ hasText: /^Corrections and refunds$/ }).click()
  return record
 }
 const correct = async (record, line, kind, label) => {
  await record.getByLabel('Correction type').selectOption(kind)
  await record.getByLabel('Public correction description', { exact: true }).fill(label)
  await record.getByLabel('Private correction reason', { exact: true }).fill('Human reviewed exact source adjustment')
  await record.getByLabel('Correction amount for ' + line.description + ' (USD)', { exact: true }).fill('5.50')
  await record.getByRole('button', { name: 'Review correction document', exact: true }).click()
  const review = record.getByRole('region', { name: 'Review invoice correction', exact: true })
  await expect(review.getByRole('heading', { name: 'Review ' + kind + ' document', exact: true })).toBeVisible()
  await review.scrollIntoViewIfNeeded(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: `${shots}/BILL-005-${label}-review-${width}.png`, animations: 'disabled' })
  await review.getByRole('checkbox').check(); await review.getByRole('button', { name: 'Confirm ' + kind + ' document', exact: true }).click()
  await expect(record.getByText('Final invoice decision recorded.', { exact: true })).toBeVisible()
 }
 let record = await open(c.job, negative.id)
 await correct(record, source, 'debit', 'negative-source-debit'); await c.read()
 let current = c.job.invoices.find(i => i.id === negative.id)
 assert.equal(current.balance.due_cents, original.gross_cents + 550); assert.equal(current.corrections[0].document.tax_cents, 50)
 await correct(record, source, 'credit', 'negative-source-recredit'); await c.read()
 current = c.job.invoices.find(i => i.id === negative.id)
 assert.equal(current.balance.due_cents, original.gross_cents); assert.deepEqual(current.issued, original)
 assert.equal(current.corrections.reduce((n, v) => n + v.document.tax_cents, 0), 0)
 await record.locator('summary').filter({ hasText: current.corrections[1].document.number }).click()
 await record.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/BILL-005-negative-source-documents-${width}.png`, animations: 'disabled' })

 // An independent retained milestone keeps its hold while the linked corrections adjust the paid balance.
 const held = await costFixture(f, { taxPercent: '10' })
 await held.ok('/sov', {})
 await held.ok('/retainage', { contract_reference: 'Signed five percent retainage agreement', rules: [{ line_id: 'quote:framing', work_bps: 500, stored_bps: 500 }, { line_id: 'quote:labor', work_bps: 500, stored_bps: 500 }], milestones: [{ id: 'inspected', name: 'Inspected completion', completion_requirements: ['Inspection'], waiver_requirements: [] }] })
 const app = (await held.ok('/claims', { description: 'Inspected retained framing', lines: [{ line_id: 'quote:framing', completed_cents: 220000, stored_cents: 0, evidence: 'Reviewed installed framing' }, { line_id: 'quote:labor', completed_cents: 110000, stored_cents: 0, evidence: 'Reviewed framing labor' }] })).record
 await held.ok(`/claims/${app.id}/approve`); await held.ok(`/claims/${app.id}/issue`)
 const invoice = (await held.ok('/invoices', { kind: 'milestone', description: 'Retained framing milestone', recipient_email: held.job.client_email, source_application_id: app.id, due_on: '2026-11-23', terms: 'Signed five percent withholding with evidence-based release' })).record
 await held.ok(`/invoices/${invoice.id}/issue`)
 const issued = structuredClone(held.job.invoices.find(i => i.id === invoice.id).issued)
 await held.ok(`/invoices/${invoice.id}/receipt`, { amount_cents: issued.payable_cents, method: 'bank', received_on: '2026-10-26', reference: 'synthetic-plinth-browser-retained-' + width, confirm: true })
 record = await open(held.job, invoice.id)
 await correct(record, issued.lines[0], 'credit', 'original-withholding-credit'); await held.read()
 current = held.job.invoices.find(i => i.id === invoice.id)
 assert.equal(current.balance.withheld_cents, 16500); assert.equal(current.balance.due_cents, -550); assert.deepEqual(current.issued, issued)
 await record.locator('summary').filter({ hasText: current.corrections[0].document.number }).click()
 await record.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/BILL-005-original-withholding-documents-${width}.png`, animations: 'disabled' })
}
