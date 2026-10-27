import { fail } from './common'

export type Token = { kind: 'open' | 'close' } | { kind: 'bytes' | 'binary'; bytes: Uint8Array<ArrayBuffer> } | { kind: 'word'; name: string; value?: number } | { kind: 'symbol'; name: string }
const letter = (byte: number) => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122
const digit = (byte: number) => byte >= 48 && byte <= 57

export function* tokens(bytes: Uint8Array<ArrayBuffer>): Generator<Token> {
 for (let at = 0; at < bytes.length;) {
  const byte = bytes[at++]
  if (byte === 123 || byte === 125) { yield { kind: byte === 123 ? 'open' : 'close' }; continue }
  if (byte === 10 || byte === 13) continue
  if (byte !== 92) {
   const start = at - 1
   while (at < bytes.length && ![92,123,125,10,13].includes(bytes[at])) at++
   yield { kind: 'bytes', bytes: bytes.subarray(start, at) }; continue
  }
  if (at === bytes.length) fail('an RTF escape is truncated.')
  const next = bytes[at++]
  if (next === 39) {
   const hex = String.fromCharCode(...bytes.subarray(at, at + 2))
   if (!/^[\da-f]{2}$/i.test(hex)) fail('an RTF byte escape is malformed.')
   at += 2; yield { kind: 'bytes', bytes: Uint8Array.of(parseInt(hex, 16)) }; continue
  }
  if (!letter(next)) { yield { kind: 'symbol', name: String.fromCharCode(next) }; continue }
  const start = at - 1
  while (letter(bytes[at])) at++
  if (at - start > 32) fail('an RTF control word exceeds 32 letters.')
  const name = String.fromCharCode(...bytes.subarray(start, at)), number = at
  if (bytes[at] === 45) at++
  const firstDigit = at
  while (digit(bytes[at])) at++
  if (at - firstDigit > 10 || (number !== firstDigit && at === firstDigit)) fail('an RTF control parameter is invalid.')
  const value = at > firstDigit ? Number(String.fromCharCode(...bytes.subarray(number, at))) : undefined
  if (value !== undefined && !Number.isSafeInteger(value)) fail('an RTF numeric parameter is invalid.')
  if (bytes[at] === 32) at++
  if (name === 'bin') {
   if (value === undefined || value < 0 || at + value > bytes.length) fail('RTF binary data is truncated or invalid.')
   yield { kind: 'binary', bytes: bytes.subarray(at, at + value) }; at += value
  } else yield { kind: 'word', name, value }
 }
}
