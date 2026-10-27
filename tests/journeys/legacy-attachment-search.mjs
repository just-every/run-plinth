import { legacyWordStories } from '../fixtures/legacy-word-stories.mjs'
import { legacyDocuments } from '../fixtures/legacy-documents.mjs'
import { reviewExtractedAttachments } from './review-extracted-attachment.mjs'

/** Genuine synthetic CFB documents are decoded by the bundled browser WASM reader before review. */
export async function legacyAttachmentSearch(context) {
 const variants = legacyDocuments().map(({term,additionalTerm,...document}) => ({...document,terms:[term,...(additionalTerm ? [additionalTerm] : [])],state:'unsupported',required:document.mime==='application/vnd.ms-excel'?['42.5']:[]}))
 const stories = legacyWordStories()
 variants.push({...stories,terms:[...stories.terms.filter(term=>!['café','Ω'].includes(term)), 'synthetic-plinth-9800 café', 'synthetic-plinth-9804 Ω'],required:['café','Ω'],state:'unsupported'})
 variants.push({name:'damaged-site-original.doc',mime:'application/msword',bytes:Buffer.from('synthetic-plinth-damaged-9414'),terms:['synthetic-plinth-damaged-9414'],state:'unsupported',denial:'Legacy extraction:'})
 await reviewExtractedAttachments({...context,variants,capturePrefix:'attachment-legacy'})
}
