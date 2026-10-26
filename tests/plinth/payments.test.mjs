import test from 'node:test'
import assert from 'node:assert/strict'
import { setPortalFeatures } from './helpers.mjs'
import { setup, intent } from './payment-fixture.mjs'

test('PAY-001 — a client pays issued draws by card, wallet and bank transfer through hosted Stripe checkout and signed events credit each invoice once', async () => {
 for(const options of [{stripeSecret:''},{stripeWebhookSecret:''}]){
  const disabled=await setup(options)
  try{const invoice=await disabled.draw(500,'Payment configuration unavailable');assert.equal((await disabled.api(`/jobs/${disabled.job().id}/payments`)).value.enabled,false);assert.equal((await disabled.pay(invoice)).value.error,'payments_unconfigured');assert.equal(disabled.edge.calls.length,0);assert.equal((await disabled.attempts()).length,0)}finally{await disabled.f.close()}
 }
 const s = await setup(), { f, edge } = s
 try {
  const card = await s.draw(200_000, 'Draw 1: framing'), wallet = await s.draw(150_000, 'Draw 2: windows'), bank = await s.draw(100_000, 'Draw 3: cabinets'), failing = await s.draw(50_000, 'Draw 4: paint')
  // Only the client starts a payment, after confirming the shown authorization; nothing else moves money.
  for (const who of [{ cookie: f.owner }, { cookie: s.foreign }, { cookie: undefined, token: s.agent }]) assert.ok([403, 404].includes((await s.pay(card, who)).status))
  await setPortalFeatures(f,s.job().id,['billing']);assert.equal((await s.pay(card)).status,404,'A revoked client billing feature refuses Checkout');assert.equal(edge.calls.length,0);await setPortalFeatures(f,s.job().id,[])
  assert.equal((await s.pay(card, { body: { invoice_id: card } })).status, 400); assert.equal(edge.sessions.length, 0, 'No Stripe call without the client\'s confirmation')
  let r = await s.pay(card); assert.equal(r.status, 201); assert.match(r.value.url, /^https:\/\/checkout\.stripe\.test\/c\/pay\/cs_synthetic_1$/); assert.equal(r.value.attempt.status, 'open'); assert.equal(r.value.attempt.livemode, false)
  const form = edge.sessions[0].form; assert.deepEqual([form.get('payment_method_types[0]'), form.get('mode'), form.get('line_items[0][price_data][unit_amount]'), form.get('line_items[0][price_data][currency]'), form.get('customer_email')], [null, 'payment', '200000', 'usd', 'client@example.com'], 'Payment methods are the ones the builder enabled in Stripe, never forced by the request')
  assert.equal(form.get('adaptive_pricing[enabled]'), 'false', 'The client pays the invoice\'s USD amount, never a converted one'); assert.equal(form.get('line_items[1][quantity]'), null, 'No fee line is added to the client\'s amount'); assert.match(edge.sessions[0].key, /^plinth-checkout-/); assert.equal(form.get('client_reference_id'), r.value.attempt.id)
  assert.match((await s.attempts({ cookie: s.client }))[0].label, /authorize .* \$2,000\.00 for invoice .* never reach Plinth/)
  r = await s.pay(card); assert.equal(r.status, 201); assert.equal(r.value.reused, true); assert.equal(edge.sessions.length, 1, 'A repeat instruction returns the same hosted page')
  // Signed events only: a bad signature, a stale one, a foreign session, a wrong amount and a wrong mode credit nothing.
  const session = edge.sessions[0], completed = s.event('checkout.session.completed', session, { payment_intent: 'pi_synthetic_card' })
  edge.intents.set('pi_synthetic_card', intent('pi_synthetic_card', 200_000, { fee: 94 }))
  assert.equal((await s.send(completed, { secret: 'synthetic-plinth-wrong-secret' })).status, 400); assert.equal((await s.send(completed, { at: Math.floor(Date.now() / 1000) - 3600 })).status, 400)
  assert.equal((await s.send(s.event('checkout.session.completed', { ...session, id: 'cs_synthetic_unknown' }, { payment_intent: 'pi_synthetic_card' }))).status, 400)
  assert.equal((await s.send(s.event('checkout.session.completed', session, { payment_intent: 'pi_synthetic_card', amount_total: 1 }))).status, 400)
  assert.equal((await s.send({ ...completed, id: 'evt_synthetic_live', livemode: true })).status, 400);assert.equal((await s.send(s.event('checkout.session.completed',session,{payment_intent:'pi_synthetic_card',currency:'aud'}))).status,400,'A signed foreign-currency event cannot credit the USD invoice')
  edge.intents.set('synthetic-plinth-foreign-intent-1',intent('synthetic-plinth-foreign-intent-1',200_000));assert.equal((await s.send(s.event('checkout.session.completed',session,{payment_intent:'synthetic-plinth-foreign-intent-1'}))).status,400,'A valid signature cannot attach an unrelated payment without the instruction metadata')
  let job = await s.read(); assert.equal(job.invoices.find(i => i.id === card).receipts.length, 0)
  // The card payment settles: one receipt with the processor references, the balance is paid and a replay changes nothing.
  assert.equal((await s.send(completed)).status, 200)
  job = await s.read(); const invoice = job.invoices.find(i => i.id === card), receipt = invoice.receipts[0]
  assert.deepEqual([invoice.receipts.length, invoice.balance.due_cents, receipt.method, receipt.amount_cents, receipt.reference], [1, 0, 'stripe', 200_000, 'pi_synthetic_card'])
  assert.deepEqual([receipt.processor.checkout_session_id, receipt.processor.payment_intent_id, receipt.processor.method, receipt.processor.wallet, receipt.processor.fee_cents, receipt.processor.livemode], ['cs_synthetic_1', 'pi_synthetic_card', 'card', null, 94, false])
  assert.match(receipt.label, /Settled by the processor/); assert.equal(receipt.recorded_by.name, 'Stripe signed events')
  const [done] = await s.attempts(); assert.deepEqual([done.status, done.payment_intent_id, done.fee_cents, done.receipt_id], ['paid', 'pi_synthetic_card', 94, receipt.id])
  assert.equal(((await s.attempts({ cookie: s.client })).find(a => a.id === done.id)).fee_cents, undefined, 'The client record carries no fee figure')
  const clientView = (await s.api(`/jobs/${job.id}`, { cookie: s.client })).value.job.invoices.find(i => i.id === card).receipts[0]; assert.equal(clientView.processor.payment_intent_id, 'pi_synthetic_card'); assert.equal(clientView.processor.fee_cents, undefined)
  const replay = await s.send(completed); assert.equal((await replay.json()).duplicate, true)
  assert.equal((await s.send({ ...completed, id: 'evt_synthetic_other' })).status, 200); assert.equal((await s.read()).invoices.find(i => i.id === card).receipts.length, 1, 'A second event for the same payment never credits twice')
  assert.equal((await s.pay(card)).value.error, 'invoice_paid')
  job = await s.read()
  r = await s.api(`/jobs/${job.id}/invoices/${card}/return-receipt`, { method: 'POST', body: { expected_version: job.version, receipt_id: receipt.id, amount_cents: 1, returned_on: '2026-10-27', reference: 'synthetic-return-1', reason: 'x', confirm: true } }); assert.equal(r.value.error, 'processor_receipt')
  // An eligible wallet is the same checkout; the processor reports which wallet paid.
  r = await s.pay(wallet); assert.equal(r.status, 201); const walletSession = edge.sessions.at(-1); edge.intents.set('pi_synthetic_wallet', intent('pi_synthetic_wallet', 150_000, { wallet: 'apple_pay', fee: 74 }))
  assert.equal((await s.send(s.event('checkout.session.completed', walletSession, { payment_intent: 'pi_synthetic_wallet' }))).status, 200)
  const walletAttempt = (await s.attempts()).find(a => a.invoice_id === wallet); assert.deepEqual([walletAttempt.status, walletAttempt.method, walletAttempt.wallet], ['paid', 'card', 'apple_pay'])
  // Bank transfer is processing until the processor confirms; a second instruction waits, and only the settled event credits the invoice.
  r = await s.pay(bank); const bankSession = edge.sessions.at(-1); edge.intents.set('pi_synthetic_ach', {...intent('pi_synthetic_ach',100_000,{type:'us_bank_account'}),status:'processing',amount_received:0}); assert.equal((await s.send(s.event('checkout.session.completed', bankSession, { payment_intent: 'pi_synthetic_ach', payment_status: 'unpaid' }))).status, 200)
  assert.equal((await s.attempts()).find(a => a.invoice_id === bank).status, 'processing'); assert.equal((await s.read()).invoices.find(i => i.id === bank).receipts.length, 0)
  assert.equal((await s.pay(bank)).value.error, 'payment_processing')
  edge.intents.set('pi_synthetic_ach', intent('pi_synthetic_ach', 100_000, { type: 'us_bank_account', fee: 8 }))
  assert.equal((await s.send(s.event('checkout.session.async_payment_succeeded', bankSession, { payment_intent: 'pi_synthetic_ach' }))).status, 200)
  const bankAttempt = (await s.attempts()).find(a => a.invoice_id === bank); assert.deepEqual([bankAttempt.status, bankAttempt.method, bankAttempt.fee_cents], ['paid', 'us_bank_account', 8]); assert.equal((await s.read()).invoices.find(i => i.id === bank).balance.due_cents, 0)
  // A failed bank payment credits nothing and the client may start again.
  r = await s.pay(failing); const failedSession = edge.sessions.at(-1)
  assert.equal((await s.send(s.event('checkout.session.async_payment_failed', failedSession, { payment_status: 'unpaid' }))).status, 200)
  assert.equal((await s.attempts()).find(a => a.invoice_id === failing).status, 'failed'); assert.equal((await s.read()).invoices.find(i => i.id === failing).balance.due_cents, 50_000)
  assert.equal((await s.pay(failing)).status, 201)
  // Audit and storage: every step is recorded by kind without card or bank details.
  const audit = JSON.stringify((await s.api('/audit?kind=financial')).value); assert.ok(audit.includes('payments.checkout') && audit.includes('payments.stripe.receipt'))
 } finally { await f.mf.dispose() }
})

// Processor state can change after an invoice was paid; every trigger reads the current provider record.
test('Settlement reconciliation preserves original receipts through returns, disputes, stale events and uncertain checkout responses', async () => {
 const s=await setup(),{f,edge}=s
 try {
  const bank=await s.draw(100_000,'Cabinet ACH draw'),card=await s.changeDraw(200_000,'Client-approved framing change order'),unknown=await s.draw(50_000,'Uncertain checkout')
  await s.pay(bank);const bs=edge.sessions.at(-1);bs.payment_intent='synthetic-plinth-bank-1'
  const pi=intent(bs.payment_intent,100_000,{type:'us_bank_account'});pi.status='requires_action';pi.amount_received=0;edge.intents.set(pi.id,pi)
  const completed=s.event('checkout.session.completed',bs,{payment_intent:pi.id,payment_status:'unpaid'})
  assert.equal((await s.send(completed)).status,200)
  assert.equal((await s.attempts()).find(a=>a.invoice_id===bank).settlement_state,'processing');assert.equal((await s.read()).invoices.find(i=>i.id===bank).balance.due_cents,100_000)
  pi.status='succeeded';pi.amount_received=100_000
  const success=s.event('checkout.session.async_payment_succeeded',bs,{payment_intent:pi.id})
  assert.equal((await s.send(success)).status,200)
  assert.equal((await s.read()).invoices.find(i=>i.id===bank).balance.due_cents,0)
  pi.latest_charge.dispute={id:'synthetic-plinth-return-1',amount:100_000,status:'lost',reason:'insufficient_funds'}
  const returned={id:'synthetic-plinth-event-return',type:'charge.dispute.created',livemode:false,data:{object:{id:'synthetic-plinth-return-1',payment_intent:pi.id}}}
  assert.equal((await s.send(returned,{secret:'synthetic-plinth-forged'})).status,400)
  assert.equal((await s.read()).invoices.find(i=>i.id===bank).balance.due_cents,0)
  assert.equal((await s.send(returned)).status,200);assert.equal((await (await s.send(returned)).json()).duplicate,true)
  assert.equal((await s.send({...success,id:'synthetic-plinth-stale-settlement'})).status,200)
  let row=(await s.read()).invoices.find(i=>i.id===bank)
  assert.deepEqual([row.receipts.length,row.receipts[0].amount_cents,row.receipts[1].amount_cents,row.balance.due_cents],[2,100_000,-100_000,100_000])
  assert.equal((await s.attempts()).find(a=>a.invoice_id===bank).settlement_state,'ach_returned')
  await s.pay(card);const cs=edge.sessions.at(-1);cs.payment_intent='synthetic-plinth-card-1';const cp=intent(cs.payment_intent,200_000);edge.intents.set(cp.id,cp)
  assert.equal((await s.send(s.event('checkout.session.completed',cs,{payment_intent:cp.id}))).status,200)
  cp.latest_charge.dispute={id:'synthetic-plinth-dispute-1',amount:75_000,status:'needs_response'}
  const attempt=(await s.attempts()).find(a=>a.invoice_id===card),reconcile=o=>s.api(`/jobs/${s.job().id}/payments/${attempt.id}/reconcile`,{method:'POST',body:{},...o})
  for (const who of [{cookie:s.client},{cookie:s.foreign},{cookie:undefined,token:s.agent}]) assert.ok([403,404].includes((await reconcile(who)).status))
  assert.equal((await reconcile()).status,200)
  row=(await s.read()).invoices.find(i=>i.id===card);assert.equal(row.balance.due_cents,75_000);assert.equal((await s.attempts()).find(a=>a.id===attempt.id).settlement_state,'disputed')
  assert.equal((await s.api(`/jobs/${s.job().id}/payments/${attempt.id}/refund`,{method:'POST',body:{expected_version:(await s.read()).version,operation_id:'synthetic-plinth-disputed-refund-1',amount_cents:1,reason:'Must refuse disputed funds',confirm:true}})).value.error,'refund_funds');assert.equal(edge.refunds.length,0)
  // A later win restores only previously disputed cents, never a second whole receipt.
  cp.latest_charge.dispute.status='won';assert.equal((await reconcile()).status,200)
  row=(await s.read()).invoices.find(i=>i.id===card);assert.equal(row.balance.due_cents,0);assert.deepEqual(row.receipts.map(r=>r.amount_cents),[200_000,-75_000,75_000])
  // A linked issued credit authorizes only that amount of processor refund; replay never sends twice.
  let current=await s.read();row=current.invoices.find(i=>i.id===card);const original=structuredClone(row.issued)
  assert.equal(original.kind,'milestone');assert.equal(original.source_application_id,row.source_application_id);assert.equal(original.sources.contract.variations.length,1);assert.equal(original.sources.contract.variations[0].approved_by.role,'member');assert.equal(original.lines.filter(l=>l.gross_cents>0).length,1);assert.equal(original.lines.find(l=>l.gross_cents>0).source_id,original.sources.contract.variations[0].id)
  const refundBody={expected_version:current.version,operation_id:'synthetic-plinth-refund-operation-1',amount_cents:25_000,reason:'Customer approved reduced scope',confirm:true}
  const refund=(body,options={})=>s.api(`/jobs/${current.id}/payments/${attempt.id}/refund`,{method:'POST',body,...options})
  assert.equal((await refund(refundBody)).value.error,'refund_credit');assert.equal(edge.refunds.length,0)
  let correction=await s.api(`/jobs/${current.id}/invoices/${card}/credit`,{method:'POST',body:{expected_version:current.version,operation_id:'synthetic-plinth-credit-operation-1',description:'Credit for reduced scope',reason:'Reviewed reduction',confirm:true,lines:[{invoice_line_id:row.issued.lines.find(l=>l.gross_cents>0).id,amount_cents:25_000}]}})
  assert.equal(correction.status,200,JSON.stringify(correction.value));refundBody.expected_version=correction.value.job.version
  const beforeRefund=await s.api(`/jobs/${current.id}/payments`),beforeJob=await s.read()
  for(const confirm of [undefined,false]){const rejected=await refund({...refundBody,confirm});assert.equal(rejected.status,400,'Absent or false confirmation cannot instruct money');assert.equal(edge.refunds.length,0);assert.deepEqual((await s.api(`/jobs/${current.id}/payments`)).value,beforeRefund.value);assert.deepEqual(await s.read(),beforeJob)}
  const restricted=[]
  for(const role of ['project_manager','bookkeeper','reader']){
   const email=`synthetic-plinth-${role.replace('_','-')}-refund@example.com`,cookie=await f.invite(email,role,'admin'),person=(await s.api('/team')).value.team.find(p=>p.email===email)
   const assigned=await s.api(`/team/${person.id}`,{method:'PUT',body:{expected_version:0,role,job_ids:[current.id],po_limit_cents:0}});assert.equal(assigned.status,200)
   restricted.push(cookie)
  }
  const clerk=await f.invite('synthetic-plinth-refund-clerk@example.com','Invoice drafting clerk','admin'),clerkPerson=(await s.api('/team')).value.team.find(p=>p.email==='synthetic-plinth-refund-clerk@example.com')
  let clerkRole=(await s.api('/roles',{method:'POST',body:{copy_of:'administrator',name:'Refund decision restricted',permissions:{invoices:{approve:false}}}})).value.role
  assert.equal((await s.api(`/team/${clerkPerson.id}`,{method:'PUT',body:{expected_version:0,role:'custom',role_id:clerkRole.id,job_ids:[current.id],po_limit_cents:0}})).status,200)
  for(const options of [...restricted.map(cookie=>({cookie})),{cookie:clerk},{cookie:s.client},{cookie:s.foreign},{cookie:undefined,token:s.agent}]){const denied=await refund(refundBody,options);assert.ok([403,404].includes(denied.status),'Current named roles and approval-disabled administrator cannot approve a refund');assert.equal(edge.refunds.length,0);assert.deepEqual((await s.api(`/jobs/${current.id}/payments`)).value,beforeRefund.value);assert.deepEqual(await s.read(),beforeJob)}
  let policy=await s.api(`/roles/${clerkRole.id}`,{method:'PUT',body:{expected_version:clerkRole.version,financial_visible:false,permissions:{invoices:{approve:true}}}});assert.equal(policy.status,200);clerkRole=policy.value.role
  assert.equal((await refund(refundBody,{cookie:clerk})).status,403,'Invoice approval cannot bypass disabled financial visibility');assert.equal(edge.refunds.length,0);assert.deepEqual((await s.api(`/jobs/${current.id}/payments`)).value,beforeRefund.value);assert.deepEqual(await s.read(),beforeJob)
  policy=await s.api(`/roles/${clerkRole.id}`,{method:'PUT',body:{expected_version:clerkRole.version,financial_visible:true,permissions:{invoices:{approve:false}}}});assert.equal(policy.status,200);clerkRole=policy.value.role
  const result=await refund(refundBody);assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(edge.refunds.length,1)
  assert.equal(edge.refundKeys[0],`plinth-refund-${attempt.id}-${refundBody.operation_id}`,'The exact durable instruction supplies the provider idempotency key')
  const audit=(await s.api(`/audit?kind=financial&action=payments.refund.approve&job_id=${current.id}`)).value.events
  const approval=audit.find(e=>e.detail.operation_id===refundBody.operation_id)
  assert.ok(approval);assert.equal(approval.actor_id,original.issued_by.id);assert.equal(approval.actor_name,original.issued_by.name);assert.equal(approval.actor_role,'owner');assert.equal(approval.source,'session');assert.equal(approval.subject_id,attempt.id);assert.equal(approval.subject_kind,'payment');assert.equal(approval.job_id,current.id)
  assert.deepEqual(approval.detail,{operation_id:refundBody.operation_id,amount_cents:25_000,invoice_id:card,invoice_number:original.number,payment_intent_id:cp.id,original_receipt_id:attempt.receipt_id})
  assert.match(approval.before_ref,/^[a-f0-9]{64}$/);assert.equal(approval.after_ref,approval.before_ref,'Reservation audits its exact unchanged invoice source');assert.ok(approval.at)
  assert.equal((await refund(refundBody)).value.reused,true);assert.equal(edge.refunds.length,1)
  assert.equal((await refund({...refundBody,amount_cents:26_000})).value.error,'refund_conflict')
  current=await s.read();row=current.invoices.find(i=>i.id===card);assert.equal(row.balance.due_cents,0);assert.equal(row.balance.received_cents,175_000);assert.deepEqual(row.issued,original)
  for(const receipt of row.receipts){assert.equal(receipt.accounting_entries.reduce((n,e)=>n+e.debit_cents-e.credit_cents,0),0);assert.ok(receipt.accounting_entries.some(e=>e.account==='stripe_clearing'))}
  assert.equal((await s.attempts()).find(a=>a.id===attempt.id).settlement_state,'refunded')
  for(const fee of [100,75]){cp.latest_charge.balance_transaction.fee=fee;assert.equal((await reconcile()).status,200);assert.equal((await s.attempts()).find(a=>a.id===attempt.id).fee_cents,fee,'Refund fee outcomes follow fresh provider evidence rather than inferred recovery')}
  current=await s.read();row=current.invoices.find(i=>i.id===card)
  correction=await s.api(`/jobs/${current.id}/invoices/${card}/credit`,{method:'POST',body:{expected_version:current.version,operation_id:'synthetic-plinth-credit-operation-2',description:'Further agreed scope credit',reason:'Reviewed reduction',confirm:true,lines:[{invoice_line_id:row.issued.lines.find(l=>l.gross_cents>0).id,amount_cents:10_000}]}});assert.equal(correction.status,200)
  const uncertainRefund={...refundBody,operation_id:'synthetic-plinth-refund-operation-2',amount_cents:10_000,expected_version:correction.value.job.version}
  edge.loseRefundResponse=true;edge.refundStatus='pending';assert.equal((await refund(uncertainRefund)).status,502)
  assert.equal((await refund(uncertainRefund)).value.reused,true);assert.equal(edge.refunds.length,2,'Lost refund response reconciles existing instruction without another send')
  assert.equal((await s.read()).invoices.find(i=>i.id===card).balance.due_cents,-10_000,'Pending refund does not falsely remove settled funds')
  edge.refunds.at(-1).status='succeeded';cp.latest_charge.amount_refunded+=10_000;edge.loseRefundResponse=false
  assert.equal((await reconcile()).status,200);assert.equal((await s.read()).invoices.find(i=>i.id===card).balance.due_cents,0)
  const paymentHistory=await s.api(`/jobs/${current.id}/payments`);assert.equal(paymentHistory.value.refunds.find(r=>r.id===uncertainRefund.operation_id).status,'succeeded');assert.equal((await s.api(`/jobs/${current.id}/payments`,{cookie:s.client})).value.refunds,undefined)

  edge.loseResponse=true;let release;edge.holdCheckout=new Promise(resolve=>release=resolve);const sent=new Promise(resolve=>edge.onCheckout=resolve),inFlight=s.pay(unknown);await sent
  assert.equal((await s.pay(unknown)).value.error,'payment_unresolved','A concurrent checkout never replaces an instruction awaiting a provider response');release();assert.equal((await inFlight).status,502);edge.holdCheckout=null;edge.onCheckout=null;const us=edge.sessions.at(-1),u=(await s.attempts()).find(a=>a.invoice_id===unknown)
  assert.equal(u.settlement_state,'unresolved');assert.equal((await s.pay(unknown)).value.error,'payment_unresolved');assert.equal(edge.sessions.filter(x=>x.form.get('client_reference_id')===u.id).length,1)
  edge.loseResponse=false
  assert.equal((await s.api(`/jobs/${s.job().id}/payments/${u.id}/reconcile`,{method:'POST',body:{}})).status,200)
  assert.equal((await s.pay(unknown)).value.url,`https://checkout.stripe.test/c/pay/${us.id}`)
  us.status='expired';assert.equal((await s.api(`/jobs/${s.job().id}/payments/${u.id}/reconcile`,{method:'POST',body:{}})).status,200)
  assert.equal((await s.attempts()).find(a=>a.id===u.id).settlement_state,'canceled')
  assert.equal((await s.read()).invoices.find(i=>i.id===unknown).balance.due_cents,50_000)
  const mixed=await s.draw(50_000,'Mixed staff and Stripe receipt draw');let mixedJob=await s.read()
  assert.equal((await s.api(`/jobs/${mixedJob.id}/invoices/${mixed}/receipt`,{method:'POST',body:{expected_version:mixedJob.version,amount_cents:40_000,received_on:'2026-10-26',reference:'synthetic-plinth-mixed-staff-1',method:'bank',confirm:true}})).status,200)
  await s.pay(mixed);const ms=edge.sessions.at(-1);ms.payment_intent='synthetic-plinth-mixed-intent-1';edge.intents.set(ms.payment_intent,intent(ms.payment_intent,10_000));const missingEventAttempt=(await s.attempts()).find(a=>a.invoice_id===mixed);assert.equal((await s.api(`/jobs/${mixedJob.id}/payments/${missingEventAttempt.id}/reconcile`,{method:'POST',body:{}})).status,200)
  mixedJob=await s.read();const mi=mixedJob.invoices.find(i=>i.id===mixed);assert.equal(mi.receipts.at(-1).processor.confirmation,'provider_record');const ma=(await s.attempts()).find(a=>a.invoice_id===mixed)
  const mc=await s.api(`/jobs/${mixedJob.id}/invoices/${mixed}/credit`,{method:'POST',body:{expected_version:mixedJob.version,operation_id:'synthetic-plinth-mixed-credit-1',description:'Agreed mixed-source credit',reason:'Reviewed reduction',confirm:true,lines:[{invoice_line_id:mi.issued.lines[0].id,amount_cents:40_000}]}});assert.equal(mc.status,200)
  edge.refundStatus='pending';const mixedBody={expected_version:mc.value.job.version,operation_id:'synthetic-plinth-mixed-refund-1',amount_cents:8_000,reason:'Return only settled Stripe funds',confirm:true},mixedRefund=body=>s.api(`/jobs/${mixedJob.id}/payments/${ma.id}/refund`,{method:'POST',body})
  assert.equal((await mixedRefund(mixedBody)).status,200);const mixedRefundCount=edge.refunds.length
  assert.equal((await mixedRefund({...mixedBody,expected_version:(await s.read()).version,operation_id:'synthetic-plinth-mixed-refund-2'})).value.error,'refund_funds','Pending instructions reserve their own settled payment even when other receipts fund invoice credit');assert.equal(edge.refunds.length,mixedRefundCount)
  current=await s.read();row=current.invoices.find(i=>i.id===card)
  correction=await s.api(`/jobs/${current.id}/invoices/${card}/credit`,{method:'POST',body:{expected_version:current.version,operation_id:'synthetic-plinth-credit-operation-3',description:'Final approved scope credit',reason:'Reviewed reduction',confirm:true,lines:[{invoice_line_id:row.issued.lines.find(l=>l.gross_cents>0).id,amount_cents:1_000}]}});assert.equal(correction.status,200)
  const expectedRefundCount=edge.refunds.length+1
  edge.refundStatus='succeeded';edge.failAfterRefund=true
  const ledgerGap={...refundBody,operation_id:'synthetic-plinth-refund-ledger-gap-1',amount_cents:1_000,expected_version:correction.value.job.version}
  assert.equal((await refund(ledgerGap)).status,502);edge.failAfterRefund=false
  assert.equal((await refund({...ledgerGap,operation_id:'synthetic-plinth-refund-ledger-gap-2'})).value.error,'refund_credit','A provider-confirmed refund reserves customer credit until its ledger update commits')
  assert.equal(edge.refunds.length,expectedRefundCount);assert.equal((await reconcile()).status,200)
  current=await s.read();row=current.invoices.find(i=>i.id===card);assert.equal(row.balance.due_cents,0)
  correction=await s.api(`/jobs/${current.id}/invoices/${card}/credit`,{method:'POST',body:{expected_version:current.version,operation_id:'synthetic-plinth-credit-operation-4',description:'Additional approved credit',reason:'Reviewed reduction',confirm:true,lines:[{invoice_line_id:row.issued.lines.find(l=>l.gross_cents>0).id,amount_cents:1_000}]}});assert.equal(correction.status,200)
  const late=await s.draw(9_000,'Checkout paid after an agreed invoice reduction');await s.pay(late);const lateSession=edge.sessions.at(-1),lateOriginal=structuredClone((await s.read()).invoices.find(i=>i.id===late).issued)
  const lateJob=await s.read(),lateCredit=await s.api(`/jobs/${lateJob.id}/invoices/${late}/credit`,{method:'POST',body:{expected_version:lateJob.version,operation_id:'synthetic-plinth-late-credit-1',description:'Agreed reduction before payment arrived',reason:'Human reviewed late settlement case',confirm:true,lines:[{invoice_line_id:lateOriginal.lines[0].id,amount_cents:1_000}]}});assert.equal(lateCredit.status,200)
  const refundsBeforeLate=edge.refunds.length;lateSession.payment_intent='synthetic-plinth-late-intent-1';edge.intents.set(lateSession.payment_intent,intent(lateSession.payment_intent,9_000));const lateEvent=s.event('checkout.session.completed',lateSession,{payment_intent:lateSession.payment_intent})
  assert.equal((await s.send(lateEvent)).status,200);assert.equal((await(await s.send(lateEvent)).json()).duplicate,true)
  const lateInvoice=(await s.read()).invoices.find(i=>i.id===late),lateAttempt=(await s.attempts()).find(a=>a.invoice_id===late)
  assert.equal(lateAttempt.status,'review');assert.match(lateAttempt.label,/office review required/);assert.equal(lateInvoice.balance.due_cents,-1_000);assert.equal(lateInvoice.receipts.length,1);assert.equal(lateInvoice.receipts[0].amount_cents,9_000);assert.deepEqual(lateInvoice.issued,lateOriginal);assert.equal(edge.refunds.length,refundsBeforeLate,'A changed balance never automatically authorizes a late-payment refund')
  const beforeChangedCount=edge.refunds.length,beforeChangedPayments=(await s.api(`/jobs/${current.id}/payments`)).value
  edge.onIntent=async()=>{const fresh=await s.read();const revised=await s.api(`/jobs/${current.id}/invoices/${card}/credit`,{method:'POST',body:{expected_version:fresh.version,operation_id:'synthetic-plinth-changing-credit-1',description:'New review required',reason:'Client revised the final refund economics',confirm:true,lines:[{invoice_line_id:row.issued.lines.find(l=>l.gross_cents>0).id,amount_cents:100}]}});assert.equal(revised.status,200)}
  const changed=await refund({...refundBody,operation_id:'synthetic-plinth-changing-refund-1',amount_cents:1_000,expected_version:(await s.read()).version})
  assert.equal(changed.status,409);assert.equal(changed.value.error,'stale_version');assert.equal(edge.refunds.length,beforeChangedCount);assert.deepEqual((await s.api(`/jobs/${current.id}/payments`)).value,beforeChangedPayments,'Changed economics cannot reserve or send the stale refund')
  const enable=await s.api(`/roles/${clerkRole.id}`,{method:'PUT',body:{expected_version:clerkRole.version,permissions:{invoices:{approve:true}}}});assert.equal(enable.status,200);clerkRole=enable.value.role
  edge.onIntent=async()=>{const revoke=await s.api(`/roles/${clerkRole.id}`,{method:'PUT',body:{expected_version:clerkRole.version,permissions:{invoices:{approve:false}}}});assert.equal(revoke.status,200);clerkRole=revoke.value.role}
  const narrowed=await refund({...refundBody,operation_id:'synthetic-plinth-narrowed-refund-1',amount_cents:1_000,expected_version:(await s.read()).version},{cookie:clerk})
  assert.equal(narrowed.status,403,'Revoking invoice approval during the processor read refuses the final instruction');assert.equal(edge.refunds.length,beforeChangedCount);assert.deepEqual((await s.api(`/jobs/${current.id}/payments`)).value,beforeChangedPayments)
  let signedOut;edge.onIntent=async()=>{signedOut=await f.request('/auth/signout',{method:'POST',cookie:f.owner,body:{}})}
  const revoked=await refund({...refundBody,operation_id:'synthetic-plinth-refund-operation-3',amount_cents:1_000,expected_version:(await s.read()).version})
  assert.equal(signedOut.status,204);assert.equal(revoked.status,401,'A session revoked during the Stripe read cannot send a refund');assert.equal(edge.refunds.length,expectedRefundCount)
  assert.equal((await s.api(`/jobs/${current.id}`,{cookie:s.client})).value.job.invoices.find(i=>i.id===card).balance.due_cents,-1_100)

 }finally{await f.mf.dispose()}
})
