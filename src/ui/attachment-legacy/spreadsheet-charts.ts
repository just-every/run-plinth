import { bounded, fail } from './types'
import { commentShapes } from './spreadsheet-drawings'
import { chartRecords, type ChartNode } from './spreadsheet-chart-records'
import { unicode, u16, u32, type ChartScope, type Biff } from './spreadsheet-records'
type Series = { name: string; counts: number[] }
const children = (node: ChartNode) => node.children ?? fail('a required Excel chart group is missing.')
function seriesText(record: Biff): string {
 if (record.data.length < 4 || u16(record.data, 0)) return fail('stored Excel chart text is invalid.')
 const value = unicode(record.data, 2, true)
 if (value.end !== record.data.length) fail('stored Excel chart text has extra bytes.')
 return value.text
}
function ai(nodes: ChartNode[], index: number, role: number): string {
 const r = nodes[index]?.record, b = r?.data
 if (r?.type !== 0x1051 || !b || b.length < 8 || b[0] !== role || b[1]! > 2 || u16(b, 6) + 8 !== b.length) return fail('an Excel chart data association is invalid.')
 return nodes[index + 1]?.record.type === 0x100d ? seriesText(nodes[index + 1]!.record) : ''
}
export function spreadsheetCharts(scopes: ChartScope[]): { text: string; notes: string[] } {
 const parts: string[] = [], notes = new Set<string>(); let chars = 0, caches = 0
 const add = (text: string) => { chars += text.length + 2; if (chars > 100_000) fail('stored Excel chart text exceeds 100,000 characters.'); parts.push(text) }
 for (const scope of scopes) {
  let id = 'chart sheet'
  if (scope.object && scope.parent) {
   const index = scope.parent.indexOf(scope.object), shapes = commentShapes(scope.parent, 5), owners = [...shapes.values()].filter(s => s.object === index)
   if (owners.length !== 1) fail('an embedded Excel chart has no unambiguous drawing owner.')
   if (owners[0]!.deleted) continue
   id = `embedded chart ${owners[0]!.id}`
  }
  const label = `${scope.name} ${id}${scope.hidden ? ' (hidden sheet)' : ''}`, roots = chartRecords(scope.records), charts = roots.filter(n => n.record.type === 0x1002)
  if (charts.length !== 1 || charts[0]!.record.data.length !== 16) fail('a current Excel chart has no unambiguous chart group.')
  const chart = charts[0]!, series: Series[] = [], chartChildren = children(chart)
  for (const [type, size] of [[0x00a0, 4], [0x1064, 8], [0x1044, 3], [0x1046, 2]]) {
   const found = chartChildren.filter(n => n.record.type === type)
   if (found.length !== 1 || found[0]!.record.data.length !== size) fail('required Excel chart properties are missing or ambiguous.')
  }
  const axisCount = u16(chartChildren.find(n => n.record.type === 0x1046)!.record.data, 0), axes = chartChildren.filter(n => n.record.type === 0x1041)
  if (![1, 2].includes(axisCount) || axes.length !== axisCount) fail('Excel chart axis groups are inconsistent.')
  for (const axis of axes) {
   const group = children(axis), formats = group.filter(n => n.record.type === 0x1014)
   if (axis.record.data.length !== 18 || group[0]?.record.type !== 0x104f || group[0].record.data.length !== 20 || !formats.length || formats.length > 4) fail('an Excel chart axis group is malformed.')
   for (const format of formats) { const content = children(format); if (format.record.data.length !== 20 || !content.some(n => n.record.type === 0x1022)) fail('an Excel chart format group is malformed.') }
  }
  for (const node of chartChildren) if (node.record.type === 0x1003) {
   const b = node.record.data, group = children(node)
   if (b.length !== 12 || ![1, 3].includes(u16(b, 0)) || u16(b, 2) !== 1 || u16(b, 8) !== 1) fail('Excel chart series properties are invalid.')
   const counts = [0, u16(b, 6), u16(b, 4), u16(b, 10)]
   if (counts.some(n => n > 32767) || series.length >= 256) fail('Excel chart series counts exceed their limit.')
   if (group.filter(n => n.record.type === 0x1051).length !== 4) fail('an Excel chart series has ambiguous data associations.')
   let cursor = 0, name = ''
   for (let role = 0; role < 4; role++) { const value = ai(group, cursor, role); if (!role) name = value; cursor += group[cursor + 1]?.record.type === 0x100d ? 2 : 1 }
   if (!group.some(n => n.record.type === 0x1045 || n.record.type === 0x104a)) fail('an Excel chart series has no chart-group association.')
   series.push({ name, counts }); if (name) add(`${label} series ${series.length}: ${name}`)
  }
  function labels(nodes: ChartNode[], depth: number) {
   if (depth > 64) fail('Excel chart labels exceed their depth limit.')
   for (const node of nodes) {
    if (node.record.type === 0x1024) continue // default text properties are not displayed text
    if (node.record.type === 0x1025) {
     const group = children(node), links = group.filter(n => n.record.type === 0x1027), data = group.map((n, i) => n.record.type === 0x1051 ? i : -1).filter(n => n >= 0)
     if (data.length !== 1 || node.record.data.length !== 32) fail('an Excel chart attached label is malformed.')
     const text = ai(group, data[0]!, 0)
     if (links.length > 1) fail('an Excel chart label has ambiguous anchors.')
     if (links.length) {
      const b = links[0]!.record.data
      if (b.length !== 6 || ![1, 2, 3, 4, 7, 12].includes(u16(b, 0))) fail('an Excel chart label anchor is invalid.')
      const role = u16(b, 0), seriesIndex = u16(b, 2), point = u16(b, 4)
      if (role === 4 ? seriesIndex >= series.length || point !== 0xffff && point > 31999 : seriesIndex || point) fail('an Excel chart label anchor is outside its series.')
      if (text) add(`${label} ${role === 1 ? 'title' : role === 4 ? `series ${seriesIndex + 1} data label` : 'axis title'}: ${text}`)
     } else if (text) add(`${label} attached label: ${text}`)
     continue
    }
    if (node.children && [0x1003, 0x1041, 0x1014, 0x1015, 0x101d, 0x1043, 0x1063].includes(node.record.type)) labels(node.children, depth + 1)
   }
  }
  labels(children(chart), 0)
  const start = roots.indexOf(chart) + 1, dimension = roots[start]?.record
  if (dimension?.type !== 0x0200 || dimension.data.length !== 14) fail('an Excel chart saved-data cache header is missing.')
  const rowStart = u32(dimension.data, 0), rowEnd = u32(dimension.data, 4), colStart = u16(dimension.data, 8), colEnd = u16(dimension.data, 10)
  if (rowStart > rowEnd || rowEnd > 32768 || colStart > colEnd || colEnd > 256 || (rowEnd - rowStart) * (colEnd - colStart) > 250_000) fail('an Excel chart cache exceeds its grid limit.')
  let cursor = start + 1
  for (let role = 1; role <= 3; role++) {
   const marker = roots[cursor++]?.record
   if (marker?.type !== 0x1065 || marker.data.length !== 2 || u16(marker.data, 0) !== role) fail('Excel chart cache groups are missing or out of order.')
   const seen = new Set<string>()
   while (roots[cursor] && [0x0203, 0x0205, 0x0201, 0x0204].includes(roots[cursor]!.record.type)) {
    const r = roots[cursor++]!.record, b = r.data
    if (b.length < 6 || ++caches > 250_000) fail('an Excel chart cache cell exceeds its boundary or limit.')
    const row = u16(b, 0), col = u16(b, 2), key = `${row}:${col}`, s = series[col]
    if (!s || row < rowStart || row >= rowEnd || col < colStart || col >= colEnd || row >= s.counts[role]! || seen.has(key)) fail('an Excel chart cache cell has no valid series association.')
    seen.add(key); let value = ''
    if (r.type === 0x0203) { if (b.length !== 14) fail('an Excel chart number is truncated.'); const number = new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat64(6, true); if (!Number.isFinite(number)) fail('an Excel chart number is not finite.'); value = String(number) }
    if (r.type === 0x0204) { const text = unicode(b, 6); if (text.end !== b.length) fail('an Excel chart cache label has extra bytes.'); value = text.text }
    if (r.type === 0x0205) { if (b.length !== 8 || b[7]! > 1 || !b[7] && b[6]! > 1) fail('an Excel chart Boolean or error is invalid.'); value = b[7] ? `saved error ${b[6]}` : b[6] ? 'TRUE' : 'FALSE' }
    if (r.type === 0x0201 && b.length !== 6) fail('an Excel chart blank is invalid.')
    if (value) add(`${label} saved ${role === 1 ? 'value' : role === 2 ? 'category' : 'bubble size'}; series ${col + 1}${s.name ? ` (${s.name})` : ''}, point ${row + 1}: ${value}`)
   }
  }
  if (roots.slice(cursor).some(n => [0x100d, 0x1003, 0x1065, 0x0204, 0x0203].includes(n.record.type))) notes.add('Unassociated chart text or cache records were excluded.')
  if (scope.records.some(r => [0x08a6, 0x08a5, 0x089e].includes(r.type))) notes.add('Modern rich chart text and future chart markup are not interpreted.')
 }
 if (scopes.length) notes.add('Chart text and saved caches are read from current charts only. Saved values can be stale and are not recalculated. Linked worksheet data, formula evaluation, generated labels, rich text, formatting, layout, images and future chart markup are not fully interpreted.')
 return { text: bounded(parts.join('\n\n')), notes: [...notes] }
}
