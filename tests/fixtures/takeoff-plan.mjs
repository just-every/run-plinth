// Public-door test input: a genuine two-page PDF with simple measured room outlines.
export function takeoffPlan(revised=false){
 const streams=[`0.8 w 50 50 ${revised?240:200} 100 re S BT /F1 15 Tf 50 300 Td (A1 - Kitchen plan${revised?' revision B':''}) Tj ET`,`0.8 w 50 50 100 100 re S BT /F1 15 Tf 50 300 Td (A2 - Laundry plan) Tj ET`]
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',`<< /Length ${Buffer.byteLength(streams[0])} >>\nstream\n${streams[0]}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',`<< /Length ${Buffer.byteLength(streams[1])} >>\nstream\n${streams[1]}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
 let pdf='%PDF-1.4\n',offsets=[0]
 for(const [i,o] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`}
 const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
 return Buffer.from(pdf)
}
