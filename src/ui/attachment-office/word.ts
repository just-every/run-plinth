import type { OfficePackage } from './package'
import { Pictures } from './pictures'
import { fail } from './types'
import { attr, elements, inSpace, storedText } from './xml'

const storyKinds: Record<string, string> = { header: 'Header', footer: 'Footer', footnotes: 'Footnotes', endnotes: 'Endnotes', comments: 'Comments', glossaryDocument: 'Glossary' }
const storyRoots: Record<string, string> = { header: 'hdr', footer: 'ftr', footnotes: 'footnotes', endnotes: 'endnotes', comments: 'comments', glossaryDocument: 'glossaryDocument' }

export async function extractWord(office: OfficePackage, main: string) {
 const { draft } = office, pictures = new Pictures(office), queue: [string, string, string][] = [[main, 'Document body', 'document']], visited = new Set<string>()
 const counts = new Map<string, number>()
 while (queue.length) {
  draft.hooks.check()
  const [part, label, expectedRoot] = queue.shift()!
  if (visited.has(part)) continue
  visited.add(part)
  if (visited.size > 200) fail('more than 200 Word story parts are unsupported.')
  draft.hooks.progress(`Reading ${label.toLowerCase()}…`)
  const document = await office.xml(part), root = document.documentElement
  if (!inSpace(root, 'word') || root.localName !== expectedRoot) fail('a Word story has an unsupported structure.')
  if (expectedRoot === 'document' && elements(root, 'body', 'word').length !== 1) fail('the Word document must contain one body.')
  const childName = ({ footnotes: 'footnote', endnotes: 'endnote', comments: 'comment' } as Record<string, string>)[expectedRoot]
  if (childName) {
   for (const child of elements(root, childName, 'word')) {
    const id = attr(child, 'id', 'word'), author = attr(child, 'author', 'word')
    draft.add(`${label} ${id}${author ? ` by ${author}` : ''}`, storedText(child, 'word'))
   }
  } else draft.add(label, storedText(root, 'word'))
  if (elements(root, 'altChunk', 'word').length) draft.notes.add('Embedded alternative document chunks are unsupported and were not extracted.')
  if (elements(root, 'delText', 'word').length) draft.notes.add('Stored deleted revisions are included. Check the current wording against the original.')
  if (root.getElementsByTagNameNS('http://schemas.openxmlformats.org/markup-compatibility/2006', 'AlternateContent').length) draft.notes.add('Stored alternative representations are included and may duplicate text or pictures.')
  if (elements(root, 'oMath').length) draft.notes.add('Mathematical equations are not interpreted; their content may be absent.')
  await pictures.from(part, label)
  for (const relation of (await office.rels(part)).values()) {
   const title = storyKinds[relation.kind]
   if (!title || relation.external || visited.has(relation.target)) continue
   const count = (counts.get(title) ?? 0) + 1; counts.set(title, count)
   queue.push([relation.target, `${title} ${count}`, storyRoots[relation.kind]])
  }
 }
 draft.notes.add('Word text includes body, linked headers, footers, footnotes, endnotes, comments and text boxes where stored. Section repetition, page layout, numbering and field evaluation are not reproduced.')
}
