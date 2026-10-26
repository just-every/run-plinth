import { deflateSync } from 'node:zlib'
/** Genuine compressed, hex-encoded PDF pages: the searched words are not present in the original bytes. */
export function searchDocument(pages = ['Reviewed service clearances', 'Final sheet confirms service-clearance-2418']) {
 const objects = [], kids = pages.map((_, i) => `${3 + 2 * i} 0 R`).join(' '), font = 3 + 2 * pages.length
 objects.push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`))
 for (const [i, text] of pages.entries()) {
  const stream = deflateSync(Buffer.from(`BT /F1 14 Tf 40 300 Td <${Buffer.from(text).toString('hex')}> Tj ET`))
  objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4 + 2 * i} 0 R >>`), Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from('\nendstream')]))
 }
 objects.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'))
 const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0]
 for (const [i, object] of objects.entries()) { offsets.push(Buffer.concat(chunks).length); chunks.push(Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')) }
 const xref = Buffer.concat(chunks).length
 chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`))
 return Buffer.concat(chunks)
}
