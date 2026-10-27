import type { OfficeResult } from '../attachment-office/types'
export type LegacyFormat = 'doc' | 'xls' | 'ppt'
export type Request = { bytes: ArrayBuffer; format: LegacyFormat }
export type Reply = { progress: string } | { result: OfficeResult } | { error: string }
export class LegacyError extends Error {
 constructor(message: string) { super(`Legacy extraction: ${message}`); this.name = 'LegacyError' }
}
export function fail(message: string): never { throw new LegacyError(message) }
export function bounded(text: string): string {
 if (text.length > 100_000) fail('stored text exceeds 100,000 characters. Nothing was copied.')
 return text
}
export const LIMITS = 'Limits: 20 MiB original, 4,096 compound directory entries, 100,000 binary records, 250,000 allocated spreadsheet cells, nesting depth 64, 200,000 structured nodes, 256 MiB WASM linear memory, 100,000 output characters and five minutes. The browser also holds bounded input and result copies.'
