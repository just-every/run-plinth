import { Archive } from '../attachment-office/archive'
import { parseXml } from '../attachment-office/xml'
import { ZIP_LIMITS } from '../attachment-office/zip-directory'
import { attr, Draft, elements, fail, is } from './common'
export const MIMES = { text: 'application/vnd.oasis.opendocument.text', spreadsheet: 'application/vnd.oasis.opendocument.spreadsheet', presentation: 'application/vnd.oasis.opendocument.presentation' } as const
export type Kind = keyof typeof MIMES
export class OpenPackage {
 private documents = new Map<string, Promise<Document>>()
 readonly media = new Map<string, string>()
 constructor(readonly archive: Archive, readonly draft: Draft) {}
 xml(path: string) {
  let document = this.documents.get(path)
  if (!document) {
   if ((this.archive.entries.get(path)?.size ?? Infinity) > ZIP_LIMITS.xml) fail('a required XML part is missing or exceeds 8 MiB.')
   document = this.archive.read(path).then(bytes => parseXml(bytes, () => this.draft.check()))
   this.documents.set(path, document)
  }
  return document
 }
 async open(): Promise<{ kind: Kind; content: Document }> {
  const manifest = await this.xml('META-INF/manifest.xml')
  if (!is(manifest.documentElement, 'manifest', 'manifest')) fail('the package manifest has an unsupported structure.')
  if (elements(manifest, 'manifest', 'encryption-data').length || elements(manifest, 'manifest', 'encrypted-key').length) fail('encrypted OpenDocument packages are unsupported. Supply an unencrypted original or reviewed text.')
  for (const entry of elements(manifest, 'manifest', 'file-entry')) {
   const path = attr(entry, 'manifest', 'full-path')
   if (!path || this.media.has(path)) fail('the manifest contains missing or duplicate paths.')
   if (path !== '/' && (path.startsWith('/') || path.includes('\\') || /[\x00-\x1f:?]/.test(path) || path.split('/').some(part => part === '..' || part === '.'))) fail('the manifest contains an unsafe part path.')
   if (path !== '/' && !path.endsWith('/') && !this.archive.has(path)) fail('a manifest part is missing from the package.')
   this.media.set(path, attr(entry, 'manifest', 'media-type'))
  }
  if ((this.archive.entries.get('mimetype')?.size ?? Infinity) > 256) fail('the package MIME declaration is missing or invalid.')
  const mime = new TextDecoder('utf-8', { fatal: true }).decode(await this.archive.read('mimetype'))
  const kind = (Object.keys(MIMES) as Kind[]).find(kind => MIMES[kind] === mime)
  if (!kind || this.media.get('/') !== mime) fail('the package MIME declaration does not identify supported text, spreadsheet or presentation content.')
  const content = await this.xml('content.xml'), root = content.documentElement
  if (!is(root, 'office', 'document-content')) fail('content.xml has an unsupported root.')
  if (!this.media.has('content.xml')) fail('the main content is absent from the package manifest.')
  const names = [...this.archive.entries.keys()]
  if (names.some(name => /(?:^|\/)(?:Basic|Scripts|ObjectReplacements)(?:\/|$)/i.test(name))) this.draft.notes.add('Macros, scripts and object previews are not executed or interpreted.')
  const unlisted = names.filter(name => !name.endsWith('/') && !['mimetype', 'META-INF/manifest.xml'].includes(name) && !this.media.has(name))
  if (unlisted.length) this.draft.notes.add('Unlisted package parts were not read unless explicitly referenced by the main content.')
  if (names.some(name => /^META-INF\/.*signatures.*\.xml$/i.test(name))) this.draft.notes.add('Package signatures are not verified by extraction.')
  return { kind, content }
 }
 internal(href: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href)) {
   this.draft.notes.add('External links, data connections and linked pictures were not followed.'); return null
  }
  let path: string
  try { path = decodeURIComponent(href.split('#')[0]) } catch { return fail('an internal image reference has invalid escaping.') }
  if (path.startsWith('/') || /[\\:?\x00-\x1f]/.test(path)) fail('an internal image reference is unsafe.')
  const parts: string[] = []
  for (const segment of path.split('/')) {
   if (!segment || segment === '.') continue
   if (segment === '..') { if (!parts.length) fail('an image reference escapes the package.'); parts.pop() }
   else parts.push(segment)
  }
  path = parts.join('/')
  if (!path || !this.archive.has(path)) fail('an internal image reference is missing.')
  return path
 }
}
