import type { Job, Stamp } from './model'
import type { BudgetRevision } from './budget-model'
import type { SovApplication, SovSources } from './sov-model'

export interface InvoiceTaxLine {
 id: string; description: string; source_id: string; source_revision: number; source_line_id?: string
 gross_cents: number; subtotal_cents: number; tax_cents: number
 reviewed_source_gross_cents: number; reviewed_source_tax_cents: number
}
export interface InvoiceSources {
 cost_billing?: import('./cost-billing').CostBilling
 contract: SovSources; original_budget: BudgetRevision; current_budget: BudgetRevision
 allowance_changes: NonNullable<Job['variations'][number]['allowance_change']>[]
 application?: SovApplication
 retainage?: { state: NonNullable<Job['retainage']>; current: import('./retainage-model').RetainageSnapshot }
 tax_verification: 'Human reviewed source; no provider verification or legal certification'
 cost_uncertainty: string
}
export interface InvoiceSnapshot {
 adjusts_invoice_numbers?: string[]
 format: 'plinth-invoice-v1'; number: string; issued_by: Stamp
 job_id: string; job_name: string; job_address: string; time_zone: string; currency: 'USD'
 kind: 'deposit' | 'milestone' | 'cost_plus'; description: string; due_on: string; terms: string; recipient_email: string
 source_application_id?: string; gross_cents: number; withheld_cents: number; payable_cents: number
 earned_revenue_cents: number; subtotal_cents: number; tax_cents: number; lines: InvoiceTaxLine[]; sources: InvoiceSources
}
export interface InvoiceReceipt {
 id: string; amount_cents: number; received_on: string; reference: string; method: 'bank' | 'check' | 'stripe'
 remittance_id?: string; reversal_of?: string; processor_refund_id?: string; refund_instruction_id?: string; accounting_entries?: InvoiceAccountingEntry[]
 /** PAY-001: the processor references of a payment Stripe settled; never a card or bank number. */
 processor?: { confirmation?: 'signed_event' | 'provider_record'; name: 'stripe'; attempt_id: string; checkout_session_id: string; payment_intent_id: string; method: string; wallet: string | null; fee_cents: number | null; livemode: boolean }
 recorded_by: Stamp; label: 'Settled by the processor and reconciled against Stripe records; Plinth did not hold the funds' | 'Processor reversal reconciled against Stripe; original receipt preserved' | 'Settled by the processor and recorded from a signed Stripe event; Plinth did not hold the funds' | 'Recorded by staff; Plinth did not move or independently verify funds' | 'Return recorded by staff; allocation reversed, no funds moved or independently verified' | 'Return recorded by staff; receipt reversed, no funds moved or independently verified' | 'Return recorded by staff; partial receipt reversal, no funds moved or independently verified'
}
export interface InvoiceAccountingEntry {
 account: 'stripe_clearing' | 'customer_deposits' | 'accounts_receivable' | 'earned_revenue' | 'sales_tax_payable' | 'deposit_request_receivable' | 'deposit_request_offset' | 'bad_debt_expense'
 debit_cents: number; credit_cents: number
}
export interface InvoiceCorrectionDocument {
 format: 'plinth-invoice-correction-v1'; id: string; number: string; kind: 'credit' | 'debit' | 'void'
 original_invoice_id: string; original_invoice_number: string; job_id: string; currency: 'USD'
 description: string; due_on: string; terms: string; recipient_email: string; issued_by: Stamp
 gross_cents: number; subtotal_cents: number; tax_cents: number
 lines: (InvoiceTaxLine & { invoice_line_id: string; tax_allocations?: { lot_id: string; gross_cents: number; tax_cents: number }[] })[]
 accounting_entries: InvoiceAccountingEntry[]
 label: string
}
export interface InvoiceCorrection { id: string; operation_id: string; reason: string; document: InvoiceCorrectionDocument }
export interface InvoiceWriteOff {
 id: string; operation_id: string; amount_cents: number; reason: string; dispute_reference: string; recorded_by: Stamp
 invoice_number: string; accounting_entries: InvoiceAccountingEntry[]; label: string
}
export interface InvoiceDepositApplication { id: string; deposit_invoice_id: string; amount_cents: number; recorded_by: Stamp }
export interface InvoiceDelivery {
 attempt_id: string; status: 'unknown' | 'accepted' | 'refused' | 'development' | 'unconfigured' | 'cancelled'
 label: string; to: string; approved_by: Stamp; provider_message_id?: string
}
export interface InvoiceBalance {
 gross_cents: number; withheld_cents: number; released_retainage_cents: number; payable_cents: number
 deposit_applied_cents: number; received_cents: number; due_cents: number
 correction_cents: number; credited_cents: number; debited_cents: number; written_off_cents: number
}
export interface Invoice {
 id: string; kind: 'deposit' | 'milestone' | 'cost_plus'; status: 'draft' | 'issued'; description: string
 due_on: string; terms: string; recipient_email: string; amount_cents: number; source_application_id?: string
 prepared_by: Stamp; source_digest: string; sources: InvoiceSources; lines: InvoiceTaxLine[]
 balance?: InvoiceBalance
 number?: string; issued?: InvoiceSnapshot; receipts: InvoiceReceipt[]; deposit_applications: InvoiceDepositApplication[]
 corrections?: InvoiceCorrection[]; write_offs?: InvoiceWriteOff[]
 acceptance?: { statement: string; accepted_by: Stamp; email: string; label: string }
 delivery?: InvoiceDelivery
}
export type InvoiceJob = Job & { invoices?: Invoice[] }
export const invoiceRows = (job: Job): Invoice[] => (job as InvoiceJob).invoices ?? []
