import { bounded, fail } from './types'
type Object = { [key: string]: unknown }
const object = (value: unknown): value is Object => !!value && typeof value === 'object' && !Array.isArray(value)
/** Traverse text-bearing IR fields, never arbitrary metadata, relationship URLs or image data. */
export function additionalText(ir: unknown, plain: string): { text: string; notes: string[] } {
 const parts: string[] = [], notes = new Set<string>(), seen = new Set<string>(); let nodes = 0, chars = plain.length
 function add(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return
  const text = value.trim()
  if (seen.has(text) || plain.includes(text)) return
  seen.add(text); chars += text.length + 2
  if (chars > 100_000) fail('stored text exceeds 100,000 characters. Nothing was copied.')
  parts.push(text)
 }
 function walk(value: unknown, depth: number) {
  if (depth > 64 || ++nodes > 200_000) fail('the structured document exceeds its traversal limit.')
  if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return }
  if (!object(value)) return
  if (value.type === 'text') add(value.text)
  if (value.type === 'code_block') add(value.content)
  if (value.type === 'chart') {
   add(value.title)
   if (Array.isArray(value.categories)) for (const category of value.categories) add(category)
   if (Array.isArray(value.series)) for (const series of value.series) if (object(series)) {
    add(series.name)
    if (Array.isArray(series.values)) add(series.values.filter(v => typeof v === 'number' && Number.isFinite(v) || typeof v === 'string').join('\t'))
   }
  }
  if (value.type === 'image' || value.type === 'embedded_object') notes.add('The structured document contains images or embedded objects whose native contents were not extracted.')
  for (const key of ['elements', 'content', 'rows', 'cells', 'items', 'nested', 'speaker_notes', 'header', 'footer', 'first_page_header', 'first_page_footer', 'even_page_header', 'even_page_footer']) if (value[key] !== undefined && typeof value[key] !== 'string') walk(value[key], depth + 1)
 }
 if (!object(ir) || !Array.isArray(ir.sections)) fail('the local reader returned an unsupported document model.')
 if (object(ir.metadata)) {
  if (ir.metadata.text_truncated === true) notes.add('The reader reports that stored text was truncated or incomplete.')
  if (Array.isArray(ir.metadata.warnings) && ir.metadata.warnings.length) notes.add('The reader reports structural warnings. The draft may be incomplete; inspect the original.')
 }
 for (const section of ir.sections) {
  if (object(section)) { add(section.title); walk(section, 0) }
 }
 return { text: bounded(parts.join('\n\n')), notes: [...notes] }
}
