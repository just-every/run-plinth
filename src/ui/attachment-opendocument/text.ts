import { attr, Draft, fail, is, positive } from './common'
/** Read actual ODF text nodes and explicit whitespace elements, without markup matching. */
export function inlineText(root: Element, draft: Draft): string {
 const parts: string[] = []; let length = 0
 const add = (text: string) => { length += text.length; if (length > 100_000) fail('a stored paragraph exceeds 100,000 characters.'); parts.push(text) }
 function visit(node: Node) {
  if (node.nodeType === 3 || node.nodeType === 4) { add(node.nodeValue ?? ''); return }
  if (node.nodeType !== 1) return
  const element = node as Element
  if (element !== root && (is(element, 'office', 'annotation') || is(element, 'text', 'note') || is(element, 'draw') || is(element, 'table'))) return
  if (is(element, 'office', 'binary-data') || is(element, 'office', 'scripts') || is(element, 'text', 'script')) return
  if (is(element, 'text', 's')) { const count = positive(attr(element, 'text', 'c') || '1', 'A repeated space count'); if (count > 100_000) fail('a stored paragraph exceeds 100,000 characters.'); add(' '.repeat(count)); return }
  if (is(element, 'text', 'tab')) { add('\t'); return }
  if (is(element, 'text', 'line-break')) { add('\n'); return }
  for (const child of element.childNodes) visit(child)
 }
 visit(root)
 return parts.join('')
}
