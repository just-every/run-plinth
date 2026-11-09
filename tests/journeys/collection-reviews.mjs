import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { collectionFixture } from '../plinth/collection-support.mjs'
import { nativeSignIn } from '../../scripts/verify/native-signin.mjs'
const base=process.env.PLINTH_URL,state=process.env.PLINTH_STATE,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&state&&shots,'Use the disposable installed application')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:state,viewport:{width:1440,height:1000}}),contexts=new Map([['owner',owner]]),page=await owner.newPage()
 const json=async(path,{method='GET',cookie='owner',body}={})=>{const r=await contexts.get(cookie).request.fetch(base+path,{method,headers:{origin:base},...(body===undefined?{}:{data:body})});return {status:r.status(),value:await r.json()}}
 const invite=async(email,displayName,role='member')=>{
  const r=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName,role,returnTo:'/app'}});assert.equal(r.status(),202)
  const context=await browser.newContext(),p=await context.newPage();await nativeSignIn(p,email);await p.close();contexts.set(email,context);return email
 }
 const c=await collectionFixture({json,invite,owner:'owner'}),j=c.j
 const observations=async()=>{const r=await owner.request.get(process.env.PLINTH_PROVIDER_EDGE_URL+'/observations');assert.equal(r.status(),200);return r.json()}
 const beforeCalls=await observations(),originals=structuredClone(j.job.invoices.map(i=>i.issued)),otherOriginal=structuredClone(j.job.invoices.find(i=>i.id===c.ids[1]))
 const originalHtml=await (await owner.request.get(base+'/api/plinth/jobs/'+j.job.id+'/invoices/'+c.ids[0]+'/document.html')).text()
 const screen=page.getByRole('region',{name:'Collection balance reviews',exact:true})
 await page.goto(base+'/app?job='+j.job.id+'&tab=Billing');await expect(screen.getByRole('heading',{name:'Current recorded balances',exact:true})).toBeVisible()
 const save=async(number)=>{
  const details=screen.locator('details').filter({has:page.locator('summary').filter({hasText:/^Review current sources$/})})
  if(!await details.evaluate(e=>e.open))await details.locator('summary').first().click()
  const form=screen.getByRole('form',{name:'Save collection review',exact:true})
  await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Save collection review',exact:true}).click()
  await expect(screen.getByRole('heading',{name:'Review '+number,exact:true})).toBeVisible()
  await expect(screen.getByText('Current native review',{exact:true})).toBeVisible()
  const data=await c.readReviews();assert.equal(data.reviews.length,number);await j.read();return data.reviews.at(-1)
 }
 const preview=async()=>{
  await screen.getByLabel('Collection preview instant',{exact:true}).fill('2026-10-30T15:00:00Z')
  await screen.getByRole('button',{name:'Preview collection follow-up',exact:true}).click()
  const result=screen.getByRole('region',{name:'Collection follow-up preview',exact:true})
  await expect(result.getByRole('heading',{name:'Collection preview at 2026-10-30T15:00:00.000Z',exact:true})).toBeVisible();return result
 }
 const r1=await save(1),p1=await preview(),number1=j.job.invoices.find(i=>i.id===c.ids[0]).number,number2=j.job.invoices.find(i=>i.id===c.ids[1]).number
 const invoice=(p,number)=>p.getByRole('article',{name:'Collection invoice '+number,exact:true})
 await expect(invoice(p1,number1)).toContainText('Collectible residual $450.00');await expect(invoice(p1,number2)).toContainText('Collectible residual $450.00')
 const saved=await save(1);assert.equal(saved.id,r1.id,'Repeated identical owner review retains one identity')
 const receive=async(amount,reference)=>{
  const row=page.locator('#invoice-'+c.ids[0])
  if(!await row.evaluate(e=>e.open))await row.locator('summary').first().click()
  const summary=row.locator('summary').filter({hasText:/^Record an external receipt$/});if(!await summary.evaluate(e=>e.parentElement.open))await summary.click()
  const form=row.getByRole('form',{name:'Record external receipt',exact:true})
  await form.getByLabel('Receipt amount (USD)',{exact:true}).fill(amount)
  await form.getByLabel('Date funds received',{exact:true}).fill('2026-10-29')
  await form.getByLabel('Bank statement or check reference',{exact:true}).fill(reference)
  await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Record external receipt',exact:true}).click()
  await expect(screen.getByText('Sources changed',{exact:true})).toBeVisible();await j.read()
 }
 await receive('100','synthetic-plinth-ui-partial-1')
 const r2=await save(2),p2=await preview();assert.notEqual(r2.id,r1.id)
 await expect(invoice(p2,number1)).toContainText('Collectible residual $350.00');await expect(invoice(p2,number1)).toContainText('Eligible preview');await expect(invoice(p2,number2)).toContainText('Collectible residual $450.00')
 await receive('350','synthetic-plinth-ui-covered-1')
 const r3=await save(3),p3=await preview()
 await expect(invoice(p3,number1)).toContainText('Collectible residual $0.00');await expect(invoice(p3,number1)).toContainText('Recorded receipts or deposit allocations cover this monetary leg');await expect(invoice(p3,number1)).toContainText('Withheld');await expect(invoice(p3,number1)).toContainText('Collection case: unresolved')
 const receipt=j.job.invoices.find(i=>i.id===c.ids[0]).receipts.at(-1)
 await j.act('/invoices/'+c.ids[0]+'/return-receipt',{receipt_id:receipt.id,amount_cents:7500,returned_on:'2026-10-30',reference:'synthetic-plinth-ui-return-1',reason:'Recorded partial bank return',confirm:true})
 await page.reload();const r4=await save(4),p4=await preview()
 await expect(invoice(p4,number1)).toContainText('Collectible residual $75.00');await expect(invoice(p4,number1)).toContainText('Native returns $75.00');await expect(invoice(p4,number1)).toContainText('A native bank or check return reversed recorded coverage');await expect(invoice(p4,number1)).toContainText('Eligible preview');await expect(invoice(p4,number2)).toContainText('Collectible residual $450.00')
 await j.read();assert.deepEqual(j.job.invoices.map(i=>i.issued),originals);assert.deepEqual(j.job.invoices.find(i=>i.id===c.ids[1]),otherOriginal)
 const beforePreview=structuredClone(j.job);await preview();assert.deepEqual(await j.read(),beforePreview)
 await screen.locator('summary').filter({hasText:/^Exact reviewed invoice evidence$/}).click()
 const source=screen.getByRole('region',{name:'Reviewed invoice '+number1,exact:true})
 assert.equal(r4.sources.invoices.find(i=>i.id===c.ids[0]).original_digest,r1.sources.invoices.find(i=>i.id===c.ids[0]).original_digest)
 const [originalPage]=await Promise.all([owner.waitForEvent('page'),source.getByRole('link',{name:'Open original invoice',exact:true}).click()])
 await expect(originalPage.getByRole('heading',{name:'Invoice '+number1,exact:true})).toBeVisible()
 assert.equal(await (await owner.request.get(originalPage.url())).text(),originalHtml,'The review source link opens identical issued original bytes after receipts and returns')
 await originalPage.close()

 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000})
  if(width===390){const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Collection review fits '+width)
  const small=await screen.locator('p, label, button, dd, dt, summary').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&parseFloat(getComputedStyle(n).fontSize)<13).map(n=>n.tagName));assert.deepEqual(small,[],'Touched collection screen text is at least 13 pixels')
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});await page.mouse.move(370,500)
  await page.screenshot({path:shots+'/AUTO-004-collection-review-'+width+'.png',fullPage:true,animations:'disabled'})
 }
 await page.setViewportSize({width:1440,height:1000})
 await screen.getByLabel('Collection review history',{exact:true}).selectOption(r1.id)
 await expect(screen.getByText('Sources changed',{exact:true})).toBeVisible();await expect(screen.getByRole('button',{name:'Preview collection follow-up',exact:true})).toHaveCount(0)
 await screen.getByLabel('Collection review history',{exact:true}).selectOption(r4.id)
 await screen.locator('summary').filter({hasText:/^Revoke this review$/}).click()
 const revoke=screen.getByRole('form',{name:'Revoke collection review',exact:true});await revoke.getByLabel('Collection revocation reason',{exact:true}).fill('Owner withdrew review');await revoke.getByRole('checkbox').check();await revoke.getByRole('button',{name:'Revoke collection review',exact:true}).click();await expect(screen.getByText('Review revoked',{exact:true})).toBeVisible()
 const client=await contexts.get(c.client).newPage();await client.goto(base+'/app?job='+j.job.id+'&tab=Billing');await expect(client.getByRole('heading',{name:'Invoices and deposits',exact:true})).toBeVisible();await expect(client.getByRole('region',{name:'Collection balance reviews',exact:true})).toHaveCount(0)
 assert.equal((await json('/api/plinth'+c.root,{cookie:c.client})).status,403)
 assert.deepEqual(await observations(),beforeCalls,'Review, preview, receipt recording and native return make zero outbound provider calls')
 for(const context of contexts.values())await context.close()
 console.log('AUTO-004 PASS: installed owner source-bound review history, partial and full recorded receipt coverage, partial native return reopening, unchanged second invoice, retained original terms, private client refusal, revoked and stale review, zero egress; screens at 1440 and 390')
}finally{await browser.close()}
