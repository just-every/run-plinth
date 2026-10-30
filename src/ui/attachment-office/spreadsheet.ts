import type { OfficePackage } from './package'
import { Pictures } from './pictures'
import { fail } from './types'
import { attr, elements, inSpace, isSheetCell } from './xml'
import { ThreadedComments } from './threaded-comments'

const richText = (element: Element) => elements(element, 't', 'sheet').map(text => text.textContent ?? '').join('')
type SharedFormula = { cell: string; text: string }

function cellValue(cell: Element, strings: string[]) {
 const type = attr(cell, 't'), value = elements(cell, 'v', 'sheet')[0]?.textContent ?? ''
 if (type === 's') {
  if (!/^\d+$/.test(value) || Number(value) >= strings.length) fail('a shared string cell refers to a missing string.')
  return strings[Number(value)]
 }
 if (type === 'inlineStr') return richText(cell)
 if (type === 'b') {
  if (!['0', '1'].includes(value)) fail('a boolean cell has an invalid stored value.')
  return value === '1' ? 'TRUE' : 'FALSE'
 }
 if (type && !['n', 'str', 'e', 'd'].includes(type)) fail('a spreadsheet cell type is unsupported.')
 return value
}

function formulaText(cell: Element, formulas: Map<string, SharedFormula>) {
 const formula = elements(cell, 'f', 'sheet')[0]
 if (!formula) return ''
 const text = formula.textContent ?? '', kind = attr(formula, 't'), group = attr(formula, 'si'), range = attr(formula, 'ref')
 if (text) return `Formula${kind ? ` (${kind}${range ? ` ${range}` : ''})` : ''}: =${text}`
 if (kind === 'shared') {
  const definition = formulas.get(group)
  if (!definition) fail('a shared formula has no stored definition.')
  return `Shared formula ${group}; definition at ${definition.cell}: =${definition.text}. Relative references are not expanded.`
 }
 fail('a spreadsheet formula has no stored expression.')
}

async function comments(office: OfficePackage, sheet: string, label: string, threads: ThreadedComments) {
 for (const relation of (await office.rels(sheet)).values()) {
  if (relation.external) continue
  if (relation.kind !== 'comments') continue
  const document = await office.xml(relation.target)
  if (!inSpace(document.documentElement, 'sheet') || document.documentElement.localName !== 'comments') fail('spreadsheet comments have an unsupported structure.')
  const authors = elements(document, 'author', 'sheet').map(author => author.textContent ?? '')
  for (const comment of elements(document, 'comment', 'sheet')) {
   const authorId = attr(comment, 'authorId')
   if (!/^\d+$/.test(authorId) || Number(authorId) >= authors.length) fail('a spreadsheet comment has no stored author.')
   const cell = attr(comment, 'ref'), author = authors[Number(authorId)], text = richText(comment)
   office.draft.add(`${label} ${threads.fallback(sheet, cell, author, text)} ${cell} by ${author}`, text)
  }
 }
}

export async function extractSpreadsheet(office: OfficePackage, main: string) {
 const { draft } = office, document = await office.xml(main), pictures = new Pictures(office)
 const shared = [...(await office.rels(main)).values()].filter(relation => relation.kind === 'sharedStrings' && !relation.external)
 if (shared.length > 1) fail('multiple shared string tables are unsupported.')
 let strings: string[] = []
 if (shared.length) {
  const sharedDocument = await office.xml(shared[0].target)
  if (sharedDocument.documentElement.localName !== 'sst' || !inSpace(sharedDocument.documentElement, 'sheet')) fail('the shared string table has an unsupported structure.')
  strings = elements(sharedDocument, 'si', 'sheet').map(richText)
 }
 const sheets = elements(document, 'sheet', 'sheet')
 if (!sheets.length || sheets.length > 200) fail('a workbook must contain between one and 200 sheets.')
 const threads = new ThreadedComments(office, main), currentSheets: { path: string; label: string }[] = []
 let cells = 0
 const sheetNames = new Set<string>(), sheetPaths = new Set<string>()
 for (const sheet of sheets) {
  draft.hooks.check()
  const name = attr(sheet, 'name'), state = attr(sheet, 'state'), label = `Sheet ${name}${state && state !== 'visible' ? ` (${state})` : ''}`
  if (!name || sheetNames.has(name)) fail('workbook sheet names are missing or duplicated.')
  sheetNames.add(name); draft.hooks.progress(`Reading ${label}…`)
  const path = await office.referenced(main, attr(sheet, 'id', 'rel'), ['worksheet', 'chartsheet'])
  if (sheetPaths.has(path)) fail('workbook sheet parts are duplicated.')
  sheetPaths.add(path)
  currentSheets.push({ path, label })
  await threads.read(path, label)
 }
 await threads.validate()
 for (const { path, label } of currentSheets) {
  draft.hooks.progress(`Reading ${label}…`)
  const sheetDocument = await office.xml(path), root = sheetDocument.documentElement
  if (!inSpace(root, 'sheet') || !['worksheet', 'chartsheet'].includes(root.localName)) fail('a sheet has an unsupported structure.')
  if (root.localName === 'chartsheet') draft.notes.add(`${label} contains a chart. Chart visuals and calculations were not extracted.`)
  const storedCells = elements(root, 'c', 'sheet'), coordinates = new Set<string>(), formulas = new Map<string, SharedFormula>()
  for (const cell of storedCells) {
   const formula = elements(cell, 'f', 'sheet')[0]
   if (formula && attr(formula, 't') === 'shared' && formula.textContent) {
    const group = attr(formula, 'si')
    if (!group || formulas.has(group)) fail('shared formula definitions are missing identifiers or duplicated.')
    formulas.set(group, { cell: attr(cell, 'r'), text: formula.textContent })
   }
  }
  for (const cell of storedCells) {
   draft.hooks.check()
   if (++cells > 100_000) fail('more than 100,000 stored spreadsheet cells are unsupported.')
   const coordinate = attr(cell, 'r')
   if (!isSheetCell(coordinate) || coordinates.has(coordinate)) fail('spreadsheet cell references are invalid or duplicated.')
   coordinates.add(coordinate)
   const value = cellValue(cell, strings), formula = formulaText(cell, formulas)
   draft.add(`${label} cell ${coordinate}`, [value, formula].filter(Boolean).join('\n'))
   if (formula && !elements(cell, 'v', 'sheet').length) draft.notes.add(`${label} contains formulas without cached results. Formula text is retained; results were not calculated.`)
  }
  for (const field of ['oddHeader', 'evenHeader', 'firstHeader', 'oddFooter', 'evenFooter', 'firstFooter']) {
   for (const element of elements(root, field, 'sheet')) draft.add(`${label} ${field}`, element.textContent ?? '')
  }
  await pictures.from(path, label)
  await comments(office, path, label, threads)
 }
 draft.notes.add('Spreadsheet values are the stored cache, not recalculated results. Number formatting and date serials are unchanged. Hidden sheets, rows and cells are included. Header and footer formatting codes are retained as text.')
}
