import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { takeoffPlan } from '../fixtures/takeoff-plan.mjs'

const base=process.env.PLINTH_URL,state=process.env.PLINTH_STATE,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&state&&shots,'Use the disposable installed application')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:state,viewport:{width:1440,height:1000}}),page=await owner.newPage()
 const request=async(path,body)=>owner.request.post(base+'/api/plinth'+path,{headers:{origin:base},data:body})
 const post=async(path,body)=>{const r=await request(path,body);assert.equal(r.status(),200,await r.text());return r.json()}
 const created=await request('/jobs',{name:'Maple house window submittal',client_email:['synthetic-plinth-submittal-client','example.test'].join('@'),address:'148 Maple Street'})
 assert.equal(created.status(),201);let job=(await created.json()).job
 job=(await post('/jobs/'+job.id+'/quotes',{expected_version:job.version,lines:[{description:'Window replacement scope',quantity:1,unit_cents:480000}]})).job
 job=(await post('/jobs/'+job.id+'/quotes/'+job.quotes[0].id+'/accept',{expected_version:job.version,method:'signed',evidence:'Synthetic signed window contract',schedule_choice:{kind:'none',reason:'Schedule follows vendor review'}})).job
 await page.goto(base+`/app?job=${job.id}&tab=Purchasing`)
 const purchase=page.locator('form').filter({has:page.getByRole('button',{name:'Prepare purchase order',exact:true})})
 await purchase.getByLabel('Supplier',{exact:true}).fill('Synthetic window supplier')
 await purchase.getByLabel('Goods or services',{exact:true}).fill('Window package W1')
 await purchase.getByLabel('Order amount',{exact:true}).fill('1200')
 await purchase.getByRole('button',{name:'Prepare purchase order',exact:true}).click()
 await expect(page.getByRole('button',{name:'Approve and issue PO',exact:true})).toBeVisible()
 const panel=page.getByRole('region',{name:'Submittal register',exact:true})
 await panel.getByText('Register a required submittal',{exact:true}).click()
 const registration=panel.locator('form').filter({has:page.getByRole('button',{name:'Submit vendor package',exact:true})})
 await registration.getByLabel('Submittal title',{exact:true}).fill('Window package review')
 await registration.getByLabel('Draft commitment',{exact:true}).selectOption({label:'Window package W1 · Synthetic window supplier'})
 const original=takeoffPlan(),revised=takeoffPlan(true)
 async function fillPackage(form,version,bytes){
  await form.getByLabel('Product and vendor version',{exact:true}).fill(version)
  await form.getByLabel('Required review date',{exact:true}).fill('2026-11-12')
  await form.getByLabel('Specified scope',{exact:true}).fill('W1 insulated low-e glazing')
  await form.getByLabel('Original vendor documents',{exact:true}).setInputFiles({name:'synthetic-plinth-window.pdf',mimeType:'application/pdf',buffer:bytes})
 }
 await fillPackage(registration,'Window W1 version one',original)
 await registration.getByLabel('Product deviates from specified scope',{exact:true}).check()
 await registration.getByLabel('Deviation details',{exact:true}).fill('The first package omits low-e coating')
 await registration.getByRole('button',{name:'Submit vendor package',exact:true}).click()
 const record=panel.getByRole('article',{name:'Window package review',exact:true}),first=record.getByRole('region',{name:'Review cycle 1',exact:true})
 await expect(first.getByRole('heading',{name:'Review cycle 1 · Window W1 version one',exact:true})).toBeVisible()
 await expect(first.getByText('Specified-scope deviation: The first package omits low-e coating',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Approve and issue PO',exact:true}).click()
 await expect(page.getByRole('alert').filter({hasText:'The current submittal must be approved before procurement release'})).toBeVisible()
 await first.getByText('Review this vendor version',{exact:true}).click()
 await first.getByLabel('Review annotation',{exact:true}).fill('Glazing schedule must include the specified coating')
 await first.getByRole('button',{name:'Add review annotation',exact:true}).click()
 await expect(first.getByText('Glazing schedule must include the specified coating',{exact:false})).toBeVisible()
 async function review(cycle,value,comment){
  const form=cycle.locator('form').filter({has:page.getByRole('button',{name:'Record review disposition',exact:true})})
  await form.getByLabel('Disposition',{exact:true}).selectOption(value)
  await form.getByLabel('Review comments',{exact:true}).fill(comment)
  await form.getByRole('checkbox').check()
  await form.getByRole('button',{name:'Record review disposition',exact:true}).click()
  await expect(cycle.getByText('Review comments: '+comment,{exact:false})).toBeVisible()
 }
 await review(first,'rejected','Reject the first package and resubmit low-e glazing')
 const capture=async(label)=>{for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await panel.scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Submittal workspace fits the viewport')
  if(width===390){const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible');await panel.scrollIntoViewIfNeeded()}
  await page.screenshot({path:`${shots}/DOC-004-${label}-${width}.png`,fullPage:true,animations:'disabled'})
 }}
 await capture('rejected')
 await page.setViewportSize({width:1440,height:1000})
 await record.getByText('Resubmit a new vendor version',{exact:true}).click()
 const resubmission=record.locator('form').filter({has:page.getByRole('button',{name:'Resubmit vendor package',exact:true})})
 await fillPackage(resubmission,'Window W1 version two',revised)
 await resubmission.getByLabel('Product deviates from specified scope',{exact:true}).uncheck()
 await resubmission.getByRole('button',{name:'Resubmit vendor package',exact:true}).click()
 const second=record.getByRole('region',{name:'Review cycle 2',exact:true})
 await second.getByText('Review this vendor version',{exact:true}).click()
 await review(second,'approved','Revised glazing matches the specified W1 scope')
 const read=async()=>(await (await owner.request.get(base+'/api/plinth/jobs/'+job.id+'/submittals')).json())
 const current=await read(),row=current.register[0],cycle=row.cycles[1],release={cycle_id:cycle.id,order_id:row.order_id,product_reference:cycle.product_reference,confirm:true}
 for(const body of [{...release,product_reference:'Unreviewed window model'},{...release,cycle_id:row.cycles[0].id},{...release,order_id:'different-commitment'}]){
  const before=await read(),r=await request('/jobs/'+job.id+'/submittals/'+row.id+'/release',{expected_version:before.version,...body});assert.equal(r.status(),409);assert.deepEqual(await read(),before)
 }
 const releaseForm=record.locator('form').filter({has:page.getByRole('button',{name:'Select approved version',exact:true})})
 await releaseForm.getByRole('checkbox').check();await releaseForm.getByRole('button',{name:'Select approved version',exact:true}).click()
 await expect(record.getByText('Approved vendor version selected for this commitment.',{exact:false})).toBeVisible()
 await page.getByRole('button',{name:'Approve and issue PO',exact:true}).click()
 await expect(page.getByRole('button',{name:'Approve and issue PO',exact:true})).toHaveCount(0)
 const released=await read();assert.equal(released.orders.find(o=>o.id===row.order_id).status,'issued');assert.equal(released.orders.find(o=>o.id===row.order_id).submittal_release.cycle_id,cycle.id)
 await expect(first.getByText('Review comments: Reject the first package and resubmit low-e glazing',{exact:false})).toBeVisible()
 await expect(second.getByText('Review comments: Revised glazing matches the specified W1 scope',{exact:false})).toBeVisible()
 for(const [review,bytes] of [[row.cycles[0],original],[row.cycles[1],revised]]){const r=await owner.request.get(base+'/api/plinth/jobs/'+job.id+'/submittals/files/'+review.attachments[0].id);assert.equal(r.status(),200);assert.deepEqual(await r.body(),bytes)}
 await capture('approved')
 await owner.close()
 console.log('DOC-004 PASS: installed rejection, annotated originals, resubmission, exact approval and procurement gate; changed screens at 1440 and 390')
}finally{await browser.close()}
