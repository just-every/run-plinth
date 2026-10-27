import { legacyDocuments } from '../fixtures/legacy-documents.mjs'
import { reviewExtractedAttachments } from './review-extracted-attachment.mjs'

/** Genuine synthetic CFB documents are decoded by the bundled browser WASM reader before review. */
export async function legacyAttachmentSearch(context) {
 const variants = legacyDocuments().map(({term,additionalTerm,...document}) => ({...document,terms:[term,...(additionalTerm ? [additionalTerm] : [])],state:'unsupported'}))
 await reviewExtractedAttachments({...context,variants,capturePrefix:'attachment-legacy'})
}
