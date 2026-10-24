import type { ReportResult } from './report-query'

const xml=(v:unknown)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'')
const utf8=new TextEncoder()
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function zip(files:Record<string,string>):Uint8Array {
 const chunks:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0,size=0
 for(const [path,content] of Object.entries(files)){
  const name=utf8.encode(path),data=utf8.encode(content),crc=crc32(data),local=new Uint8Array(30+name.length),l=new DataView(local.buffer)
  l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(10,0,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);local.set(name,30)
  const entry=new Uint8Array(46+name.length),c=new DataView(entry.buffer)
  c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);entry.set(name,46)
  chunks.push(local,data);central.push(entry);offset+=local.length+data.length;size+=entry.length
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length,true);e.setUint16(10,central.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true)
 const output=new Uint8Array(offset+size+end.length);let at=0;for(const part of [...chunks,...central,end]){output.set(part,at);at+=part.length}return output
}
/** Inline string cells never execute formulas; money stays explicitly labelled in integer cents. */
export function reportXlsx(report:ReportResult):Uint8Array {
 const rows:unknown[][]=[['Scope and filters',JSON.stringify(report.annotation)],['Current report date (UTC)',new Date().toISOString().slice(0,10)],['record_id','record_name','currency',...report.columns.map(c=>c.name+(c.type==='money'?' (currency and integer cents)':''))]]
 for(const row of report.rows)rows.push([row.id,row.label,row.currency,...report.columns.map(c=>{const v=row.values[c.id];return v&&typeof v==='object'?`${v.currency} ${v.amount_cents}`:v})])
 for(const total of report.money_totals)rows.push(['Total',total.column_id,total.currency,total.amount_cents,total.count])
 const sheet='<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+rows.map((row,i)=>`<row r="${i+1}">`+row.map(v=>typeof v==='number'?`<c><v>${v}</v></c>`:`<c t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')+'</row>').join('')+'</sheetData></worksheet>'
 return zip({
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application\u002fvnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application\u002fxml"/><Override PartName="/xl/workbook.xml" ContentType="application\u002fvnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application\u002fvnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Scoped report" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':sheet,
 })
}
