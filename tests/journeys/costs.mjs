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
 const c=await costFixture(f);let r=await c.ok('/costs/bills',c.bill('synthetic-plinth-invoice-'+Date.now()));const id=r.record.id;await c.ok(`/costs/bills/${id}/review`,{reason:'Reviewed both receipts and source code allocation'});await c.ok(`/costs/bills/${id}/post`)
 const capture=async(label)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' fits '+width);await page.screenshot({path:`${shots}/${label}-${width}.png`,fullPage:true,animations:'disabled'})}}
 await page.goto(base+`/app?job=${c.job.id}&tab=Purchasing`);await expect(page.getByRole('heading',{name:'Purchase orders',exact:true})).toBeVisible();await expect(page.getByText('synthetic-plinth-delivery-1',{exact:false})).toBeVisible();await expect(page.getByText('synthetic-plinth-delivery-2',{exact:false})).toBeVisible();await capture('COST-001-purchasing')
 await page.goto(base+`/app?job=${c.job.id}&tab=History`);await expect(page.getByRole('heading',{name:/Approval history/})).toBeVisible();await expect(page.getByText('cost.bill.post',{exact:false}).first()).toBeVisible();await capture('COST-001-history')
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const ledger=(await c.ledger());assert.equal(ledger.totals.posted_actual_cents,43000);assert.equal(ledger.totals.open_commitment_cents,60000);assert.equal(ledger.totals.received_not_billed_cents,10000);const source=ledger.rows.find(r=>r.cost_code==='06-100').sources;assert.equal(source.actual[0].source_id,id);assert.equal(source.procurement.filter(r=>r.kind==='receipt').length,2)}
 // All further cost work uses native HTTP and the same existing History screen.
 const date={dated_on:'2026-10-23',period:'2026-10',cost_code:'01-100'}
 r=await c.ok('/costs/sources',{...date,kind:'time',reference:'synthetic-plinth-browser-time',employee_reference:'synthetic-plinth-employee-1',minutes:480,hour_cents:3000,burden_bps:2000});const time=r.record;await c.ok(`/costs/sources/${time.id}/approve`)
 r=await c.ok('/costs/sources',{...date,kind:'expense',reference:'synthetic-plinth-browser-expense',employee_reference:'synthetic-plinth-employee-1',amount_cents:1250,document:c.bill().document});const expense=r.record;await c.ok(`/costs/sources/${expense.id}/approve`);await c.ok(`/costs/sources/${expense.id}/reimburse`,{confirm:true,reference:'synthetic-plinth-browser-reimbursement'})
 r=await c.ok('/costs/sources',{...date,cost_code:'06-100',kind:'equipment',reference:'synthetic-plinth-browser-lift',equipment_reference:'synthetic-plinth-lift-1',minutes:90,hour_cents:4000});await c.ok(`/costs/sources/${r.record.id}/approve`)
 const csv=`external_id,time_source_id,gross_cents,burden_cents\nsynthetic-plinth-browser-payroll,${time.id},25000,5500\n`;await c.ok('/costs/payroll',{csv,reference:'synthetic-plinth-browser-register',dated_on:'2026-10-24',period:'2026-10'})
 assert.equal((await c.ledger()).totals.posted_actual_cents,80750)
 const assumptions={as_of:'2026-10-23',source_as_of:'Builder reviewed production, invoices and remaining bid today',codes:[{cost_code:'06-100',remaining_quantity:'50',minutes_per_unit:'24',labor_hour_cents:3000,outstanding_commitment_cents:60000,unbought_cents:5000,risk_cents:2000,reference:'Half framing remains; observed 24 minutes per unit; revised bid 5000'},{cost_code:'01-100',remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:0,outstanding_commitment_cents:0,unbought_cents:10000,risk_cents:0,reference:'Unbought labor package'}]}
 r=await c.ok('/costs/forecasts',assumptions);assert.equal(r.record.final_cents,217750)
 assumptions.codes[0].minutes_per_unit='30';r=await c.ok('/costs/forecasts',assumptions);assert.equal(r.record.final_cents,232750)
 const extra={...c.bill('synthetic-plinth-browser-variance-'+Date.now()),lines:[{cost_code:'06-100',description:'Supplier variance awaiting correction',subtotal_cents:100000,taxable:false,matches:[]}]}
 r=await c.ok('/costs/bills',extra);const extraId=r.record.id;await c.ok(`/costs/bills/${extraId}/review`,{reason:'Owner reviewed invoice and source discrepancy'});await c.ok(`/costs/bills/${extraId}/post`)
 await c.ok('/costs/reconcile',{period:'2026-10',balances:[{cost_code:'01-100',amount_cents:41750}],reference:'Reviewed accounting export with missing framing entry'})
 let exceptions=(await f.json(`/api/plinth/jobs/${c.job.id}/costs/exceptions`)).value;assert.equal(exceptions.items.filter(e=>e.status==='open'&&['budget','ledger'].includes(e.kind)).length,2)
 await page.goto(base+`/app?job=${c.job.id}&tab=History`);await expect(page.getByText('cost.forecast',{exact:false}).first()).toBeVisible();await capture('COST-003-004-006-history')
 r=await c.ok('/costs/bills',{...extra,kind:'credit',credit_of:extraId,reference:'synthetic-plinth-browser-correction-'+Date.now()});await c.ok(`/costs/bills/${r.record.id}/review`,{reason:'Supplier corrected variance; exact original credit reviewed'});await c.ok(`/costs/bills/${r.record.id}/post`)
 await c.ok('/costs/reconcile',{period:'2026-10',balances:[{cost_code:'01-100',amount_cents:41750},{cost_code:'06-100',amount_cents:39000}],reference:'Corrected accounting source matches both job codes'})
 exceptions=(await f.json(`/api/plinth/jobs/${c.job.id}/costs/exceptions`)).value
 for(const e of exceptions.items.filter(e=>!e.resolutions.length&&!e.current))await c.ok(`/costs/exceptions/${e.id}`,{reason:'Approved correction and reviewed source reconciliation now agree'})
 assert.equal((await f.json(`/api/plinth/jobs/${c.job.id}/costs/exceptions`)).value.healthy,true)
 await page.reload();await capture('COST-006-cleared-history')
 const cash=(await f.json(`/api/plinth/jobs/${c.job.id}/costs/cash?start_period=2026-10&months=3&opening_cash_cents=200000`)).value;assert.equal(cash.rows.length,3);assert.equal(cash.wip.actual_cents,80750)
 await c.ok('/costs/periods',{period:'2026-10',accountant_approved:true,accountant_name:'Synthetic external accountant',approval_reference:'Reviewed exact October as-of records; externally recorded decision',opening_cash_cents:200000,months:3})
 await page.reload();await expect(page.getByText('cost.period.close',{exact:false}).first()).toBeVisible();await capture('COST-005-closed-history')
 // The shared shell is unchanged, but its icon-only controls remain part of these screens.
 await page.setViewportSize({width:390,height:1000});const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();assert.equal(await menu.evaluate(el=>getComputedStyle(el,'::after').opacity),'0');await page.waitForTimeout(450);assert.equal(await menu.evaluate(el=>getComputedStyle(el,'::after').opacity),'1');await page.mouse.move(250,500);await menu.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');assert.equal(await menu.evaluate(el=>getComputedStyle(el,'::after').opacity),'1');await page.screenshot({path:`${shots}/COST-001-tooltip-390.png`,animations:'disabled'})
 await context.close();console.log('COST-001/002/003/004/005/006 native cost workflows and existing Purchasing/History screens PASS at 1440/390; icon tooltip delay/focus PASS')
}finally{await browser.close()}
