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
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1100})
  const c=await costFixture(f,{taxPercent:'10'}),date={dated_on:'2026-10-24',period:'2026-10',cost_code:'01-100'}
  const source=async(kind,reference,extra)=>{const {record}=await c.ok('/costs/sources',{...date,kind,reference,...extra});await c.ok(`/costs/sources/${record.id}/approve`);return record}
  await source('time','synthetic-plinth-browser-time-'+width,{employee_reference:'synthetic-plinth-worker',minutes:480,hour_cents:3000,burden_bps:2000})
  await source('equipment','synthetic-plinth-browser-lift-'+width,{equipment_reference:'synthetic-plinth-lift',minutes:60,hour_cents:5000})
  await source('expense','synthetic-plinth-browser-material-'+width,{employee_reference:'synthetic-plinth-worker',amount_cents:10000,document:original})
  const bill=(await c.ok('/costs/bills',c.bill('synthetic-plinth-browser-bill-'+width))).record;await c.ok(`/costs/bills/${bill.id}/review`,{reason:'Reviewed original cost evidence'});await c.ok(`/costs/bills/${bill.id}/post`)
  const entries=(await c.ledger()).rows.flatMap(r=>r.sources.actual).filter(e=>e.source_kind),excluded=entries.find(e=>e.source_kind==='expense')
  const prepare=async(selected,label,first=false)=>{
   await page.goto(base+`/app?job=${c.job.id}&tab=Billing`)
   await page.getByRole('heading',{name:'Bill approved actual costs',exact:true}).waitFor()
   await page.getByLabel('Cost invoice description',{exact:true}).fill(label)
   await page.getByLabel('Cost invoice due date',{exact:true}).fill('2026-11-23')
   await page.getByLabel('Reviewed cost billing terms',{exact:true}).fill('Human-reviewed accepted tax and contractual fee categories')
   if(first){await page.getByLabel('Reviewed agreement reference',{exact:true}).fill('synthetic-plinth-browser-contract-'+width);await page.getByLabel('Cumulative gross cap (USD)',{exact:true}).fill('1000');await page.getByLabel('Fee category for 06-100',{exact:true}).fill('Material handling');await page.getByLabel('Fee category for 01-100',{exact:true}).fill('Labor and equipment');await page.getByLabel('Permanently exclude source '+excluded.id,{exact:true}).check()}
   for(const e of selected)await page.getByLabel('Bill source '+e.id,{exact:true}).check()
   await page.getByRole('button',{name:'Preview cost billing',exact:true}).click()
   const review=page.getByRole('region',{name:'Cost billing preview',exact:true});await expect(review.getByRole('heading',{name:'Review cost billing',exact:true})).toBeVisible();await expect(review).toContainText('10%');await expect(review).toContainText('Material handling');await expect(review).toContainText('Labor and equipment')
   await review.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   await page.screenshot({path:`${shots}/BILL-004-${label}-preview-${width}.png`,animations:'disabled'})
   await review.getByRole('button',{name:'Prepare reviewed cost invoice',exact:true}).click()
   const record=page.locator('details.record').filter({has:page.locator('summary').filter({hasText:label})});await record.locator('summary').first().click();await record.getByRole('button',{name:'Approve and issue invoice',exact:true}).click();await expect(record.getByRole('link',{name:'Open original invoice',exact:true})).toBeVisible()
   await page.screenshot({path:`${shots}/BILL-004-${label}-issue-${width}.png`,animations:'disabled'})
   await c.read();return c.job.invoices.find(i=>i.description===label)
  }
  const first=await prepare(entries.filter(e=>e.id!==excluded.id),'Mixed-costs',true),frozen=structuredClone(first.issued)
  assert.equal(first.issued.tax_cents,8448);assert.equal(first.amount_cents,92928)
  const credit=(await c.ok('/costs/bills',{...c.bill('synthetic-plinth-browser-credit-'+width),kind:'credit',credit_of:bill.id,lines:[{cost_code:'06-100',description:'Returned materials',subtotal_cents:1000,taxable:true,matches:[{order_id:c.order.id,receipt_id:c.receipts[0].id,cost_code:'06-100',amount_cents:1000}]}]})).record;await c.ok(`/costs/bills/${credit.id}/post`)
  const creditEntries=(await c.ledger()).rows.flatMap(r=>r.sources.actual).filter(e=>e.source_id===credit.id),adjustment=await prepare(creditEntries,'Standalone-credit')
  assert.equal(adjustment.amount_cents,-1331);assert.deepEqual(adjustment.issued.adjusts_invoice_numbers,[first.number])
  const late=await source('time','synthetic-plinth-browser-late-'+width,{employee_reference:'synthetic-plinth-worker',minutes:180,hour_cents:3000,burden_bps:2000})
  const lateEntries=(await c.ledger()).rows.flatMap(r=>r.sources.actual).filter(e=>e.source_id===late.id),last=await prepare(lateEntries,'Late-time')
  assert.equal(last.amount_cents,8403);assert.ok(last.sources.cost_billing.cap_reduction_cents>0);assert.deepEqual(c.job.invoices.find(i=>i.id===first.id).issued,frozen)
  const replay=await c.act('/invoices',{kind:'cost_plus',description:'Replay',recipient_email:c.job.client_email,due_on:'2026-11-23',terms:'Replay is refused',cost_billing:{...last.sources.cost_billing,entry_ids:lateEntries.map(e=>e.id)}});assert.equal(replay.status,409)
  const controls=page.locator('button.icon-button:visible')
  if(width===390)assert.ok(await controls.count()>0)
  for(const control of await controls.all()){assert.ok((await control.getAttribute('data-tip'))?.split(' ').length>=2);await control.hover();await page.waitForTimeout(350);await expect.poll(()=>control.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible');await control.focus();await expect.poll(()=>control.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible');await page.screenshot({path:`${shots}/BILL-004-tooltip-${width}.png`,animations:'disabled'});await control.blur()}
  const doc=await context.newPage();await doc.setViewportSize({width,height:1100});await doc.goto(base+`/api/plinth/jobs/${c.job.id}/invoices/${last.id}/document.html`)
  await expect(doc.getByText('Contractual cap adjustment',{exact:true})).toBeVisible();assert.equal(await doc.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await doc.screenshot({path:`${shots}/BILL-004-original-${width}.png`,animations:'disabled'});await doc.close()
 }
 await context.close();console.log('BILL-004 PASS: cost selection, reviewed taxable categories, standalone credit, late time, cap and frozen originals at 1440 and 390')
}finally{await browser.close()}
