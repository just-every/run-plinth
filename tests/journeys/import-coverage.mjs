import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { historicalSource, historicalBytes } from '../fixtures/import-history.mjs'
import { chromium, expect } from '@playwright/test'

const base=process.env.PLINTH_URL, shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base && process.env.PLINTH_STATE && process.env.PLINTH_CLIENT_STATE && shots, 'Installed native owner and client states required')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try {
 const owner=await browser.newContext({storageState:process.env.PLINTH_STATE,viewport:{width:1440,height:1000}}),page=await owner.newPage()
 const client=await browser.newContext({storageState:process.env.PLINTH_CLIENT_STATE})
 const request=(suffix,body)=>owner.request.post(base+'/api/plinth/imports'+suffix,{headers:{origin:base},data:body})
 const get=async suffix=>{const r=await owner.request.get(base+'/api/plinth/imports'+suffix);assert.equal(r.status(),200,await r.text());return r.json()}
 const jobs=async()=>(await(await owner.request.get(base+'/api/plinth/jobs')).json()).jobs
 const csv=await readFile(new URL('../fixtures/import-accepted-jobs.csv',import.meta.url),'utf8')
 const declaration={sourceSystem:'Synthetic construction register',extractionScope:'Accepted job headers only',extractedAt:'2026-10-01T12:00:00Z',verified:false}
 const providerMail=async()=>{const r=await owner.request.get(process.env.PLINTH_PROVIDER_EDGE_URL+'/observations');assert.equal(r.status(),200);return r.json()}
 const beforeEffects=await providerMail()
 const open=async()=>{
  await page.goto(base+'/app')
  await page.getByRole('button',{name:'Move in',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Preview your file',exact:true})).toBeVisible()
 }
 const upload=async value=>{
  await page.getByLabel('Jobs CSV',{exact:true}).setInputFiles({name:'synthetic-plinth.csv',mimeType:'text/csv',buffer:Buffer.from(value)})
  await page.getByRole('button',{name:'Dry run CSV',exact:true}).click()
 }
 const capture=async label=>{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.getByRole('heading',{name:'Move in',exact:true}).scrollIntoViewIfNeeded()
   await page.screenshot({path:shots+'/MOVE-001-'+label+'-'+width+'.png',fullPage:true,animations:'disabled'})
  }
  await page.setViewportSize({width:1440,height:1000})
 }
 await open()
 const lines=csv.trimEnd().split('\n')
 await upload(lines.concat(lines[1]).join('\n')+'\n')
 const coverage=page.getByRole('region',{name:'Source coverage',exact:true}).first()
 await expect(coverage.getByLabel('Coverage counts')).toContainText('duplicate: 1')
 await expect(coverage.getByLabel('Source diagnostics')).toContainText('Row 4, column 1')
 assert.equal((await jobs()).length,0)
 await capture('duplicate-refused')
 await upload(csv.replace('Northside extension','Bad"title'))
 await expect(coverage.getByLabel('Source diagnostics')).toContainText('MALFORMED_CSV')
 assert.equal((await jobs()).length,0)
 await upload(csv.replace('accepted_on','accepted_on,attachment_reference').replaceAll('2026-09-12','2026-09-12,missing-original').replaceAll('2026-09-18','2026-09-18,missing-original'))
 await expect(coverage.getByLabel('Source diagnostics')).toContainText('UNSUPPORTED_FIELD')
 await expect(coverage.getByLabel('Source diagnostics')).toContainText('column 7')
 assert.equal((await jobs()).length,0)
 await capture('unsupported-refused')
 await page.getByText('Declare source and extraction',{exact:true}).click()
 await page.getByLabel('Source system',{exact:true}).fill(declaration.sourceSystem)
 await page.getByLabel('Extraction scope',{exact:true}).fill(declaration.extractionScope)
 await page.getByLabel('Extraction time in UTC',{exact:true}).fill(declaration.extractedAt)
 await upload(csv)
 await expect(coverage.getByLabel('Coverage counts')).toContainText('proposed: 2')
 await expect(coverage).toContainText('Owner-declared source · unverified')
 await expect(coverage).toContainText(createHash('sha256').update(csv).digest('hex'))
 await capture('review')
 const preview=await(await request('/preview',{csv,declaration})).json()
 for(const body of [
  {csv,declaration:{...declaration,extractionScope:'Changed scope'},fingerprint:preview.fingerprint},
  {csv:csv.replace('Northside extension','Changed title'),declaration,fingerprint:preview.fingerprint},
  {csv,declaration,mappingRevision:'unsupported',fingerprint:preview.fingerprint},
 ])assert.equal((await request('/commit',body)).status(),409)
 assert.equal((await jobs()).length,0)
 await page.getByLabel('Extraction scope',{exact:true}).fill('Changed after review')
 await expect(page.getByRole('button',{name:'Approve and import drafts',exact:true})).toHaveCount(0)
 await page.getByLabel('Extraction scope',{exact:true}).fill(declaration.extractionScope)
 await page.getByRole('button',{name:'Dry run CSV',exact:true}).click()
 await expect(page.getByRole('button',{name:'Approve and import drafts',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Approve and import drafts',exact:true}).click()
 await expect(page.getByRole('button',{name:'Inspect coverage',exact:true})).toBeVisible()
 const imported=(await get('')).jobs[0], journal=page.getByRole('article',{name:'Import '+imported.id,exact:true})
 await journal.getByRole('button',{name:'Inspect coverage',exact:true}).click()
 await expect(journal.getByLabel('Coverage counts')).toContainText('imported: 2')
 const receipt=(await get('/'+imported.id+'/coverage')).coverage
 assert.equal(receipt.counts.imported,2);assert.equal(receipt.counts.proposed,0);assert.deepEqual(receipt.declaration,declaration)
 assert.deepEqual(receipt.rows.map(row=>row.row),[2,3])
 assert.deepEqual(receipt.rows[0].columns.map(c=>c.column),[1,2,3,4,5,6])
 const download=page.waitForEvent('download');await journal.getByRole('button',{name:'Download coverage report',exact:true}).click()
 assert.deepEqual(JSON.parse(await readFile(await(await download).path(),'utf8')),receipt)
 const original=page.waitForEvent('download');await journal.getByRole('button',{name:'Download original CSV',exact:true}).click()
 assert.deepEqual(await readFile(await(await original).path()),Buffer.from(csv))
 const adopted=await jobs();assert.equal(adopted.length,2)
 for(const job of adopted){
  assert.equal(job.status,'quoting');assert.equal(job.quotes[0].status,'draft');assert.equal(job.approvals.length,0)
  assert.equal(job.import_evidence.acceptance_verified,false);assert.equal(job.claims.length,0);assert.equal(job.orders.length,0)
  assert.ok(!job.invoices?.length && !job.cost_records)
 }
 await capture('imported')
 const replay=await request('/commit',{csv,declaration,fingerprint:preview.fingerprint});assert.equal(replay.status(),200);assert.equal((await replay.json()).job.id,imported.id)
 assert.equal((await jobs()).length,2)
 const repeated=(await(await request('/preview',{csv,declaration})).json()).coverage
 assert.equal(repeated.counts.duplicate,2);assert.equal(repeated.counts.imported,0)
 let edited=adopted[0]
 const edit=await owner.request.post(base+'/api/plinth/jobs/'+edited.id+'/quotes',{headers:{origin:base},data:{expected_version:edited.version,lines:[{description:'Native reviewed work',quantity:1,unit_cents:125}]}})
 assert.equal(edit.status(),200);edited=(await edit.json()).job
 assert.equal((await get('/'+imported.id+'/coverage')).coverage.counts.conflict,1)
 assert.equal((await request('/commit',{csv,declaration,fingerprint:preview.fingerprint})).status(),200)
 assert.deepEqual((await jobs()).find(j=>j.id===edited.id),edited)
 await journal.getByRole('button',{name:'Inspect coverage',exact:true}).click()
 await expect(journal.getByLabel('Coverage counts')).toContainText('conflict: 1')
 await capture('native-edit-preserved')
 const foreign=base+'/api/plinth/imports/'+imported.id
 for(const suffix of ['/coverage','/originals'])assert.equal((await client.request.get(foreign+suffix)).status(),403)
 const erased=adopted.find(job=>job.id!==edited.id)
 const erase=await owner.request.delete(base+'/api/plinth/jobs/'+erased.id,{headers:{origin:base},data:{expected_version:erased.version}})
 assert.equal(erase.status(),200,await erase.text())
 const afterErase=(await get('/'+imported.id+'/coverage')).coverage
 assert.equal(afterErase.counts.erased,1);assert.equal(afterErase.counts.conflict,1)
 assert.equal(afterErase.originalStatus,'unavailable')
 assert.ok(!JSON.stringify(afterErase).includes(erased.client_email))
 assert.equal((await get('/'+imported.id+'/originals')).originals[0].original.status,'unavailable')
 assert.equal((await request('/commit',{csv,declaration,fingerprint:preview.fingerprint})).status(),200)
 assert.ok(!(await jobs()).some(job=>job.id===erased.id))
 await journal.getByRole('button',{name:'Inspect coverage',exact:true}).click()
 await expect(journal.getByLabel('Coverage counts')).toContainText('erased: 1')
 await capture('erasure-fenced')
 await page.setViewportSize({width:390,height:1000})
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Coverage fits the phone screen')
 for(const button of await page.locator('button.icon-button:visible').all()){
  assert.ok(await button.getAttribute('data-tip'),'Visible icon control has tooltip text')
  await page.keyboard.press('Tab'); await button.focus()
  assert.ok(await button.evaluate(el=>getComputedStyle(el,'::after').opacity==='1'),'Icon tooltip appears on focus')
 }
 await open()
 const historyCsv=csv.replaceAll('MOVE-','HISTORY-'),history=historicalSource('HISTORY-001')
 await page.getByLabel('Historical source JSON (optional)',{exact:true}).setInputFiles({name:'synthetic-plinth-history.json',mimeType:'application/json',buffer:Buffer.from(history)})
 await upload(historyCsv)
 await expect(coverage.getByLabel('Historical coverage counts')).toContainText('historical: 6')
 await expect(coverage.getByLabel('Historical coverage counts')).toContainText('duplicate: 1')
 await expect(coverage.getByLabel('Historical coverage counts')).toContainText('missing: 1')
 await expect(coverage).toContainText('Old signed window change')
 await expect(coverage).toContainText('unsupported-source-kind')
 await capture('historical-review')
 const historicalPreview=await(await request('/preview',{csv:historyCsv,history})).json()
 assert.equal((await request('/commit',{csv:historyCsv,history:history.replaceAll('Old signed window change','Changed source claim'),fingerprint:historicalPreview.fingerprint})).status(),409)
 await page.getByRole('button',{name:'Approve and import drafts',exact:true}).click()
 await expect(page.getByRole('button',{name:'Approve and import drafts',exact:true})).toHaveCount(0)
 const historyJob=(await get('')).jobs.find(job=>job.fingerprint===historicalPreview.fingerprint)
 assert.ok(historyJob)
 const historyJournal=page.getByRole('article',{name:'Import '+historyJob.id,exact:true})
 await historyJournal.getByRole('button',{name:'Inspect coverage',exact:true}).click()
 await expect(historyJournal.getByLabel('Historical coverage counts')).toContainText('retained: 1')
 const sourceFile=page.waitForEvent('download')
 await historyJournal.getByRole('button',{name:'Download synthetic-plinth-signed-change.txt',exact:true}).click()
 assert.deepEqual(await readFile(await(await sourceFile).path()),historicalBytes)
 const historicalJobs=(await jobs()).filter(job=>job.import_evidence?.external_id.startsWith('HISTORY-'))
 assert.equal(historicalJobs.length,2)
 for(const job of historicalJobs){assert.equal(job.status,'quoting');assert.equal(job.approvals.length,0);assert.equal(job.variations.length,0);assert.equal(job.schedules.length,0);assert.equal(job.invoices?.length??0,0);assert.equal(job.claims.length,0)}
 await capture('historical-custody')
 assert.equal((await request('/commit',{csv:historyCsv,history,fingerprint:historicalPreview.fingerprint})).status(),200)
 const historicalErased=historicalJobs.find(job=>job.import_evidence.external_id==='HISTORY-001')
 assert.equal((await owner.request.delete(base+'/api/plinth/jobs/'+historicalErased.id,{headers:{origin:base},data:{expected_version:historicalErased.version}})).status(),200)
 assert.ok((await get('/'+historyJob.id+'/originals')).originals.every(file=>file.original.status==='unavailable'))
 await historyJournal.getByRole('button',{name:'Inspect coverage',exact:true}).click()
 await expect(historyJournal.getByText('Old signed window change',{exact:false})).toHaveCount(0)
 await expect(historyJournal.getByRole('button',{name:'Download synthetic-plinth-signed-change.txt',exact:true})).toHaveCount(0)
 await capture('historical-erasure')
 assert.deepEqual(await providerMail(),beforeEffects,'Import review, commit, replay, reporting and erasure create no outbound mail or processor operation')
 const signout=await owner.request.post(base+'/auth/signout',{headers:{origin:base},data:{}});assert.equal(signout.status(),204)
 for(const suffix of ['/coverage','/originals'])assert.equal((await owner.request.get(foreign+suffix)).status(),401,'Revoked owner session cannot read retained custody')
 assert.equal((await request('/commit',{csv,declaration,fingerprint:preview.fingerprint})).status(),401,'Revoked owner session cannot replay intake')
 console.log('MOVE-001 coverage PASS: exact review, independent dispositions, original custody, native-edit and erasure fences; owner screens 1440 and 390')
}finally{await browser.close()}
