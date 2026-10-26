// Stripe's documented test bank account exercises a return after settlement through hosted Checkout.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {stripeFixture} from './stripe-fixture.mjs'
const key=process.env.STRIPE_SECRET,scratch=process.argv[2];assert.ok(key&&scratch)
await mkdir(scratch,{recursive:true})
const s=await stripeFixture(key),receipt={run:'sx-plinth-c-i817',at:new Date().toISOString(),mode:'Real Stripe test-mode ACH hosted Checkout, microdeposit verification and processor records',ach:{}}
const save=()=>writeFile(scratch+'/ach-return-sandbox.json',JSON.stringify(receipt,null,2)+'\n')
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
const stripePost=async(path,body)=>{const r=await fetch('https://api.stripe.com/v1'+path,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});assert.ok(r.ok,`Provider verification succeeded (${r.status})`);return r.json()}
try{
 const id=await s.invoice(2600,'Returned ACH bank draw'),started=await s.pay(id),attemptId=started.value.attempt.id,page=await(await browser.newContext()).newPage()
 await page.goto(started.value.url,{waitUntil:'domcontentloaded'});await page.getByText('US bank account',{exact:true}).waitFor({timeout:60000});await page.locator('#payment-method-label-us_bank_account').click({force:true});await page.getByLabel('Full name').fill('Alex Chen')
 await page.getByText('Enter bank details manually',{exact:false}).click();await page.screenshot({path:scratch+'/ach-manual-fields.png',fullPage:true})
 let bankFrame
 for(let n=0;n<30&&!bankFrame;n++) {for(const frame of page.frames())if(await frame.getByLabel('Routing number',{exact:true}).count()){bankFrame=frame;break}if(!bankFrame)await page.waitForTimeout(1000)}
 await writeFile(scratch+'/ach-frame-fields.json',JSON.stringify(await Promise.all(page.frames().map(async frame=>({url:frame.url().startsWith('http')?new URL(frame.url()).hostname:'local',inputs:await frame.locator('input').evaluateAll(nodes=>nodes.map(n=>({id:n.id,name:n.name,placeholder:n.placeholder,type:n.type}))),text:await frame.locator('body').innerText().catch(()=> '')}))),null,2))
 assert.ok(bankFrame,'Manual bank form is available')
 await bankFrame.getByLabel('Routing number',{exact:true}).fill('110000000');await bankFrame.getByLabel('Account number',{exact:true}).fill('000555555559')
 const confirm=bankFrame.getByLabel(/Confirm account number/i);if(await confirm.count())await confirm.fill('000555555559')
 const button=bankFrame.getByRole('button',{name:/Confirm|Continue|Submit/i});if(bankFrame!==page.mainFrame()&&await button.count())await button.first().click()
 for(let n=0;n<20;n++) {
  await page.waitForTimeout(750)
  let pressed=false
  for(const frame of page.frames()) {
   if(!frame.url().startsWith('https://js.stripe.com'))continue
   const text=await frame.locator('body').innerText().catch(()=>'')
   if(!text.trim())continue
   await writeFile(scratch+'/ach-modal-step.txt',text)
   const decline=frame.getByText('Not now',{exact:true});if(await decline.count()&&await decline.first().isVisible()){await decline.first().click();pressed=true;break}
   const next=frame.getByRole('button',{name:/^(Done|Continue(?: to .*)?|Confirm|Agree and continue|Verify account|Authorize)$/i})
   if(await next.count()&&await next.first().isVisible()){await next.first().click();pressed=true;break}
  }
  if(!pressed&&await page.locator('.SubmitButton').isVisible()&&await page.locator('.SubmitButton').getAttribute('tabindex')!=='-1')break
 }
 await page.locator('.SubmitButton').click();await page.waitForURL(u=>u.origin===s.f.origin,{timeout:120000})
 const session=await s.stripe(`/checkout/sessions/${(await s.attempts()).find(a=>a.id===attemptId).session_id}`),pi=await s.stripe(`/payment_intents/${session.payment_intent}`)
 receipt.ach.hosted_checkout_completed=session.status==='complete';receipt.ach.requires_microdeposit_verification=pi.status==='requires_action';await save()
 if(pi.status==='requires_action'){const verified=await stripePost(`/payment_intents/${pi.id}/verify_microdeposits`,{'amounts[0]':'32','amounts[1]':'45'});receipt.ach.verified=verified.status==='processing';await save()}
 await s.act(`/payments/${attemptId}/reconcile`);let row=(await s.read()).invoices.find(i=>i.id===id),attempt=(await s.attempts()).find(a=>a.id===attemptId)
 receipt.ach.processing_without_credit=attempt.settlement_state==='processing'&&row.balance.due_cents===2600;await save();assert.ok(receipt.ach.processing_without_credit)
 let settled
 for(let n=0;n<200;n++){settled=(await s.events('checkout.session.async_payment_succeeded',attemptId))[0];if(settled)break;await new Promise(r=>setTimeout(r,3000))}
 assert.ok(settled,'Real delayed settlement event found');await s.send(settled);row=(await s.read()).invoices.find(i=>i.id===id);receipt.ach.settled_before_return=row.balance.due_cents===0;await save()
 for(let n=0;n<200;n++){await s.act(`/payments/${attemptId}/reconcile`);attempt=(await s.attempts()).find(a=>a.id===attemptId);if(attempt.settlement_state==='ach_returned'){receipt.ach.returned=true;break}await new Promise(r=>setTimeout(r,3000))}
 row=(await s.read()).invoices.find(i=>i.id===id);receipt.ach.open_balance_cents=row.balance.due_cents;receipt.ach.original_settlement_preserved=row.receipts.some(r=>r.amount_cents===2600);await save();assert.ok(receipt.ach.settled_before_return&&receipt.ach.returned);assert.equal(row.balance.due_cents,2600)
 console.log(JSON.stringify(receipt,null,2))
}catch(error){await save();throw new Error(String(error.message).replace(/https:\/\/(?:js|checkout)\.stripe\.com[^\s\"'<>]*/g,'[Stripe page URL redacted]').replace(/(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g,'[redacted]'))}finally{await browser.close();await s.f.close()}
