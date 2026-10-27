import type { PresentationGraph } from './presentation-graph'
import type { PresentationRecord } from './presentation-records'
import { bounded, fail } from './types'

/** Only current list text and selected objects' drawing textboxes are content sources. */
export function presentationText(graph: PresentationGraph): { text: string; notes: string[] } {
 const { records } = graph, output: string[] = []; let length = 0, visited = 0, characters = 0
 function add(label: string, parts: string[]) {
  if (!parts.length) return
  const text = label + '\n' + parts.join('\n')
  length += text.length + 2
  if (length > 100_000) fail('stored PowerPoint text exceeds 100,000 characters. Nothing was copied.')
  output.push(text)
 }
 function textBodies(children: PresentationRecord[], allowOutline = false): string[] {
  const result: string[] = []; let header = false, hasText = false
  for (const row of children) {
   if (row.type === 0x0f9f) { records.atom(row, 0x0f9f, 4); header = true; hasText = false }
   else if (row.type === 0x0fa0 || row.type === 0x0fa8) {
    if (!header || hasText || row.container || row.instance) fail('a PowerPoint text body has an invalid owner or duplicate character record.')
    const bytes = records.bytes.subarray(row.body,row.end)
    characters += row.type === 0x0fa0 ? bytes.length / 2 : bytes.length
    if (characters > 100_000) fail('stored PowerPoint text exceeds 100,000 characters. Nothing was copied.')
    let text: string
    if (row.type === 0x0fa0) {
     if (bytes.length % 2) fail('PowerPoint Unicode text has an odd byte length.')
     try { text = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }).decode(bytes) }
     catch { return fail('PowerPoint text contains invalid UTF-16. No replacement encoding was used.') }
    } else {
     const units: string[] = []
     for (const byte of bytes) units.push(String.fromCharCode(byte))
     text = units.join('')
    }
    if (text.includes('\0')) fail('a PowerPoint text body contains a forbidden NUL character.')
    text = text.replace(/[\r\v]/g,'\n').trim()
    if (text) result.push(text)
    hasText = true
   } else if (row.type === 0x0f9e) {
    records.atom(row, 0x0f9e, 4)
    if (!allowOutline) fail('a PowerPoint outline reference has no current slide-list owner.')
    if (children.length > 2 || children[0] !== row || children.length === 2 && children[1]!.type !== 0x0fa6) fail('a PowerPoint outline textbox mixes inline and referenced text.')
   }
  }
  return result
 }
 function drawing(record: PresentationRecord, outlineCount = 0): string[] {
  const drawing = records.child(record, 0x040c, 0, !outlineCount)
  const roots = drawing ? [drawing] : []
  const parts: string[] = []
  function walk(row: PresentationRecord, depth: number) {
   if (++visited > 100_000 || depth > 64) fail('PowerPoint drawing traversal exceeds its record or nesting limit.')
   if (row.type === 0xf00d) {
    if (!row.container || row.instance) fail('a PowerPoint drawing textbox is invalid.')
    const children = records.children(row), reference = children.find(child => child.type === 0x0f9e)
    if (reference && (!outlineCount || records.u32(records.atom(reference, 0x0f9e, 4).body) >= outlineCount)) fail('a PowerPoint textbox references text outside the current slide outline.')
    parts.push(...textBodies(children, !!reference)); return
   }
   // Do not descend into programmable tags, round-trip data, charts or OLE payloads.
   if ([0x040c,0xf002,0xf003,0xf004].includes(row.type)) {
    if (!row.container) fail('a PowerPoint drawing container is invalid.')
    for (const child of records.children(row)) walk(child, depth + 1)
   }
  }
  for (const root of roots) walk(root,0)
  return parts
 }
 for (const [index,slide] of graph.slides.entries()) {
  const outline = textBodies(slide.outline), outlineCount = slide.outline.filter(row => row.type === 0x0f9f).length
  add(`Slide ${index + 1}`, [...outline,...drawing(slide.record,outlineCount)])
  const note = graph.notes.find(row => row.id === slide.notesId)
  if (note) add(`Slide ${index + 1} notes`,drawing(note.record))
 }
 for (const master of graph.masters) add(master.record.type === 0x03f8 ? `Main master ${master.id}` : `Title master ${master.id}`,drawing(master.record))
 if (graph.notesMaster) add('Notes master',drawing(graph.notesMaster))
 if (graph.handoutMaster) add('Handout master',drawing(graph.handoutMaster))
 return { text: bounded(output.join('\n\n')), notes: ['Stored text is read only from current slide lists and current slide, notes and master drawings. Layout, inherited placeholder rendering, comments, charts, image text, programmable tags, round-trip extensions and embedded objects are not interpreted.'] }
}
