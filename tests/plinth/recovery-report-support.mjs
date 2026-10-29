import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** Open real document formats independently of the application's serializers. */
export async function readRecoveryReport(bytes, format) {
 if (format === 'pdf') {
  const task = getDocument({data:new Uint8Array(bytes),useSystemFonts:true}), document = await task.promise
  try {
   let text = ''
   for (let page = 1; page <= document.numPages; page++) {
    const content = await (await document.getPage(page)).getTextContent()
    text += content.items.filter(item=>item.transform[5]>36&&item.transform[5]<756).map(item=>item.str).join('')
   }
   return {text, pages:document.numPages}
  } finally { await task.destroy() }
 }
 const script = format === 'csv'
  ? 'import csv,io,json,sys; print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.buffer.read().decode("utf-8"))))))'
  : 'import io,json,sys,zipfile,xml.etree.ElementTree as E; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; [E.fromstring(z.read(n)) for n in z.namelist()]; root=E.fromstring(z.read("xl/worksheets/sheet1.xml")); ns={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}; assert not root.findall(".//s:f",ns); print(json.dumps([["".join(c.itertext()) for c in row] for row in root.findall(".//s:row",ns)]))'
 const rows = JSON.parse(execFileSync('python3',['-c',script],{input:bytes,encoding:'utf8',maxBuffer:20_000_000}))
 return {rows, text:rows.map(row=>row.join(' | ')).join('')}
}
export function checkRecoveryReport(report, manifest, expectedControl, comparison = false) {
 const compact = value => value.replace(/\s/g,'')
 const text = compact(report.text)
 assert.ok(text.includes(compact('Plinth '+(comparison?'recovery comparison':'native recovery inventory'))))
 for (const record of manifest.records) { assert.ok(text.includes(compact(record.identity)),'Report retains record identity');assert.ok(text.includes(record.sha256),'Report retains exact record digest') }
 for (const file of manifest.files) { assert.ok(text.includes(compact(file.identity)));assert.ok(text.includes(file.sha256)) }
 for (const exclusion of manifest.exclusions) assert.ok(text.includes(compact(exclusion)),'Report carries every explicit boundary')
 if (expectedControl) {
  const row = ['Control','current',...expectedControl.map(String)]
  if (report.rows) assert.deepEqual(report.rows.find(row=>row[0]==='Control'&&row[1]==='current'&&row[2]===expectedControl[0]),row,'Human report independently reconciles financial control totals')
  else assert.ok(text.includes(compact(row.join(' | '))),'PDF retains the independently calculated financial control totals')
 }
 if (report.rows) {
  assert.equal(report.rows.filter(row=>row[0]==='Record').length,manifest.records.length)
  assert.equal(report.rows.filter(row=>row[0]==='Original').length,manifest.files.length)
  assert.equal(report.rows.filter(row=>row[0]==='Table').length,manifest.tables.length)
 }
}
