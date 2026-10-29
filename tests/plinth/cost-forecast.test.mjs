import {recoveryNative} from '../fixtures/recovery-native.mjs'
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
  await c.ok(`/orders/${r.order.id}/receive`,{lines:[{line_id:'recovery-lot',quantity:'2'}],reference:'synthetic-plinth-delivery-52',received_on:'2026-11-06'})
  const stale=await c.act(`/recovery-evidence/${r.recovery.id}/assess`,r.observation());assert.equal(stale.status,409);assert.equal(stale.value.error,'recovery_stale')
  await r.refresh();const deliveryOnly=await r.assess();assert.equal(deliveryOnly.comparison.deliveries[0].state,'supported');assert.equal(deliveryOnly.comparison.tasks[0].quantity_state,'unknown');assert.equal(deliveryOnly.comparison.overall_restoration,'unverified');assert.ok(deliveryOnly.comparison.missing.some(s=>s.startsWith('Installed quantity ')))
  await c.ok('/schedule-actuals',{task_id:r.criteria.tasks[0].task_id,actual_start:'2026-11-06T08:00:00Z',actual_finish:'2026-11-06T09:00:00Z',installed:{quantity:'2',unit:'pack',cost_code:'06-100'},evidence:'Human records the exact installed units'})
  await c.ok('/costs/reconcile',{period:'2026-11',balances:[],reference:'Synthetic native balance review; not independent accounting proof'})
  await r.forecast();await r.refresh();const second=await r.assess()
  assert.equal(second.comparison.deliveries[0].state,'supported');assert.equal(second.comparison.tasks[0].date_state,'supported');assert.equal(second.comparison.tasks[0].quantity_state,'supported');assert.equal(second.comparison.native_status,'supported');assert.equal(second.comparison.overall_restoration,'unverified');assert.equal(second.comparison.forecast_margin_cents,180000);assert.equal(second.comparison.observed_margin_cents,300000);assert.equal(second.risks[0].owner_id,c.job.created_by.id)
  const posted=await c.ok('/costs/bills',{...c.bill('synthetic-plinth-adverse-52'),tax:{percent:'0',reference:'Synthetic exempt adjustment',exemption_reference:'Synthetic source',human_reviewed:true},lines:[{cost_code:'06-100',description:'Adverse native cost adjustment',subtotal_cents:220000,taxable:false,matches:[]}]});await c.ok(`/costs/bills/${posted.record.id}/review`,{reason:'Human checks adverse original'});await c.ok(`/costs/bills/${posted.record.id}/post`)
  await r.refresh();const third=await r.assess()
  assert.equal(third.comparison.posted_actual_cents,220000);assert.equal(third.comparison.observed_margin_cents,80000);assert.equal(third.comparison.forecast_margin_cents,null);assert.equal(third.comparison.margin_state,'contradicted');assert.equal(third.comparison.native_status,'contradicted');assert.equal(third.reopened,true);assert.equal(third.comparison.overall_restoration,'unverified')
  assert.deepEqual(r.recovery.assessments.slice(0,3),[first,deliveryOnly,second]);assert.equal(r.recovery.packets.length,4)
  const after=await c.read();for(const key of ['schedules','budgets','quotes','trade_invitations'])assert.deepEqual(after[key],before[key],key+' decisions remain immutable');assert.equal(after.approvals.filter(a=>a.kind==='schedule.publish').length,1)
 }finally{await f.close()}
})

test('Recovery comparison reconciles two immutable date, margin and expected-cash alternatives without executing decisions',async()=>{
 const f=await createFixture();try{
  const call=async(path,body,method='POST')=>{const r=await f.json('/api/plinth/'+path,{method,cookie:f.owner,...(method==='GET'?{}:{body})});assert.equal(r.status, ['jobs','resources','pricing-rates'].includes(path)?201:200,JSON.stringify(r.value));return r.value}
  const c=await recoveryNative(call,{name:'Recovery arithmetic',client:['synthetic-plinth-client','example.invalid'].join('@')})
  const before=await c.read(),ledgerBefore=(await call(c.root+'/costs',undefined,'GET')),messages=f.messages.length
  const proposal=(await c.act('/recovery/requests/'+c.request.id+'/compare',{key:'synthetic-plinth-1',alternatives:c.alternatives})).record
  const [wait,fast]=proposal.alternatives
  assert.equal(wait.schedule.completion_after,'2026-11-10T16:00:00.000Z');assert.equal(fast.schedule.completion_after,'2026-11-06T16:00:00.000Z')
  assert.equal(wait.forecast.remaining_cents,196000);assert.equal(wait.forecast.final_cents,256000);assert.equal(wait.forecast.margin_cents,44000)
  assert.equal(fast.forecast.remaining_cents,230000);assert.equal(fast.forecast.final_cents,290000);assert.equal(fast.forecast.margin_cents,10000)
  assert.equal(fast.forecast.revenue_cents,300000,'An unapproved client price never becomes contract revenue')
  assert.deepEqual(wait.cash.rows.map(r=>r.closing_cents),[140000,40000,-6000]);assert.deepEqual(fast.cash.rows.map(r=>r.closing_cents),[140000,-40000,-40000])
  assert.deepEqual(proposal.difference,{finish_minutes:-5760,remaining_cents:34000,margin_cents:-34000,expected_cash_closing_cents:[0,-80000,-34000],expected_cash_trough_cents:-34000})
  assert.deepEqual(wait.labor_capacity,{task_id:c.install,required_minutes:'960',available_minutes:960,sufficient:true});assert.deepEqual(fast.labor_capacity,wait.labor_capacity)
  assert.ok(proposal.alternatives.every(a=>a.native_feasible));assert.equal(fast.amendment.state,'unsent');assert.equal(fast.client_decision.state,'unapproved')
  let r=await c.act('/recovery/requests/'+c.request.id+'/review/'+proposal.id,{digest:proposal.digest,alternative_id:'expedite',decision:'retain',reason:'Owner prefers the comparison, subject to separate actual decisions'})
  assert.equal(r.record.reviews[0].decision,'retain')
  r=await c.act('/recovery/requests/'+c.request.id+'/review/'+proposal.id,{digest:proposal.digest,alternative_id:'wait',decision:'reject',reason:'Recorded date is too late; preserve rejected alternative'})
  assert.equal(r.record.reviews.length,2);assert.deepEqual(r.record.alternatives,proposal.alternatives)
  assert.deepEqual((await c.act('/recovery/requests/'+c.request.id+'/compare',{key:'synthetic-plinth-1',alternatives:c.alternatives})).record,r.record,'Replay retains one proposal with its complete review history')
  const impossible=structuredClone(c.alternatives);impossible[1].schedule.tasks[1].duration_minutes=120
  const short=(await c.act('/recovery/requests/'+c.request.id+'/compare',{key:'understated-effort',alternatives:impossible})).record
  assert.equal(short.alternatives[1].native_feasible,false);assert.equal(short.alternatives[1].labor_capacity.required_minutes,'960');assert.equal(short.alternatives[1].labor_capacity.available_minutes,240,'A shorter elapsed promise cannot hide the forecast labor effort')
  const denied=await f.json('/api/plinth/'+c.root+'/recovery/requests/'+c.request.id+'/review/'+short.id,{method:'POST',cookie:f.owner,body:{expected_version:c.job.version,digest:short.digest,alternative_id:'expedite',decision:'retain',reason:'Insufficient crew time'}});assert.equal(denied.value.error,'recovery_infeasible')
  const after=await c.read();for(const field of ['schedules','orders','variations','selections','invoices','approvals','budgets','schedule_baselines'])assert.deepEqual(after[field],before[field],field+' remains unchanged')
  const ledgerAfter=await call(c.root+'/costs',undefined,'GET');assert.deepEqual({...ledgerAfter,version:0},{...ledgerBefore,version:0});assert.equal(f.messages.length,messages)
  const different=structuredClone(c.alternatives);different[0].forecast.codes[1].minutes_per_unit='119'
  assert.equal((await f.json('/api/plinth/'+c.root+'/recovery/requests/'+c.request.id+'/compare',{method:'POST',cookie:f.owner,body:{expected_version:after.version,key:'synthetic-plinth-1',alternatives:different}})).value.error,'recovery_replay')
  await c.act('/schedule-actuals',{task_id:c.install,actual_start:'2026-11-02T08:00:00Z',installed:{quantity:'2',unit:'pack',cost_code:'01-100'},evidence:'Installation began with the early partial delivery; eight units still await material'})
  await c.review()
  const started=(await c.act('/recovery/requests/'+c.request.id+'/compare',{key:'started-before-delay',alternatives:c.alternatives})).record
  assert.deepEqual(started.alternatives.map(a=>a.labor_capacity.available_minutes),[0,0],'Historical installation time before remaining material arrives is not remaining crew capacity')
  assert.ok(started.alternatives.every(a=>!a.native_feasible),'Neither alternative can finish remaining installation before its package arrives')
  const nativeStarted=await c.read()
  for(const alternative of started.alternatives){
   const refusal=await f.json('/api/plinth/'+c.root+'/recovery/requests/'+c.request.id+'/review/'+started.id,{method:'POST',cookie:f.owner,body:{expected_version:c.job.version,digest:started.digest,alternative_id:alternative.id,decision:'retain',reason:'Cannot retain work that finishes before delivery'}})
   assert.equal(refusal.value.error,'recovery_infeasible');assert.deepEqual(await c.read(),nativeStarted,'Refused review writes nothing')
  }
  const extended=structuredClone(c.alternatives)
  extended[0].schedule.tasks[1].duration_minutes=3360
  extended[1].schedule.tasks[1].duration_minutes=2400
  const resumed=(await c.act('/recovery/requests/'+c.request.id+'/compare',{key:'resume-after-delivery',alternatives:extended})).record
  assert.deepEqual(resumed.alternatives.map(a=>a.labor_capacity.available_minutes),[960,960],'Only working time after each arrival can satisfy the remaining sixteen crew hours')
  assert.deepEqual(resumed.alternatives.map(a=>a.schedule.completion_after),['2026-11-10T16:00:00.000Z','2026-11-06T16:00:00.000Z'])
  assert.ok(resumed.alternatives.every(a=>a.native_feasible))
  await c.act('/recovery/requests/'+c.request.id+'/review/'+resumed.id,{digest:resumed.digest,alternative_id:'wait',decision:'retain',reason:'Remaining working time is explicitly available after delivery'})
  const retained=await c.read();assert.deepEqual(retained.schedules,nativeStarted.schedules);assert.deepEqual(retained.orders,nativeStarted.orders);assert.deepEqual(retained.schedule_actuals,nativeStarted.schedule_actuals)
  const lagged=structuredClone(extended);for(const alternative of lagged)alternative.schedule.tasks[1].predecessors[0].lag_minutes=480
  const laggedProposal=(await c.act('/recovery/requests/'+c.request.id+'/compare',{key:'remaining-dependency-lag',alternatives:lagged})).record
  assert.deepEqual(laggedProposal.alternatives.map(a=>a.labor_capacity.available_minutes),[480,0]);assert.ok(laggedProposal.alternatives.every(a=>!a.native_feasible),'Recorded predecessor lag also consumes the remaining window')
  await c.review('2026-11-10')
  const later=(await c.act('/recovery/requests/'+c.request.id+'/compare',{key:'later-reviewed-date',alternatives:extended})).record
  assert.deepEqual(later.alternatives.map(a=>a.labor_capacity.available_minutes),[480,0]);assert.ok(later.alternatives.every(a=>!a.native_feasible),'Working time before the reviewed date is already past')
  await c.act('/schedule-actuals',{task_id:c.install,actual_start:'2026-11-02T08:00:00Z',actual_finish:'2026-11-03T16:00:00Z',installed:{quantity:'2',unit:'pack',cost_code:'01-100'},evidence:'Human records this installation task complete; unfinished package work needs a new reviewed task'})
  await c.review()
  const complete=(await c.act('/recovery/requests/'+c.request.id+'/compare',{key:'completed-work-is-not-remaining',alternatives:extended})).record
  assert.deepEqual(complete.alternatives.map(a=>a.labor_capacity.available_minutes),[0,0]);assert.ok(complete.alternatives.every(a=>!a.native_feasible),'Completed actual work cannot supply capacity for remaining labor')


 }finally{await f.close()}
})
