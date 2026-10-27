import { Archive } from './archive'
import { fail, type Draft } from './types'
import { attr, elements, parseXml } from './xml'
import { ZIP_LIMITS } from './zip-directory'

export type Relation = { id: string; kind: string; target: string; external: boolean }
const relationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'

function targetPath(part: string, target: string) {
 let decoded: string
 try { decoded = decodeURIComponent(target.split('#')[0]) }
 catch { return fail('a relationship target has invalid escaping.') }
 if (!decoded || decoded.startsWith('//') || /[\\:?\x00-\x1f]/.test(decoded)) fail('a package relationship is not a safe internal path.')
 const result = decoded.startsWith('/') ? [] : part.split('/').slice(0, -1)
 for (const segment of decoded.split('/')) {
  if (!segment || segment === '.') continue
  if (segment === '..') { if (!result.length) fail('a relationship escapes the package.'); result.pop() }
  else result.push(segment)
 }
 return result.join('/')
}

export class OfficePackage {
 private documents = new Map<string, Promise<Document>>()
 private relationships = new Map<string, Promise<Map<string, Relation>>>()
 constructor(readonly archive: Archive, readonly draft: Draft) {}
 xml(path: string) {
  let work = this.documents.get(path)
  if (!work) {
   if ((this.archive.entries.get(path)?.size ?? Infinity) > ZIP_LIMITS.xml) fail('a required XML part is missing or exceeds 8 MiB.')
   work = this.archive.read(path).then(bytes => parseXml(bytes, () => this.draft.hooks.check()))
   this.documents.set(path, work)
  }
  return work
 }
 rels(part: string): Promise<Map<string, Relation>> {
  const cached = this.relationships.get(part)
  if (cached) return cached
  const segments = part.split('/'), filename = segments.pop() ?? ''
  const path = [...segments, '_rels', filename + '.rels'].join('/')
  const work = (async () => {
   const result = new Map<string, Relation>()
   if (!this.archive.has(path)) return result
   const document = await this.xml(path)
   if (document.documentElement.localName !== 'Relationships' || document.documentElement.namespaceURI !== relationshipNamespace) fail('a relationship part has an unsupported structure.')
   for (const element of elements(document, 'Relationship')) {
    if (element.namespaceURI !== relationshipNamespace) fail('a relationship namespace is unsupported.')
    const id = attr(element, 'Id'), type = attr(element, 'Type'), mode = attr(element, 'TargetMode')
    if (!id || !type || result.has(id) || (mode && !['Internal', 'External'].includes(mode))) fail('a relationship is malformed or duplicated.')
    const external = mode === 'External', kind = type.split('/').at(-1) ?? ''
    const target = external ? '' : targetPath(part, attr(element, 'Target'))
    if (!external && !this.archive.has(target)) fail('an internal relationship target is missing.')
    if (external) this.draft.notes.add('External links were not followed. Linked files and linked pictures were not read.')
    result.set(id, { id, kind, target, external })
   }
   return result
  })()
  this.relationships.set(part, work)
  return work
 }
 async main() {
  const contentTypes = await this.xml('[Content_Types].xml')
  if (contentTypes.documentElement.localName !== 'Types') fail('the Office content type inventory is invalid.')
  const main = [...(await this.rels('')).values()].filter(relation => relation.kind === 'officeDocument' && !relation.external)
  if (main.length !== 1) fail('the package must have one internal main Office document.')
  return main[0].target
 }
 async referenced(part: string, id: string, kind?: string) {
  const relation = (await this.rels(part)).get(id)
  if (!relation || relation.external || (kind && relation.kind !== kind)) fail('a required document relationship is missing or unsupported.')
  return relation.target
 }
 audit() {
  const names = [...this.archive.entries.keys()]
  if (names.some(name => /(?:^|\/)embeddings\//i.test(name))) this.draft.notes.add('Embedded objects and embedded documents were not opened or extracted.')
  if (names.some(name => /(?:chart|diagram|pivotTable|pivotCache|slicer|externalLink|activeX|vbaProject)/i.test(name))) this.draft.notes.add('Charts, diagrams, pivots, external data, controls and macros are not evaluated or rendered; their visible content may be absent.')
  if (names.some(name => /\.(?:emf|wmf|svg|eps)$/i.test(name))) this.draft.notes.add('Vector pictures are unsupported. Their visible content was not read.')
 }
}
