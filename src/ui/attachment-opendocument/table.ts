import { attr, Draft, elements, fail, is, positive } from './common'
export type Walk = (element: Element, label: string) => Promise<void>
function column(index: number) {
 let result = ''
 for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result
 return result
}
function advance(start: number, count: number) {
 const end = start + count - 1
 if (!Number.isSafeInteger(end) || end > 1_000_000_000) fail('a repeated row or column exceeds its supported range.')
 return end
}
function* rows(parent: Element): Generator<Element> {
 for (const child of parent.children) {
  if (is(child, 'table', 'table-row')) yield child
  else if (is(child, 'table') && ['table-row-group', 'table-header-rows', 'table-rows'].includes(child.localName)) yield* rows(child)
 }
}
export async function readTable(table: Element, draft: Draft, walk: Walk, label: string) {
 const name = attr(table, 'table', 'name'), title = `${label}${name ? ` · ${name}` : ''}`
 const sheetHidden = ['false', '0'].includes(attr(table, 'table', 'display'))
 if (elements(table, 'table', 'table-column').some(column => ['collapse', 'filter'].includes(attr(column, 'table', 'visibility')))) draft.notes.add('Stored text from hidden columns is included at its cell addresses.')
 let rowIndex = 1, cells = 0
 if (sheetHidden) draft.notes.add('Stored cells from hidden sheets are included and labelled; visibility is not a permission grant.')
 for (const row of rows(table)) {
  await draft.step()
  const rowRepeat = positive(attr(row, 'table', 'number-rows-repeated') || '1', 'A repeated row count'), rowEnd = advance(rowIndex, rowRepeat)
  const hidden = attr(row, 'table', 'visibility'), suffix = hidden && hidden !== 'visible' ? ` · row visibility ${hidden}` : ''
  let col = 1
  for (const cell of row.children) {
   if (!is(cell, 'table') || !['table-cell', 'covered-table-cell'].includes(cell.localName)) continue
   if (++cells > 100_000) fail('a table exceeds 100,000 stored cell elements.')
   await draft.step()
   const repeated = positive(attr(cell, 'table', 'number-columns-repeated') || '1', 'A repeated column count'), lastCol = advance(col, repeated)
   const range = `${column(col)}${rowIndex}${rowEnd !== rowIndex || lastCol !== col ? `:${column(lastCol)}${rowEnd}` : ''}`
   const cellLabel = `${title} · ${range}${sheetHidden ? ' · hidden sheet' : ''}${suffix}${cell.localName === 'covered-table-cell' ? ' · covered cell' : ''}`
   const type = attr(cell, 'office', 'value-type'), formula = attr(cell, 'table', 'formula')
   if (formula) draft.add(`${cellLabel} · stored formula`, formula)
   const valueName = ({ string: 'string-value', boolean: 'boolean-value', date: 'date-value', time: 'time-value', float: 'value', currency: 'value', percentage: 'value' } as Record<string, string>)[type]
   if (type && !valueName && type !== 'void') draft.notes.add('An unsupported stored spreadsheet value type may have missing cached values.')
   const value = valueName ? attr(cell, 'office', valueName) : '', currency = attr(cell, 'office', 'currency')
   if (value) draft.add(`${cellLabel} · stored ${type}${currency ? ` ${currency}` : ''}`, value)
   await walk(cell, cellLabel)
   if (rowRepeat > 1 || repeated > 1) draft.notes.add('Repeated rows and cells are represented once with their stored cell ranges; their text is not duplicated for each repeat.')
   if (attr(cell, 'table', 'number-columns-spanned') || attr(cell, 'table', 'number-rows-spanned')) draft.notes.add('Merged cells retain their stored text; merged layout is not reproduced.')
   col = lastCol + 1
  }
  rowIndex = rowEnd + 1
 }
 for (const child of table.children) {
  if (is(child, 'table') && ['table-row', 'table-row-group', 'table-header-rows', 'table-rows', 'table-column', 'table-column-group', 'table-header-columns', 'table-columns'].includes(child.localName)) continue
  await walk(child, title)
 }
 draft.notes.add('Spreadsheet formulas are stored expressions with cached values, where present. They are not recalculated; formatting, conditional visibility, validation, external data and calculation engines are not applied.')
}
