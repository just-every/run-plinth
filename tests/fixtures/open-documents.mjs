import JSZip from 'jszip'

// Original synthetic OpenDocument packages under Plinth's MIT license.
// Namespace and package structure follow OASIS OpenDocument 1.3 Parts 2 and 3.
// Searchable words occur only in actual XML content or raster pixels.
const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"'
const xml = body => '<?xml version="1.0" encoding="UTF-8"?>' + body
const p = text => `<text:p>${text}</text:p>`
const annotation = term => `<office:annotation office:name="comment"><dc:creator>Synthetic Plinth</dc:creator><dc:date>2026-10-27T12:00:00Z</dc:date>${p(term)}</office:annotation>`
const picture = '<draw:frame draw:name="Proof" svg:width="20cm" svg:height="3.2cm"><draw:image xlink:href="Pictures/proof.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>'
const styles = (header, footer, masterText = '') => xml(`<office:document-styles ${ns} office:version="1.3"><office:styles><style:style style:name="Standard" style:family="paragraph"/></office:styles><office:automatic-styles><style:page-layout style:name="Layout"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin="2cm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="Layout"><style:header>${p(header)}</style:header><style:footer>${p(footer)}</style:footer>${masterText ? `<draw:frame><draw:text-box>${p(masterText)}</draw:text-box></draw:frame>` : ''}</style:master-page></office:master-styles></office:document-styles>`)

async function pack(kind, body, header, footer, image, masterText = '', encryption = false) {
 const mime = `application/vnd.oasis.opendocument.${kind}`, zip = new JSZip()
 zip.file('mimetype', mime, { compression: 'STORE' })
 zip.file('META-INF/manifest.xml', xml(`<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}" manifest:version="1.3"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml">${encryption ? '<manifest:encryption-data/>' : ''}</manifest:file-entry><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>${image ? '<manifest:file-entry manifest:full-path="Pictures/proof.png" manifest:media-type="image/png"/>' : ''}</manifest:manifest>`), { createFolders: false })
 zip.file('content.xml', xml(`<office:document-content ${ns} office:version="1.3"><office:automatic-styles/><office:body><office:${kind}>${body}</office:${kind}></office:body></office:document-content>`))
 zip.file('styles.xml', styles(header, footer, masterText))
 if (image) zip.file('Pictures/proof.png', image, { createFolders: false })
 return { mime, bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) }
}


export async function openDocuments(image) {
 if (!image) throw new Error('Provide the authored raster fixture')
 const text = p('synthetic-plinth-9601') + p('Explicit<text:s text:c="3"/>spaces<text:tab/>tab<text:line-break/>line')
  + `<text:p>Footnote<text:note text:id="note1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body>${p('synthetic-plinth-9604')}</text:note-body></text:note></text:p>`
  + p(annotation('synthetic-plinth-9605'))
  + `<table:table table:name="Body table"><table:table-column/><table:table-row><table:table-cell office:value-type="string">${p('synthetic-plinth-9606')}</table:table-cell></table:table-row></table:table>`
  + `<text:p><draw:frame draw:name="Box"><draw:text-box>${p('synthetic-plinth-9607')}</draw:text-box></draw:frame>${picture}</text:p>`
 const sheet = `<table:table table:name="Fixture"><table:table-column table:number-columns-repeated="3"/><table:table-row><table:table-cell office:value-type="string">${p('synthetic-plinth-9611')}</table:table-cell><table:table-cell office:value-type="string" office:string-value="synthetic-plinth-9612"/><table:table-cell office:value-type="string" office:string-value="synthetic-plinth-9613" table:formula="of:=&quot;synthetic-plinth-9613&quot;"/></table:table-row><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2" office:value-type="string">${p('synthetic-plinth-9615')}</table:table-cell></table:table-row><table:table-row table:visibility="collapse"><table:table-cell office:value-type="string">${p('synthetic-plinth-9614')}${annotation('synthetic-plinth-9616')}</table:table-cell></table:table-row></table:table>`
 const slides = `<draw:page draw:name="Fixture slide" draw:master-page-name="Default"><draw:frame><draw:text-box>${p('synthetic-plinth-9621')}${annotation('synthetic-plinth-9623')}</draw:text-box></draw:frame><presentation:notes><draw:page-thumbnail/><draw:frame presentation:class="notes"><draw:text-box>${p('synthetic-plinth-9622')}</draw:text-box></draw:frame></presentation:notes></draw:page><presentation:footer-decl presentation:name="Footer">synthetic-plinth-9627</presentation:footer-decl>`
 return [
  { name: 'synthetic-plinth-9901.odt', ...await pack('text', text, 'synthetic-plinth-9602', 'synthetic-plinth-9603', image), terms: ['BRACING', ...Array.from({ length: 7 }, (_, index) => `synthetic-plinth-${9601 + index}`)] },
  { name: 'synthetic-plinth-9902.ods', ...await pack('spreadsheet', sheet, 'synthetic-plinth-9617', 'synthetic-plinth-9618', undefined), terms: Array.from({ length: 8 }, (_, index) => `synthetic-plinth-${9611 + index}`) },
  { name: 'synthetic-plinth-9903.odp', ...await pack('presentation', slides, 'synthetic-plinth-9625', 'synthetic-plinth-9626', undefined, 'synthetic-plinth-9624'), terms: Array.from({ length: 7 }, (_, index) => `synthetic-plinth-${9621 + index}`) },
  // The original is clear XML with an actual manifest encryption declaration; no invented ciphertext is presented as an encrypted document.
  { name: 'synthetic-plinth-9904.odt', ...await pack('text', p('synthetic-plinth-9631'), 'synthetic-plinth-9632', 'synthetic-plinth-9633', undefined, '', true), terms: ['synthetic-plinth-9631'], denial: 'encrypted OpenDocument packages' },
 ]
}
