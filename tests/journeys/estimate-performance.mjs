import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {performanceFixture,performanceAddress} from '../plinth/performance-support.mjs'
import {nativeSignIn} from '../../scripts/verify/native-signin.mjs'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS,state=process.env.PLINTH_STATE
assert.ok(base&&shots&&state,'Use the disposable installed application with native sign-in')
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:state}),contexts=new Map([['owner',owner]]),page=await owner.newPage()
 const call=async(path,{method='GET',body,cookie='owner'}={})=>{const context=contexts.get(cookie)??owner,response=await context.request.fetch(base+path,{method,headers:{origin:base},...(body===undefined?{}:{data:body})});return {status:response.status(),value:await response.json()}}
 const invite=async(email,name,role='member')=>{
  const response=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:name,role,returnTo:'/app'}});assert.equal(response.status(),202)
  const context=await browser.newContext(),p=await context.newPage();await nativeSignIn(p,email);await p.close();contexts.set(email,context);return email
 }
 const c=await performanceFixture({owner:'owner',json:call,invite}),first=c.jobs[0],second=c.jobs[1]
 const historicalQuotes=structuredClone(first.job.quotes),before=(await call(`/api/plinth/jobs/${first.job.id}/costs`)).value
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/app');await page.locator('summary').filter({hasText:/^Estimate productivity and sales$/}).click()
 await expect(page.getByText('Synthetic Plinth builder: 1 won · 1 lost · 1 open · Win rate 50%',{exact:true})).toBeVisible()
 await expect(page.getByText('Synthetic cost preparer: 1 won · 0 lost · 0 open · Win rate 100%',{exact:true})).toBeVisible()
 const firstRegion=page.getByRole('region',{name:first.job.name+' productivity'}),secondRegion=page.getByRole('region',{name:second.job.name+' productivity'})
 const labor=firstRegion.getByRole('row').filter({hasText:'06-100'}),other=secondRegion.getByRole('row').filter({hasText:'06-100'})
 await expect(labor.getByRole('cell').nth(1)).toHaveText('$60.00');await expect(labor.getByRole('cell').nth(2)).toHaveText('$60.00');await expect(labor.getByRole('cell').nth(8)).toHaveText('5')
 await expect(other.getByRole('cell').nth(1)).toHaveText('$72.00');await expect(other.getByRole('cell').nth(2)).toHaveText('$90.00');await expect(other.getByRole('cell').nth(8)).toHaveText('4')
 await expect(firstRegion.getByText('Production denominator unknown',{exact:true})).toBeVisible()
 const sources=await owner.request.get(base+await page.getByRole('link',{name:'Download comparison sources',exact:true}).first().getAttribute('href'));assert.equal(sources.status(),200);assert.equal((await sources.json()).job.rows.find(r=>r.cost_code==='06-100').source.time_ids.length,1)
 await page.locator('summary').filter({hasText:/^Propose a catalog lesson$/}).click()
 const propose=async(entry,value,reason)=>{
  await page.getByLabel('Lesson source job',{exact:true}).selectOption(first.job.id)
  await page.getByLabel('Catalog record',{exact:true}).selectOption(entry.id)
  await page.getByRole('checkbox',{name:second.job.name+' · USD',exact:true}).check()
  await page.getByLabel('Lesson reason',{exact:true}).fill(reason)
  if(entry.kind==='assembly')await page.getByLabel('Production units per rate unit 1',{exact:true}).fill(value.parts[0].productivity)
  else await page.getByLabel('Default dimension: walls',{exact:true}).fill(value.dimensions.walls)
  await page.getByRole('button',{name:'Propose reviewed lesson',exact:true}).click()
  await expect(page.getByText(reason,{exact:false}).first()).toBeVisible()
  await page.getByRole('button',{name:'Review proposed revision',exact:true}).last().click()
  const review=page.getByRole('region',{name:'Catalog lesson review'})
  await expect(review).toBeVisible();await expect(review.getByText(entry.kind==='assembly'?'Production units per rate unit: 4':'walls: 14',{exact:true})).toBeVisible()
  if(entry.kind==='assembly'){for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await review.screenshot({path:`${shots}/RPT-002-review-${width}.png`,animations:'disabled'})}await page.setViewportSize({width:1440,height:1000})}
  await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Approve for new estimates only',exact:true}).click()
  await expect(review).toHaveCount(0)
 }
 const assemblyValue=structuredClone(c.assembly.revisions[0].value);assemblyValue.parts[0].productivity='4'
 await propose(c.assembly,assemblyValue,'Completed jobs support four feet per approved hour')
 let catalog=(await call('/api/plinth/estimate-catalog')).value.entries;assert.equal(catalog.find(e=>e.id===c.assembly.id).version,2)
 const templateValue=structuredClone(c.template.revisions[0].value);templateValue.dimensions.walls='14'
 await propose(c.template,templateValue,'Reviewed future wall template dimension')
 catalog=(await call('/api/plinth/estimate-catalog')).value.entries;assert.equal(catalog.find(e=>e.id===c.template.id).version,2)
 await first.read();assert.deepEqual(first.job.quotes,historicalQuotes)
 const after=(await call(`/api/plinth/jobs/${first.job.id}/costs`)).value;assert.deepEqual(after,{...before,version:after.version})
 const next=c.jobs[3],request={template_id:c.template.id,as_of:'2026-10-20'},preview=await next.act('/estimate-template/preview',request)
 assert.equal(preview.preview.proposal.cost_total_cents,11900);await next.act('/estimate-template/apply',{...request,digest:preview.preview.digest});assert.equal(next.job.quotes.at(-1).cost_total_cents,11900)
 const client=await invite(performanceAddress('performance-client'),'Synthetic reporting client');assert.equal((await call('/api/plinth/reports/performance',{cookie:client})).status,403)
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow at '+width)
  if(width===390){const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')}
  await page.screenshot({path:`${shots}/RPT-002-comparisons-and-reviews-${width}.png`,fullPage:true,animations:'disabled'})
 }
 for(const context of contexts.values())await context.close()
 console.log('RPT-002 PASS: two completed source-linked productivity comparisons, independent native win rate, unknown denominators, explicit assembly and template reviews, new estimates and unchanged historical costs; screens at 1440 and 390')
}finally{await browser.close()}
