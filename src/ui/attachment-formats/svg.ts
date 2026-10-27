import { DOMParser, type Node, type Element } from '@xmldom/xmldom'
import type { OfficeHooks } from '../attachment-office/types'
import { Draft, fail } from './common'
import { bom, decodeText } from './encoding'
import { InlinePictures } from './raster'

const svgNamespace = 'http://www.w3.org/2000/svg'
const children = (node: Node) => Array.from({ length: node.childNodes?.length ?? 0 }, (_, index) => node.childNodes.item(index)!).filter(Boolean)
const externalCss = (text: string) => /@import/i.test(text) || [...text.matchAll(/url\(\s*['"]?([^)'"\s]+)[^)]*\)/gi)].some(match => !match[1].startsWith('#'))

export async function extractSvg(bytes: Uint8Array<ArrayBuffer>, hooks: OfficeHooks) {
 if (bytes.length > 8 * 1024 * 1024) fail('SVG exceeds the 8 MiB inert parsing limit.')
 const prefix = String.fromCharCode(...bytes.subarray(0, 512)), encoding = bom(bytes) ?? /<\?xml[^>]*encoding\s*=\s*['"]([\w-]+)['"]/i.exec(prefix)?.[1] ?? 'utf-8'
 const source = decodeText(bytes, encoding).text, draft = new Draft(hooks), pictures = new InlinePictures(draft)
 if (/<!\s*(DOCTYPE|ENTITY)/i.test(source) || /<\?xml-stylesheet/i.test(source)) fail('SVG document types, entity declarations and external stylesheets are unsupported.')
 let markup = 0
 for (const character of source) if (character === '<' && ++markup > 100_000) fail('SVG exceeds the bounded markup item limit.')
 const document = new DOMParser({ onError: () => fail('SVG XML is malformed.') }).parseFromString(source, 'application/xml')
 if (document.documentElement?.localName !== 'svg' || document.documentElement.namespaceURI !== svgNamespace) fail('the file is not a supported SVG document.')
 const stack: { node: Node; depth: number; text: boolean; skip: boolean }[] = [{ node: document.documentElement, depth: 0, text: false, skip: false }]
 const parts: string[] = [], images: string[] = []
 let count = 0
 while (stack.length) {
  hooks.check()
  const current = stack.pop()!
  if (++count > 100_000 || current.depth > 256) fail('SVG exceeds 100,000 nodes or nesting depth 256.')
  if ([3,4].includes(current.node.nodeType) && current.text && !current.skip) parts.push(current.node.nodeValue ?? '')
  let text = current.text, skip = current.skip
  if (current.node.nodeType === 1) {
   const element = current.node as Element
   if (element.namespaceURI !== svgNamespace || ['script','foreignObject','style'].includes(element.localName ?? '')) {
    skip = true; draft.notes.add('SVG scripts, styles and foreign markup were not executed or extracted.')
   }
   for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index)!, value = attribute.value.trim()
    if (['href','src','data','poster'].includes(attribute.localName ?? '') && value && !value.startsWith('#') && !/^data:image\/(png|jpeg);base64,/i.test(value)) fail('SVG contains an external or unsupported reference. No resources were fetched.')
    if (attribute.localName === 'srcset' && value || externalCss(value)) fail('SVG has an external style or image resource. No resources were fetched.')
   }
   if (element.localName === 'style' && externalCss(element.textContent ?? '')) fail('SVG style resources are unsupported. No resources were fetched.')
   if (!skip && ['text','title','desc'].includes(element.localName ?? '')) { text = true; parts.push('\n') }
   if (!skip && element.localName === 'image') {
    const uri = element.getAttribute('href') ?? element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? ''
    if (uri.startsWith('data:')) images.push(uri)
    else draft.notes.add('SVG local image references were not rendered. Only inline PNG and JPEG picture data is read.')
    if (images.length > 40) fail('SVG contains more than 40 inline pictures.')
   }
   if (!skip && element.localName === 'use') draft.notes.add('SVG reused definitions were not instantiated. Stored definition text may be included once rather than at each visual use.')
  }
  hooks.boundedText(parts.join(''))
  const nested = children(current.node)
  for (let index = nested.length - 1; index >= 0; index--) stack.push({ node: nested[index], depth: current.depth + 1, text, skip })
 }
 draft.add('SVG stored text', parts.join(''))
 for (let index = 0; index < images.length; index++) await pictures.data(images[index], `SVG picture ${index + 1}`)
 draft.notes.add('SVG was parsed locally without rendering. Stored text, titles, descriptions and supported inline raster pictures are included. Paths, outlined glyphs, filters, generated content, positioning, animation and visual reading order are not interpreted.')
 return draft.result()
}
