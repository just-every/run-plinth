/** A classic little-endian TIFF with two complete grayscale image directories. */
export function multipageTiff(pages, width, height) {
 const tags = 10, directoryBytes = 2 + tags * 12 + 4
 const pixels = width * height, firstPixels = 8 + pages.length * directoryBytes
 const bytes = Buffer.alloc(firstPixels + pages.length * pixels)
 bytes.write('II', 0); bytes.writeUInt16LE(42, 2); bytes.writeUInt32LE(8, 4)
 pages.forEach((page, index) => {
  const offset = 8 + index * directoryBytes; bytes.writeUInt16LE(tags, offset)
  const values = [[256, 4, width], [257, 4, height], [258, 3, 8], [259, 3, 1], [262, 3, 1], [273, 4, firstPixels + index * pixels], [277, 3, 1], [278, 4, height], [279, 4, pixels], [284, 3, 1]]
  values.forEach(([tag, type, value], slot) => { const entry = offset + 2 + slot * 12; bytes.writeUInt16LE(tag, entry); bytes.writeUInt16LE(type, entry + 2); bytes.writeUInt32LE(1, entry + 4); if (type === 3) bytes.writeUInt16LE(value, entry + 8); else bytes.writeUInt32LE(value, entry + 8) })
  bytes.writeUInt32LE(index + 1 < pages.length ? offset + directoryBytes : 0, offset + 2 + tags * 12)
  Buffer.from(page).copy(bytes, firstPixels + index * pixels)
 })
 return bytes
}

export function richTextDocument(png) {
 const image = Buffer.from(png).toString('hex')
 return Buffer.from('{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Arial;}}{\\header synthetic-plinth-rtfheader-9401}{\\footer synthetic-plinth-rtffooter-9402}\\f0 synthetic-plinth-rtfbody-9400 caf\\\'e9 \\u937? \\par {\\field{\\*\\fldinst HYPERLINK "https://example.invalid/never-fetch"}{\\fldrslt synthetic-plinth-rtffield-9403}}\\par {\\pict\\pngblip\\picw1200\\pich180 ' + image + '}}', 'ascii')
}
