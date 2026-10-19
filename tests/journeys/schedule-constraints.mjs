// SCH-006: real installed workspace, original file uploads and human schedule clearance.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
const base=process.env.PLINTH_URL, state=process.env.PLINTH_STATE, shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&state&&shots,'Set installation URL, private owner storage state and external screenshots directory')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
try {
 const context=await browser.newContext({storageState:state,viewport:{width:1440,height:1100}}),page=await context.newPage()
 const capture=async name=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1100});await page.waitForTimeout(200);await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${shots}/SCH-006-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 const post=async(path,body)=>{const r=await context.request.post(base+'/api/plinth'+path,{headers:{origin:base},data:body});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 const suffix=Date.now(),pdf=Buffer.from('%PDF-1.7\nOriginal city inspection and safe-site clearance evidence\n%%EOF')
 let {job}=await post('/jobs',{name:'Alvarez whole-home remodel — inspection and weather clearance '+suffix,client_email:'client@dev.localhost',address:'2480 Maple Street, Burlington, VT 05401'})
 let r=await post(`/jobs/${job.id}/quotes`,{expected_version:job.version,lines:[{description:'Agreed remodel construction works',quantity:1,unit_cents:48_000_000}]});job=r.job
 r=await post(`/jobs/${job.id}/quotes/${job.quotes[0].id}/accept`,{expected_version:job.version,method:'signed',evidence:'Signed household remodel agreement'});job=r.job
 const calendar={weekdays:[1,2,3,4,5],start_hour:8,end_hour:17,holidays:[]}
 let tasks=[{id:crypto.randomUUID(),trade:'Drywall crew '+suffix,owner:'Alex Rivera, superintendent',description:'Drywall after city rough inspection',start:'2026-11-02T08:00:00Z',duration_minutes:120}]
 r=await post(`/jobs/${job.id}/schedule/preview`,{expected_version:job.version,calendar,tasks});r=await post(`/jobs/${job.id}/schedule/publish`,{expected_version:job.version,calendar,tasks:r.preview.tasks,digest:r.preview.digest});job=r.job
 await page.goto(`${base}/app?job=${job.id}&tab=Schedule`)
 const section=page.getByRole('heading',{name:'Inspections, permits and site holds',exact:true}).locator('..')
 await section.getByText('Add a schedule requirement',{exact:true}).click()
 const add=section.locator('details').filter({has:page.getByText('Add a schedule requirement',{exact:true})})
 await add.getByLabel('Requirement title',{exact:true}).fill('Rough inspection before drywall')
 await add.getByLabel('Jurisdiction',{exact:true}).fill('City of Burlington building department')
 await add.getByLabel('Accountable person',{exact:true}).fill('Alex Rivera, superintendent')
 await add.getByLabel('Drywall after city rough inspection',{exact:true}).check()
 await add.getByLabel('Request, result or clearance reason',{exact:true}).fill('Rough plumbing and wiring inspection requested')
 await add.getByLabel('Original evidence (PDF, PNG or JPEG; up to 2 MB)',{exact:true}).setInputFiles({name:'inspection-request.pdf',mimeType:'application/pdf',buffer:pdf})
 await capture('requirement-editor')
 await add.getByRole('button',{name:'Record schedule requirement',exact:true}).click()
 const row=section.getByRole('listitem').filter({has:page.getByRole('heading',{name:'Rough inspection before drywall',exact:true})}).first()
 await expect(row).toContainText('Publication blocked')
 await expect(add.getByLabel('Requirement title',{exact:true})).toHaveValue('')
 await expect(add.getByLabel('Original evidence (PDF, PNG or JPEG; up to 2 MB)',{exact:true})).toHaveValue('')
 await row.getByText('Record a result or clearance',{exact:true}).click()
 let decision=row.locator('details').filter({has:page.getByText('Record a result or clearance',{exact:true})})
 await decision.getByLabel('Constraint decision',{exact:true}).selectOption('failed')
 await decision.getByLabel('Request, result or clearance reason',{exact:true}).fill('Inspector refused rough inspection: missing protective nail plates')
 await decision.getByLabel('Original evidence (PDF, PNG or JPEG; up to 2 MB)',{exact:true}).setInputFiles({name:'inspection-failed.pdf',mimeType:'application/pdf',buffer:pdf})
 await decision.getByRole('button',{name:'Append constraint decision',exact:true}).click()
 await expect(row).toContainText('failed')
 await add.getByLabel('Requirement kind',{exact:true}).selectOption('weather')
 await add.getByLabel('Requirement title',{exact:true}).fill('Rain hold on exposed work')
 await add.getByLabel('Jurisdiction',{exact:true}).fill('Burlington job site')
 await add.getByLabel('Accountable person',{exact:true}).fill('Morgan Chen, builder')
 await add.getByLabel('Request, result or clearance reason',{exact:true}).fill('Unsafe rain exposure; all work held for human site review')
 await add.getByRole('button',{name:'Record schedule requirement',exact:true}).click()
 await expect(section).toContainText('Rain hold on exposed work')
 await page.getByRole('button',{name:'Preview schedule',exact:true}).click()
 const review=page.getByRole('heading',{name:'Review schedule before publishing',exact:true}).locator('..')
 await expect(review).toContainText('Rough inspection before drywall');await expect(review).toContainText('Rain hold on exposed work')
 await expect(review.getByRole('button',{name:'Publish reviewed schedule',exact:true})).toHaveCount(0)
 await capture('blocked-review')
 for(const title of ['Rough inspection before drywall','Rain hold on exposed work']){
  const item=section.getByRole('listitem').filter({has:page.getByRole('heading',{name:title,exact:true})}).first()
  const summary=item.getByText('Record a result or clearance',{exact:true})
  const details=summary.locator('..');if(!await details.getAttribute('open').then(v=>v!==null))await summary.click()
  await details.getByLabel('Constraint decision',{exact:true}).selectOption('cleared')
  await details.getByLabel('Request, result or clearance reason',{exact:true}).fill(title.startsWith('Rough')?'Inspector passed corrected rough work; signed result attached':'Builder reviewed dry conditions and safe site; original site record attached')
  await details.getByLabel('Original evidence (PDF, PNG or JPEG; up to 2 MB)',{exact:true}).setInputFiles({name:'human-clearance.pdf',mimeType:'application/pdf',buffer:pdf})
  await capture(title.startsWith('Rough')?'inspection-clearance':'weather-clearance')
  await details.getByRole('button',{name:'Append constraint decision',exact:true}).click()
  await expect(item).toContainText('Cleared by a person')
 }
 const get=await context.request.get(base+`/api/plinth/jobs/${job.id}`);job=(await get.json()).job
 tasks=job.schedules.map(t=>({...t,start:'2026-11-04T08:00:00Z'}))
 r=await post(`/jobs/${job.id}/schedule/preview`,{expected_version:job.version,calendar,tasks});assert.deepEqual(r.preview.blockers,[])
 await post(`/jobs/${job.id}/schedule/publish`,{expected_version:job.version,calendar,tasks:r.preview.tasks,digest:r.preview.digest})
 await page.reload();await expect(section).toContainText('Cleared by a person')
 for(const summary of await section.getByText('Request and clearance history',{exact:true}).all())await summary.click()
 await expect(section).toContainText('missing protective nail plates');await expect(section).toContainText('Inspector passed corrected rough work')
 const link=row.getByRole('link',{name:'inspection-request.pdf',exact:true}).first(),file=await context.request.get(base+await link.getAttribute('href'))
 assert.deepEqual(await file.body(),pdf,'Downloaded original bytes are exact')
 await capture('published-history')
 console.log('SCH-006 passed at 1440 and 390: failed inspection + rain hold, blocked publication, original evidence, human clearance and retained history')
 await context.close()
}finally{await browser.close()}
