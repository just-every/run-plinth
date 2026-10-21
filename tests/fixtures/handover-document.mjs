// Genuine, distinguishable PDF originals for the public handover upload/download journey.
export function handoverDocument(title, revision=1) {
 const escaped = value => String(value).replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)')
 const lines = [title, `Original revision ${revision}`, 'Mason residence - construction handover', 'Synthetic test original; human document review remains required.']
 const content = lines.map((line,n) => `BT /F1 ${n ? 12 : 18} Tf 48 ${740-n*30} Td (${escaped(line)}) Tj ET`).join('\n')
 const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
 let pdf='%PDF-1.4\n';const offsets=[]
 for (const [i,object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n` }
 const start=Buffer.byteLength(pdf)
 pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
 return Buffer.from(pdf)
}
