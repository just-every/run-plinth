export type PaymentStatus = 'open' | 'processing' | 'paid' | 'failed' | 'expired' | 'review'
export interface PaymentAttempt {
 id: string; job_id: string; invoice_id: string; amount_cents: number; currency: 'usd'; status: PaymentStatus; label: string; client_email: string
 session_id: string | null; checkout_url: string | null; payment_intent_id: string | null; method: string | null; wallet: string | null
 fee_cents: number | null; livemode: number | null; receipt_id: string | null; created_by: string; created_at: string; updated_at: string
}
export const attemptColumns = 'id,job_id,invoice_id,amount_cents,currency,status,label,client_email,session_id,checkout_url,payment_intent_id,method,wallet,fee_cents,livemode,receipt_id,created_by,created_at,updated_at'
const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
/** What the client reads before they leave for the processor, and what the builder's record says about fees. */
export const feeStatement = 'No processing fee is added to your payment. Card (including Apple Pay and Google Pay where your device offers them) and US bank transfer payments are processed by Stripe, and the builder pays the processor fee.'
export const authorization = (cents: number, number: string, builder: string) => `You authorize ${builder} to collect ${usd(cents)} for invoice ${number} by card or US bank account through Stripe. Your card or bank details are entered on Stripe's page and never reach Plinth.`
export const settledLabel = 'Settled by the processor and recorded from a signed Stripe event; Plinth did not hold the funds' as const
/** The client's view of an attempt: no fee, no internal ids beyond the processor references on the receipt. */
export const clientAttempt = (a: PaymentAttempt) => ({ id: a.id, invoice_id: a.invoice_id, amount_cents: a.amount_cents, status: a.status, label: a.label, method: a.method, wallet: a.wallet, created_at: a.created_at, updated_at: a.updated_at, livemode: a.livemode === 1 })
