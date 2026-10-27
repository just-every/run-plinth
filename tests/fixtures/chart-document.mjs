import JSZip from 'jszip'

export const chartTerms = ['synthetic-plinth-9700', 'synthetic-plinth-9701', 'synthetic-plinth-9702', 'synthetic-plinth-9703', '42871', '53109', 'GraphData!$B$2:$B$3', 'synthetic-plinth-9704']
const s = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const c = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const xml = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body
const relations = items => xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, kind, target]) => `<Relationship Id="${id}" Type="${r}/${kind}" Target="${target}"/>`).join('')}</Relationships>`)
const cache = (name, values) => `<c:${name}><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('')}</c:${name}>`

export async function chartDocument() {
 const zip = new JSZip()
 const contentTypes = [
  ['/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
  ['/xl/worksheets/sheet1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'],
  ['/xl/drawings/drawing1.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml'],
  ['/xl/charts/chart1.xml', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'],
 ]
 zip.file('[Content_Types].xml', xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${contentTypes.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('')}</Types>`))
 zip.file('_rels/.rels', relations([['main', 'officeDocument', 'xl/workbook.xml']]))
 zip.file('xl/workbook.xml', xml(`<workbook xmlns="${s}" xmlns:r="${r}"><sheets><sheet name="GraphData" sheetId="1" r:id="sheet"/></sheets></workbook>`))
 zip.file('xl/_rels/workbook.xml.rels', relations([['sheet', 'worksheet', 'worksheets/sheet1.xml']]))
 zip.file('xl/worksheets/sheet1.xml', xml(`<worksheet xmlns="${s}" xmlns:r="${r}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Recorded categories</t></is></c><c r="B1" t="inlineStr"><is><t>Stored worksheet figures</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>First phase</t></is></c><c r="B2"><v>100</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Second phase</t></is></c><c r="B3"><v>200</v></c></row></sheetData><drawing r:id="drawing"/></worksheet>`))
 zip.file('xl/worksheets/_rels/sheet1.xml.rels', relations([['drawing', 'drawing', '../drawings/drawing1.xml']]))
 zip.file('xl/drawings/drawing1.xml', xml(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${a}" xmlns:c="${c}" xmlns:r="${r}"><xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="5486400" cy="3657600"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Recorded graph"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="3657600"/></xdr:xfrm><a:graphic><a:graphicData uri="${c}"><c:chart r:id="chart"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`))
 zip.file('xl/drawings/_rels/drawing1.xml.rels', relations([['chart', 'chart', '../charts/chart1.xml']]))
 const series = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>GraphData!$B$1</c:f>${cache('strCache', [chartTerms[1]])}</c:strRef></c:tx><c:cat><c:strRef><c:f>GraphData!$A$2:$A$3</c:f>${cache('strCache', chartTerms.slice(2, 4))}</c:strRef></c:cat><c:val><c:numRef><c:f>${chartTerms[6]}</c:f><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>${chartTerms[4]}</c:v></c:pt><c:pt idx="1"><c:v>${chartTerms[5]}</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>`
 zip.file('xl/charts/chart1.xml', xml(`<c:chartSpace xmlns:c="${c}" xmlns:a="${a}"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${chartTerms[0]} ${chartTerms[7]}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series}<c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:numFmt formatCode="0" sourceLinked="0"/><c:crossAx val="1"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`))
 return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
