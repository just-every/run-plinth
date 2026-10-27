import type { OfficeHooks, OfficeResult } from '../attachment-office/types'
export const NS = {
 office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
 table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0', style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
 draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
 manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0', xlink: 'http://www.w3.org/1999/xlink', dc: 'http://purl.org/dc/elements/1.1/',
}
export type Space = keyof typeof NS
export const is = (element: Element, space: Space, name?: string) => element.namespaceURI === NS[space] && (!name || element.localName === name)
export const attr = (element: Element, space: Space, name: string) => element.getAttributeNS(NS[space], name) ?? ''
export const elements = (root: Document | Element, space: Space, name: string) => [...root.getElementsByTagNameNS(NS[space], name)]
export class OpenDocumentError extends Error { constructor(message: string) { super(`OpenDocument extraction: ${message}`); this.name = 'OpenDocumentError' } }
export function fail(message: string): never { throw new OpenDocumentError(message) }
export function positive(value: string, label: string) {
 if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 1_000_000_000) fail(`${label} is invalid or exceeds its supported range.`)
 return Number(value)
}
export class Draft {
 private parts: string[] = []
 readonly notes = new Set<string>()
 private visited = 0
 private started = Date.now()
 constructor(readonly hooks: OfficeHooks) {}
 check() { this.hooks.check(); if (Date.now() - this.started > 300_000) fail('the five minute reading limit was reached. Nothing was copied.') }
 async step() { this.check(); if (++this.visited % 200 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); this.check() } }
 add(label: string, text: string) {
  this.check()
  if (!text.trim()) return
  this.parts.push(`${label}\n${text.trim()}`)
  this.bound(this.parts.join('\n\n'))
 }
 bound(text: string) {
  if (text.length > 100_000) fail('stored text exceeds 100,000 characters. Nothing was copied.')
  return this.hooks.boundedText(text)
 }
 result(): OfficeResult { return { text: this.bound(this.parts.join('\n\n')), notes: [...this.notes] } }
}
