import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap } from 'parse5'
import type { OfficeHooks } from '../attachment-office/types'
import { Draft, fail } from './common'
import { bom, decodeText } from './encoding'
import { InlinePictures } from './raster'

type Node = DefaultTreeAdapterMap['node']
const blocked = new Set(['script','style','template','iframe','object','embed'])
const block = new Set(['p','div','section','article','header','footer','h1','h2','h3','h4','h5','h6','ul','ol','li','tr','table','blockquote','pre','br','hr'])

function declaredEncoding(bytes: Uint8Array) {
 if (bom(bytes)) return bom(bytes)!
 const prefix = String.fromCharCode(...bytes.subarray(0, 4096)), tree = parse(prefix, { scriptingEnabled: false }), stack: Node[] = [tree]
 while (stack.length) {
  const node = stack.pop()!
  if ('tagName' in node && node.tagName === 'meta') {
   const attrs = new Map(node.attrs.map(attribute => [attribute.name, attribute.value]))
   if (attrs.has('charset')) return attrs.get('charset')!
   if (attrs.get('http-equiv')?.toLowerCase() === 'content-type') {
    const match = /charset\s*=\s*["']?([\w-]+)/i.exec(attrs.get('content') ?? '')
    if (match) return match[1]
   }
  }
  if ('childNodes' in node) stack.push(...node.childNodes)
 }
 return 'utf-8'
}

export async function extractHtml(bytes: Uint8Array<ArrayBuffer>, hooks: OfficeHooks) {
 if (bytes.length > 8 * 1024 * 1024) fail('HTML exceeds the 8 MiB inert parsing limit.')
 const decoded = decodeText(bytes, declaredEncoding(bytes)), draft = new Draft(hooks), pictures = new InlinePictures(draft)
 let created = 0
 const treeAdapter = { ...defaultTreeAdapter, createElement(...args: Parameters<typeof defaultTreeAdapter.createElement>) {
  if (++created > 100_000) fail('HTML exceeds 100,000 parsed elements.')
  return defaultTreeAdapter.createElement(...args)
 } }
 const document = parse(decoded.text, { scriptingEnabled: false, treeAdapter }), stack: { node: Node; depth: number; end?: boolean }[] = [{ node: document, depth: 0 }]
 const text: string[] = [], images: string[] = []
 let count = 0
 while (stack.length) {
  hooks.check()
  const { node, depth, end } = stack.pop()!
  if (end) { text.push('\n'); continue }
  if (++count > 100_000 || depth > 256) fail('HTML exceeds 100,000 nodes or nesting depth 256.')
  if (node.nodeName === '#text' && 'value' in node) text.push(node.value)
  if ('tagName' in node) {
   const attrs = new Map(node.attrs.map(attribute => [attribute.name, attribute.value]))
   if (blocked.has(node.tagName)) { draft.notes.add('Scripts, styles, templates, frames and embedded active content were omitted and never executed or loaded.'); continue }
   if (block.has(node.tagName)) { text.push('\n'); stack.push({ node, depth, end: true }) }
   if (['td','th'].includes(node.tagName)) text.push('\t')
   if (node.tagName === 'img' || node.tagName === 'image') {
    const uri = attrs.get('src') ?? attrs.get('href') ?? ''
    if (attrs.get('alt')) text.push(` ${attrs.get('alt')} `)
    if (uri.startsWith('data:')) {
     if (images.length >= 40) fail('HTML contains more than 40 inline pictures.')
     images.push(uri)
    } else draft.notes.add('Linked HTML pictures and other external resources were not fetched. Only stored text and supported inline PNG and JPEG data are read.')
   }
  }
  hooks.boundedText(text.join(''))
  if ('childNodes' in node) for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push({ node: node.childNodes[index], depth: depth + 1 })
 }
 draft.add('HTML stored text', text.join(''))
 for (let index = 0; index < images.length; index++) await pictures.data(images[index], `HTML picture ${index + 1}`)
 draft.notes.add(`HTML was decoded as ${decoded.encoding} using an inert parser. Source order, hidden text and form choices may differ from the rendered page. CSS layout, generated content, linked resources and active content were not rendered.`)
 return draft.result()
}
