import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { costFixture } from '../plinth/cost-support.mjs'
const base=process.env.PLINTH_URL,entrance=process.env.PLINTH_OWNER_OPEN,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&entrance&&shots&&new URL(entrance).origin===base,'Use this disposable installation’s native dev entrance')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
try{
 const context=await browser.newContext(),page=await context.newPage();await page.goto(entrance);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 if(new URL(page.url()).pathname==='/setup'){await page.getByLabel('Your name',{exact:true}).fill('Synthetic builder');await page.getByRole('checkbox',{name:'I confirm this owner account is ready to use.'}).check();await page.getByRole('button',{name:'Finish setup',exact:true}).click();await page.waitForURL('**/app')}
 const f={owner:'owner',json:async(path,{method='GET',body}={})=>{const r=await context.request.fetch(base+path,{method,headers:{origin:base,'content-type':'application/json'},...(body===undefined?{}:{data:body})});return {status:r.status(),value:await r.json()}}}
 const c=await costFixture(f);let r=await c.ok('/costs/bills',c.bill());const id=r.record.id;await c.ok(`/costs/bills/${id}/review`,{reason:'Reviewed both receipts and source code allocation'});await c.ok(`/costs/bills/${id}/post`)
 const capture=async(label)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' fits '+width);await page.screenshot({path:`${shots}/${label}-${width}.png`,fullPage:true,animations:'disabled'})}}
 await page.goto(base+`/app?job=${c.job.id}&tab=Purchasing`);await expect(page.getByRole('heading',{name:'Purchase orders',exact:true})).toBeVisible();await expect(page.getByText('synthetic-plinth-delivery-1',{exact:false})).toBeVisible();await expect(page.getByText('synthetic-plinth-delivery-2',{exact:false})).toBeVisible();await capture('COST-001-purchasing')
 await page.goto(base+`/app?job=${c.job.id}&tab=History`);await expect(page.getByRole('heading',{name:/Approval history/})).toBeVisible();await expect(page.getByText('cost.bill.post',{exact:false}).first()).toBeVisible();await capture('COST-001-history')
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const ledger=(await c.ledger());assert.equal(ledger.totals.posted_actual_cents,43000);assert.equal(ledger.totals.open_commitment_cents,60000);assert.equal(ledger.totals.received_not_billed_cents,10000);const source=ledger.rows.find(r=>r.cost_code==='06-100').sources;assert.equal(source.actual[0].source_id,id);assert.equal(source.procurement.filter(r=>r.kind==='receipt').length,2)}
 // The shared shell is unchanged, but its icon-only controls remain part of these screens.
 await page.setViewportSize({width:390,height:1000});const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();assert.equal(await menu.evaluate(el=>getComputedStyle(el,'::after').opacity),'0');await page.waitForTimeout(450);assert.equal(await menu.evaluate(el=>getComputedStyle(el,'::after').opacity),'1');await page.mouse.move(250,500);await menu.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');assert.equal(await menu.evaluate(el=>getComputedStyle(el,'::after').opacity),'1');await page.screenshot({path:`${shots}/COST-001-tooltip-390.png`,animations:'disabled'})
 await context.close();console.log('COST-001/COST-002 native bill + ledger and existing Purchasing/History screens PASS at 1440/390; icon tooltip delay/focus PASS')
}finally{await browser.close()}
