import { DomainError, need, object, type Input } from './model'

/** Bound JSON before decoding; malformed or oversized originals never reach domain actions. */
export async function jobRequest(request: Request, maximum = 4_000_000): Promise<Input> {
 need((request.headers.get('content-type') ?? '').split(';')[0] === 'application/json', 'Send application/json', 415, 'content_type')
 const reader = request.body?.getReader(); need(reader, 'JSON body is required')
 const chunks: Uint8Array[] = []; let size = 0
 for (;;) {
  const next = await reader.read(); if (next.done) break
  size += next.value.byteLength
  if (size > maximum) { await reader.cancel(); need(false, 'Request is too large', 413, 'body_size') }
  chunks.push(next.value)
 }
 const bytes = new Uint8Array(size); let offset = 0
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
 try { return object(JSON.parse(new TextDecoder().decode(bytes))) }
 catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('invalid_json', 'Invalid JSON body') }
}
