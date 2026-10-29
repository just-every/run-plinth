import test from 'node:test'
import assert from 'node:assert/strict'
import {createFixture} from './helpers.mjs'
import {costFixture} from './cost-support.mjs'

test('COST-004 — half-complete framing, worse productivity, posted costs and a revised remaining bid produce independently reconciled immutable forecasts',async()=>{
 const f=await createFixture();try{
  const c=await costFixture(f);let r=await c.ok('/costs/bills',c.bill()),id=r.record.id;await c.ok(`/costs/bills/${id}/review`,{reason:'Reviewed coded source'});await c.ok(`/costs/bills/${id}/post`)
  const assumptions={as_of:'2026-10-23',source_as_of:'Two receipts and bill reconciled today; remaining bid synthetic-plinth-1',codes:[{cost_code:'06-100',remaining_quantity:'50',minutes_per_unit:'24',labor_hour_cents:3000,outstanding_commitment_cents:60000,unbought_cents:5000,risk_cents:2000,reference:'50 of 100 framing units remain; observed 24 minutes/unit vs original 15; revised remaining bid 5000'},{cost_code:'01-100',remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:0,outstanding_commitment_cents:0,unbought_cents:10000,risk_cents:0,reference:'Separate unbought labor package'}]}
  r=await c.ok('/costs/forecasts',assumptions);const first=r.record
  assert.equal(first.remaining_cents,137000);assert.equal(first.final_cents,180000);assert.equal(first.margin_cents,120000);assert.equal(first.codes[0].actual_cents,33000);assert.equal(first.codes[0].remaining_cents,127000);assert.equal(first.codes[0].variance_cents,60000);assert.equal(r.ledger.forecast.stale,false)
  const stale=structuredClone(assumptions);stale.codes[0].outstanding_commitment_cents=100000;assert.equal((await c.act('/costs/forecasts',stale)).status,409,'Consumed commitment cannot return as remaining')
  const next=structuredClone(assumptions);next.codes[0].minutes_per_unit='30';next.codes[0].unbought_cents=8000
  r=await c.ok('/costs/forecasts',next);assert.equal(r.record.final_cents,198000);assert.equal(r.record.margin_cents,102000)
  const snapshots=(await c.api(`/jobs/${c.job.id}/costs/forecasts`)).value.forecasts
  assert.equal(snapshots.length,2);assert.deepEqual({...snapshots[0],stale:undefined},{...first,stale:undefined});assert.equal(snapshots[0].stale,true);assert.equal(snapshots[1].stale,false);assert.equal(snapshots[0].source_digest,snapshots[1].source_digest)
  const missing={...assumptions,codes:assumptions.codes.slice(0,1)};assert.equal((await c.act('/costs/forecasts',missing)).status,409)
  const pending=structuredClone(assumptions);pending.codes[0].pending_change_cents=1000;assert.equal((await c.act('/costs/forecasts',pending)).status,400)
  r=await c.ok('/costs/forecasts',{...pending,scenario:'pending'});assert.equal(r.record.final_cents,181000);assert.equal(r.record.revenue_cents,300000,'Pending scenario does not invent client-approved revenue')
 }finally{await f.close()}
})

test('COST-006 — owner limits and separated approval assign budget and missing-accounting exceptions; only approved correction and source agreement permit clearance',async()=>{
 const f=await createFixture();try{
  const c=await costFixture(f),admin=await f.invite('synthetic-plinth-admin@example.com','Cost preparer','admin'),reviewer=await f.invite('synthetic-plinth-limit-reviewer@example.com','Independent cost reviewer','admin')
  const operators={id:c.job.created_by.id}
  await c.ok('/costs/policy',{budget_limit_cents:0,commitment_limit_cents:0,bill_limit_cents:100000,separate_approval:true,owner_id:operators.id,due_on:'2026-11-01'})
  const team=(await c.api('/team')).value.team,reviewerId=team.find(p=>p.email==='synthetic-plinth-limit-reviewer@example.com').id
  let commitment=await c.ok('/orders',{supplier:'Synthetic Lumber',description:'Additional framing commitment above owner variance',source:{kind:'budget',cost_code:'06-100'},lines:[{id:'extra',description:'Additional framing package',cost_code:'06-100',quantity:'1',unit:'lot',unit_cents:1000}]});const extra=commitment.record
  await c.ok(`/orders/${extra.id}/issue`)
  assert.ok((await c.api(`/jobs/${c.job.id}/costs/exceptions`)).value.items.some(e=>e.kind==='commitment'&&e.amount_cents===1000),'The issued-order public door assigns an over-limit commitment exception')
  await c.ok(`/orders/${extra.id}/cancel`,{reason:'Owner cancels the unstarted excess package after source review'})
  const invoice=c.bill();invoice.lines=[{...invoice.lines[0],subtotal_cents:160000,taxable:false,matches:[]}]
  let r=await c.act('/costs/bills',invoice,admin);assert.equal(r.status,200,JSON.stringify(r.value));const id=r.value.record.id;await c.read()
  await c.ok(`/costs/bills/${id}/review`,{reason:'Receipt missing; reviewed original supplier evidence and assigned follow-up'})
  await c.ok(`/costs/bills/${id}/route`,{reviewer_id:r.value.record.prepared_by.id,reason:'Exercise the configured independent-preparer fence'})
  assert.equal((await c.act(`/costs/bills/${id}/post`,{},admin)).value.error,'cost_separation','A designated preparing clerk still cannot approve their own bill')
  await c.ok(`/costs/bills/${id}/route`,{reviewer_id:reviewerId,reason:'Independent office reviewer checks the over-limit invoice'})
  assert.equal((await c.act(`/costs/bills/${id}/post`,{},reviewer)).value.error,'cost_limit','A different designated administrator still cannot approve above the owner bill limit')
  await c.ok(`/costs/bills/${id}/route`,{reviewer_id:operators.id,reason:'Route the over-limit decision to the owner'})
  await c.ok(`/costs/bills/${id}/post`)
  await c.ok('/costs/reconcile',{period:'2026-10',balances:[],reference:'synthetic-plinth-accounting-export-removed-entry'})
  let exceptions=(await c.api(`/jobs/${c.job.id}/costs/exceptions`)).value
  const active=exceptions.items.filter(e=>['budget','ledger'].includes(e.kind));assert.equal(active.length,2);assert.ok(active.every(e=>e.status==='open'&&e.owner_id===operators.id&&e.due_on==='2026-11-01'))
  for(const e of active)assert.equal((await c.act(`/costs/exceptions/${e.id}`,{reason:'Dismiss without correction'})).status,409)
  const credit={...invoice,kind:'credit',credit_of:id,reference:'synthetic-plinth-variance-credit',lines:[{...invoice.lines[0],subtotal_cents:60000}]}
  r=await c.act('/costs/bills',credit,admin);assert.equal(r.status,200);await c.read();await c.ok(`/costs/bills/${r.value.record.id}/review`,{reason:'Supplier corrected overbill'});await c.ok(`/costs/bills/${r.value.record.id}/post`)
  await c.ok('/costs/reconcile',{period:'2026-10',balances:[{cost_code:'06-100',amount_cents:100000}],reference:'synthetic-plinth-accounting-partial-correction'})
  const budgetException=active.find(e=>e.kind==='budget')
  assert.equal((await c.act(`/costs/exceptions/${budgetException.id}`,{reason:'Actual alone is inside budget but commitments remain'})).value.error,'cost_unresolved','Accounting agreement alone cannot hide actual plus open commitment exposure')
  const remainder={...credit,reference:'synthetic-plinth-variance-credit-remaining',lines:[{...invoice.lines[0],subtotal_cents:100000}]}
  r=await c.act('/costs/bills',remainder,admin);assert.equal(r.status,200);await c.read();await c.ok(`/costs/bills/${r.value.record.id}/review`,{reason:'Remaining erroneous supplier invoice is credited; original commitments remain separate'});await c.ok(`/costs/bills/${r.value.record.id}/post`)
  await c.ok('/costs/reconcile',{period:'2026-10',balances:[{cost_code:'06-100',amount_cents:0}],reference:'synthetic-plinth-accounting-corrected-export'})
  for(const e of active)await c.ok(`/costs/exceptions/${e.id}`,{reason:'Approved credit and exact accounting reconciliation agree'})
  exceptions=(await c.api(`/jobs/${c.job.id}/costs/exceptions`)).value;assert.ok(exceptions.items.filter(e=>active.some(a=>a.id===e.id)).every(e=>e.status==='cleared'&&e.resolutions.length===1));assert.equal(exceptions.unassigned.length,0);assert.equal(exceptions.healthy,false,'Historical source follow-ups still need explicit human resolution')
  for(const e of exceptions.items.filter(e=>!e.resolutions.length&&!e.current))await c.ok(`/costs/exceptions/${e.id}`,{reason:'Approved source is now posted and the current external ledger agrees'})
  assert.equal((await c.api(`/jobs/${c.job.id}/costs/exceptions`)).value.healthy,true)
  assert.equal((await c.act('/costs/policy',{budget_limit_cents:0},admin)).status,403)
 }finally{await f.close()}
})

test('Recovery evidence compares confirmation, delivery, installed progress and adverse costs without certifying restoration',async()=>{
 const f=await createFixture({now:Date.parse('2026-11-07T12:00:00Z')});try{
  const {recoveryEvidenceFixture}=await import('./recovery-evidence-support.mjs'),r=await recoveryEvidenceFixture(f),c=r.c
  const before=await c.read(),first=await r.assess()
  assert.equal(first.comparison.tasks[0].confirmed,true);assert.equal(first.comparison.deliveries[0].state,'unknown');assert.equal(first.comparison.deliveries[0].received_cents,0);assert.equal(first.comparison.forecast_margin_cents,180000);assert.equal(first.comparison.posted_actual_cents,0);assert.equal(first.comparison.overall_restoration,'unverified');assert.ok(first.comparison.missing.some(s=>s.startsWith('Delivery ')))
  const outcomePath=`/recovery-evidence/${r.recovery.id}/review-outcome`,riskPath=`/recovery-evidence/${r.recovery.id}/risk-decision`
  const unverifiedBefore=structuredClone(await c.read());assert.equal((await c.act(outcomePath,r.reviewInput())).value.error,'recovery_unverified');assert.deepEqual(await c.read(),unverifiedBefore,'Confirmation alone cannot become a native outcome review')
  await c.ok(`/orders/${r.order.id}/receive`,{lines:[{line_id:'recovery-lot',quantity:'2'}],reference:'synthetic-plinth-delivery-52',received_on:'2026-11-06'})
  const stale=await c.act(`/recovery-evidence/${r.recovery.id}/assess`,r.observation());assert.equal(stale.status,409);assert.equal(stale.value.error,'recovery_stale')
  await r.refresh();const deliveryOnly=await r.assess();assert.equal(deliveryOnly.comparison.deliveries[0].state,'supported');assert.equal(deliveryOnly.comparison.tasks[0].quantity_state,'unknown');assert.equal(deliveryOnly.comparison.overall_restoration,'unverified');assert.ok(deliveryOnly.comparison.missing.some(s=>s.startsWith('Installed quantity ')))
  await c.ok('/schedule-actuals',{task_id:r.criteria.tasks[0].task_id,actual_start:'2026-11-06T08:00:00Z',actual_finish:'2026-11-06T09:00:00Z',installed:{quantity:'2',unit:'pack',cost_code:'06-100'},evidence:'Human records the exact installed units'})
  await c.ok('/costs/reconcile',{period:'2026-11',balances:[],reference:'Synthetic native balance review; not independent accounting proof'})
  await r.forecast();await r.refresh();const second=await r.assess()
  assert.equal(second.comparison.deliveries[0].state,'supported');assert.equal(second.comparison.tasks[0].date_state,'supported');assert.equal(second.comparison.tasks[0].quantity_state,'supported');assert.equal(second.comparison.native_status,'supported');assert.equal(second.comparison.overall_restoration,'unverified');assert.equal(second.comparison.forecast_margin_cents,180000);assert.equal(second.comparison.observed_margin_cents,300000);assert.equal(second.risks[0].owner_id,c.job.created_by.id)
  const nativeReview=(await c.ok(outcomePath,r.reviewInput())).record
  const supportedState=await r.state();assert.equal(supportedState.status,'native_supported');assert.equal(supportedState.open_risk_count,1);assert.equal(supportedState.overall_restoration,'unverified')
  const posted=await c.ok('/costs/bills',{...c.bill('synthetic-plinth-adverse-52'),tax:{percent:'0',reference:'Synthetic exempt adjustment',exemption_reference:'Synthetic source',human_reviewed:true},lines:[{cost_code:'06-100',description:'Adverse native cost adjustment',subtotal_cents:220000,taxable:false,matches:[]}]});await c.ok(`/costs/bills/${posted.record.id}/review`,{reason:'Human checks adverse original'});await c.ok(`/costs/bills/${posted.record.id}/post`)
  const live=await r.state();assert.equal(live.status,'reopened','Reading a changed native cost immediately exposes the reopened case, before another agent assessment');assert.equal(live.comparison.observed_margin_cents,80000);assert.equal(live.open_risk_count,1)
  const changedBefore=structuredClone(await c.read());assert.equal((await c.act(outcomePath,r.reviewInput())).value.error,'recovery_stale');assert.deepEqual(await c.read(),changedBefore)
  await r.refresh();const third=await r.assess()
  assert.equal(third.comparison.posted_actual_cents,220000);assert.equal(third.comparison.observed_margin_cents,80000);assert.equal(third.comparison.forecast_margin_cents,null);assert.equal(third.comparison.margin_state,'contradicted');assert.equal(third.comparison.native_status,'contradicted');assert.equal(third.reopened,true);assert.equal(third.comparison.overall_restoration,'unverified')
  assert.deepEqual(r.recovery.assessments.slice(0,3),[first,deliveryOnly,second]);assert.equal(r.recovery.packets.length,4)
  const after=await c.read();for(const key of ['schedules','budgets','quotes','trade_invitations'])assert.deepEqual(after[key],before[key],key+' decisions remain immutable');assert.equal(after.approvals.filter(a=>a.kind==='schedule.publish').length,1)
  assert.deepEqual(r.recovery.outcome_reviews,[nativeReview],'The earlier human native review remains history after contradiction')
  // Human source corrections and two accounting periods exercise the complete native review loop.
  const credit=(await c.ok('/costs/bills',{...c.bill('synthetic-plinth-recovery-credit'),kind:'credit',credit_of:posted.record.id,tax:{percent:'0',reference:'Synthetic exempt correction',exemption_reference:'Synthetic source',human_reviewed:true},lines:[{cost_code:'06-100',description:'Approved correction of adverse source',subtotal_cents:220000,taxable:false,matches:[]}]})).record
  await c.ok(`/costs/bills/${credit.id}/review`,{reason:'Human checks the original-linked correction'});await c.ok(`/costs/bills/${credit.id}/post`)
  for(const period of ['2026-10','2026-11']){
   const bill=(await c.ok('/costs/bills',{...c.bill('synthetic-plinth-recovery-'+period),period,dated_on:period+'-06',tax:{percent:'0',reference:'Synthetic reviewed exempt cost',exemption_reference:'Synthetic source',human_reviewed:true},lines:[{cost_code:'06-100',description:'Recorded recovery cost',subtotal_cents:10000,taxable:false,matches:[]}]})).record
   await c.ok(`/costs/bills/${bill.id}/review`,{reason:'Human checks period and original'});await c.ok(`/costs/bills/${bill.id}/post`)
  }
  await c.ok('/costs/reconcile',{period:'2026-11',balances:[{cost_code:'06-100',amount_cents:10000}],reference:'Synthetic reviewed November native actuals'})
  await r.forecast();await r.refresh();const incomplete=await r.assess(),periods=r.recovery.packets.at(-1).evidence.accounting.periods
  assert.equal(incomplete.comparison.posted_actual_cents,20000);assert.equal(incomplete.comparison.observed_margin_cents,280000);assert.equal(incomplete.comparison.native_status,'unverified');assert.ok(incomplete.comparison.missing.includes('Complete current native accounting evidence'))
  assert.deepEqual(periods.map(period=>[period.period,period.balances[0].actual_cents,period.current]),[['2026-10',10000,false],['2026-11',10000,true]])
  assert.equal((await c.act(outcomePath,r.reviewInput())).value.error,'recovery_unverified','A later agreeing period cannot hide missing reconciliation of earlier actuals')
  await c.ok('/costs/reconcile',{period:'2026-10',balances:[{cost_code:'06-100',amount_cents:9000}],reference:'Synthetic deliberately mismatched October source'})
  await r.refresh();const mismatch=await r.assess();assert.equal(mismatch.comparison.native_status,'unverified');assert.equal(r.recovery.packets.at(-1).evidence.accounting.periods[0].balances[0].difference_cents,1000)
  await c.ok('/costs/reconcile',{period:'2026-09',balances:[{cost_code:'06-100',amount_cents:5000}],reference:'Synthetic earlier accounting source with no matching native entry'})
  await c.ok('/costs/reconcile',{period:'2026-10',balances:[{cost_code:'06-100',amount_cents:10000}],reference:'Synthetic corrected October source'})
  await r.refresh();const externalOnly=await r.assess();assert.equal(externalOnly.comparison.native_status,'unverified');assert.equal(r.recovery.packets.at(-1).evidence.accounting.periods[0].balances[0].difference_cents,-5000,'An earlier reviewed source with no native entry must not disappear behind a later agreeing period')
  await c.ok('/costs/reconcile',{period:'2026-09',balances:[],reference:'Synthetic human correction of the earlier unmatched accounting declaration'})
  await r.refresh()
  const riskObservation={...r.observation(),risks:[...r.observation().risks,{description:'Review the installed lot against the recorded task quantity',owner_id:c.job.created_by.id,due_on:'2026-11-30'}]}
  await c.ok(`/recovery-evidence/${r.recovery.id}/assess`,riskObservation);await r.state()
  const restored=await r.state();assert.equal(restored.comparison.native_status,'supported');assert.equal(restored.comparison.forecast_margin_cents,160000);assert.equal(restored.open_risk_count,2)
  const nativeSources=structuredClone(await c.read()),risk=restored.risks.find(risk=>risk.description===riskObservation.risks[1].description)
  const decision=(await c.ok(riskPath,{...r.reviewInput(),risk_id:risk.id,status:'resolved',reason:'Human checked the exact recorded installed quantity; external accounting is still outstanding'})).record
  await r.state();const finalReview=(await c.ok(outcomePath,r.reviewInput())).record
  const reviewed=await r.state();assert.equal(reviewed.status,'native_supported');assert.equal(reviewed.open_risk_count,1);assert.equal(reviewed.risks.find(row=>row.id===risk.id).status,'resolved');assert.equal(reviewed.overall_restoration,'unverified');assert.deepEqual(reviewed.risks.find(row=>row.id===risk.id).decisions,[decision])
  const decisionSnapshot=structuredClone(await c.read());assert.equal((await c.act(riskPath,{...r.reviewInput(),risk_id:risk.id,status:'resolved'})).status,409);assert.equal((await c.act(`/recovery-evidence/${r.recovery.id}/close`,{confirm:true})).status,404);assert.deepEqual(await c.read(),decisionSnapshot,'Replay and a narrative final-close attempt change nothing')
  for(const key of ['orders','schedules','schedule_actuals','approvals','budgets','cost_records'])assert.deepEqual((await c.read())[key],nativeSources[key],'Native outcome and risk review cannot mutate '+key)
  await c.ok(`/orders/${r.order.id}/return`,{lines:[{line_id:'recovery-lot',quantity:'1'}],reference:'synthetic-plinth-recovery-return',reason:'Human records returned package'})
  await c.ok(`/orders/${r.order.id}/receive`,{lines:[{line_id:'recovery-lot',quantity:'1'}],reference:'synthetic-plinth-recovery-late-receipt',received_on:'2026-11-08'})
  const late=await r.state();assert.equal(late.status,'reopened');assert.equal(late.comparison.deliveries[0].state,'supported');assert.equal(late.comparison.deliveries[0].date_state,'contradicted');assert.equal(late.comparison.deliveries[0].observed_on,'2026-11-08');assert.equal(late.risks.find(row=>row.id===risk.id).status,'open','Resolution of earlier evidence cannot clear a changed packet');assert.equal(late.open_risk_count,2)
  assert.deepEqual(r.recovery.outcome_reviews,[nativeReview,finalReview]);assert.deepEqual(r.recovery.assessments.slice(0,3),[first,deliveryOnly,second]);assert.deepEqual(r.recovery.risk_decisions,[decision])
  await r.refresh();await r.assess();await r.state()
  const reopenedRisk=(await c.ok(riskPath,{...r.reviewInput(),risk_id:risk.id,status:'resolved',reason:'Human reviewed this changed source without certifying final recovery'})).record
  await c.ok(riskPath,{...r.reviewInput(),risk_id:risk.id,status:'open',reason:'Human reopens the follow-up while the actual delivery remains late'})
  const open=await r.state();assert.equal(open.risks.find(row=>row.id===risk.id).decisions.length,3);assert.equal(open.risks.find(row=>row.id===risk.id).decisions[1].id,reopenedRisk.id);assert.equal(open.open_risk_count,2)
 }finally{await f.close()}
})
