import { fail, MAX_INPUT, MAX_PIXELS } from './common'

export type TiffPage = { tags: Record<string, number[]>; width: number; height: number; orientation: number; rowBytes: number; rows: number; offsets: number[]; lengths: number[]; compression: number }
const fieldSizes = [0,1,1,2,4,8,1,1,2,4,8,4,8,4]
const wanted = new Set([256,257,258,259,262,266,273,274,277,278,279,284,292,293,317,320,322,323,324,325,338,339,347])

export function tiffHeader(buffer: ArrayBuffer) {
 const bytes = new Uint8Array(buffer), view = new DataView(buffer), pages: TiffPage[] = [], notes = new Set<string>(), seen = new Set<number>()
 if (bytes.length < 8 || bytes.length > MAX_INPUT) fail('TIFF input is truncated or exceeds 20 MiB.')
 const little = bytes[0] === 73 && bytes[1] === 73
 if (!little && !(bytes[0] === 77 && bytes[1] === 77)) fail('the TIFF byte order is invalid.')
 const short = (offset: number) => view.getUint16(offset, little), long = (offset: number) => view.getUint32(offset, little)
 if (short(2) !== 42) fail('only classic TIFF is supported. BigTIFF and raw camera containers are unsupported.')
 let offset = long(4), totalPixels = 0, totalTags = 0
 while (offset) {
  if (seen.has(offset) || pages.length >= 200 || offset + 2 > bytes.length) fail('TIFF has a directory cycle, invalid offset or more than 200 pages.')
  seen.add(offset)
  const count = short(offset), tags: Record<string, number[]> = {}
  if (!count || count > 1024 || (totalTags += count) > 20_000 || offset + 2 + count * 12 + 4 > bytes.length) fail('TIFF directory entries are malformed or exceed bounded metadata limits.')
  for (let index = 0; index < count; index++) {
   const at = offset + 2 + index * 12, tag = short(at), type = short(at + 2), count = long(at + 4), size = fieldSizes[type]
   if (!size || !count || count * size > MAX_INPUT) fail('a TIFF tag has an invalid type or count.')
   const data = count * size <= 4 ? at + 8 : long(at + 8)
   if (data + count * size > bytes.length) fail('TIFF tag data lies outside the original file.')
   if ([330,34665,34853,40965].includes(tag)) notes.add('TIFF subimages and descriptive EXIF metadata are not traversed. Only the main page directory chain is read.')
   if (!wanted.has(tag)) continue
   if (tags[`t${tag}`] || ![1,3,4,7].includes(type) || count > 65536) fail('TIFF pixel metadata is duplicated or uses an unsupported layout.')
   const values: number[] = []
   for (let item = 0; item < count; item++) values.push(type === 3 ? short(data + item * 2) : type === 4 ? long(data + item * 4) : bytes[data + item])
   tags[`t${tag}`] = values
  }
  const scalar = (tag: number, defaultValue?: number) => {
   const values = tags[`t${tag}`]
   if (values && values.length !== 1) fail('a scalar TIFF pixel tag has multiple values.')
   const value = values?.[0] ?? defaultValue
   if (value === undefined) fail('TIFF is missing required pixel metadata.')
   return value
  }
  const width = scalar(256), height = scalar(257), samples = scalar(277, 1), bits = tags.t258 ?? [1]
  const compression = scalar(259, 1), photo = scalar(262, 0), orientation = scalar(274, 1)
  if (!width || !height || width * height > MAX_PIXELS || (totalPixels += width * height) > 64_000_000) fail('TIFF exceeds 16 megapixels per page or 64 megapixels total.')
  if (scalar(284, 1) !== 1 || (tags.t339 ?? [1]).some(format => format !== 1)) fail('planar or signed and floating-point TIFF samples are unsupported.')
  if (!bits.length || bits.length > 4 || bits.some(bit => bit !== bits[0]) || ![1,2,4,8,16].includes(bits[0])) fail('the TIFF sample depth is unsupported.')
  if (!(photo === 0 && samples === 1 && [1,4,8,16].includes(bits[0]) || photo === 1 && samples === 1 && [1,2,8,16].includes(bits[0]) || photo === 2 && [3,4].includes(samples) && [8,16].includes(bits[0]) || photo === 3 && samples === 1 && [1,2,4,8].includes(bits[0]))) fail('the TIFF color model or sample layout is unsupported.')
  if (![1,2,3,4,5,8,32946,32773].includes(compression)) fail(`TIFF compression ${compression} is unsupported. JPEG, raw camera and proprietary TIFF compression are not decoded.`)
  if ([2,3,4].includes(compression) && (bits[0] !== 1 || samples !== 1)) fail('fax TIFF compression requires one-bit grayscale samples.')
  if (![1,2].includes(scalar(266, 1)) || ![1,2].includes(scalar(317, 1)) || orientation < 1 || orientation > 8) fail('TIFF fill order, predictor or orientation is unsupported.')
  if (scalar(266, 1) === 2 && ![2,3,4].includes(compression)) fail('reversed bit order outside fax TIFF compression is unsupported.')
  if (scalar(292, 0) & 2 || scalar(293, 0)) fail('uncompressed fax extensions are unsupported.')
  if (scalar(317, 1) === 2 && ![8,16].includes(bits[0])) fail('TIFF horizontal prediction with packed samples is unsupported.')
  if (photo === 3 && tags.t320?.length !== 3 * 2 ** bits[0]) fail('the TIFF palette is missing or invalid.')
  if (tags.t322 || tags.t324) fail('tiled TIFF pages are unsupported. Supply a stripped TIFF or reviewed text.')
  const rows = Math.min(scalar(278, height), height), offsets = tags.t273, lengths = tags.t279
  if (!rows || !offsets || !lengths || offsets.length !== Math.ceil(height / rows) || lengths.length !== offsets.length || offsets.length > 16384) fail('TIFF strip counts or row spans are invalid or unsupported.')
  const rowBytes = Math.ceil(width * samples * bits[0] / 8)
  for (let index = 0; index < offsets.length; index++) {
   if (!lengths[index] || offsets[index] + lengths[index] > bytes.length) fail('a TIFF strip lies outside the original file.')
   if (compression === 1 && lengths[index] !== rowBytes * Math.min(rows, height - index * rows)) fail('an uncompressed TIFF strip has an inconsistent byte count.')
  }
  tags.t258 = bits; tags.t259 = [compression]; tags.t262 = [photo]; tags.t277 = [samples]; tags.t278 = [rows]
  pages.push({ tags, width, height, orientation, rowBytes, rows, offsets, lengths, compression })
  offset = long(offset + 2 + count * 12)
 }
 if (!pages.length) fail('TIFF contains no main image pages.')
 return { pages, notes: [...notes] }
}
