function dimensions(width, height) {
 if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_000_000) throw new Error('Invalid synthetic TIFF dimensions.')
}

function classicTiff(entries, payloads, offsetTag) {
 entries.sort((left, right) => left[0] - right[0])
 let extra = 8 + 2 + entries.length * 12 + 4
 const external = new Map()
 for (const [tag, type, values] of entries) {
  const size = (type === 3 ? 2 : 4) * values.length
  if (size > 4) { external.set(tag, extra); extra += size + (size % 2) }
 }
 let at = extra
 const offsets = entries.find(entry => entry[0] === offsetTag)[2]
 for (let index = 0; index < payloads.length; index++) { offsets[index] = at; at += payloads[index].length }
 if (at > 20 * 1024 * 1024) throw new Error('Synthetic TIFF exceeds its original byte limit.')
 const bytes = Buffer.alloc(at)
 bytes.write('II', 0, 'ascii'); bytes.writeUInt16LE(42, 2); bytes.writeUInt32LE(8, 4)
 bytes.writeUInt16LE(entries.length, 8)
 for (let index = 0; index < entries.length; index++) {
  const [tag, type, values] = entries[index], entry = 10 + index * 12, start = external.get(tag) ?? entry + 8
  bytes.writeUInt16LE(tag, entry); bytes.writeUInt16LE(type, entry + 2); bytes.writeUInt32LE(values.length, entry + 4)
  if (external.has(tag)) bytes.writeUInt32LE(start, entry + 8)
  for (let item = 0; item < values.length; item++) {
   if (type === 3) bytes.writeUInt16LE(values[item], start + item * 2)
   else bytes.writeUInt32LE(values[item], start + item * 4)
  }
 }
 for (let index = 0; index < payloads.length; index++) bytes.set(payloads[index], offsets[index])
 return bytes
}

export function tiledTiff(pixels, width, height) {
 dimensions(width, height)
 if (!(pixels instanceof Uint8Array) || pixels.length !== width * height) throw new Error('Synthetic TIFF requires actual grayscale pixels.')
 const tileWidth = 256, tileHeight = 64, payloads = []
 for (let top = 0; top < height; top += tileHeight) {
  for (let left = 0; left < width; left += tileWidth) {
   const tile = Buffer.alloc(tileWidth * tileHeight, 255), count = Math.min(tileWidth, width - left)
   for (let row = 0; row < Math.min(tileHeight, height - top); row++) tile.set(pixels.subarray((top + row) * width + left, (top + row) * width + left + count), row * tileWidth)
   payloads.push(tile)
  }
 }
 return classicTiff([
  [256,4,[width]],[257,4,[height]],[258,3,[8]],[259,3,[1]],[262,3,[1]],
  [277,3,[1]],[284,3,[1]],[322,4,[tileWidth]],[323,4,[tileHeight]],
  [324,4,payloads.map(() => 0)],[325,4,payloads.map(bytes => bytes.length)],
 ], payloads, 324)
}

function jpegSampling(jpeg, width, height) {
 if (jpeg[0] !== 255 || jpeg[1] !== 216) throw new Error('Synthetic TIFF requires an actual JPEG stream.')
 for (let at = 2; at + 4 < jpeg.length;) {
  if (jpeg[at++] !== 255) break
  while (jpeg[at] === 255) at++
  const marker = jpeg[at++], length = jpeg.readUInt16BE(at)
  if (length < 2 || at + length > jpeg.length) break
  if (marker === 192 || marker === 193) {
   if (length !== 17 || jpeg[at + 2] !== 8 || jpeg[at + 7] !== 3 || jpeg.readUInt16BE(at + 3) !== height || jpeg.readUInt16BE(at + 5) !== width) break
   const factors = jpeg[at + 9]
   if (jpeg[at + 12] !== 17 || jpeg[at + 15] !== 17 || ![17,33,34].includes(factors)) break
   return [factors >>> 4, factors & 15]
  }
  if (marker === 218 || marker === 217) break
  at += length
 }
 throw new Error('Synthetic TIFF JPEG requires matching sequential three-component frame dimensions and sampling.')
}

export function jpegTiff(jpeg, width, height) {
 dimensions(width, height)
 if (!Buffer.isBuffer(jpeg)) throw new Error('Synthetic TIFF requires JPEG bytes in a Buffer.')
 const sampling = jpegSampling(jpeg, width, height)
 return classicTiff([
  [256,4,[width]],[257,4,[height]],[258,3,[8,8,8]],[259,3,[7]],[262,3,[6]],
  [273,4,[0]],[277,3,[3]],[278,4,[height]],[279,4,[jpeg.length]],[284,3,[1]],[530,3,sampling],
 ], [jpeg], 273)
}
