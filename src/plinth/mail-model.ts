import type { Bindings } from '../auth.server'
import { need } from './model'

/** INT-007: a message is required transactional mail or an optional notice; only optional notices honour an unsubscribe. */
export const mailKinds = {
 proposal: { required: true, label: 'Proposal' },
 selection_request: { required: true, label: 'Selection request' },
 invoice: { required: true, label: 'Invoice' },
 selection_reminder: { required: false, label: 'Selection reminder' },
 reminder: { required: false, label: 'Reminder' },
 update: { required: false, label: 'Job update' },
 message: { required: false, label: 'Message' },
} as const
export type MailKind = keyof typeof mailKinds
export type MailStatus = 'unknown' | 'accepted' | 'deferred' | 'delivered' | 'unsubscribed' | 'bounced' | 'complained' | 'refused' | 'unconfigured' | 'cancelled' | 'development' | 'suppressed' | 'received' | 'note'
export interface MailMessage {
 id: string; job_id: string; direction: 'out' | 'in' | 'note'; visibility: 'client' | 'private'; kind: string; required: boolean; counterparty: string
 reply_to?: string | null
 subject: string; body: string; status: MailStatus; label: string; provider_message_id: string | null; reply_to_id: string | null; sender_check: string | null
 by_id: string; by_name: string; created_at: string; status_at: string; files: { id: string; name: string; mime: string; size: number }[]
}
/** A delivery state only moves forward, so a retried or reordered provider event can never undo a worse one. */
export const mailRank: Record<string, number> = { unknown: 0, accepted: 1, deferred: 2, delivered: 3, unsubscribed: 4, bounced: 5, complained: 6 }
export const mailLimits = { maxRawBytes: 10 * 1024 * 1024, maxBodyBytes: 200_000, maxAttachments: 10, maxAttachmentBytes: 2 * 1024 * 1024, maxTotalAttachmentBytes: 8 * 1024 * 1024 }
const encoder = new TextEncoder()
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
async function mac(env: Bindings, purpose: string, value: string, length: number) {
 const key = await crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
 return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`plinth-mail:${purpose}:${value}`))).slice(0, length)
}
const equal = (a: string, b: string) => a.length === b.length && [...a].reduce((d, c, i) => d | c.charCodeAt(0) ^ b.charCodeAt(i), 0) === 0
/** The reply address names one message and its one recipient: only that recipient holds it, so it is the capability to reply into that thread. */
export async function replyAddress(env: Bindings, messageId: string, recipient: string): Promise<string | null> {
 if (!env.MAIL_REPLY_DOMAIN) return null
 return `r.${messageId.replaceAll('-', '')}.${await mac(env, 'reply', `${messageId}:${recipient.toLowerCase()}`, 20)}@${env.MAIL_REPLY_DOMAIN}`
}
export async function parseReplyAddress(env: Bindings, address: string): Promise<{ messageId: string; mac: string } | null> {
 const match = /^r\.([0-9a-f]{32})\.([0-9a-f]{20})@([^@]+)$/i.exec(address.trim())
 if (!match || !env.MAIL_REPLY_DOMAIN || match[3]!.toLowerCase() !== env.MAIL_REPLY_DOMAIN.toLowerCase()) return null
 const id = match[1]!.toLowerCase(); return { messageId: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`, mac: match[2]!.toLowerCase() }
}
export async function replyMatches(env: Bindings, messageId: string, recipient: string, given: string) { return equal(await mac(env, 'reply', `${messageId}:${recipient.toLowerCase()}`, 20), given) }
/** A signed link in each optional notice; it unsubscribes exactly that mailbox from optional notices and nothing else. */
export async function unsubscribeToken(env: Bindings, email: string): Promise<string> {
 const lower = email.toLowerCase()
 return `${btoa(lower).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}.${await mac(env, 'unsubscribe', lower, 32)}`
}
export async function unsubscribeEmail(env: Bindings, token: string): Promise<string | null> {
 const [encoded, given] = token.split('.')
 if (!encoded || !given || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null
 let email: string
 try { email = atob(encoded.replaceAll('-', '+').replaceAll('_', '/')) } catch { return null }
 return equal(await mac(env, 'unsubscribe', email, 32), given) ? email : null
}
export const plain = (value: unknown, label: string, max: number) => { need(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), `${label} is required (up to ${max} characters)`); return (value as string).trim() }
export const oneLine = (value: string) => value.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim()
/** Every optional notice carries the same signed link, in its text and, where the origin is HTTPS, in the one-click unsubscribe headers. */
export async function optionalNotice(env: Bindings, email: string) {
 const link = `${env.AUTH_ORIGIN}/api/plinth/mail/unsubscribe/${await unsubscribeToken(env, email)}`
 return { text: `\n\n--\nTo stop optional notices like this one from this builder, open: ${link}`, ...(link.startsWith('https://') ? { unsubscribe: { url: link, oneClick: true } } : {}) }
}
