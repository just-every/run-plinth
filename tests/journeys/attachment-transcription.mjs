import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { attachmentExtraction } from './attachment-extraction.mjs'
import { originalEmail } from './meeting-mail.mjs'

/** Supplement an actual unextractable original through the existing search and human review screens. */
export async function attachmentTranscription({ base, page, clientPage, owner, client, job, capture }) {
 const text = 'SCANNED KITCHEN NOTE\nCLEARANCE 36 INCHES ABOVE THE WORKTOP\nORIGINAL-HEIGHT-723'
 const original = Buffer.from(await page.evaluate(value=>{const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=300;const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,1400,300);context.fillStyle='black';context.font='40px sans-serif';value.split('\n').forEach((line,index)=>context.fillText(line,40,70+index*85));return canvas.toDataURL('image/png').split(',')[1]},text),'base64')
 const raw = originalEmail({from:'synthetic-plinth-510@example.com',to:'builder@example.com',subject:'Private kitchen attachment review',text:'Original site document for office review.',file:{name:'kitchen-note.png',mime:'image/png',bytes:original}})
 await page.goto(base+`/app?job=${job.id}&tab=Messages`)
 await page.locator('select[name=kind]').selectOption('capture');await page.getByLabel('Original email file').setInputFiles({name:'kitchen-note.eml',mimeType:'message/rfc822',buffer:raw});await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Capture private email',exact:true}).click();await expect(page.getByText('Private kitchen attachment review',{exact:true})).toBeVisible()
 await page.goto(base+`/app?job=${job.id}&tab=Decision%20search`)
 const search=async value=>{await page.getByLabel('Search text',{exact:true}).fill(value);await page.getByRole('button',{name:'Search decisions',exact:true}).click()}
 await search('ORIGINAL-HEIGHT-723');await expect(page.getByText('0 matching records',{exact:true})).toBeVisible()
 await search('kitchen-note.png');await expect(page.getByText('1 matching records',{exact:true})).toBeVisible();await expect(page.getByText(/File text: unsupported/)).toBeVisible()
 await page.getByText('Index metadata',{exact:true}).click();await page.getByText('Supplied attachment text',{exact:true}).click();await page.getByText('Extract text in this browser',{exact:true}).click()
 const unexpected=[],observe=request=>{const url=new URL(request.url());if(url.protocol.startsWith('http')&&url.origin!==base)unexpected.push(url.origin)};page.on('request',observe)
 await page.getByRole('button',{name:'Extract draft text',exact:true}).click();await expect(page.getByRole('textbox',{name:'Unverified extracted draft',exact:true})).toBeVisible({timeout:120000});const extracted=await page.getByRole('textbox',{name:'Unverified extracted draft',exact:true}).inputValue();assert.match(extracted,/CLEARANCE\s+36\s+INCHES/);assert.deepEqual(unexpected,[],'Original bytes, OCR worker, core and English model use only this installation');page.removeListener('request',observe);await capture(page,'attachment-browser-extraction')
 await page.getByRole('button',{name:'Use text in editor',exact:true}).click();await expect(page.getByRole('textbox',{name:'Human-supplied transcription',exact:true})).toHaveValue(extracted);await page.getByRole('textbox',{name:'Human-supplied transcription',exact:true}).fill(text);await capture(page,'attachment-supplied-text')
 await page.getByRole('button',{name:'Review complete supplied text',exact:true}).click();const review=page.locator('form').filter({has:page.getByRole('heading',{name:'Review complete supplied text',exact:true})});await expect(review.locator('pre')).toHaveText(text);await capture(page,'attachment-complete-review')
 await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Confirm and save supplied text',exact:true}).click()
 await search('ORIGINAL-HEIGHT-723');await expect(page.getByText('1 matching records',{exact:true})).toBeVisible();await expect(page.getByText(/Human-supplied transcription · Revision 1/)).toBeVisible();await expect(page.getByText(/File text: unsupported/)).toBeVisible();await capture(page,'attachment-supplied-search')
 const result=await(await owner.request.get(base+`/api/plinth/jobs/${job.id}/decision-search?q=ORIGINAL-HEIGHT-723`)).json();assert.equal(result.count,1);const hit=result.results[0]
 assert.deepEqual(Buffer.from(await(await owner.request.get(base+hit.files[0].href)).body()),original)
 await page.getByText('Index metadata',{exact:true}).click();await page.getByText('Supplied attachment text',{exact:true}).click();await page.getByText('Saved revisions (1)',{exact:true}).click();await expect(page.locator('pre').filter({hasText:'ORIGINAL-HEIGHT-723'})).toHaveText(text);await capture(page,'attachment-retained-revision')
 await clientPage.goto(base+`/app?job=${job.id}&tab=Decision%20search`);await clientPage.getByLabel('Search text',{exact:true}).fill('ORIGINAL-HEIGHT-723');await clientPage.getByRole('button',{name:'Search decisions',exact:true}).click();await expect(clientPage.getByText('0 matching records',{exact:true})).toBeVisible();assert.equal((await client.request.get(base+`/api/plinth/jobs/${job.id}/decision-search/transcriptions?`+new URLSearchParams({source:hit.source}))).status(),404);assert.equal((await client.request.get(base+hit.files[0].href)).status(),404);await capture(clientPage,'attachment-private-search')
 await attachmentExtraction({base,page,owner,job,capture})
}
