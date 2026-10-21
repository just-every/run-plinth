import type { Job, Stamp } from './model'
import type { BudgetRevision } from './budget-model'
import type { SovApplication, SovSources } from './sov-model'

export interface InvoiceTaxLine {
 id: string; description: string; source_id: string; source_revision: number; source_line_id?: string
 gross_cents: number; subtotal_cents: number; tax_cents: number
 reviewed_source_gross_cents: number; reviewed_source_tax_cents: number
}
export interface InvoiceSources {
 contract: SovSources; original_budget: BudgetRevision; current_budget: BudgetRevision
 allowance_changes: NonNullable<Job['variations'][number]['allowance_change']>[]
 application?: SovApplication
 retainage?: { state: NonNullable<Job['retainage']>; current: import('./retainage-model').RetainageSnapshot }
 tax_verification: 'Human reviewed source; no provider verification or legal certification'
 cost_uncertainty: string
}
export interface InvoiceSnapshot {
 format: 'plinth-invoice-v1'; number: string; issued_by: Stamp
 job_id: string; job_name: string; job_address: string; time_zone: string; currency: 'USD'
 kind: 'deposit' | 'milestone'; description: string; due_on: string; terms: string; recipient_email: string
 source_application_id?: string; gross_cents: number; withheld_cents: number; payable_cents: number
 earned_revenue_cents: number; subtotal_cents: number; tax_cents: number; lines: InvoiceTaxLine[]; sources: InvoiceSources
}
export interface InvoiceReceipt {
 id: string; amount_cents: number; received_on: string; reference: string; method: 'bank' | 'check'
 remittance_id?: string; reversal_of?: string
 recorded_by: Stamp; label: 'Recorded by staff; Plinth did not move or independently verify funds' | 'Return recorded by staff; allocation reversed, no funds moved or independently verified' | 'Return recorded by staff; receipt reversed, no funds moved or independently verified' | 'Return recorded by staff; partial receipt reversal, no funds moved or independently verified'
}
export interface InvoiceDepositApplication { id: string; deposit_invoice_id: string; amount_cents: number; recorded_by: Stamp }
export interface InvoiceDelivery {
 attempt_id: string; status: 'unknown' | 'accepted' | 'refused' | 'development' | 'unconfigured' | 'cancelled'
 label: string; to: string; approved_by: Stamp; provider_message_id?: string
}
export interface InvoiceBalance {
 gross_cents: number; withheld_cents: number; released_retainage_cents: number; payable_cents: number
 deposit_applied_cents: number; received_cents: number; due_cents: number
}
export interface Invoice {
 id: string; kind: 'deposit' | 'milestone'; status: 'draft' | 'issued'; description: string
 due_on: string; terms: string; recipient_email: string; amount_cents: number; source_application_id?: string
 prepared_by: Stamp; source_digest: string; sources: InvoiceSources; lines: InvoiceTaxLine[]
 balance?: InvoiceBalance
 number?: string; issued?: InvoiceSnapshot; receipts: InvoiceReceipt[]; deposit_applications: InvoiceDepositApplication[]
 acceptance?: { statement: string; accepted_by: Stamp; email: string; label: string }
 delivery?: InvoiceDelivery
}
export type InvoiceJob = Job & { invoices?: Invoice[] }
export const invoiceRows = (job: Job): Invoice[] => (job as InvoiceJob).invoices ?? []
