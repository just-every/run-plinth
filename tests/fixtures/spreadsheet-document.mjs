import JSZip from 'jszip'

export const sheetTerms = ['synthetic-plinth-shared-9300', 'synthetic-plinth-inline-9301', 'synthetic-plinth-second-9302', 'synthetic-plinth-comment-9303', 'synthetic-plinth-drawing-9304', 'synthetic-plinth-print-9305', '41000+1157', 'FRAMING']
const s = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const xml = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body
const relations = items => xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, kind, target]) => `<Relationship Id="${id}" Type="${r}/${kind}" Target="${target}"/>`).join('')}</Relationships>`)

/** A real workbook with shared and inline strings, cached formula data, comments and a drawing. */
export async function spreadsheetDocument(image) {
 const zip = new JSZip()
 zip.file('[Content_Types].xml', xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'))
 zip.file('_rels/.rels', relations([['main', 'officeDocument', 'xl/workbook.xml']]))
 zip.file('xl/workbook.xml', xml(`<workbook xmlns="${s}" xmlns:r="${r}"><sheets><sheet name="Cabinet clearances" sheetId="1" r:id="sheet1"/><sheet name="Revision checks" sheetId="2" r:id="sheet2"/></sheets></workbook>`))
 zip.file('xl/_rels/workbook.xml.rels', relations([['sheet1', 'worksheet', 'worksheets/sheet1.xml'], ['sheet2', 'worksheet', 'worksheets/sheet2.xml'], ['strings', 'sharedStrings', 'sharedStrings.xml']]))
 zip.file('xl/sharedStrings.xml', xml(`<sst xmlns="${s}" count="1" uniqueCount="1"><si><t>${sheetTerms[0]}</t></si></sst>`))
 zip.file('xl/worksheets/sheet1.xml', xml(`<worksheet xmlns="${s}" xmlns:r="${r}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>${sheetTerms[1]}</t></is></c><c r="C1"><f>${sheetTerms[6]}</f><v>42157</v></c></row></sheetData><headerFooter><oddHeader>&amp;C${sheetTerms[5]}</oddHeader></headerFooter><drawing r:id="drawing"/></worksheet>`))
 zip.file('xl/worksheets/sheet2.xml', xml(`<worksheet xmlns="${s}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${sheetTerms[2]}</t></is></c></row></sheetData></worksheet>`))
 zip.file('xl/worksheets/_rels/sheet1.xml.rels', relations([['drawing', 'drawing', '../drawings/drawing1.xml'], ['comments', 'comments', '../comments1.xml']]))
 zip.file('xl/comments1.xml', xml(`<comments xmlns="${s}"><authors><author>Synthetic Plinth</author></authors><commentList><comment ref="A1" authorId="0"><text><t>${sheetTerms[3]}</t></text></comment></commentList></comments>`))
 zip.file('xl/drawings/drawing1.xml', xml(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${a}" xmlns:r="${r}"><xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="9144000" cy="1371600"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Site image"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:absoluteAnchor><xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="9144000" cy="1371600"/><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="2" name="Drawing note"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/><xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${sheetTerms[4]}</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`))
 zip.file('xl/drawings/_rels/drawing1.xml.rels', relations([['image', 'image', '../media/site.png']]))
 zip.file('xl/media/site.png', image)
 return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
