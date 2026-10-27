import { attr, elements, fail, is } from './common'
import type { OpenPackage } from './package'
import { Pictures } from './pictures'
import { readTable } from './table'
import { inlineText } from './text'
export class Reader {
 private pictures: Pictures
 private pages = 0
 private tables = 0
 constructor(private office: OpenPackage) { this.pictures = new Pictures(office) }
 async walk(element: Element, label: string): Promise<void> {
  const { draft } = this.office
  await draft.step()
  if (is(element, 'office', 'scripts') || is(element, 'text', 'script')) { draft.notes.add('Stored scripts and macros were not executed or interpreted.'); return }
  if (attr(element, 'xlink', 'href') && !is(element, 'draw', 'image')) {
   const href = attr(element, 'xlink', 'href')
   if (href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href)) draft.notes.add('External hyperlinks, linked data and linked media were not followed.')
  }
  if (is(element, 'draw', 'object') || is(element, 'draw', 'object-ole') || is(element, 'draw', 'plugin') || is(element, 'draw', 'applet') || is(element, 'draw', 'floating-frame')) {
   draft.notes.add('Embedded documents, charts, OLE objects, media and frames were not recursively opened. Their native content may be absent.'); return
  }
  if (is(element, 'office', 'binary-data')) return
  if (is(element, 'draw', 'image') || is(element, 'style', 'background-image') || is(element, 'draw', 'fill-image')) { await this.pictures.image(element, label); return }
  if (is(element, 'table', 'table')) { await readTable(element, draft, (child, title) => this.walk(child, title), `${label} · table ${++this.tables}`); return }
  if (is(element, 'draw', 'page')) label = `Slide ${++this.pages}${attr(element, 'draw', 'name') ? ` · ${attr(element, 'draw', 'name')}` : ''}`
  if (is(element, 'presentation', 'notes')) label += ' · speaker notes'
  if (is(element, 'presentation') && ['header-decl', 'footer-decl', 'date-time-decl'].includes(element.localName)) {
   draft.add(`${label} · stored ${element.localName}`, inlineText(element, draft)); return
  }
  if (is(element, 'office', 'annotation')) {
   const author = elements(element, 'dc', 'creator')[0]?.textContent ?? '', date = elements(element, 'dc', 'date')[0]?.textContent ?? ''
   label += ` · comment${author ? ` by ${author}` : ''}${date ? ` · ${date}` : ''}`
  }
  if (is(element, 'text', 'note')) {
   const citation = elements(element, 'text', 'note-citation')[0]?.textContent ?? ''
   label += ` · ${attr(element, 'text', 'note-class') || 'note'}${citation ? ` ${citation}` : ''}`
   for (const child of element.children) if (is(child, 'text', 'note-body')) await this.walk(child, label)
   return
  }
  if (is(element, 'text', 'tracked-changes')) { label += ' · stored change history'; draft.notes.add('Stored change history is included where present. Current accepted wording and deleted revisions need review against the original.') }
  if (is(element, 'style') && ['header', 'header-left', 'header-first', 'footer', 'footer-left', 'footer-first'].includes(element.localName)) label += ` · ${element.localName}${attr(element, 'style', 'display') === 'false' ? ' · stored disabled' : ''}`
  if (is(element, 'text', 'p') || is(element, 'text', 'h')) draft.add(label, inlineText(element, draft))
  for (const child of element.children) await this.walk(child, label)
 }
 async backgrounds(document: Document, label: string) {
  for (const image of [...elements(document, 'style', 'background-image'), ...elements(document, 'draw', 'fill-image')]) await this.pictures.image(image, label)
 }
 async styles() {
  const { archive, draft } = this.office
  if (!archive.has('styles.xml')) { draft.notes.add('No styles.xml part was stored; shared master headers and footers were not available.'); return }
  const document = await this.office.xml('styles.xml')
  if (!is(document.documentElement, 'office', 'document-styles')) fail('styles.xml has an unsupported root.')
  await this.backgrounds(document, 'Stored master background or fill')
  const masters = elements(document, 'style', 'master-page')
  if (masters.length > 200) fail('more than 200 stored master pages are unsupported.')
  for (const master of masters) await this.walk(master, `Stored master ${attr(master, 'style', 'name') || 'page'}`)
  if (masters.length) draft.notes.add('Stored master content and headers or footers are read once. Page repetition, active master selection and visual layout are not reproduced.')
 }
}
