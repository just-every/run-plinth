import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {backgroundFixture} from '../plinth/background-work-support.mjs'
import {nativeSignIn} from '../../scripts/verify/native-signin.mjs'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS,state=process.env.PLINTH_STATE
assert.ok(base&&shots&&state,'Use the disposable installed application with native sign-in')
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:state}),page=await owner.newPage()
 const call=async(path,{method='GET',body}={})=>{const r=await owner.request.fetch(base+path,{method,headers:{origin:base},...(body===undefined?{}:{data:body})});return {status:r.status(),value:await r.json()}}
 const f={owner:'owner',json:call,request:(path,options={})=>owner.request.fetch(base+path,{method:options.method??'GET',headers:{origin:base},...(options.body?{data:options.body}:{})})}
 const c=await backgroundFixture(f)
 await page.setViewportSize({width:1440,height:1000})
 const open=async()=>{await page.goto(base+'/app');await page.getByText('Report export work',{exact:true}).click();await expect(page.getByRole('button',{name:'Request report export',exact:true})).toBeVisible()}
 await open()
 const panel=page.getByText('Report export work',{exact:true}).locator('..')
 const request=async format=>{
  await panel.getByLabel('Export saved view',{exact:true}).selectOption(c.saved.view.id);await panel.getByLabel('Export format',{exact:true}).selectOption(format)
  const response=page.waitForResponse(r=>r.url()===base+'/api/plinth/reports/work'&&r.request().method()==='POST')
  await panel.getByRole('button',{name:'Request report export',exact:true}).click()
  const wire=await response;assert.equal(wire.status(),201);const task=(await wire.json()).task
  await expect(panel.locator('[data-work-id="'+task.id+'"]')).toBeVisible();return task
 }
 const row=task=>panel.locator('[data-work-id="'+task.id+'"]')
 const resume=async task=>{const reply=page.waitForResponse(r=>r.url()===base+'/api/plinth/reports/work/'+task.id+'/resume'&&r.request().method()==='POST');await row(task).getByRole('button',{name:'Resume next chunk',exact:true}).click();const response=await reply;assert.equal(response.status(),200);const current=(await response.json()).task;await expect(row(task).locator('p[role="status"]')).toContainText(current.progress+' of '+current.total+' records');return current}
 let task=await request('csv');task=await resume(task);assert.equal(task.progress,25)
 await open();await expect(row(task).locator('p[role="status"]')).toHaveText('Paused · 25 of 61 records')
 const concurrent=await Promise.all([c.action(task,'resume'),c.action(task,'resume')]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);task=await c.read(task);assert.equal(task.progress,50)
 await panel.getByRole('button',{name:'Refresh export work',exact:true}).click();await expect(row(task).locator('p[role="status"]')).toHaveText('Paused · 50 of 61 records')
 await page.route('**/api/plinth/reports/work/'+task.id+'/resume',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic connection unavailable. Refresh and retry.'})}))
 await row(task).getByRole('button',{name:'Resume next chunk',exact:true}).click()
 await expect(row(task).getByRole('alert')).toHaveText('Synthetic connection unavailable. Refresh and retry.')
 assert.equal((await c.read(task)).progress,50,'A failed request cannot invent progress')
 await page.unroute('**/api/plinth/reports/work/'+task.id+'/resume');task=await resume(task);assert.equal(task.state,'complete')
 const response=await owner.request.get(base+'/api/plinth/reports/work/'+task.id+'/download');assert.equal(response.status(),200)
 const csv=await response.body();for(const j of c.jobs)assert.equal(csv.toString().split('"'+j.name+'"').length-1,1)
 const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(csv).digest('hex'),task.checksum)
 const downloaded=page.waitForEvent('download');await row(task).getByRole('link',{name:'Download verified CSV',exact:true}).click()
 assert.deepEqual(await readFile(await (await downloaded).path()),csv,'The actual browser download matches the independently checked output')
 const xlsx=await request('xlsx');let workbook=xlsx
 while(workbook.state!=='complete')workbook=await resume(workbook)
 const xresponse=await owner.request.get(base+'/api/plinth/reports/work/'+workbook.id+'/download');assert.equal(xresponse.status(),200)
 const xbytes=await xresponse.body(),JSZip=(await import('jszip')).default,xml=await (await JSZip.loadAsync(xbytes)).file('xl/worksheets/sheet1.xml').async('string')
 for(const j of c.jobs)assert.equal(xml.split('>'+j.name+'<').length-1,1);assert.equal((xml.match(/>quoting</g)??[]).length,58);assert.equal((xml.match(/>active</g)??[]).length,3);for(const amount of [12000,34000,56000]){assert.ok(csv.includes(Buffer.from('USD '+amount)));assert.ok(xml.includes('USD '+amount))}assert.ok(csv.includes(Buffer.from('"money_total","native.contract","USD","102000"')));assert.ok(xml.includes('<v>102000</v>'));assert.equal(createHash('sha256').update(xbytes).digest('hex'),workbook.checksum)
 const cancelled=await request('csv');await row(cancelled).getByRole('button',{name:'Cancel export',exact:true}).click();await expect(row(cancelled).locator('p[role="status"]')).toHaveText('Cancelled · 0 of 61 records')
 assert.equal((await c.action(await c.read(cancelled),'resume')).status,409)
 assert.equal((await owner.request.get(base+'/api/plinth/reports/work/'+cancelled.id+'/download')).status(),409)
 const client=await browser.newContext({storageState:process.env.PLINTH_CLIENT_STATE})
 for(const path of ['/api/plinth/reports/work','/api/plinth/reports/work/'+task.id+'/download'])assert.equal((await client.request.get(base+path)).status(),403)
 await client.close()
 // A source owner session revoked between chunks cannot continue or retrieve output.
 assert.equal((await owner.request.post(base+'/auth/signout',{headers:{origin:base},data:{}})).status(),204)
 assert.equal((await owner.request.get(base+'/api/plinth/reports/work/'+task.id+'/download')).status(),401)
 assert.equal((await owner.request.post(base+'/api/plinth/reports/work/'+task.id+'/resume',{headers:{origin:base},data:{expected_version:task.version}})).status(),401)
 const email=['builder','example.com'].join('@')
 assert.equal((await owner.request.post(base+'/auth/magic-link',{headers:{origin:base},data:{email,returnTo:'/app'}})).status(),202);await nativeSignIn(page,email)
 await open()
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1600})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow at '+width)
  await row(task).getByRole('link',{name:'Download verified CSV',exact:true}).scrollIntoViewIfNeeded()
  if(width===390){const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')}
  await page.evaluate(()=>scrollTo(0,0));await panel.screenshot({path:shots+'/OPS-002-export-work-'+width+'.png',animations:'disabled'})
 }
 await page.setViewportSize({width:1440,height:1000})
 const j=c.jobs[0],erased=await c.api('/jobs/'+j.id,{expected_version:j.version},{method:'DELETE'});assert.equal(erased.status,200)
 for(const t of [task,workbook,cancelled]){assert.equal((await owner.request.get(base+'/api/plinth/reports/work/'+t.id+'/download')).status(),404);assert.equal((await c.action(t,'resume')).status,404)}
 await panel.getByRole('button',{name:'Refresh export work',exact:true}).click();await expect(panel.getByText('No requested exports.',{exact:true})).toBeVisible()
 await owner.close()
 console.log('OPS-002 native export PASS: bounded checkpoints, page interruption, concurrent continuation, visible network failure and explicit retry, independent native CSV and XLSX downloads, cancellation, revoked session and erasure refusals; screens at 1440 and 390. Process restart and inactive archive recovery are exercised by the CLI archive journey.')
}finally{await browser.close()}
