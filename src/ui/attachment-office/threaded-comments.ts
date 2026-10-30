import type { OfficePackage, Relation } from './package'
import { fail } from './types'
import { attr, inSpace } from './xml'

const relationship = 'http://schemas.microsoft.com/office/2017/10/relationships/'
const canonical = (value: string) => /^\{?[0-9a-f-]{36}\}?$/i.test(value) ? value.replace(/[{}]/g, '').toLowerCase() : value
const identifier = (value: string) => {
 if (!value || value.length > 256 || /[\s\x00-\x1f]/.test(value)) fail('a threaded comment or person identifier is missing or invalid.')
 // GUID spelling is case insensitive; arbitrary stored identifiers retain their case.
 return canonical(value)
}
const children = (root: Element, name: string) => [...root.children].filter(child => child.localName === name)
type Comment = { id: string; key: string; parent: string; person: string; personId: string; date: string; cell: string; text: string; sheet: string; label: string }

/** Only current workbook relationships confer reachability, never attribution or account authority. */
export class ThreadedComments {
 private comments = new Map<string, Comment>()
 private parts = new Set<string>()
 private roots = new Map<string, string>()
 private depths = new Map<string, number>()
 private people = new Map<string, string>()
 private rootCells = new Set<string>()
 constructor(private office: OfficePackage, private workbook: string) {}

 private internal(relation: Relation, kind: string) {
  if (relation.type !== relationship + kind) fail('a threaded comment relationship namespace is unsupported.')
  if (relation.external) fail('threaded comments require internal relationships; external content was not read.')
  return relation.target
 }

 private async inventory() {
  const relations = [...(await this.office.rels(this.workbook)).values()].filter(relation => relation.kind === 'person')
  if (relations.length !== 1) fail('threaded comments require one internal person inventory.')
  const document = await this.office.xml(this.internal(relations[0], 'person')), root = document.documentElement
  if (root.localName !== 'personList' || !inSpace(root, 'threaded')) fail('the threaded comment person inventory namespace or structure is unsupported.')
  for (const person of root.children) {
   this.office.draft.hooks.check()
   if (person.localName !== 'person' || !inSpace(person, 'threaded') || person.children.length) fail('the threaded comment person inventory has an unsupported structure.')
   const id = identifier(attr(person, 'id')), name = attr(person, 'displayName')
   if (!name.trim()) fail('a threaded comment person has no stored display name.')
   if (this.people.has(id)) fail('threaded comment person identifiers are duplicated.')
   if (this.people.size >= 2000) fail('threaded comments exceed the 2,000-person processing limit.')
   this.people.set(id, name)
  }
 }

 async read(sheet: string, label: string) {
  const relations = [...(await this.office.rels(sheet)).values()].filter(relation => ['threadedComment', 'threadedComments'].includes(relation.kind))
  if (relations.length > 1) fail('a sheet has duplicate threaded comment relationships.')
  for (const relation of relations) {
   const part = this.internal(relation, 'threadedComment')
   if (this.parts.has(part)) fail('a threaded comment part is referenced by multiple sheets.')
   this.parts.add(part)
   const document = await this.office.xml(part), root = document.documentElement
   if (root.localName !== 'ThreadedComments' || !inSpace(root, 'threaded')) fail('the threaded comment namespace or structure is unsupported.')
   for (const element of root.children) {
    this.office.draft.hooks.check()
    if (element.localName !== 'threadedComment' || !inSpace(element, 'threaded')) fail('the threaded comment namespace or structure is unsupported.')
    const text = children(element, 'text')
    if ([...element.getElementsByTagNameNS('*', '*')].some(child => !inSpace(child, 'threaded'))) fail('a threaded comment child namespace is unsupported.')
    if (text.length !== 1 || !inSpace(text[0], 'threaded') || text[0].children.length || [...element.children].some(child => !inSpace(child, 'threaded') || !['text', 'mentions', 'extLst'].includes(child.localName))) fail('a threaded comment text or child namespace is unsupported.')
    const id = attr(element, 'id'), key = identifier(id), parent = attr(element, 'parentId'), person = identifier(attr(element, 'personId')), cell = attr(element, 'ref'), date = attr(element, 'dT')
    if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(cell)) fail('a threaded comment cell reference is missing or invalid.')
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(date) || !Number.isFinite(Date.parse(date))) fail('a threaded comment stored date is missing or invalid.')
    if (this.comments.has(key)) fail('threaded comment identifiers are duplicated across the workbook.')
    if (this.comments.size >= 10000) fail('threaded comments exceed the 10,000-comment processing limit.')
    this.comments.set(key, { id, key, parent: parent ? identifier(parent) : '', person, personId: attr(element, 'personId'), cell, date, text: text[0].textContent ?? '', sheet, label })
    if (element.children.length > 1) this.office.draft.notes.add('Threaded comment mention and extension metadata are not interpreted; stored comment text is retained.')
   }
  }
 }

 async validate() {
  if (!this.parts.size) return
  await this.inventory()
  for (const comment of this.comments.values()) {
   if (!this.people.has(comment.person)) fail('a threaded comment refers to a missing stored author.')
   if (comment.parent) {
    const parent = this.comments.get(comment.parent)
    if (!parent) fail('a threaded comment refers to a missing parent.')
    if (parent.sheet !== comment.sheet) fail('a threaded comment parent crosses sheet boundaries.')
    if (parent.cell !== comment.cell) fail('a threaded comment parent refers to a different cell.')
   } else {
    const cell = comment.sheet + '\n' + comment.cell
    if (this.rootCells.has(cell)) fail('multiple threaded comment roots refer to the same sheet and cell.')
    this.rootCells.add(cell)
   }
  }
  for (const comment of this.comments.values()) {
   this.office.draft.hooks.check()
   const chain: string[] = [], seen = new Set<string>()
   let current = comment
   while (!this.roots.has(current.key)) {
    if (seen.has(current.key)) fail('threaded comment parent references form a cycle.')
    if (chain.length >= 64) fail('threaded comments exceed the 64-level reply processing limit.')
    seen.add(current.key); chain.push(current.key)
    if (!current.parent) { this.roots.set(current.key, current.key); this.depths.set(current.key, 1); break }
    current = this.comments.get(current.parent)!
   }
   for (const key of chain.reverse()) {
    const parent = this.comments.get(key)!.parent, depth = parent ? this.depths.get(parent)! + 1 : 1
    if (depth > 64) fail('threaded comments exceed the 64-level reply processing limit.')
    this.depths.set(key, depth); this.roots.set(key, this.roots.get(current.key)!)
   }
  }
  for (const comment of this.comments.values()) {
   const root = this.comments.get(this.roots.get(comment.key)!)!, parent = comment.parent ? this.comments.get(comment.parent)! : undefined
   this.office.draft.add(`${comment.label} cell ${comment.cell} threaded comment ${comment.id}\nThread ${root.id}; parent ${parent?.id ?? 'none (root)'}; stored author ${this.people.get(comment.person)} (person ${comment.personId}); stored date ${comment.date}`, comment.text || '[Empty stored comment]')
  }
  this.office.draft.notes.add('Threaded comment authors and dates are stored document attribution, not verified identities, current account authority or evidence of approval. Only comments linked from current workbook sheets and their internal person inventory were read.')
 }

 fallback(sheet: string, cell: string, author: string, text: string) {
  const storedId = /^tc=(.+)$/i.exec(author)?.[1]
  const comment = storedId ? this.comments.get(canonical(storedId)) : undefined
  if (comment && comment.sheet === sheet && comment.cell === cell) return `classic fallback for thread ${this.comments.get(this.roots.get(comment.key)!)!.id} (stored mirrored text)`
  if (text.trimStart().startsWith('[Threaded comment]') && this.rootCells.has(sheet + '\n' + cell)) return 'classic comment (possible mirrored threaded fallback)'
  return 'comment'
 }
}
