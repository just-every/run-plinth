import { Compound } from './compound'
import { PresentationRecords, type PresentationRecord } from './presentation-records'
import { fail } from './types'

type Slide = { id: number; record: PresentationRecord; outline: PresentationRecord[]; masterId: number; notesId: number }
type Master = { id: number; record: PresentationRecord; masterId: number }
type Notes = { id: number; record: PresentationRecord; slideId: number }
export interface PresentationGraph {
 records: PresentationRecords
 slides: Slide[]
 masters: Master[]
 notes: Notes[]
 notesMaster?: PresentationRecord
 handoutMaster?: PresentationRecord
}

/** MS-PPT 2.1.2: latest persist mappings plus current document references define live content. */
export function presentationGraph(cfb: Compound): PresentationGraph {
 const records = new PresentationRecords(cfb.stream('PowerPoint Document')), user = new PresentationRecords(cfb.stream('Current User'))
 const current = user.read(0)
 if (current.type !== 0x0ff6 || current.container || current.end - current.body < 20 || user.u32(current.body + 4) !== 0xe391c05f) fail('a supported unencrypted PowerPoint current-user record is required.')
 const offsets = new Map<number, number>(), edits = new Set<number>(); let edit = user.u32(current.body + 8), documentId = 0, entries = 0
 for (let n = 0; ; n++) {
  if (n >= 256 || edits.has(edit)) fail('the PowerPoint user-edit chain exceeds its limit or is cyclic.')
  edits.add(edit); const row = records.read(edit), size = row.end - row.body
  if (row.type !== 0x0ff5 || row.container || ![28,32].includes(size)) fail('the PowerPoint user-edit record is invalid.')
  if (size === 32 && records.u32(row.body + 28)) fail('encrypted binary PowerPoint files are unsupported.')
  if (!n) documentId = records.u32(row.body + 16)
  const directory = records.read(records.u32(row.body + 12))
  if (directory.type !== 0x1772 || directory.container) fail('the PowerPoint persist directory is invalid.')
  const local = new Set<number>()
  for (let at = directory.body; at < directory.end;) {
   records.span(at, 4, directory.end)
   const head = records.u32(at), first = head & 0xfffff, count = head >>> 20; at += 4
   if (!first || !count || first + count > 0x100000 || (entries += count) > 100_000) fail('the PowerPoint persist directory exceeds its bounds.')
   records.span(at, count * 4, directory.end)
   for (let i = 0; i < count; i++, at += 4) {
    const id = first + i
    if (local.has(id)) fail('the PowerPoint persist directory repeats an identifier.')
    local.add(id)
    if (!offsets.has(id)) offsets.set(id, records.u32(at))
    if (offsets.size > 10_000) fail('PowerPoint exceeds 10,000 persist identifiers.')
   }
  }
  const prior = records.u32(row.body + 8)
  if (!prior) break
  if (prior >= edit) fail('the PowerPoint previous edit does not precede the current edit.')
  edit = prior
 }
 function resolve(id: number, types: number[]) {
  const at = offsets.get(id)
  if (at === undefined) return fail('a required current PowerPoint persist reference is missing.')
  return records.container(records.read(at), types)
 }
 const document = resolve(documentId, [0x03e8]), documentAtom = records.atom(records.child(document, 0x03e9), 0x03e9, 40)
 const lists = new Map<number, PresentationRecord>()
 for (const child of records.children(document)) if (child.type === 0x0ff0) {
  if (!child.container || ![0,1,2].includes(child.instance) || lists.has(child.instance)) fail('the current PowerPoint lists are invalid or ambiguous.')
  lists.set(child.instance, child)
 }
 function references(instance: number) {
  const list = lists.get(instance), result: { id: number; record: PresentationRecord; outline: PresentationRecord[] }[] = []
  if (!list) return result
  const seen = new Set<number>()
  for (const row of records.children(list)) {
   if (row.type === 0x03f3) {
    records.atom(row, 0x03f3, 20)
    const id = records.u32(row.body + 12)
    if (!id || seen.has(id)) fail('a current PowerPoint list repeats or omits an object identifier.')
    seen.add(id)
    const types = instance === 0 ? [0x03ee] : instance === 1 ? [0x03f8,0x03ee] : [0x03f0]
    result.push({ id, record: resolve(records.u32(row.body), types), outline: [] })
   } else if (instance === 0 && result.length) result[result.length - 1]!.outline.push(row)
   else if (instance !== 0 || [0x0f9f,0x0fa0,0x0fa8].includes(row.type)) fail('a PowerPoint list contains text or references outside their declared owner.')
  }
  return result
 }
 const slideAtom = (record: PresentationRecord) => records.atom(records.child(record, 0x03ef), 0x03ef, 24)
 const slides = references(0).map(row => { const atom = slideAtom(row.record); return { ...row, masterId: records.u32(atom.body + 12), notesId: records.u32(atom.body + 16) } })
 if (!slides.length) fail('the current PowerPoint deck contains no resolvable slides.')
 const masters = references(1).map(row => { const atom = slideAtom(row.record); if (records.u32(atom.body + 16)) fail('a PowerPoint master incorrectly references a notes slide.'); return { id: row.id, record: row.record, masterId: records.u32(atom.body + 12) } })
 const notes = references(2).map(row => { const atom = records.atom(records.child(row.record, 0x03f1), 0x03f1, 8); return { id: row.id, record: row.record, slideId: records.u32(atom.body) } })
 const masterIds = new Map(masters.map(row => [row.id,row])), noteIds = new Map(notes.map(row => [row.id,row]))
 for (const slide of slides) {
  if (slide.masterId && !masterIds.has(slide.masterId) || slide.notesId && noteIds.get(slide.notesId)?.slideId !== slide.id) fail('a slide references notes or a master outside the current document lists.')
 }
 for (const note of notes) if (!slides.some(slide => slide.id === note.slideId && slide.notesId === note.id)) fail('a current notes slide has no matching current presentation slide.')
 for (const master of masters) {
  const visited = new Set<number>(); let next: Master | undefined = master
  while (next) {
   if (visited.has(next.id) || visited.size >= 64) fail('the PowerPoint master graph is cyclic or exceeds 64 levels.')
   visited.add(next.id)
   if (!next.masterId) break
   next = masterIds.get(next.masterId)
   if (!next) fail('a current master references a master outside the current list.')
  }
 }
 const notesId = records.u32(documentAtom.body + 24), handoutId = records.u32(documentAtom.body + 28)
 const notesMaster = notesId ? resolve(notesId, [0x03f0]) : undefined, handoutMaster = handoutId ? resolve(handoutId, [0x0fc9]) : undefined
 if (notesMaster) {
  const atom = records.atom(records.child(notesMaster, 0x03f1), 0x03f1, 8)
  if (records.u32(atom.body) || records.u16(atom.body + 4)) fail('the PowerPoint notes master has an invalid slide association.')
 }
 return { records, slides, masters, notes, notesMaster, handoutMaster }
}
