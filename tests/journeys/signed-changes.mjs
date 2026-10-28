import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { signedChangeFixture, changeAddress } from '../plinth/signed-change-support.mjs'
import { nativeSignIn } from '../../scripts/verify/native-signin.mjs'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS,state=process.env.PLINTH_STATE,clientState=process.env.PLINTH_CLIENT_STATE
assert.ok(base&&shots&&state&&clientState,'Use the disposable installed Worker and native sign-in')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:state}),client=await browser.newContext({storageState:clientState}),contexts=new Map([['owner',owner],['client',client]])
 const page=await owner.newPage(),clientPage=await client.newPage()
 const call=async(path,{method='GET',body,cookie='owner'}={})=>{const r=await contexts.get(cookie).request.fetch(base+path,{method,headers:{origin:base},...(body===undefined?{}:{data:body})});return {status:r.status(),value:await r.json()}}
 const invite=async(email,name)=>{const r=await call('/auth/invite',{method:'POST',body:{email,displayName:name,role:'member',returnTo:'/app'}});assert.equal(r.status,202);const context=await browser.newContext(),p=await context.newPage();await nativeSignIn(p,email);await p.close();contexts.set(email,context);return email}
 const f={owner:'owner',json:call,invite},c=await signedChangeFixture(f,{clientEmail:['client','dev.localhost'].join(String.fromCharCode(64)),clientCookie:'client',tag:'installed'})
 const open=async(p,width=1440)=>{await p.setViewportSize({width,height:1000});await p.goto(base+'/app?job='+c.job.id+'&tab=Changes');await expect(p.getByRole('heading',{name:'Signed change documents',exact:true})).toBeVisible()}
 await open(page)
 await page.locator('summary').filter({hasText:/^Prepare a signed change$/}).click()
 await page.getByLabel('Signed change scope',{exact:true}).fill('Added window with five days of impact')
 await page.getByLabel('Private cost code',{exact:true}).fill('08-500');await page.getByLabel('Private estimated cost',{exact:true}).fill('450')
 await page.getByLabel('Client price before tax',{exact:true}).fill('1000');await page.getByLabel('Pricing review date',{exact:true}).fill('2026-10-28')
 await page.getByLabel('Reviewed tax source',{exact:true}).selectOption(c.rate.id)
 await page.getByRole('button',{name:'Prepare reviewed change price',exact:true}).click()
 await expect(page.getByLabel('Reviewed priced change',{exact:true}).getByRole('option',{name:'Added window with five days of impact · $1,100.00',exact:true})).toHaveCount(1)
 await c.read();const variation=c.job.variations.at(-1)
 await page.getByLabel('Reviewed priced change',{exact:true}).selectOption(variation.id)
 const clients=(await c.list()).clients;await page.getByLabel('Assigned client signer',{exact:true}).selectOption(clients[0].id)
 await page.getByLabel('Extra calendar days',{exact:true}).fill('5');await page.getByRole('checkbox',{name:'Install window installed',exact:true}).check()
 await page.getByRole('button',{name:'Present immutable change document',exact:true}).click()
 const region=page.getByRole('article',{name:'Signed change: Added window with five days of impact'}),row=(await c.list()).changes[0]
 await expect(region).toBeVisible();await expect(region).toContainText('Completion 2026-11-04 → 2026-11-09')
 await region.getByLabel('Type your account name to sign',{exact:true}).fill('Synthetic Plinth builder');await region.getByRole('checkbox',{name:'I consent to sign these exact terms electronically.',exact:true}).check()
 await region.getByRole('button',{name:'Sign exact change document',exact:true}).click();await expect(region).toContainText('Builder signed: Synthetic Plinth builder')
 await open(clientPage);const clientRegion=clientPage.getByRole('article',{name:'Signed change: Added window with five days of impact'})
 await expect(clientRegion).toContainText('$1,100.00');await expect(clientRegion.getByText('Private cost and source review',{exact:true})).toHaveCount(0)
 const artifactResponse=await client.request.get(base+await clientRegion.getByRole('link',{name:'Download exact change document',exact:true}).getAttribute('href'));assert.equal(artifactResponse.status(),200);const artifact=await artifactResponse.json();assert.equal(artifact.digest,row.digest)
 const clientList=await c.list('client');for(const privateValue of ['cost_unit_cents','cost_total_cents','45000','private_terms"','source_digest'])assert.ok(!JSON.stringify(clientList).includes(privateValue))
 await clientRegion.getByLabel('Type your account name to sign',{exact:true}).fill('Synthetic Plinth client');await clientRegion.getByRole('checkbox',{name:'I consent to sign these exact terms electronically.',exact:true}).check();await clientRegion.getByRole('button',{name:'Sign exact change document',exact:true}).click();await expect(clientRegion).toContainText('Client signed: Synthetic Plinth client')
 for(const width of [1440,390]){await clientPage.setViewportSize({width,height:1000});assert.ok(await clientPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await clientPage.evaluate(()=>scrollTo(0,0));await clientPage.screenshot({path:`${shots}/CLIENT-004-client-signed-${width}.png`,fullPage:true,animations:'disabled'})}
 await open(page);await region.locator('summary').filter({hasText:/^Review downstream application$/}).click()
 await region.getByLabel('Draft billing evidence and review basis',{exact:true}).fill('Proposed window milestone; separately verify completion')
 await region.getByLabel('Draft invoice due date',{exact:true}).fill('2026-12-01');await region.getByLabel('Draft invoice terms',{exact:true}).fill('Review earned work and issue separately')
 await region.getByRole('checkbox',{name:/I reviewed the exact signed dates/}).check();await region.getByRole('button',{name:'Apply signed change and prepare billing drafts',exact:true}).click()
 await expect(region).toContainText('Applied once · Budget revision 2 · SOV revision 2')
 await c.read();const applied=(await c.list()).changes[0];let snapshot=structuredClone(c.job)
 assert.equal(c.job.budgets[1].contract_cents,330000);assert.equal(c.job.budgets[1].codes.find(x=>x.cost_code==='08-500').cost_cents,45000);assert.equal(c.job.sov[1].contract_cents,330000)
 assert.equal(c.job.schedules[0].end,'2026-11-09T12:00:00.000Z');assert.equal(c.job.invoices[0].status,'draft');assert.equal(c.job.invoices[0].source_application_id,applied.application.claim_id)
 assert.equal((await c.act('/signed-changes/'+row.id+'/apply',{digest:row.digest,confirm:true,...c.billing(row)})).status,409);await c.read();assert.deepEqual(c.job,snapshot)
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(width===390){const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')}await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${shots}/CLIENT-004-builder-applied-${width}.png`,fullPage:true,animations:'disabled'})}
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/app?job='+c.job.id+'&tab=Billing')
 const [approvedResponse]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/claims/'+applied.application.claim_id+'/approve')),page.getByRole('button',{name:'Approve pay app',exact:true}).click()]);assert.equal(approvedResponse.status(),200,await approvedResponse.text())
 // Invoice issue requires the committed application, not just a dispatched click.
 const applicationPath=`/api/plinth/jobs/${c.job.id}/claims/${applied.application.claim_id}`
 const [applicationResponse]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===applicationPath+'/issue'),page.getByRole('button',{name:'Issue payment application',exact:true}).click()])
 assert.equal(applicationResponse.status(),200,await applicationResponse.text())
 await expect(page.getByRole('link',{name:'Download application sources',exact:true})).toHaveAttribute('href',applicationPath+'/application.json')
 const invoicePanel=page.locator('#invoice-'+applied.application.invoice_id);await invoicePanel.locator(':scope > summary').click()
 await invoicePanel.getByRole('button',{name:'Approve and issue invoice',exact:true}).click();await expect(invoicePanel.getByRole('link',{name:'Download invoice JSON',exact:true})).toBeVisible()
 await invoicePanel.getByRole('button',{name:'Approve invoice email',exact:true}).click();await expect(invoicePanel).toContainText('Accepted by the mail provider; delivery is not confirmed')
 await c.read();assert.equal(c.job.invoices[0].issued.gross_cents,110000);assert.equal(c.job.invoices[0].issued.sources.contract.variations[0].signed_document.digest,row.digest)
 await clientPage.setViewportSize({width:1440,height:1000});await clientPage.goto(base+'/app?job='+c.job.id+'&tab=Billing')
 const clientInvoice=clientPage.locator('#invoice-'+applied.application.invoice_id);await clientInvoice.locator(':scope > summary').click()
 const issuedResponse=await client.request.get(base+await clientInvoice.getByRole('link',{name:'Download invoice JSON',exact:true}).getAttribute('href'));assert.equal(issuedResponse.status(),200);const issued=await issuedResponse.json();assert.equal(issued.invoice.issued.gross_cents,110000);assert.equal(issued.invoice.issued.source_budget_revision,2)
 for(const privateValue of ['cost_unit_cents','cost_total_cents','45000','private_terms'])assert.ok(!JSON.stringify(issued).includes(privateValue))
 for(const width of [1440,390]){await clientPage.setViewportSize({width,height:1000});await clientPage.evaluate(()=>scrollTo(0,0));await clientPage.screenshot({path:`${shots}/CLIENT-004-client-linked-invoice-${width}.png`,fullPage:true,animations:'disabled'})}
 snapshot=structuredClone(c.job)
 const second=await c.priced('Declined second window'),declined=await c.present(second,{extra_days:7});await open(clientPage);const declineRegion=clientPage.getByRole('article',{name:'Signed change: Declined second window'})
 await declineRegion.locator('summary').filter({hasText:/^Decline or dispute this document$/}).click();await declineRegion.getByLabel('Decision reason',{exact:true}).fill('No second window');await declineRegion.getByRole('button',{name:'Record decision without applying changes',exact:true}).click();await expect(declineRegion).toContainText('No second window')
 await c.read();assert.deepEqual(c.job.budgets,snapshot.budgets);assert.deepEqual(c.job.schedules,snapshot.schedules);assert.deepEqual(c.job.invoices,snapshot.invoices);assert.equal(c.job.orders.length,0)
 const stale=await c.present(second,{extra_days:7});await c.sign(stale);await c.priced('New reviewed commercial source')
 assert.equal((await c.act('/signed-changes/'+stale.id+'/sign',{digest:stale.digest,confirm:true,name:'Synthetic Plinth client'},'client')).value.error,'change_sources')
 const revoked=await signedChangeFixture(f,{clientEmail:changeAddress('installed-revoked'),tag:'revoked-installed'});await revoked.priced();const rr=await revoked.present();await revoked.sign(rr);await revoked.sign(rr,revoked.client,'Synthetic change client')
 assert.equal((await call('/auth/operator/status',{method:'POST',body:{operatorId:rr.client.id,status:'inactive'}})).status,200)
 assert.ok([403,409].includes((await revoked.act('/signed-changes/'+rr.id+'/apply',{digest:rr.digest,confirm:true,...revoked.billing(rr)})).status));await revoked.read();assert.equal(revoked.job.budgets.length,1)
 for(const context of contexts.values())await context.close()
 console.log('CLIENT-004 PASS: exact builder and client signatures, five-day document, private costs, separately reviewed once-only budget, schedule and SOV application, linked draft and separately issued invoice with explicit provider-edge email, decline, changed source and revoked signer refusals; screens at 1440 and 390')
}finally{await browser.close()}
