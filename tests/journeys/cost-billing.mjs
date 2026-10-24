import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {costFixture,original} from '../plinth/cost-support.mjs'
const base=process.env.PLINTH_URL,entrance=process.env.PLINTH_OWNER_OPEN,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&entrance&&shots,'Use the disposable native installation and private dev sign-in')
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
try{
 const context=await browser.newContext(),page=await context.newPage()
 await page.goto(entrance);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 if(new URL(page.url()).pathname==='/setup'){
  await page.getByLabel('Your name',{exact:true}).fill('Synthetic Plinth builder');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Finish setup',exact:true}).click();await page.waitForURL('**/app')
 }
 const f={owner:'owner',json:async(path,options={})=>{const r=await context.request.fetch(base+path,{method:options.method??'GET',headers:{origin:base},...(options.body?{data:options.body}:{})});return {status:r.status(),value:await r.json()}}}
 const c=await costFixture(f),date={dated_on:'2026-10-24',period:'2026-10',cost_code:'01-100'}
 for(const [kind,reference,extra] of [['time','synthetic-plinth-browser-time',{employee_reference:'synthetic-plinth-worker',minutes:480,hour_cents:3000,burden_bps:2000}],['equipment','synthetic-plinth-browser-lift',{equipment_reference:'synthetic-plinth-lift',minutes:60,hour_cents:5000}],['expense','synthetic-plinth-browser-material',{employee_reference:'synthetic-plinth-worker',amount_cents:10000,document:original}]]){
  const {record}=await c.ok('/costs/sources',{...date,kind,reference,...extra});await c.ok(`/costs/sources/${record.id}/approve`)
 }
 const entries=(await c.ledger()).rows.flatMap(r=>r.sources.actual).filter(e=>e.source_kind)
 const result=await c.ok('/invoices',{kind:'cost_plus',description:'Cost-plus approved actuals with fee and cap',recipient_email:'synthetic-plinth-client@example.com',due_on:'2026-11-23',terms:'Recorded zero-tax agreement; supporting time and receipts held by office',cost_billing:{contract_reference:'synthetic-plinth-browser-contract',fee_bps:1000,cap_cents:46000,entry_ids:entries.map(e=>e.id),excluded_entry_ids:[]}})
 const id=result.record.id
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1100});await page.goto(base+`/app?job=${c.job.id}&tab=Billing`)
  await page.getByRole('heading',{name:'Invoices and deposits',exact:true}).waitFor()
  const controls=page.locator('button.icon-button:visible')
  if(width===390)assert.ok(await controls.count()>0,'Phone navigation has a visible icon control')
  for(const control of await controls.all()){
   assert.ok((await control.getAttribute('data-tip'))?.split(' ').length>=2,'Visible icon control has a short tooltip')
   await page.keyboard.press('Tab');await control.focus();await expect.poll(()=>control.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible')
   await page.screenshot({path:`${shots}/BILL-004-tooltip-${width}.png`,animations:'disabled'});await control.blur()
  }
  const record=page.locator('#invoice-'+id);await record.locator('summary').first().click()
  if(width===1440){await record.getByRole('button',{name:'Approve and issue invoice',exact:true}).click();await record.getByRole('link',{name:'Open original invoice',exact:true}).waitFor()}
  await expect(record.getByRole('link',{name:'Open original invoice',exact:true})).toBeVisible()
  await record.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:`${shots}/BILL-004-invoice-${width}.png`,animations:'disabled'})
  const doc=await context.newPage();await doc.setViewportSize({width,height:1100});await doc.goto(base+`/api/plinth/jobs/${c.job.id}/invoices/${id}/document.html`)
  await expect(doc.getByText('Contractual cost billing fee',{exact:true})).toBeVisible();await expect(doc.getByText('Contractual cap adjustment',{exact:true})).toBeVisible()
  assert.equal(await doc.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await doc.screenshot({path:`${shots}/BILL-004-original-${width}.png`,animations:'disabled'});await doc.close()
 }
 await context.close();console.log('BILL-004 PASS: existing Billing issue controls and frozen fee and cap invoice at 1440 and 390')
}finally{await browser.close()}
