import type { OfficePackage } from './package'
import { fail } from './types'
import { attr, elements, inSpace, storedText } from './xml'

const namespaces = ['http://schemas.openxmlformats.org/drawingml/2006/chart', 'http://purl.oclc.org/ooxml/drawingml/chart']
const chart = (element: Element) => namespaces.includes(element.namespaceURI ?? '')
const children = (element: Element, name: string) => [...element.children].filter(child => chart(child) && child.localName === name)
const cacheNames = new Set(['strCache','numCache','strLit','numLit','multiLvlStrCache'])
const contexts: Record<string, string> = { cat: 'categories', val: 'values', xVal: 'X values', yVal: 'Y values', bubbleSize: 'bubble sizes', plus: 'positive errors', minus: 'negative errors' }

function index(value: string) {
 if (!/^\d+$/.test(value) || Number(value) > 100_000) fail('a chart point index or count is invalid or exceeds 100,000.')
 return Number(value)
}

export async function extractChart(office: OfficePackage, part: string, label: string): Promise<void> {
 const { draft } = office
 draft.hooks.check(); draft.hooks.progress(`Reading stored chart data for ${label}…`)
 const document = await office.xml(part), root = document.documentElement
 if (root.localName !== 'chartSpace') fail('a chart part has an unsupported root structure.')
 if (!chart(root)) { draft.notes.add(`A chart extension in ${label} is unsupported. Its stored content was not read.`); return }
 if (children(root, 'chart').length !== 1) fail('a classic chart part must contain one chart.')
 const relations = await office.rels(part)
 for (const relation of relations.values()) {
  draft.hooks.check()
  if (relation.external) draft.notes.add(`Linked chart data in ${label} was not fetched. Stored caches may be stale or incomplete.`)
  else if (['package','oleObject'].includes(relation.kind)) draft.notes.add(`The embedded chart workbook or object in ${label} was not opened. Only values stored in the chart itself are read.`)
  else if (relation.kind !== 'image') draft.notes.add(`Related chart resources in ${label} were not rendered or extracted. Only text and data stored in the chart part are read.`)
 }
 const stack: { element: Element; context: string }[] = [{ element: root, context: `${label} chart` }]
 let series = 0, titles = 0, points = 0
 function readCache(cache: Element, context: string) {
  const declared = children(cache, 'ptCount')
  if (declared.length > 1) fail('a chart cache has duplicated point counts.')
  const count = declared.length ? index(attr(declared[0], 'val')) : undefined
  const levels = cache.localName === 'multiLvlStrCache' ? children(cache, 'lvl') : [cache]
  if (levels.length > 100) fail('a chart category cache exceeds 100 levels.')
  if (!levels.length) draft.notes.add(`A multilevel chart cache in ${label} has no stored category levels.`)
  for (let level = 0; level < levels.length; level++) {
   const seen = new Set<number>(), rows: string[] = [], saved = children(levels[level], 'pt')
   for (const point of saved) {
    draft.hooks.check()
    if (++points > 20_000) fail('a chart exceeds 20,000 stored cache points.')
    const at = index(attr(point, 'idx')), values = children(point, 'v')
    if (seen.has(at) || values.length !== 1 || count !== undefined && at >= count) fail('chart cache point indexes or stored values are inconsistent.')
    seen.add(at)
    const format = attr(point, 'formatCode')
    rows.push(`Point ${at}: ${values[0].textContent ?? ''}${format ? ` (stored format ${format})` : ''}`)
    draft.hooks.boundedText(rows.join('\n'))
   }
   if (count !== undefined && saved.length < count) draft.notes.add(`A chart cache in ${label} contains gaps. Missing values were not inferred or recalculated.`)
   if (!saved.length) draft.notes.add(`A chart cache in ${label} has no stored point values.`)
   draft.add(`${context} stored ${cache.localName}${levels.length > 1 ? ` level ${level + 1}` : ''}`, rows.join('\n'))
  }
  for (const format of children(cache, 'formatCode')) draft.add(`${context} stored number format`, format.textContent ?? '')
  if (elements(cache, 'extLst').some(chart)) draft.notes.add(`Chart cache extensions in ${label} were not interpreted or extracted.`)
 }
 while (stack.length) {
  draft.hooks.check()
  const item = stack.pop()!, element = item.element, name = element.localName
  let context = item.context
  if (chart(element)) {
   if (name === 'extLst') { draft.notes.add(`Chart extension content in ${label} was not interpreted or extracted.`); continue }
   if (name === 'ser') {
    if (++series > 200) fail('a chart exceeds 200 series.')
    context = `${label} chart series ${series}`
    const savedIndex = children(element, 'idx')[0]
    if (savedIndex) draft.add(`${context} stored index`, String(index(attr(savedIndex, 'val'))))
   } else if (name === 'title') context += ` title ${++titles}`
   else if (contexts[name]) context += ` ${contexts[name]}`
   else if (name === 'dLbl') {
    const savedIndex = children(element, 'idx')[0]
    context += ` data label${savedIndex ? ` ${index(attr(savedIndex, 'val'))}` : ''}`
   }
   if (cacheNames.has(name)) { readCache(element, context); continue }
   if (name === 'f') { draft.add(`${context} stored formula`, element.textContent ?? ''); continue }
   if (name === 'v') { draft.add(`${context} stored label`, element.textContent ?? ''); continue }
   if (['strRef','numRef','multiLvlStrRef'].includes(name) && ![...element.children].some(child => chart(child) && cacheNames.has(child.localName))) draft.notes.add(`A chart formula reference in ${label} has no saved cache. Its formula is retained, but no values were calculated.`)
   if (name === 'externalData') {
    const id = attr(element, 'id', 'rel')
    if (!id || !relations.has(id)) fail('a chart data relationship is missing.')
    draft.notes.add(`The chart data source in ${label} was not opened or refreshed. Only the chart's saved text, formulas and cache values were read.`)
   }
   if (name === 'userShapes') draft.notes.add(`Additional chart drawing shapes in ${label} were not rendered or extracted.`)
  } else if (inSpace(element, 'drawing')) {
   if (name === 'p') { draft.add(`${context} rich text`, storedText(element, 'drawing')); continue }
  } else if (element.namespaceURI === 'http://schemas.openxmlformats.org/markup-compatibility/2006') draft.notes.add(`Stored chart alternatives in ${label} may duplicate content. Their visual selection was not evaluated.`)
  else { draft.notes.add(`Chart extension content in ${label} was not interpreted or extracted.`); continue }
  for (let child = element.children.length - 1; child >= 0; child--) stack.push({ element: element.children[child], context })
 }
 draft.notes.add('Chart extraction preserves saved titles, labels, point indexes, raw cache values and formula text. It does not recalculate data, apply number formats, refresh linked data or render chart visuals, trendlines and extensions. Stored caches may be stale; review against the original.')
}
