import type { OfficePackage } from './package'
import { Pictures } from './pictures'
import { fail } from './types'
import { attr, elements, inSpace, storedText } from './xml'

export async function extractPresentation(office: OfficePackage, main: string) {
 const { draft } = office, presentation = await office.xml(main), pictures = new Pictures(office)
 const slides = elements(presentation, 'sldId', 'slide')
 if (!slides.length || slides.length > 200) fail('a presentation must contain between one and 200 slides.')
 const inherited = new Set<string>()
 for (let index = 0; index < slides.length; index++) {
  draft.hooks.check()
  const label = `Slide ${index + 1}`, path = await office.referenced(main, attr(slides[index], 'id', 'rel'), 'slide')
  draft.hooks.progress(`Reading ${label}…`)
  const slide = await office.xml(path)
  if (slide.documentElement.localName !== 'sld' || !inSpace(slide.documentElement, 'slide')) fail('a presentation slide has an unsupported structure.')
  draft.add(label, storedText(slide.documentElement, 'drawing'))
  await pictures.from(path, label)
  const related = [...(await office.rels(path)).values()].filter(relation => !relation.external && ['notesSlide', 'comments', 'slideLayout'].includes(relation.kind))
  for (const relation of related) {
   const document = await office.xml(relation.target), root = document.documentElement
   if (relation.kind === 'notesSlide') {
    if (root.localName !== 'notes' || !inSpace(root, 'slide')) fail('speaker notes have an unsupported structure.')
    draft.add(`${label} speaker notes`, storedText(root, 'drawing'))
    await pictures.from(relation.target, `${label} speaker notes`)
   } else if (relation.kind === 'comments') {
    if (root.localName !== 'cmLst' || !inSpace(root, 'slide')) {
     draft.notes.add(`Modern comments in ${label} are unsupported and were not read.`); continue
    }
    for (const comment of elements(root, 'cm', 'slide')) {
     const text = elements(comment, 'text', 'slide').map(element => element.textContent ?? '').join('\n')
     draft.add(`${label} comment ${attr(comment, 'idx')} by author ${attr(comment, 'authorId')}`, text)
    }
   } else {
    const queue: [string, string][] = [[relation.target, 'layout']]
    while (queue.length) {
     draft.hooks.check()
     const [part, kind] = queue.shift()!
     const key = `${index}\n${part}`
     if (inherited.has(key)) continue
     inherited.add(key)
     if (inherited.size > 400) fail('more than 400 attributed slide layouts and masters are unsupported.')
     const layout = await office.xml(part)
     if (!inSpace(layout.documentElement, 'slide') || !['sldLayout', 'sldMaster'].includes(layout.documentElement.localName)) fail('a slide layout or master has an unsupported structure.')
     draft.add(`${label} stored ${kind}`, storedText(layout.documentElement, 'drawing'))
     await pictures.from(part, `${label} stored ${kind}`)
     for (const master of (await office.rels(part)).values()) if (!master.external && master.kind === 'slideMaster') queue.push([master.target, 'master'])
    }
   }
  }
 }
 draft.notes.add('Presentation text includes stored slide shapes, tables, speaker notes, classic comments, layouts and masters. Master placeholders and hidden slides may add duplicate or non-visible text. Animations and media playback are not reproduced.')
}
