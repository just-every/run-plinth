import { requireJobManager } from './auth'
import { clientAccess } from './job-customers'
import { cents, find, need, recordApproval, stamp, sum, text, type Actor, type Input, type Job } from './model'
import { invoiceDigest, invoiceLines, invoiceSources } from './invoice-pricing'
import { invoiceRows, type Invoice, type InvoiceJob, type InvoiceSnapshot, type InvoiceBalance, type InvoiceReceipt } from './invoice-model'

function date(value: unknown, name: string) {
 const result = text(value, name, 10)
 need(/^\d{4}-\d{2}-\d{2}$/.test(result) && !Number.isNaN(Date.parse(result + 'T00:00:00Z')) && new Date(result + 'T00:00:00Z').toISOString().slice(0, 10) === result, `${name} must be a valid YYYY-MM-DD job-local date`)
 return result
}
export function invoiceBalance(job: Job, invoice: Invoice): InvoiceBalance {
 const gross_cents = invoice.issued?.gross_cents ?? invoice.amount_cents, withheld_cents = invoice.issued?.withheld_cents ?? invoice.sources.application?.retainage?.current_withheld_cents ?? 0
 const releases = invoice.kind === 'milestone' ? (job.retainage?.releases ?? []).filter(r => r.source_claim_id === invoice.source_application_id) : []
 const released_retainage_cents = sum(releases.map(r => r.amount_cents))
 const captured = new Set(invoice.issued?.sources.retainage?.state.releases.map(r => r.id) ?? [])
 const later_released_cents = sum(releases.filter(r => !captured.has(r.id)).map(r => r.amount_cents))
 const payable_cents = sum([invoice.issued?.payable_cents ?? gross_cents - withheld_cents, invoice.issued ? later_released_cents : 0])
 const deposit_applied_cents = sum(invoice.deposit_applications.map(a => a.amount_cents)), received_cents = sum(invoice.receipts.map(r => r.amount_cents))
 return { gross_cents, withheld_cents, released_retainage_cents, payable_cents, deposit_applied_cents, received_cents, due_cents: sum([payable_cents, -deposit_applied_cents, -received_cents]) }
}
function depositAvailable(job: Job, deposit: Invoice) {
 return sum([...deposit.receipts.map(r => r.amount_cents), ...invoiceRows(job).flatMap(i => i.deposit_applications.filter(a => a.deposit_invoice_id === deposit.id).map(a => -a.amount_cents))])
}
export function depositLiability(job: Job): number { return sum(invoiceRows(job).filter(i => i.kind === 'deposit' && i.issued).map(i => depositAvailable(job, i))) }
function publicSnapshot(s: InvoiceSnapshot) {
 const { sources: _sources, ...doc } = s
 return { ...doc, tax_verification: s.sources.tax_verification, source_budget_revision: s.sources.current_budget.revision }
}
/** Explicit client whitelist excludes private costs, pricing rules, rates, progress evidence and approval history. */
export function invoiceProjection(job: Job, actor?: Actor) {
 if (actor?.role !== 'member') return invoiceRows(job).map(i => ({ ...i, balance: invoiceBalance(job, i) }))
 return invoiceRows(job).filter(i => i.status === 'issued' && i.issued).map(i => ({
  id: i.id, kind: i.kind, status: i.status, number: i.number, description: i.description, due_on: i.due_on, terms: i.terms,
  recipient_email: i.recipient_email, amount_cents: i.amount_cents, source_application_id: i.source_application_id,
  issued: publicSnapshot(i.issued!), receipts: i.receipts.map(r => ({ id: r.id, amount_cents: r.amount_cents, received_on: r.received_on, reference: r.reference, method: r.method, recorded_by: r.recorded_by, label: r.label })),
  deposit_applications: structuredClone(i.deposit_applications), acceptance: i.acceptance, delivery: i.delivery, balance: invoiceBalance(job, i),
 }))
}
/** Mutates only the caller's cloned job. All returned guards/counter writes belong in its optimistic transaction. */
export async function invoiceAction(db: D1Database, job: Job, actor: Actor, input: Input, id?: string, action?: string): Promise<{ record: Invoice; writes: D1PreparedStatement[] }> {
 const writes: D1PreparedStatement[] = []
 if (!id) {
  requireJobManager(actor, true)
  need(!action || action === 'prepare', 'Unknown invoice action', 404, 'not_found')
  need(input.kind === 'deposit' || input.kind === 'milestone', 'Choose deposit or milestone')
  const recipient_email = text(input.recipient_email, 'recipient_email', 254).toLowerCase()
  need(await clientAccess(db, job, recipient_email), 'Choose the original client or a currently authorized billing contact', 403, 'recipient')
  need(input.source_retainage_release_id === undefined, 'Retainage releases adjust the original milestone ledger and cannot be invoiced twice')
  need(input.kind !== 'deposit' || input.source_application_id === undefined, 'Deposit invoices cannot name an earned application')
  const source_application_id = input.kind === 'milestone' ? text(input.source_application_id, 'source_application_id', 100) : undefined
  const sources = invoiceSources(job, source_application_id)
  need(!source_application_id || !invoiceRows(job).some(i => i.source_application_id === source_application_id && i.status === 'issued'), 'This application already has an issued invoice', 409, 'invoice_duplicate')
  const amount_cents = input.kind === 'deposit' ? cents(input.amount_cents) : sources.application!.current_cents
  need(amount_cents > 0, 'An invoice needs a positive gross amount')
  if (input.kind === 'milestone' && input.amount_cents !== undefined) need(input.amount_cents === amount_cents, 'Milestone amount comes from its issued application')
  const record: Invoice = { id: crypto.randomUUID(), kind: input.kind, status: 'draft', description: text(input.description, 'description', 2000), due_on: date(input.due_on, 'due_on'), terms: text(input.terms, 'terms', 4000), recipient_email, amount_cents, ...(source_application_id ? { source_application_id } : {}), prepared_by: stamp(actor), source_digest: invoiceDigest(sources), sources, lines: [], receipts: [], deposit_applications: [] }
  record.lines = invoiceLines(job, record, sources)
  ;((job as InvoiceJob).invoices ??= []).push(record)
  return { record, writes }
 }
 const row = find(invoiceRows(job), id)
 if (action === 'accept') {
  need(actor.role === 'member' && await clientAccess(db, job, actor.email), 'Only a currently assigned signed-in client may acknowledge this invoice', 403, 'forbidden')
  need(row.issued && !row.acceptance, 'Issue the invoice first; acknowledgment is recorded once', 409, 'invoice_state')
  need(input.confirm === true, 'Confirm your acknowledgment of this exact invoice')
  row.acceptance = { statement: text(input.statement, 'Acknowledgment statement', 2000), accepted_by: stamp(actor), email: actor.email, label: 'Client acknowledgment recorded; not payment or an electronic signature' }
  recordApproval(job, actor, 'invoice.accept', row, { invoice_number: row.issued.number, ...row.acceptance })
  return { record: row, writes }
 }
 requireJobManager(actor)
 if (action === 'issue') {
  need(row.status === 'draft' && !row.issued, 'Each invoice issues once', 409, 'invoice_state')
  need(await clientAccess(db, job, row.recipient_email), 'The invoice recipient is no longer authorized', 403, 'recipient')
  const sources = invoiceSources(job, row.source_application_id)
  need(invoiceDigest(sources) === row.source_digest, 'Approval sources changed; prepare a fresh invoice', 409, 'invoice_stale')
  need(!row.source_application_id || !invoiceRows(job).some(i => i.id !== row.id && i.issued && i.source_application_id === row.source_application_id), 'This application already has an issued invoice', 409, 'invoice_duplicate')
  const lines = invoiceLines(job, row, sources)
  need(JSON.stringify(lines) === JSON.stringify(row.lines), 'Earlier invoice allocations changed; prepare a fresh invoice', 409, 'invoice_stale')
  const billed = sum(invoiceRows(job).filter(i => i.kind === 'milestone' && i.source_application_id && i.issued).map(i => i.issued!.gross_cents))
  const deposits = sum(invoiceRows(job).filter(i => i.kind === 'deposit' && i.issued).map(i => i.issued!.gross_cents))
  need(row.kind === 'deposit' ? sum([deposits, row.amount_cents]) <= sources.current_budget.contract_cents : sum([billed, row.amount_cents]) <= sources.current_budget.contract_cents, 'Invoice exceeds the approved contract ', 409, 'invoice_balance')
  const counter = await db.prepare('SELECT next_number FROM pl_invoice_sequence WHERE id=1').first<{ next_number: number }>()
  need(counter && Number.isSafeInteger(counter.next_number) && counter.next_number > 0 && counter.next_number < 1_000_000_000_000, 'Invoice numbering is unavailable', 409, 'invoice_sequence')
  writes.push(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_invoice_sequence WHERE id=1 AND next_number=?) THEN 1 ELSE 0 END').bind(counter.next_number), db.prepare('UPDATE pl_invoice_sequence SET next_number=next_number+1 WHERE id=1 AND next_number=?').bind(counter.next_number))
  const number = `INV-${String(counter.next_number).padStart(6, '0')}`, withheld_cents = sources.application?.retainage?.current_withheld_cents ?? 0
  const payable_cents = sources.retainage?.current.current_net_cents ?? sum([row.amount_cents, -withheld_cents]); need(payable_cents >= 0, 'Withholding cannot exceed the invoice gross', 409, 'invoice_balance')
  row.issued = structuredClone({ format: 'plinth-invoice-v1', number, issued_by: stamp(actor), job_id: job.id, job_name: job.name, job_address: job.address, time_zone: job.time_zone ?? 'UTC', currency: 'USD', kind: row.kind, description: row.description, due_on: row.due_on, terms: row.terms, recipient_email: row.recipient_email, ...(row.source_application_id ? { source_application_id: row.source_application_id } : {}), gross_cents: row.amount_cents, withheld_cents, payable_cents, earned_revenue_cents: row.kind === 'deposit' ? 0 : sum(lines.map(l => l.subtotal_cents)), subtotal_cents: sum(lines.map(l => l.subtotal_cents)), tax_cents: sum(lines.map(l => l.tax_cents)), lines, sources })
  need(sum(lines.map(l => l.gross_cents)) === row.amount_cents, 'Invoice lines do not reconcile', 409, 'invoice_balance')
  row.number = number; row.status = 'issued'; recordApproval(job, actor, 'invoice.issue', row, row.issued)
 } else {
  need(row.status === 'issued' && row.issued, 'Issue the invoice first', 409, 'invoice_state')
  if (action === 'receipt') {
   need(input.confirm === true, 'Confirm the external receipt was recorded by staff; Plinth did not move or independently verify funds')
   need(input.method === 'bank' || input.method === 'check', 'Choose bank or check receipt')
   const amount_cents = cents(input.amount_cents), reference = text(input.reference, 'External receipt reference', 500)
   need(amount_cents > 0 && amount_cents <= invoiceBalance(job, row).due_cents, 'Receipt must be positive and cannot exceed the invoice balance', 409, 'invoice_balance')
   const recorded = sum(invoiceRows(job).flatMap(i => i.receipts.map(r => r.amount_cents)))
   need(sum([recorded, amount_cents]) <= (job.budgets?.at(-1)?.contract_cents ?? 0), 'Total recorded receipts would exceed the current approved contract; review unapplied deposits before recording more', 409, 'invoice_balance')
   need(!(job.remittances ?? []).some(r => r.reference.toLowerCase() === reference.toLowerCase()) && !invoiceRows(job).some(i => i.receipts.some(r => r.reference.toLowerCase() === reference.toLowerCase())), 'This external receipt reference is already recorded on this job', 409, 'invoice_duplicate')
   const receipt: InvoiceReceipt = { id: crypto.randomUUID(), amount_cents, received_on: date(input.received_on, 'received_on'), reference, method: input.method, recorded_by: stamp(actor), label: 'Recorded by staff; Plinth did not move or independently verify funds' as const }
   row.receipts.push(receipt); recordApproval(job, actor, 'invoice.receipt', row, receipt)
  } else if (action === 'return-receipt') {
   need(input.confirm === true, 'Confirm the external bank/check return; Plinth does not move or independently verify funds')
   need(input.amount_cents === undefined, 'A receipt return reverses the full original amount; partial returns need a separate reviewed adjustment')
   const receipt = find(row.receipts, text(input.receipt_id, 'receipt_id', 100))
   need(!receipt.remittance_id, 'Return a remittance through its remittance return door so all allocations reconcile together', 409, 'remittance_history')
   need(receipt.amount_cents > 0 && !receipt.reversal_of && !row.receipts.some(r => r.reversal_of === receipt.id), 'Choose an original receipt that has not already been returned', 409, 'receipt_returned')
   const returned_on = date(input.returned_on, 'returned_on')
   need(returned_on >= receipt.received_on, 'Return date cannot precede the original receipt')
   // Allocated liability must stay funded; this action never rewrites a draw's deposit applications.
   need(row.kind !== 'deposit' || receipt.amount_cents <= depositAvailable(job, row), 'This return would consume deposit funds already applied to a milestone; review allocation reversals first', 409, 'deposit_allocated')
   const reason = text(input.reason, 'Return reason', 2000)
   const reversal: InvoiceReceipt = { id: crypto.randomUUID(), amount_cents: -receipt.amount_cents, received_on: returned_on, reference: text(input.reference, 'Return evidence reference', 500), method: receipt.method, recorded_by: stamp(actor), reversal_of: receipt.id, label: 'Return recorded by staff; receipt reversed, no funds moved or independently verified' }
   row.receipts.push(reversal)
   recordApproval(job, actor, 'invoice.receipt_return', row, { invoice_number: row.number, receipt, reversal, reason })
  } else if (action === 'apply-deposit') {
   need(row.kind === 'milestone', 'Apply deposits only to milestone invoices', 409, 'invoice_state')
   const deposit = find(invoiceRows(job), text(input.deposit_invoice_id, 'deposit_invoice_id', 100)), amount_cents = cents(input.amount_cents)
   need(deposit.kind === 'deposit' && deposit.issued, 'Choose an issued deposit invoice', 409, 'invoice_state')
   need(!row.deposit_applications.some(a => a.deposit_invoice_id === deposit.id), 'This deposit was already applied to this milestone', 409, 'invoice_duplicate')
   need(amount_cents > 0 && amount_cents <= depositAvailable(job, deposit) && amount_cents <= invoiceBalance(job, row).due_cents, 'Allocation exceeds recorded deposit liability or the milestone balance', 409, 'invoice_balance')
   const application = { id: crypto.randomUUID(), deposit_invoice_id: deposit.id, amount_cents, recorded_by: stamp(actor) }
   row.deposit_applications.push(application); recordApproval(job, actor, 'invoice.apply_deposit', row, application)
  } else need(false, 'Unknown invoice action', 404, 'not_found')
 }
 return { record: row, writes }
}
const escape = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const usd = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100)
/** The printable original reads the frozen issue only, never the current receipt/allocation ledger. */
export function invoiceDocument(invoice: Invoice, _job?: Job): string {
 const s = invoice.issued; need(s, 'Issue the invoice before downloading its original', 409, 'invoice_state')
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(s.number)}</title><style>body{font:16px system-ui;margin:24px;color:#172b36}main{max-width:100%;overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #bbb}@media print{body{margin:0}}</style><h1>Invoice ${escape(s.number)}</h1><h2>${escape(s.job_name)}</h2><p>${escape(s.job_address)}</p><p>${escape(s.description)} · ${escape(s.kind)} · USD</p><p>Bill to ${escape(s.recipient_email)}<br>Due ${escape(s.due_on)} inclusive in ${escape(s.time_zone)}<br>Terms: ${escape(s.terms)}</p><main><table><tr><th>Description</th><th>Before tax</th><th>Tax</th><th>Total</th></tr>${s.lines.map(l => `<tr><td>${escape(l.description)}</td><td>${usd(l.subtotal_cents)}</td><td>${usd(l.tax_cents)}</td><td>${usd(l.gross_cents)}</td></tr>`).join('')}</table></main><p>Gross ${usd(s.gross_cents)} · Withheld ${usd(s.withheld_cents)} · Original payable ${usd(s.payable_cents)}</p><p>${s.kind === 'deposit' ? 'Deposit liability arises only from recorded receipts; this request earns no revenue.' : 'Gross includes the source application’s reviewed tax; withholding does not change gross earned value.'}</p><p>${escape(s.sources.tax_verification)}. This commercial invoice does not certify work completion, legal tax treatment, receipt or movement of funds. Current receipts and deposit allocations are a separate ledger.</p><p>Issued by ${escape(s.issued_by.name)} at ${escape(s.issued_by.at)}</p></html>`
}
