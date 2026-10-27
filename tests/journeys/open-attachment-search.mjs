import { openDocuments } from '../fixtures/open-documents.mjs'
import { reviewExtractedAttachments } from './review-extracted-attachment.mjs'

/** Stored OpenDocument content and actual embedded pixels become searchable only after complete review. */
export async function openAttachmentSearch(context) {
 const image = Buffer.from(await context.page.evaluate(() => {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 180
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,1200,180)
  ctx.fillStyle = 'black'; ctx.font = '48px sans-serif'; ctx.fillText('BRACING CLEARANCE 48 INCHES',30,100)
  return canvas.toDataURL('image/png').split(',')[1]
 }), 'base64')
 const variants = (await openDocuments(image)).map(document => ({...document,state:'unsupported'}))
 await reviewExtractedAttachments({...context,variants,capturePrefix:'attachment-open'})
}
