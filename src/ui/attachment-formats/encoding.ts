import { fail } from './common'

const codePages: Record<number, string> = { 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 1200: 'utf-16le', 1201: 'utf-16be', 65001: 'utf-8' }
export const fontPages: Record<number, number> = { 2: -2, 77: 10000, 128: 932, 129: 949, 130: 1361, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250, 254: 437, 255: 850 }

export function decoder(label: string) {
 try { return new TextDecoder(label, { fatal: true }) }
 catch { return fail('the declared character encoding is unsupported by this browser.') }
}
export function codePageDecoder(page: number) {
 if (page === -2) fail('Symbol font glyph encoding is unsupported. Supply reviewed text for those glyphs.')
 const label = codePages[page] ?? (page >= 1250 && page <= 1258 ? `windows-${page}` : '')
 if (!label) fail(`RTF code page ${page} is unsupported. No replacement encoding was used.`)
 return decoder(label)
}
export function bom(bytes: Uint8Array): string | undefined {
 if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
 if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
 if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
 return undefined
}
export function decodeText(bytes: Uint8Array, declared = 'utf-8') {
 const label = bom(bytes) ?? declared
 try { return { text: decoder(label).decode(bytes), encoding: label } }
 catch { return fail('text bytes are invalid for their declared encoding. No replacement encoding was used.') }
}
