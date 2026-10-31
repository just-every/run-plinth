import { fail } from './types'

export const NS = {
 word: ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'],
 sheet: ['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main'],
 slide: ['http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main'],
 drawing: ['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main'],
 rel: ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'],
 threaded: ['http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments'],
}
export type Space = keyof typeof NS
export const inSpace = (element: Element, space: Space) => NS[space].includes(element.namespaceURI ?? '')
export const elements = (root: Document | Element, name: string, space?: Space) => [...root.getElementsByTagNameNS('*', name)].filter(element => !space || inSpace(element, space))
export const attr = (element: Element, name: string, space?: Space) => space
 ? [...element.attributes].find(attribute => attribute.localName === name && NS[space].includes(attribute.namespaceURI ?? ''))?.value ?? ''
 : element.getAttribute(name) ?? ''

export function parseXml(bytes: Uint8Array, check: () => void): Document {
 check()
 let source: string
 try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
 catch { return fail('package XML must be valid UTF-8.') }
 if (/<!\s*(DOCTYPE|ENTITY)/i.test(source)) fail('XML declarations that define entities or document types are unsupported.')
 const document = new DOMParser().parseFromString(source, 'application/xml')
 if (!document.documentElement || document.getElementsByTagNameNS('*', 'parsererror').length) fail('a package XML part is malformed.')
 const stack: [Element, number][] = [[document.documentElement, 0]]
 let count = 0
 while (stack.length) {
  const [element, depth] = stack.pop()!
  if (++count > 100_000 || depth > 256) fail('a package XML part exceeds 100,000 elements or 256 nested levels.')
  if (count % 1000 === 0) check()
  for (const child of element.children) stack.push([child, depth + 1])
 }
 return document
}

export function storedText(root: Element, space: 'word' | 'drawing'): string {
 const parts: string[] = []
 function visit(element: Element) {
  const own = inSpace(element, space), drawing = inSpace(element, 'drawing')
  if ((own && ['t', 'delText', 'instrText'].includes(element.localName)) || (drawing && element.localName === 't')) {
   parts.push(element.textContent ?? ''); return
  }
  if (own && element.localName === 'tab') parts.push('\t')
  if (own && ['br', 'cr'].includes(element.localName)) parts.push('\n')
  if (own && element.localName === 'txbxContent') parts.push('\nText box\n')
  for (const child of element.children) visit(child)
  if ((own || drawing) && ['p', 'tr', 'txbxContent'].includes(element.localName)) parts.push('\n')
  if (own && element.localName === 'tc') parts.push('\t')
 }
 visit(root)
 return parts.join('').trim()
}
