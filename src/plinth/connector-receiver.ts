import { isIP } from 'node:net'
import { need, text } from './model'
import type { Bindings } from '../auth.server'

/** Only globally routable addresses may receive installation references. */
function publicAddress(address: string): boolean {
 if (isIP(address) === 4) {
  const [a, b, c] = address.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
   a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
   a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) ||
   a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113)
 }
 if (isIP(address) !== 6) return false
 const canonical = new URL(`https://[${address}]/`).hostname.slice(1, -1)
 const [first, second = 0] = canonical.split(':').map(part => parseInt(part || '0', 16))
 // Exclude special-purpose, documentation and transition ranges as well as local addresses.
 return first >= 0x2000 && first <= 0x3fff &&
  !(first === 0x2001 && (second < 0x200 || second === 0xdb8) || first === 0x2002 || first === 0x3fff)
}

export function receiverUrl(env: Bindings, value: unknown): URL {
 let url: URL
 try { url = new URL(text(value, 'receiver', 2000)) } catch { need(false, 'Enter a valid receiver URL') }
 const allowed = (env.PLINTH_WEBHOOK_ORIGINS ?? '').split(',').map(origin => origin.trim())
 need(url.protocol === 'https:' && !url.username && !url.password && !url.hash && allowed.includes(url.origin), 'Receiver origin must be explicitly configured by the installation owner', 403, 'receiver_origin')
 const host = url.hostname.replace(/^\[|\]$/g, '')
 need(isIP(host) ? publicAddress(host) : host.includes('.') && !/(^|\.)(localhost|local|internal|home|test|invalid)$/.test(host.replace(/\.$/, '')), 'Receiver must have a public address', 403, 'receiver_origin')
 return url
}

/** Resolve afresh at registration and at the send fence; resolution failure denies delivery. */
export async function publicReceiver(env: Bindings, value: unknown): Promise<string> {
 const url = receiverUrl(env, value), host = url.hostname.replace(/^\[|\]$/g, '')
 if (!isIP(host)) {
  let addresses: string[] = []
  try {
   const answers = await Promise.all(['A', 'AAAA'].map(async type => {
    const query = new URL('https://cloudflare-dns.com/dns-query')
    query.searchParams.set('name', host); query.searchParams.set('type', type)
    const response = await fetch(query, {headers: {accept: 'application/dns-json'}, redirect: 'manual', signal: AbortSignal.timeout(5000)})
    if (!response.ok) throw Error('DNS unavailable')
    const result = await response.json() as {Status: number; Answer?: {type: number; data: string}[]}
    if (result.Status !== 0) throw Error('DNS unavailable')
    return (result.Answer ?? []).filter(answer => answer.type === 1 || answer.type === 28).map(answer => answer.data)
   }))
   addresses = answers.flat()
  } catch { /* A failed lookup cannot authorize an outbound attempt. */ }
  need(addresses.length > 0 && addresses.every(publicAddress), 'Receiver must resolve exclusively to public addresses', 403, 'receiver_origin')
 }
 return url.href
}
