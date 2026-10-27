import JSZip from 'jszip'

export const slideTerms = ['synthetic-plinth-slide-9400', 'synthetic-plinth-notes-9401', 'synthetic-plinth-comment-9402', 'synthetic-plinth-layout-9403', 'synthetic-plinth-master-9404', 'VENTILATION']
const p = 'http://schemas.openxmlformats.org/presentationml/2006/main', r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const xml = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body
const relations = items => xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, kind, target]) => `<Relationship Id="${id}" Type="${r}/${kind}" Target="${target}"/>`).join('')}</Relationships>`)
const shape = text => `<p:sp><p:nvSpPr><p:cNvPr id="1" name="Construction note"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
const tree = content => `<p:spTree><p:nvGrpSpPr><p:cNvPr id="0" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${content}</p:spTree>`

/** A compressed presentation retaining actual slide, notes, classic comment, layout and master parts. */
export async function presentationDocument(image) {
 const zip = new JSZip()
 const entries = [['presentation', 'presentation.main'], ['slides/slide1', 'slide'], ['notesSlides/notesSlide1', 'notesSlide'], ['slideLayouts/slideLayout1', 'slideLayout'], ['slideMasters/slideMaster1', 'slideMaster'], ['comments/comment1', 'comments']]
 zip.file('[Content_Types].xml', xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${entries.map(([part, kind]) => `<Override PartName="/ppt/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml"/>`).join('')}</Types>`))
 zip.file('_rels/.rels', relations([['main', 'officeDocument', 'ppt/presentation.xml']]))
 zip.file('ppt/presentation.xml', xml(`<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="master"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`))
 zip.file('ppt/_rels/presentation.xml.rels', relations([['slide', 'slide', 'slides/slide1.xml'], ['master', 'slideMaster', 'slideMasters/slideMaster1.xml']]))
 const picture = '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Site image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="1371600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
 zip.file('ppt/slides/slide1.xml', xml(`<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld>${tree(shape(slideTerms[0]) + picture)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`))
 zip.file('ppt/slides/_rels/slide1.xml.rels', relations([['image', 'image', '../media/site.png'], ['notes', 'notesSlide', '../notesSlides/notesSlide1.xml'], ['comments', 'comments', '../comments/comment1.xml'], ['layout', 'slideLayout', '../slideLayouts/slideLayout1.xml']]))
 zip.file('ppt/notesSlides/notesSlide1.xml', xml(`<p:notes xmlns:p="${p}" xmlns:a="${a}"><p:cSld>${tree(shape(slideTerms[1]))}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`))
 zip.file('ppt/comments/comment1.xml', xml(`<p:cmLst xmlns:p="${p}"><p:cm authorId="0" dt="2026-10-27T00:00:00Z" idx="1"><p:pos x="0" y="0"/><p:text>${slideTerms[2]}</p:text></p:cm></p:cmLst>`))
 zip.file('ppt/slideLayouts/slideLayout1.xml', xml(`<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" type="blank"><p:cSld>${tree(shape(slideTerms[3]))}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`))
 zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relations([['master', 'slideMaster', '../slideMasters/slideMaster1.xml']]))
 zip.file('ppt/slideMasters/slideMaster1.xml', xml(`<p:sldMaster xmlns:p="${p}" xmlns:a="${a}"><p:cSld>${tree(shape(slideTerms[4]))}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/></p:sldMaster>`))
 zip.file('ppt/media/site.png', image)
 return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
