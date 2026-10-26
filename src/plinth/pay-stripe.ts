import type { Bindings } from '../auth.server'
import { DomainError } from './model'

/** Stripe's form encoding: nested objects and arrays become bracketed keys. */
export function formBody(value: Record<string, unknown>): string {
 const pairs: string[] = []
 const walk = (prefix: string, v: unknown) => {
  if (v === undefined || v === null) return
  if (Array.isArray(v)) v.forEach((item, n) => walk(`${prefix}[${n}]`, item))
  else if (typeof v === 'object') for (const [k, item] of Object.entries(v)) walk(`${prefix}[${k}]`, item)
  else pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`)
 }
 for (const [k, v] of Object.entries(value)) walk(k, v)
 return pairs.join('&')
}
/** One call to the fixed Stripe origin with the builder's key. Provider bodies never reach the caller, so no error can echo a secret or card detail. */
export async function stripeCall<T>(env: Bindings, path: string, options: { body?: Record<string, unknown>; idempotencyKey?: string } = {}): Promise<T> {
 if (!env.STRIPE_SECRET_KEY) throw new DomainError('payments_unconfigured', 'Online payment is not set up for this builder', 409)
 let response: Response
 try {
  response = await fetch(`https://api.stripe.com/v1${path}`, {
   method: options.body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(15_000),
   headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(options.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}) },
   ...(options.body ? { body: formBody(options.body) } : {}),
  })
 } catch { throw new DomainError('payment_provider', 'Stripe could not be reached; the instruction remains unresolved until reconciliation', 502) }
 if (!response.ok) { await response.body?.cancel(); throw new DomainError('payment_provider', 'Stripe did not confirm the instruction; reconcile before trying again', 502) }
 try { return await response.json() as T } catch { throw new DomainError('payment_provider', 'Stripe returned an unreadable answer', 502) }
}
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
const same = (a: string, b: string) => a.length === b.length && [...a].reduce((d, c, i) => d | c.charCodeAt(0) ^ b.charCodeAt(i), 0) === 0
/** Stripe-Signature: t=timestamp,v1=hex HMAC-SHA256 of "timestamp.rawbody" under the endpoint secret; any valid v1 inside the tolerance passes. */
export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now: number, toleranceSeconds = 300): Promise<boolean> {
 if (!header) return false
 const parts = header.split(',').map(p => p.trim().split('=') as [string, string]), t = parts.find(([k]) => k === 't')?.[1]
 if (!t || !/^\d{1,12}$/.test(t) || Math.abs(now / 1000 - Number(t)) > toleranceSeconds) return false
 const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
 const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`)))
 return parts.some(([k, v]) => k === 'v1' && v !== undefined && same(v, expected))
}
export interface CheckoutSession { id: string; url: string | null; livemode: boolean; payment_status?: string; status?: string; expires_at?: number; payment_intent?: string | null; amount_total?: number; currency?: string; client_reference_id?: string | null; metadata?: Record<string, string> }
export interface StripeDispute { id: string; status: string; amount: number; reason?: string; payment_intent?: string; charge?: string }
export interface StripeRefund { id: string; status: string; amount: number; payment_intent?: string; charge?: string; metadata?: Record<string, string> }
export interface StripeCharge {
 id: string; status?: string; amount: number; amount_refunded?: number; refunded?: boolean; disputed?: boolean; failure_code?: string | null
 payment_intent?: string; metadata?: Record<string, string>; dispute?: StripeDispute | string | null
 refunds?: { data: StripeRefund[] }; payment_method_details?: { type?: string; card?: { wallet?: { type?: string } | null } }
 balance_transaction?: { fee?: number } | string | null
}
export interface PaymentIntent { id: string; status: string; amount: number; amount_received: number; currency: string; livemode: boolean; metadata?: Record<string, string>; latest_charge?: StripeCharge | string | null }
