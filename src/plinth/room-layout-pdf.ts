import { layoutMeasures, placementCorners, type LayoutRevision } from './room-layout-model'

/** Vector geometry and dimension labels in a real, independently readable PDF. */
export function layoutPdf(name:string,r:LayoutRevision):Uint8Array<ArrayBuffer>{
 const ps=r.points,minX=Math.min(...ps.map(p=>p.x)),minY=Math.min(...ps.map(p=>p.y)),w=Math.max(...ps.map(p=>p.x))-minX,h=Math.max(...ps.map(p=>p.y))-minY
 const scale=Math.min(440/Math.max(w,1),440/Math.max(h,1)),x=(n:number)=>80+(n-minX)*scale,y=(n:number)=>620-(n-minY)*scale
 const ascii=(s:string)=>s.replace(/[^\x20-\x7e]/g,'?').replace(/[()\\]/g,'\\$&')
 const label=(s:string,a:number,b:number)=>`BT /F1 12 Tf ${a.toFixed(3)} ${b.toFixed(3)} Td (${ascii(s)}) Tj ET\n`
 const m=layoutMeasures(r);let stream=label(`${name} - revision ${r.revision}`,36,756)+label(`Area ${m.area_m2} sq m; perimeter ${m.perimeter_m} m`,36,732)+label('Metres. Historical underlays are not editable geometry.',36,710)+'0.1 0.2 0.3 RG 1.5 w\n'
 ps.forEach((p,i)=>{const q=ps[(i+1)%ps.length]!;stream+=`${x(p.x)} ${y(p.y)} m ${x(q.x)} ${y(q.y)} l S\n`+label(`W${i+1}: ${m.walls[i]!.length_m} m`,(x(p.x)+x(q.x))/2+5,(y(p.y)+y(q.y))/2+8)})
 r.openings.forEach(o=>{const a=ps[o.wall]!,b=ps[(o.wall+1)%ps.length]!,length=m.walls[o.wall]!.length_m;const start={x:a.x+(b.x-a.x)*o.offset/length,y:a.y+(b.y-a.y)*o.offset/length},end={x:a.x+(b.x-a.x)*(o.offset+o.width)/length,y:a.y+(b.y-a.y)*(o.offset+o.width)/length};stream+=`0.1 0.6 0.4 RG 4 w ${x(start.x)} ${y(start.y)} m ${x(end.x)} ${y(end.y)} l S 1.5 w\n`+label(`${o.kind} ${o.width} x ${o.height} m`,x(start.x)+5,y(start.y)-16)})
 r.placements.forEach(p=>{const corners=placementCorners(p),a=corners[0]!,b=corners[2]!;stream+=`0.4 0.4 0.4 RG ${x(a.x)} ${y(b.y)} ${(b.x-a.x)*scale} ${(b.y-a.y)*scale} re S\n`+label(`${p.name} ${p.width} x ${p.depth} m`,x(p.x)+3,y(p.y)-14)})
 stream+=label('Reviewed design draft. No professional certification or work release.',36,52)
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [4 0 R] >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream}endstream`]
 let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`});const start=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return new TextEncoder().encode(pdf)
}
