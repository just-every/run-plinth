import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { imageDocument, protectedDocument, unsupportedDocument } from '../fixtures/unextractable-documents.mjs'
import { originalEmail } from './meeting-mail.mjs'

/** Real protected, raster-only and compressed originals are read locally before a human saves searchable text. */
export async function attachmentExtraction({ base, page, owner, job, capture }) {
 const variants=[
  {name:'protected-review.pdf',mime:'application/pdf',bytes:protectedDocument,term:'synthetic-plinth-protected-9101',pattern:/synthetic-plinth-protected-9101/,password:'synthetic-plinth-9001'},
  {name:'compressed-review.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:unsupportedDocument,term:'synthetic-plinth-docx-9102',pattern:/synthetic-plinth-docx-9102/},
  {name:'scanned-review.pdf',mime:'application/pdf',bytes:imageDocument(),term:'synthetic-plinth-scan-9100',pattern:/synthetic.*plinth.*scan.*9100/i},
 ]
 for(const [index,variant] of variants.entries()){
  const raw=originalEmail({from:'synthetic-plinth-520@example.com',to:'builder@example.com',subject:`Private original review ${index}`,text:'Retain the original for review.',file:variant})
  const captured=await owner.request.post(base+`/api/plinth/jobs/${job.id}/correspondence`,{headers:{origin:base},data:{kind:'capture',confirm:true,original_base64:raw.toString('base64')}});assert.equal(captured.status(),201)
  await page.goto(base+`/app?job=${job.id}&tab=Decision%20search`);await page.getByLabel('Search text',{exact:true}).fill(variant.name);await page.getByRole('button',{name:'Search decisions',exact:true}).click();await expect(page.getByText('1 matching records',{exact:true})).toBeVisible()
  await page.getByText('Index metadata',{exact:true}).click();await page.getByText('Supplied attachment text',{exact:true}).click();await page.getByText('Extract text in this browser',{exact:true}).click()
  if(variant.password){
   await page.getByLabel('PDF password (if needed)',{exact:true}).fill('synthetic-plinth-wrong-password');await page.getByRole('button',{name:'Extract draft text',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'This PDF needs a valid password.'})).toBeVisible();await expect(page.getByLabel('Human-supplied transcription',{exact:true})).toHaveValue('');await capture(page,'attachment-protected-refusal');await page.getByLabel('PDF password (if needed)',{exact:true}).fill(variant.password)
  }
  await page.getByRole('button',{name:'Extract draft text',exact:true}).click();await expect(page.getByRole('textbox',{name:'Unverified extracted draft',exact:true})).toBeVisible({timeout:120000});const generated=await page.getByRole('textbox',{name:'Unverified extracted draft',exact:true}).inputValue();assert.match(generated,variant.pattern);await expect(page.getByLabel('PDF password (if needed)',{exact:true})).toHaveValue('');await capture(page,`attachment-extracted-${index}`)
  await page.getByRole('button',{name:'Use text in editor',exact:true}).click();await expect(page.getByLabel('Human-supplied transcription',{exact:true})).toHaveValue(generated)
  await page.getByLabel('Human-supplied transcription',{exact:true}).fill(variant.term);await page.getByRole('button',{name:'Review complete supplied text',exact:true}).click();const review=page.locator('form').filter({has:page.getByRole('heading',{name:'Review complete supplied text',exact:true})});await expect(review.locator('pre')).toHaveText(variant.term);await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Confirm and save supplied text',exact:true}).click()
  await page.getByLabel('Search text',{exact:true}).fill(variant.term);await page.getByRole('button',{name:'Search decisions',exact:true}).click();await expect(page.getByText('1 matching records',{exact:true})).toBeVisible();await expect(page.getByText(/Human-supplied transcription · Revision 1/)).toBeVisible();await capture(page,`attachment-extraction-saved-${index}`)
  const result=await(await owner.request.get(base+`/api/plinth/jobs/${job.id}/decision-search?`+new URLSearchParams({q:variant.term}))).json();assert.equal(result.count,1);assert.deepEqual(Buffer.from(await(await owner.request.get(base+result.results[0].files[0].href)).body()),variant.bytes)
 }
}
