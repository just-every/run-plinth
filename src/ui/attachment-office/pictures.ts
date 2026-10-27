import type { OfficePackage } from './package'
import { fail } from './types'
import { extractChart } from './charts'
import { storedText } from './xml'

const rasterTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' }
const unsupportedRelations = new Set(['oleObject', 'package', 'diagramData', 'audio', 'video', 'control', 'aFChunk', 'altChunk', 'subDocument'])

export class Pictures {
 private recognized = new Map<string, Promise<string>>()
 private visited = new Set<string>()
 private charts = new Set<string>()
 constructor(private office: OfficePackage) {}
 async from(part: string, label: string, drawingText = false) {
  const { draft, archive } = this.office
  draft.hooks.check()
  const key = `${label}\n${part}`
  if (this.visited.has(key)) return
  this.visited.add(key)
  if (this.visited.size > 400) fail('more than 400 attributed drawing or story parts are unsupported.')
  if (drawingText) {
   const document = await this.office.xml(part)
   draft.add(`${label} drawing text`, storedText(document.documentElement, 'drawing'))
   for (const textbox of document.getElementsByTagNameNS('urn:schemas-microsoft-com:vml', 'textbox')) draft.add(`${label} legacy text box`, textbox.textContent ?? '')
  }
  for (const relation of (await this.office.rels(part)).values()) {
   draft.hooks.check()
   if (relation.external) continue
   if (unsupportedRelations.has(relation.kind)) draft.notes.add(`Unsupported embedded content in ${label}: ${relation.kind}. Its contents were not extracted.`)
   if (['drawing', 'vmlDrawing'].includes(relation.kind)) { await this.from(relation.target, label, true); continue }
   if (relation.kind === 'chart') {
    if (!this.charts.has(relation.target)) {
     if (this.charts.size >= 40) fail('more than 40 chart parts are unsupported.')
     this.charts.add(relation.target)
     await extractChart(this.office, relation.target, `${label} chart`)
     await this.from(relation.target, label)
    }
    continue
   }
   if (relation.kind !== 'image') continue
   const extension = relation.target.split('.').at(-1)?.toLowerCase() ?? '', type = rasterTypes[extension]
   if (!type) { draft.notes.add(`An unsupported picture format in ${label} was not read: ${extension || 'unknown'}.`); continue }
   if (extension === 'gif') draft.notes.add('GIF pictures use their first decoded frame. Other animation frames are not read.')
   let recognized = this.recognized.get(relation.target)
   if (!recognized) {
    if (this.recognized.size >= 40) fail('more than 40 unique raster pictures are unsupported.')
    recognized = (async () => {
     const bytes = await archive.read(relation.target)
     draft.hooks.check(); draft.hooks.progress(`Recognizing a raster picture in ${label}…`)
     const text = await draft.hooks.recognizeImage(new Blob([bytes], { type }))
     draft.hooks.check()
     return draft.hooks.boundedText(text)
    })()
    this.recognized.set(relation.target, recognized)
   }
   const text = await recognized
   draft.hooks.check()
   if (text.trim()) draft.add(`${label} raster picture`, text)
   else draft.notes.add(`No text was recognized in a raster picture in ${label}. Inspect it manually.`)
  }
 }
}
