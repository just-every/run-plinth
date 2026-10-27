import JSZip from 'jszip'

export const wordTerms = ['body', 'header', 'footer', 'footnote', 'endnote', 'comment', 'textbox', 'table'].map((part, index) => `synthetic-plinth-${part}-${9200 + index}`)
const xml = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const paragraph = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

/** A compressed OOXML document with real related stories and an embedded raster picture. */
export async function wordDocument(image) {
 const zip = new JSZip()
 const parts = ['document', 'header1', 'footer1', 'footnotes', 'endnotes', 'comments']
 const types = ['document.main', 'header', 'footer', 'footnotes', 'endnotes', 'comments']
 zip.file('[Content_Types].xml', xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${parts.map((part, index) => `<Override PartName="/word/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${types[index]}+xml"/>`).join('')}</Types>`))
 zip.file('_rels/.rels', xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`))
 const imageMarkup = '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="9144000" cy="1371600"/><wp:docPr id="1" name="Site image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="site.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId6"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="1371600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
 zip.file('word/document.xml', xml(`<w:document xmlns:w="${word}" xmlns:r="${rel}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${paragraph(wordTerms[0])}<w:tbl><w:tr><w:tc>${paragraph(wordTerms[7])}</w:tc></w:tr></w:tbl><w:p><w:r><w:footnoteReference w:id="1"/><w:endnoteReference w:id="1"/><w:commentReference w:id="1"/></w:r></w:p><w:p><w:r><w:pict><v:shape id="TextBox" type="#_x0000_t202"><v:textbox><w:txbxContent>${paragraph(wordTerms[6])}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>${imageMarkup}<w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:footerReference w:type="default" r:id="rId2"/></w:sectPr></w:body></w:document>`))
 zip.file('word/header1.xml', xml(`<w:hdr xmlns:w="${word}">${paragraph(wordTerms[1])}</w:hdr>`))
 zip.file('word/footer1.xml', xml(`<w:ftr xmlns:w="${word}">${paragraph(wordTerms[2])}</w:ftr>`))
 zip.file('word/footnotes.xml', xml(`<w:footnotes xmlns:w="${word}"><w:footnote w:id="1">${paragraph(wordTerms[3])}</w:footnote></w:footnotes>`))
 zip.file('word/endnotes.xml', xml(`<w:endnotes xmlns:w="${word}"><w:endnote w:id="1">${paragraph(wordTerms[4])}</w:endnote></w:endnotes>`))
 zip.file('word/comments.xml', xml(`<w:comments xmlns:w="${word}"><w:comment w:id="1" w:author="Synthetic Plinth">${paragraph(wordTerms[5])}</w:comment></w:comments>`))
 zip.file('word/_rels/document.xml.rels', xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${['header', 'footer', 'footnotes', 'endnotes', 'comments', 'image'].map((type, index) => `<Relationship Id="rId${index + 1}" Type="${rel}/${type}" Target="${['header1.xml', 'footer1.xml', 'footnotes.xml', 'endnotes.xml', 'comments.xml', 'media/site.png'][index]}"/>`).join('')}</Relationships>`))
 zip.file('word/media/site.png', image)
 return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
