// Minimal MS-CFB version 3 writer for small, synthetic binary Office fixtures.
// Authored from the public Microsoft format specification; no third-party data.
const END = 0xfffffffe, FREE = 0xffffffff
export const u16 = value => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes }
export const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value >>> 0); return bytes }
export function compound(streams) {
 const sectors = [], links = [], miniLinks = [], miniParts = []
 const allocate = (bytes, block = 512) => {
  const start = sectors.length, count = Math.ceil(bytes.length / block)
  for (let n = 0; n < count; n++) {
   const part = Buffer.alloc(block); bytes.copy(part, 0, n * block, (n + 1) * block)
   sectors.push(part); links.push(n + 1 < count ? start + n + 1 : END)
  }
  return count ? start : END
 }
 const directoryId = allocate(Buffer.alloc(512))
 const entries = Object.entries(streams).sort(([a], [b]) => a.length - b.length || a.toUpperCase().localeCompare(b.toUpperCase())).map(([name, bytes]) => {
  let start
  if (bytes.length < 4096) {
   start = miniParts.length
   const count = Math.ceil(bytes.length / 64)
   for (let n = 0; n < count; n++) { const part = Buffer.alloc(64); bytes.copy(part, 0, n * 64, (n + 1) * 64); miniParts.push(part); miniLinks.push(n + 1 < count ? start + n + 1 : END) }
  } else start = allocate(bytes)
  return { name, start, size: bytes.length, left: FREE, right: FREE, color: 0 }
 })
 if (entries.length > 3) throw new Error('Synthetic fixture writer supports at most three streams')
 const miniBytes = Buffer.concat(miniParts), miniStart = allocate(miniBytes), miniFat = Buffer.alloc(512, 255)
 miniLinks.forEach((id, index) => miniFat.writeUInt32LE(id >>> 0, index * 4))
 const miniFatStart = miniParts.length ? allocate(miniFat) : END
 const middle = Math.floor(entries.length / 2)
 if (entries.length) { entries[middle].color = 1; if (middle) entries[middle].left = 1; if (middle + 1 < entries.length) entries[middle].right = middle + 2 }
 const directoryEntry = (name, kind, start, size, child, left = FREE, right = FREE, color = 1) => {
  const bytes = Buffer.alloc(128), encoded = Buffer.from(name + '\0', 'utf16le'); encoded.copy(bytes)
  bytes.writeUInt16LE(encoded.length, 64); bytes[66] = kind; bytes[67] = color
  bytes.writeUInt32LE(left, 68); bytes.writeUInt32LE(right, 72); bytes.writeUInt32LE(child, 76)
  bytes.writeUInt32LE(start, 116); bytes.writeUInt32LE(size, 120)
  return bytes
 }
 const directory = sectors[directoryId]
 directoryEntry('Root Entry', 5, miniStart, miniBytes.length, entries.length ? middle + 1 : FREE).copy(directory)
 entries.forEach((entry, index) => directoryEntry(entry.name, 2, entry.start, entry.size, FREE, entry.left, entry.right, entry.color).copy(directory, (index + 1) * 128))
 const fatId = sectors.length, fat = Buffer.alloc(512, 255)
 links.push(0xfffffffd); links.forEach((id, index) => fat.writeUInt32LE(id >>> 0, index * 4)); sectors.push(fat)
 const header = Buffer.alloc(512)
 Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]).copy(header)
 header.writeUInt16LE(0x3e, 24); header.writeUInt16LE(3, 26); header.writeUInt16LE(0xfffe, 28); header.writeUInt16LE(9, 30); header.writeUInt16LE(6, 32)
 header.writeUInt32LE(1, 44); header.writeUInt32LE(directoryId, 48); header.writeUInt32LE(4096, 56)
 header.writeUInt32LE(miniFatStart, 60); header.writeUInt32LE(miniParts.length ? 1 : 0, 64); header.writeUInt32LE(END, 68)
 header.fill(255, 76); header.writeUInt32LE(fatId, 76)
 return Buffer.concat([header, ...sectors])
}
