import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {actualsFixture,refreshCodes} from '../plinth/actuals-refresh-support.mjs'
const base=process.env.PLINTH_URL,state=process.env.PLINTH_STATE,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&state&&shots,'Use the installed owner and native D1 journey')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const context=await browser.newContext({storageState:state,viewport:{width:1440,height:1100}}),page=await context.newPage()
 const f={owner:'owner',json:async(path,options={})=>{
  const response=await context.request.fetch(base+path,{method:options.method??'GET',headers:{origin:base},...(options.body?{data:options.body}:{})})
  return {status:response.status(),value:await response.json()}
 }}
 const {c,list}=await actualsFixture(f),frozen=structuredClone((await c.read()).claims)
 const observed=async()=>{const r=await fetch(process.env.PLINTH_PROVIDER_EDGE_URL+'/observations');return r.json()},outbound=await observed()
 const open=async()=>{
  await page.goto(base+'/app?job='+c.job.id+'&tab=Billing')
  await page.getByRole('heading',{name:'Actuals refresh',exact:true}).waitFor()
  await page.getByText('Review sources and prepare preview',{exact:true}).click()
 }
 const save=async(reference,codes)=>{
  await page.getByLabel('Refresh as of',{exact:true}).fill('2026-11-09')
  await page.getByLabel('Fresh review reference',{exact:true}).fill(reference)
  for(const row of codes){
   for(const [key,label] of [['remaining_quantity','Remaining quantity'],['minutes_per_unit','Minutes per unit'],['labor_hour_cents','Labor hourly cents'],['unbought_cents','Unbought cents'],['risk_cents','Risk cents'],['reference','Assumption evidence']])await page.getByLabel(label+' '+row.cost_code,{exact:true}).fill(String(row[key]))
  }
  await page.getByLabel('Stored cents quote:framing',{exact:true}).fill('20000')
  await page.getByLabel('Stored evidence quote:framing',{exact:true}).fill('Human reviewed stored packs on exact native receipts')
  await page.getByLabel('Stored evidence quote:labor',{exact:true}).fill('No stored labor')
  await page.getByRole('group',{name:'Stored allocation · Framing materials',exact:true}).getByRole('checkbox',{name:'PO '+c.order.id,exact:true}).check()
  await page.getByRole('checkbox',{name:'I freshly reviewed these exact sources, assumptions and stored allocations.',exact:true}).check()
  await page.getByRole('button',{name:'Save private refresh preview',exact:true}).click()
  await expect(page.getByRole('article',{name:'Refresh result'}).getByRole('heading',{name:reference,exact:true})).toBeVisible()
 }
 await open();await save('Synthetic baseline refresh',refreshCodes())
 let latest=(await list()).previews.at(-1);assert.equal(latest.forecast.final_cents,177000)
 const result=page.getByRole('article',{name:'Refresh result'})
 await expect(result.getByRole('region',{name:'Prospective billing'})).toContainText('Approved completed work $300.00')
 await c.read();await c.ok('/orders/'+c.order.id+'/receive',{lines:[{line_id:'lumber',quantity:'2'}],reference:'synthetic-plinth-browser-new-receipt',received_on:'2026-11-08'})
 await open();await expect(result).toContainText('Sources changed');await save('Synthetic receipt refresh',refreshCodes())
 latest=(await list()).previews.at(-1);assert.equal(latest.codes[0].delta.received_cents,20000);assert.equal(latest.codes[0].delta.actual_cents,0)
 await c.read();const bill=(await c.ok('/costs/bills',c.bill())).record
 await c.ok('/costs/bills/'+bill.id+'/review',{reason:'Human reviews exact original and source codes'});await c.ok('/costs/bills/'+bill.id+'/post')
 await open();await save('Synthetic posted bill refresh',refreshCodes(60000))
 latest=(await list()).previews.at(-1);assert.equal(latest.forecast.final_cents,180000);assert.equal(latest.codes[0].open_commitment_cents,60000)
 await result.getByText('Saved review inputs',{exact:true}).click()
 await expect(result).toContainText('reviewed open commitment $600.00')
 await expect(result).toContainText('remaining quantity 50, minutes per unit 24')
 await result.getByText('Saved review inputs',{exact:true}).click()
 await expect(result.getByRole('region',{name:'Refresh code 06-100'})).toContainText('$330.00')
 await expect(result.getByRole('region',{name:'Refresh code 06-100'})).toContainText('$1,270.00')
 await expect(result.getByRole('region',{name:'Prospective billing'})).toContainText('Current net $190.00')
 await c.read();await c.ok('/diary',{note:'Synthetic unapproved note claims more completed work'})
 await open()
 const source=(await list()).source_digest
 assert.equal(source,latest.source_digest,'Unapproved daily notes supply no new earned progress')
 assert.deepEqual((await c.read()).claims,frozen)
 assert.deepEqual(await observed(),outbound,'Native review and UI cause zero external provider calls')
 // The money assertions run once. Both viewport captures show the same owner result.
 await page.getByText('Review sources and prepare preview',{exact:true}).click()
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1100})
  await page.getByRole('heading',{name:'Actuals refresh',exact:true}).scrollIntoViewIfNeeded()
  await page.screenshot({path:shots+'/AUTO-003-sources-'+width+'.png',fullPage:true,animations:'disabled'})
  await result.scrollIntoViewIfNeeded()
  await page.screenshot({path:shots+'/AUTO-003-result-'+width+'.png',animations:'disabled'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  for(const control of await page.locator('button.icon-button:visible').all()){
   assert.ok((await control.getAttribute('data-tip'))?.split(' ').length>=2)
   await control.hover();await page.waitForTimeout(350);await expect.poll(()=>control.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible')
   await control.focus();await expect.poll(()=>control.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible');await control.blur()
  }
 }
 await context.close()
 console.log('AUTO-003 PASS: installed native receipt and bill deltas, reviewed assumptions, frozen completed work and issued billing; zero provider calls; owner screens at 1440 and 390')
}finally{await browser.close()}
