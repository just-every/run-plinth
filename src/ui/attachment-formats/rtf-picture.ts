import { fail } from './common'

export class RtfPicture {
 type = ''
 private chunks: Uint8Array<ArrayBuffer>[] = []
 private length = 0
 private nibble = ''
 hex(bytes: Uint8Array) {
  const output: number[] = []
  for (const byte of bytes) {
   if ([9,10,13,32].includes(byte)) continue
   const character = String.fromCharCode(byte)
   if (!/[\da-f]/i.test(character)) fail('an RTF picture has malformed hexadecimal data.')
   this.nibble += character
   if (this.nibble.length === 2) { output.push(parseInt(this.nibble, 16)); this.nibble = '' }
   if (output.length >= 16384) { this.binary(Uint8Array.from(output)); output.length = 0 }
  }
  this.binary(Uint8Array.from(output))
 }
 binary(bytes: Uint8Array<ArrayBuffer>) {
  this.length += bytes.length
  if (this.length > 8 * 1024 * 1024) fail('an RTF picture exceeds 8 MiB.')
  this.chunks.push(bytes)
 }
 finish() {
  if (this.nibble) fail('an RTF picture has an incomplete hexadecimal byte.')
  const bytes = new Uint8Array(this.length)
  let offset = 0
  for (const chunk of this.chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return { bytes, type: this.type }
 }
}
