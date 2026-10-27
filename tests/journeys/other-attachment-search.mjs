import { tiledTiff, jpegTiff } from '../fixtures/advanced-tiff.mjs'
import { multipageTiff, richTextDocument } from '../fixtures/other-documents.mjs'
import { reviewExtractedAttachments } from './review-extracted-attachment.mjs'

/** Read actual multipage pixels, encoded text and inert rich content, then save only the reviewed draft. */
export async function otherAttachmentSearch(context) {
 const rendered = await context.page.evaluate(() => {
  const render = text => {
   const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 180
   const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height)
   ctx.fillStyle = 'black'; ctx.font = '48px sans-serif'; ctx.fillText(text, 30, 100)
   const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
   return { png: canvas.toDataURL('image/png').split(',')[1], jpeg: canvas.toDataURL('image/jpeg',0.9).split(',')[1], gray: Array.from({ length: canvas.width * canvas.height }, (_, index) => pixels[index * 4]) }
  }
  return ['FOUNDATION CLEARANCE 48 INCHES', 'DRAINAGE CLEARANCE 48 INCHES', 'INSULATION CLEARANCE 48 INCHES', 'TILING CLEARANCE 48 INCHES', 'ROOFING CLEARANCE 48 INCHES'].map(render)
 })
 const variants = [
  { name: 'two-page-site-scan.tiff', mime: 'image/tiff', bytes: multipageTiff(rendered.slice(0, 2).map(image => image.gray), 1200, 180), terms: ['FOUNDATION', 'DRAINAGE'], state: 'unsupported' },
  { name: 'encoded-site-notes.rtf', mime: 'application/rtf', bytes: richTextDocument(Buffer.from(rendered[2].png, 'base64')), terms: ['synthetic-plinth-rtfbody-9400', 'synthetic-plinth-rtfheader-9401', 'synthetic-plinth-rtffooter-9402', 'synthetic-plinth-rtffield-9403', 'INSULATION'], required: ['café', 'Ω'], absent: ['never-fetch'], state: 'unsupported' },
  { name: 'wide-site-notes.txt', mime: 'text/plain', bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Foundation café Ω synthetic-plinth-wide-9404', 'utf16le')]), terms: ['café Ω synthetic-plinth-wide-9404'], required: ['café', 'Ω'], state: 'failed' },
  { name: 'saved-site-page.html', mime: 'text/html', bytes: Buffer.from('<!doctype html><html><head><title>Site notes</title><script>synthetic-plinth-script-9406</script><style>.synthetic-plinth-css-9407{}</style></head><body><h1>synthetic-plinth-html-9405</h1><p>Approved &amp; retained café</p><img src="https://example.invalid/never-fetch" alt="Plan elevation"></body></html>'), terms: ['synthetic-plinth-html-9405'], required: ['café'], absent: ['synthetic-plinth-script-9406', 'synthetic-plinth-css-9407'] },
  { name: 'saved-site-vector.svg', mime: 'image/svg+xml', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><title>Site detail</title><text x="0" y="20">synthetic-plinth-vector-9408</text><script>synthetic-plinth-script-9409</script></svg>'), terms: ['synthetic-plinth-vector-9408'], absent: ['synthetic-plinth-script-9409'], state: 'unsupported' },
  { name: 'linked-site-vector.svg', mime: 'image/svg+xml', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>synthetic-plinth-linked-9410</text><image href="https://example.invalid/never-fetch"/></svg>'), terms: ['synthetic-plinth-linked-9410'], denial: 'SVG contains an external or unsupported reference', state: 'unsupported' },
  { name: 'tile-site-original.tiff', mime: 'image/tiff', bytes: tiledTiff(Uint8Array.from(rendered[3].gray),1200,180), terms: ['TILING'], state: 'unsupported' },
  { name: 'compressed-site-original.tiff', mime: 'image/tiff', bytes: jpegTiff(Buffer.from(rendered[4].jpeg,'base64'),1200,180), terms: ['ROOFING'], state: 'unsupported' },
 ]
 let externalRequests = 0
 const refuseExternal = route => { externalRequests++; return route.abort() }
 await context.page.route('https://example.invalid/**', refuseExternal)
 try {
  await reviewExtractedAttachments({...context,variants,capturePrefix:'attachment-formats'})
  if (externalRequests !== 0) throw new Error('Inert source content must not fetch external resources')
 } finally { await context.page.unroute('https://example.invalid/**', refuseExternal) }
}
