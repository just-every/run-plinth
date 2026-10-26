// Held-key test mode only. Run through the authorized environment injector and heavy-slot.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {stripeFixture} from './stripe-fixture.mjs'
const key=process.env.STRIPE_SECRET,scratch=process.argv[2],providerEdge=process.argv.includes('--provider-edge')
assert.ok((key||providerEdge)&&scratch,'Held test key and scratch directory required')
await mkdir(scratch,{recursive:true})
const s=await stripeFixture(key,{providerEdge}),receipt={run:providerEdge?'push-verify-network-edge':'sx-plinth-c-i908',at:new Date().toISOString(),mode:providerEdge?'Synthetic Stripe network boundary through the real Plinth Worker':'Real Stripe test mode through the real Plinth Worker; real events delivered under an installation-local signing secret',card:{},refund:{},uncertain:{}}
const save=()=>writeFile(scratch+'/settlement-sandbox.json',JSON.stringify(receipt,null,2)+'\n')
const browser=providerEdge?null:await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
async function cardPay(url,number){if(providerEdge){await s.settle(url,number.endsWith('0259'));return}const page=await(await browser.newContext()).newPage();await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForSelector('#payment-method-label-card',{timeout:60000});if(!await page.locator('#cardNumber').isVisible())await page.locator('#payment-method-label-card').click({force:true});await page.waitForSelector('#cardNumber',{timeout:60000});await page.selectOption('#billingCountry','US');if(await page.locator('#enableStripePass').count())await page.uncheck('#enableStripePass');await page.fill('#cardNumber',number);await page.fill('#cardExpiry','12 / 34');await page.fill('#cardCvc','123');await page.fill('#billingName','Alex Chen');if(await page.locator('#billingPostalCode').count())await page.fill('#billingPostalCode','05401');await page.locator('.SubmitButton').click();await page.waitForURL(u=>u.origin===s.f.origin,{timeout:120000});await page.close()}
async function waitEvent(type,id,seconds=120){for(let n=0;n<seconds/3;n++){const e=(await s.events(type,id))[0];if(e)return e;await new Promise(r=>setTimeout(r,3000))}return null}
try{
 const cardId=await s.invoice(2500,'Disputed card draw'),start=await s.pay(cardId),attempt=start.value.attempt.id
 await cardPay(start.value.url,'4000000000000259')
 const completed=await waitEvent('checkout.session.completed',attempt);assert.ok(completed,'Real completed event found');assert.equal((await s.send(completed)).status,200)
 const pi=await s.stripe(`/payment_intents/${completed.data.object.payment_intent}?expand[]=latest_charge`)
 const disputes=await s.stripe(`/disputes?payment_intent=${pi.id}&limit=100`);assert.ok(disputes.data.length,'Real test dispute exists')
 const eventList=await s.stripe('/events?type=charge.dispute.created&limit=100'),disputeEvent=eventList.data.find(e=>e.data.object.id===disputes.data[0].id);assert.ok(disputeEvent)
 assert.equal((await s.send(disputeEvent)).status,200);assert.equal((await(await s.send(disputeEvent)).json()).duplicate,true)
 const forged={...completed,id:'synthetic-plinth-forged-event-1',data:{object:{...completed.data.object,amount_total:1}}};assert.equal((await s.send(forged)).status,400)
 assert.equal((await s.send({...completed,id:'synthetic-plinth-out-of-order-event-1'})).status,200)
 let row=(await s.read()).invoices.find(i=>i.id===cardId),a=(await s.attempts()).find(a=>a.id===attempt)
 receipt.card={real_dispute:true,real_completed_event:true,duplicate_no_effect:true,forged_refused:true,out_of_order_no_false_settlement:true,state:a.settlement_state,original_settlement_preserved:row.receipts[0].amount_cents===2500,open_balance_cents:row.balance.due_cents,provider_dispute_cents:disputes.data[0].amount}
 assert.equal(a.settlement_state,'disputed');assert.equal(row.balance.due_cents,2500);await save()
 // Real creation succeeds, but its response is lost before the app sees it. Read-only provider reconciliation recovers exactly that session.
 const refundId=await s.invoice(11000,'Paid change-order finish invoice',true);s.loseNext();assert.equal((await s.pay(refundId)).status,502)
 let u=(await s.attempts()).find(a=>a.invoice_id===refundId);assert.equal(u.settlement_state,'unresolved');assert.equal((await s.pay(refundId)).value.error,'payment_unresolved')
 await s.act(`/payments/${u.id}/reconcile`);const recovered=await s.pay(refundId);assert.equal(recovered.status,201);assert.equal(recovered.value.reused,true)
 const sessions=await s.stripe(`/checkout/sessions?limit=100&created[gte]=${Math.floor(Date.parse(u.created_at)/1000)-60}`);assert.equal(sessions.data.filter(x=>x.client_reference_id===u.id).length,1)
 receipt.uncertain={unresolved_until_reconciliation:true,repeat_refused:true,one_real_session:true,recovered_same_instruction:recovered.value.attempt.id===u.id};await save()
 await cardPay(recovered.value.url,'4242424242424242');const paid=await waitEvent('checkout.session.completed',u.id);assert.ok(paid);assert.equal((await s.send(paid)).status,200)
 row=(await s.read()).invoices.find(i=>i.id===refundId);const original=structuredClone(row.issued)
 const credit=await s.act(`/invoices/${refundId}/credit`,{operation_id:'synthetic-plinth-live-credit-1',confirm:true,reason:'Client approved reduced finish scope',description:'Finish scope credit',lines:[{invoice_line_id:row.issued.lines.find(l=>l.gross_cents>0).id,amount_cents:2200}]})
 const refundOperation=crypto.randomUUID()
 const approved=await s.act(`/payments/${u.id}/refund`,{operation_id:refundOperation,confirm:true,reason:'Refund the approved finish credit',amount_cents:2200})
 const replay=await s.act(`/payments/${u.id}/refund`,{operation_id:refundOperation,confirm:true,reason:'Refund the approved finish credit',amount_cents:2200})
 const realRefunds=await s.stripe(`/refunds?payment_intent=${paid.data.object.payment_intent}&limit=100`);row=(await s.read()).invoices.find(i=>i.id===refundId)
 receipt.refund={paid_change_invoice:true,linked_credit:row.corrections?.some(c=>c.document.original_invoice_number===original.number&&c.document.gross_cents===-2200)===true,processor_status:approved.refund.status,replay_reused:replay.reused,one_real_refund:realRefunds.data.length===1,provider_refunded_cents:realRefunds.data.reduce((n,r)=>n+r.amount,0),adjusted_balance_cents:row.balance.due_cents,original_unchanged:JSON.stringify(row.issued)===JSON.stringify(original)}
 assert.equal(row.kind,'milestone');assert.equal(original.sources.application.sov_revision.sources.variations.length,1);assert.ok(receipt.refund.linked_credit);assert.equal(approved.refund.status,'succeeded');assert.equal(replay.reused,true);assert.equal(realRefunds.data.reduce((n,r)=>n+r.amount,0),2200);assert.deepEqual(row.issued,original);assert.equal(row.balance.due_cents,0);assert.equal(realRefunds.data.length,1);await save()
 console.log(JSON.stringify(receipt,null,2))
}catch(error){throw new Error(String(error.message).replace(/https:\/\/(?:js|checkout)\.stripe\.com[^\s\"'<>]*/g,'[Stripe page URL redacted]').replace(/(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g,'[redacted]'))}finally{await save();await browser?.close();await s.f.close()}
