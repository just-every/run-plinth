// BILL-002 installed owner/client deposit-to-milestone invoice journey using the 12ui Billing continuation.
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
const base=process.env.PLINTH_URL,ownerState=process.env.PLINTH_STATE,clientState=process.env.PLINTH_CLIENT_STATE,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&ownerState&&clientState&&shots,'Provide private owner/client states, installation URL and screenshot directory')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
try {
 const owner=await browser.newContext({storageState:ownerState}),client=await browser.newContext({storageState:clientState}),page=await owner.newPage(),clientPage=await client.newPage()
 const req=async(path,body,context=owner)=>{const r=await context.request.fetch(base+'/api/plinth'+path,{method:body===undefined?'GET':'POST',headers:{origin:base,'content-type':'application/json'},...(body===undefined?{}:{data:body})});const value=await r.json();assert.ok(r.ok(),`${path}: ${r.status()} ${JSON.stringify(value)}`);return value}
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1100});await clientPage.setViewportSize({width,height:1100})
  let job=(await req('/jobs',{name:`Maple Street whole-home renovation · invoices ${width} · ${Date.now()}`,client_email:'client@dev.localhost',address:'2480 Maple Street, Burlington, VT 05401',time_zone:'America/New_York'})).job
  const read=async()=>job=(await req(`/jobs/${job.id}`)).job
  const act=async(path,body={})=>{const result=await req(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});if(result.job)job=result.job;return result}
  await act('/quotes',{lines:[{id:'framing',description:'Framing materials and installation',cost_code:'06-100',phase:'Remodel',category:'material',quantity:'1',unit:'job',unit_cents:18000000,cost_unit_cents:12000000},{id:'labor',description:'Whole-home remodeling labor',cost_code:'01-100',phase:'Remodel',category:'labor',quantity:'1',unit:'job',unit_cents:30000000,cost_unit_cents:21000000}]})
  const rate=(await req('/pricing-rates',{jurisdiction:'Reviewed remodel exemption',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'Builder-reviewed project tax/exemption schedule',human_reviewed:true})).rate
  const price={basis:'sell',as_of:'2026-10-21',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['framing','labor']}}
  const preview=await act('/pricing/preview',price);await act('/pricing/apply',{...price,digest:preview.preview.digest})
  await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Client returned signed agreement with deposit and fixed framing milestone',schedule_choice:{kind:'none',reason:'Superintendent will plan dates separately'}});await act('/sov',{})
  await act('/retainage',{contract_reference:'Signed agreement section 9',rules:[{line_id:'quote:framing',work_bps:500,stored_bps:500},{line_id:'quote:labor',work_bps:1000,stored_bps:1000}],milestones:[{id:'completion',name:'Substantial completion',completion_requirements:['Architect inspection'],waiver_requirements:[]}]})
  let r=await act('/claims',{description:'Fixed framing milestone application',lines:[{line_id:'quote:framing',completed_cents:6000000,stored_cents:0,evidence:'Materials installed and inspected'},{line_id:'quote:labor',completed_cents:6000000,stored_cents:0,evidence:'Superintendent approved labor progress'}]});const app=r.record
  await act(`/claims/${app.id}/approve`);await act(`/claims/${app.id}/issue`)
  await page.goto(base+`/app?job=${job.id}&tab=Billing`);await page.getByRole('heading',{name:'Invoices and deposits',exact:true}).waitFor();await page.screenshot({path:`${shots}/BILL-002-empty-${width}.png`,animations:'disabled'})
  const prepare=async(kind,description)=>{
   const form=page.getByRole('heading',{name:'Create a draft invoice',exact:true}).locator('..')
   await form.locator('select[name=kind]').selectOption(kind);await form.getByLabel('Invoice description',{exact:true}).fill(description)
   await form.getByLabel('Invoice due date',{exact:true}).fill('2026-11-20');await form.getByLabel('Invoice payment terms',{exact:true}).fill('Bank/check within 14 days; retainage per signed agreement')
   if(kind==='deposit')await form.getByLabel('Deposit request (USD)',{exact:true}).fill('48000');else await form.locator('select[name=source_application_id]').selectOption(app.id)
   await form.getByRole('button',{name:'Prepare invoice',exact:true}).click();await page.locator('details.record > summary').filter({hasText:description}).waitFor();await read();const invoice=job.invoices.at(-1),record=page.locator('#invoice-'+invoice.id);await expect(page.getByRole('region',{name:'Decisions',exact:true}).getByRole('button',{name:'Invoice draft: '+description,exact:true})).toBeVisible();await page.getByRole('region',{name:'Decisions',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/BILL-002-pending-${kind}-${width}.png`,animations:'disabled'})
   await record.locator('summary').first().click();await record.getByRole('button',{name:'Approve and issue invoice',exact:true}).click();await record.getByRole('link',{name:'Open original invoice',exact:true}).waitFor();await read();return {invoice:job.invoices.find(i=>i.id===invoice.id),record}
  }
  const deposit=await prepare('deposit','Signed contract deposit')
  await deposit.record.getByRole('button',{name:'Approve invoice email',exact:true}).click();await expect(deposit.record.getByText(/Development mail suppressed/)).toBeVisible()
  const receipt=async(record,amount,reference)=>{await record.locator('summary').filter({hasText:'Record an external receipt'}).click();const form=record.getByRole('button',{name:'Record external receipt',exact:true}).locator('..');await form.getByLabel('Receipt amount (USD)',{exact:true}).fill(amount);await form.getByLabel('Date funds received',{exact:true}).fill('2026-10-22');await form.getByLabel('Bank statement or check reference',{exact:true}).fill(reference);await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Record external receipt',exact:true}).click();await record.getByText(reference,{exact:false}).waitFor();await read()}
  await receipt(deposit.record,'24000','Bank statement BS-104-'+job.id)
  await act(`/invoices/${deposit.invoice.id}/receipt`,{amount_cents:2400000,received_on:'2026-10-22',reference:'Second deposit bank posting BS-104B-'+job.id,method:'bank',confirm:true})
  const depositReturnId=job.invoices.find(i=>i.id===deposit.invoice.id).receipts.at(-1).id
  assert.equal(job.invoice_deposit_liability_cents,4800000)
  await deposit.record.locator('summary').first().click()
  const milestone=await prepare('milestone','Fixed framing milestone'),original=structuredClone(milestone.invoice.issued)
  await milestone.record.locator('summary').filter({hasText:'Apply a recorded deposit'}).click()
  const apply=milestone.record.getByRole('button',{name:'Apply deposit to invoice',exact:true}).locator('..');await apply.getByLabel('Deposit amount to apply (USD)',{exact:true}).fill('24000');await apply.getByRole('button',{name:'Apply deposit to invoice',exact:true}).click();await milestone.record.getByText(/^Applied .* from INV-/).waitFor();await read()
  await receipt(milestone.record,'20000','Bank statement BS-105-'+job.id)
  assert.equal(job.invoice_deposit_liability_cents,2400000);assert.equal(job.invoices.find(i=>i.id===milestone.invoice.id).balance.due_cents,6700000);assert.deepEqual(job.invoices.find(i=>i.id===milestone.invoice.id).issued,original)
  // BILL-006 uses the existing Billing history; the new money doors do not claim a new interface.
  const remittance=(await act('/remittances',{amount_cents:1200000,received_on:'2026-10-23',reference:'Recorded ACH BS-106-'+job.id,evidence:'Office-only remittance source statement',method:'bank',confirm:true,allocations:[{invoice_id:milestone.invoice.id,amount_cents:1000000}]})).record
  assert.equal(job.invoices.find(i=>i.id===milestone.invoice.id).balance.due_cents,5700000)
  let receivables=await req(`/jobs/${job.id}/receivables?as_of=2026-12-21`);assert.equal(receivables.unapplied_cents,200000);assert.equal(receivables.aging['31-60'],5700000)
  await page.reload();await page.getByRole('heading',{name:'Invoices and deposits',exact:true}).waitFor();await page.locator('#invoice-'+milestone.invoice.id+' > summary').click();await page.locator('#invoice-'+milestone.invoice.id).getByText('Recorded ACH BS-106-'+job.id,{exact:false}).waitFor();await page.locator('#invoice-'+milestone.invoice.id).scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/BILL-006-allocated-${width}.png`,animations:'disabled'})
  await act(`/remittances/${remittance.id}/return`,{returned_on:'2026-10-24',reference:'Bank returned ACH BS-107-'+job.id,reason:'Staff recorded bank return notice',confirm:true})
  assert.equal(job.invoices.find(i=>i.id===milestone.invoice.id).balance.due_cents,6700000);assert.deepEqual(job.invoices.find(i=>i.id===milestone.invoice.id).issued,original)
  receivables=await req(`/jobs/${job.id}/receivables?as_of=2026-12-21`);assert.equal(receivables.unapplied_cents,0);assert.equal(receivables.aging['31-60'],6700000)
  await page.reload();await page.getByRole('heading',{name:'Invoices and deposits',exact:true}).waitFor();await page.locator('#invoice-'+milestone.invoice.id+' > summary').click();await expect(page.locator('#invoice-'+milestone.invoice.id).getByText(/Return recorded by staff/)).toBeVisible();await page.locator('#invoice-'+milestone.invoice.id).scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/BILL-006-returned-${width}.png`,animations:'disabled'})
  const directReceipt=job.invoices.find(i=>i.id===milestone.invoice.id).receipts.find(r=>r.reference==='Bank statement BS-105-'+job.id)
  await act(`/invoices/${milestone.invoice.id}/return-receipt`,{receipt_id:directReceipt.id,returned_on:'2026-10-25',reference:'Returned single-invoice check BS-108-'+job.id,reason:'Private single-invoice bank return correspondence',confirm:true})
  await act(`/invoices/${deposit.invoice.id}/return-receipt`,{receipt_id:depositReturnId,returned_on:'2026-10-25',reference:'Returned unapplied deposit BS-109-'+job.id,reason:'Private deposit bank return correspondence',confirm:true})
  assert.equal(job.invoice_deposit_liability_cents,0);assert.equal(job.invoices.find(i=>i.id===milestone.invoice.id).balance.due_cents,8700000)
  assert.deepEqual(job.invoices.find(i=>i.id===milestone.invoice.id).issued,original)
  receivables=await req(`/jobs/${job.id}/receivables?as_of=2026-12-21`);assert.equal(receivables.aging['31-60'],8700000)
  await page.reload();await page.getByRole('heading',{name:'Invoices and deposits',exact:true}).waitFor();await page.locator('#invoice-'+milestone.invoice.id+' > summary').click()
  await expect(page.locator('#invoice-'+milestone.invoice.id).getByText('Returned single-invoice check BS-108-'+job.id,{exact:false})).toBeVisible()
  await page.locator('#invoice-'+milestone.invoice.id).scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/BILL-006-direct-return-${width}.png`,animations:'disabled'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`BILL-006 history ${width} fits`)
  const shot=async(contextPage,name,target)=>{await target.scrollIntoViewIfNeeded();assert.equal(await contextPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`BILL-002 ${name} ${width} fits`);await contextPage.screenshot({path:`${shots}/BILL-002-${name}-${width}.png`,animations:'disabled'})}
  await shot(page,'activity',milestone.record.locator('summary').first());await milestone.record.locator('summary').first().click();await shot(page,'ledger',page.getByRole('heading',{name:'Invoices and deposits',exact:true}))
  await clientPage.goto(base+`/app?job=${job.id}&tab=Billing`);const clientInvoice=clientPage.locator('#invoice-'+milestone.invoice.id);await clientInvoice.locator('summary').first().click();await clientInvoice.getByLabel('Invoice acknowledgment statement',{exact:true}).fill('I acknowledge the exact framing invoice; payment is recorded separately');await clientInvoice.getByRole('checkbox').check();await clientInvoice.getByRole('button',{name:'Acknowledge this invoice',exact:true}).click();await expect(clientInvoice.getByText(/Client acknowledged by/)).toBeVisible();assert.equal((await client.request.get(base+`/api/plinth/jobs/${job.id}/receivables`)).status(),403);assert.equal(await clientPage.getByText('Office-only remittance source statement',{exact:false}).count(),0);await shot(clientPage,'client',clientInvoice.locator('summary').first());assert.equal(await clientPage.getByText('Private single-invoice bank return correspondence',{exact:false}).count(),0);await read();assert.equal(job.invoices.find(i=>i.id===milestone.invoice.id).balance.due_cents,8700000)
  const document=await client.newPage();await document.setViewportSize({width,height:1100});await document.goto(base+`/api/plinth/jobs/${job.id}/invoices/${milestone.invoice.id}/document.html`);await document.getByRole('heading',{name:'Invoice '+original.number,exact:true}).waitFor();assert.equal(await document.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'BILL-002 original invoice fits the phone page');await document.screenshot({path:`${shots}/BILL-002-original-${width}.png`,animations:'disabled'});await document.close()
 }
 const site=process.env.PLINTH_SITE;assert.ok(site);await page.goto(site+'/contract');for(const width of [1440,390]){await page.setViewportSize({width,height:1100});await page.getByText('BILL-002',{exact:true}).first().scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/BILL-002-contract-${width}.png`,animations:'disabled'})}
 await page.goto(site+'/docs/agent-commands');for(const width of [1440,390]){await page.setViewportSize({width,height:1100});await page.getByRole('heading',{name:'Deposits and milestone invoices (BILL-002)',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/BILL-002-commands-${width}.png`,animations:'disabled'})}
 console.log('BILL-006 recorded allocation, direct/deposit receipt returns, history and aging passed at 1440/390; BILL-002 native owner/client Billing journey passed at 1440/390: issue, suppressed mail, recorded bank receipts, partial deposit allocation, liability, net balance, acknowledgment and immutable invoice')
 await owner.close();await client.close()
} finally {await browser.close()}
