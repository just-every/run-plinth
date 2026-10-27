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
export const LIMITS = 'Legacy Office limits: 20 MiB original, 250,000 spreadsheet cells, 100,000 output characters and five minutes. Very complex or structurally unsupported originals are refused.'
