import type { OfficeHooks } from '../attachment-office/types'
import { Draft, fail, pause } from './common'
import { codePageDecoder, fontPages } from './encoding'
import { InlinePictures } from './raster'
import { RtfPicture } from './rtf-picture'
import { tokens } from './rtf-tokens'

type State = { dest: 'text' | 'skip' | 'font' | 'picture'; page: number; font?: number; uc: number; star: boolean; hardSkip: boolean; picture?: RtfPicture; pictureRoot: boolean }
const omit = new Set(['fonttbl','colortbl','stylesheet','info','filetbl','listtable','listoverridetable','revtbl','rsidtbl','generator','datastore','themedata','colorschememapping','xmlnstbl','latentstyles','fontemb','fontfile','fldinst','htmltag','picprop','blipuid','shpinst','sn','sv'])
const stories: Record<string, string> = { header: 'Header', headerl: 'Left header', headerr: 'Right header', headerf: 'First header', footer: 'Footer', footerl: 'Left footer', footerr: 'Right footer', footerf: 'First footer', footnote: 'Footnote', annotation: 'Comment', shptxt: 'Text box' }
const characters: Record<string, string> = { par: '\n', line: '\n', page: '\n', sect: '\n', row: '\n', nestrow: '\n', cell: '\t', nestcell: '\t', tab: '\t', emdash: '—', endash: '–', emspace: ' ', enspace: ' ', qmspace: ' ', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”' }

export async function extractRtf(bytes: Uint8Array<ArrayBuffer>, hooks: OfficeHooks) {
 if (String.fromCharCode(...bytes.subarray(0, 6)) !== '{\\rtf1') fail('the RTF version or file header is unsupported.')
 const draft = new Draft(hooks), pictures = new InlinePictures(draft), fonts = new Map<number, number>()
 const states: State[] = [], parts: string[] = [], images: { bytes: Uint8Array<ArrayBuffer>; type: string }[] = []
 let state: State = { dest: 'text', page: 1252, uc: 1, star: false, hardSkip: false, pictureRoot: false }
 let pending: number[] = [], textDecoder: TextDecoder | undefined, fallback = 0, defaultFont = 0, count = 0, groups = 0, closed = false
 const append = (text: string) => { parts.push(text); hooks.boundedText(parts.join('')) }
 const flush = (final = true) => {
  if (pending.length || textDecoder) {
   textDecoder ??= codePageDecoder(fonts.get(state.font ?? defaultFont) ?? state.page)
   try { append(textDecoder.decode(Uint8Array.from(pending), { stream: !final })) }
   catch { fail('text bytes are invalid for their declared RTF encoding.') }
  }
  if (final) textDecoder = undefined
  pending = []
 }
 for (const token of tokens(bytes)) {
  if (++count > 1_000_000) fail('RTF exceeds one million tokens.')
  if (count % 4096 === 0) { await pause(); hooks.check() }
  if (token.kind === 'bytes') {
   if (closed && token.bytes.some(byte => ![9,10,13,32].includes(byte))) fail('RTF has data outside its root group.')
   if (state.dest === 'picture') { state.picture!.hex(token.bytes); continue }
   if (state.dest !== 'text' || state.hardSkip) continue
   const skip = Math.min(fallback, token.bytes.length); fallback -= skip
   for (const byte of token.bytes.subarray(skip)) {
    pending.push(byte)
    if (pending.length >= 4096) { hooks.check(); flush(false) }
   }
   continue
  }
  if (token.kind === 'binary') {
   if (fallback) { fallback--; continue }
   if (state.dest === 'picture') state.picture!.binary(token.bytes)
   else draft.notes.add('Binary content outside supported inline pictures was not extracted.')
   continue
  }
  flush()
  if (token.kind === 'open') {
   if (closed || ++groups > 100_000 || states.length >= 256) fail('RTF has multiple roots or exceeds 100,000 groups or depth 256.')
   states.push(state); state = { ...state, star: false, pictureRoot: false }; fallback = 0; continue
  }
  if (token.kind === 'close') {
   if (!states.length) fail('RTF groups are unbalanced.')
   if (state.pictureRoot) {
    if (images.length >= 40) fail('RTF contains more than 40 inline pictures.')
    const image = state.picture!.finish()
    if (image.type) images.push(image)
    else draft.notes.add('An RTF picture uses an unsupported vector or bitmap encoding. Its content was not read.')
   }
   state = states.pop()!; fallback = 0; if (!states.length) closed = true
   continue
  }
  if (token.kind === 'symbol') {
   if (token.name === '*') { state.star = true; continue }
   if (fallback) { fallback--; continue }
   if (state.dest === 'text' && !state.hardSkip) {
    if (['\\','{','}'].includes(token.name)) append(token.name)
    else if (token.name === '~') append('\u00a0')
    else if (token.name === '_') append('‑')
    else if (token.name === '-') append('\u00ad')
   }
   continue
  }
  if (token.kind !== 'word') continue
  const { name, value } = token
  if (fallback && name !== 'u') { fallback--; continue }
  const starred = state.star; state.star = false
  if (name === 'rtf' && value !== 1) fail('the RTF version is unsupported.')
  if (name === 'object' || name === 'objdata') { state.dest = 'skip'; state.hardSkip = true; draft.notes.add('Embedded RTF objects are unsupported and were not opened.'); continue }
  if (state.hardSkip) continue
  if (omit.has(name)) {
   state.dest = name === 'fonttbl' ? 'font' : 'skip'
   if (name === 'fldinst') draft.notes.add('RTF field instructions and linked resources were not evaluated or followed. Stored field results are included.')
   continue
  }
  if (name === 'pict') { state.dest = 'picture'; state.picture = new RtfPicture(); state.pictureRoot = true; continue }
  if (name === 'pngblip' || name === 'jpegblip') { if (state.picture) state.picture.type = name === 'pngblip' ? 'image/png' : 'image/jpeg'; continue }
  if (['shppict','nonshppict','fldrslt','ud'].includes(name)) { if (state.dest !== 'skip') state.dest = 'text'; continue }
  if (starred) { state.dest = 'skip'; draft.notes.add(`Unsupported RTF destination ${name} was omitted.`); continue }
  if (name === 'ansicpg') { if (value === undefined) fail('RTF declares a code page without a value.'); state.page = value; continue }
  if (['ansi','mac','pc','pca'].includes(name)) { state.page = ({ ansi: 1252, mac: 10000, pc: 437, pca: 850 } as Record<string, number>)[name]; continue }
  if (name === 'deff') { if (value !== undefined) defaultFont = value; continue }
  if (name === 'f') { state.font = value; continue }
  if (name === 'fcharset' || name === 'cpg') {
   if (state.dest === 'font' && state.font !== undefined && value !== undefined) fonts.set(state.font, name === 'cpg' ? value : [0,1].includes(value) ? state.page : fontPages[value] ?? -value)
   continue
  }
  if (name === 'plain') { state.font = defaultFont; continue }
  if (name === 'uc') { if (value === undefined || value < 0 || value > 32) fail('RTF Unicode fallback width is unsupported.'); state.uc = value; continue }
  if (state.dest !== 'text') continue
  if (name === 'u') {
   if (value === undefined || value < -32768 || value > 65535) fail('an RTF Unicode code unit is invalid.')
   append(String.fromCharCode(value & 65535)); fallback = state.uc; continue
  }
  if (stories[name]) append(`\n${stories[name]}\n`)
  else if (characters[name]) append(characters[name])
  else if (['upr','deleted','v'].includes(name)) draft.notes.add('RTF includes stored alternatives, revisions or hidden text. Duplicates and superseded wording require review.')
 }
 flush(); hooks.check()
 if (states.length || !closed) fail('RTF groups are unbalanced or the root group is missing.')
 draft.add('RTF stored text', parts.join(''))
 for (let index = 0; index < images.length; index++) await pictures.read(images[index].bytes, images[index].type, `RTF picture ${index + 1}`)
 draft.notes.add('RTF text and stored inline PNG and JPEG pixels were read without rendering. Formatting, generated numbering, crop regions, fields, vector drawings and unsupported destinations are not reproduced. Stored picture alternatives may duplicate content.')
 return draft.result()
}
