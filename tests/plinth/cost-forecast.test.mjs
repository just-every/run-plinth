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
  const c=await costFixture(f),admin=await f.invite('synthetic-plinth-admin@example.com','Cost reviewer','admin')
  const operators={id:c.job.created_by.id}
  await c.ok('/costs/policy',{budget_limit_cents:0,commitment_limit_cents:0,bill_limit_cents:100000,separate_approval:true,owner_id:operators.id,due_on:'2026-11-01'})
  const invoice=c.bill();invoice.lines=[{...invoice.lines[0],subtotal_cents:160000,taxable:false,matches:[]}]
  let r=await c.act('/costs/bills',invoice,admin);assert.equal(r.status,200,JSON.stringify(r.value));const id=r.value.record.id;await c.read()
  await c.ok(`/costs/bills/${id}/review`,{reason:'Receipt missing; reviewed original supplier evidence and assigned follow-up'})
  assert.equal((await c.act(`/costs/bills/${id}/post`,{},admin)).status,403,'Preparing clerk cannot approve; also exceeds their limit')
  await c.ok(`/costs/bills/${id}/post`)
  await c.ok('/costs/reconcile',{period:'2026-10',balances:[],reference:'synthetic-plinth-accounting-export-removed-entry'})
  let exceptions=(await c.api(`/jobs/${c.job.id}/costs/exceptions`)).value
  const active=exceptions.items.filter(e=>['budget','ledger'].includes(e.kind));assert.equal(active.length,2);assert.ok(active.every(e=>e.status==='open'&&e.owner_id===operators.id&&e.due_on==='2026-11-01'))
  for(const e of active)assert.equal((await c.act(`/costs/exceptions/${e.id}`,{reason:'Dismiss without correction'})).status,409)
  const credit={...invoice,kind:'credit',credit_of:id,reference:'synthetic-plinth-variance-credit',lines:[{...invoice.lines[0],subtotal_cents:60000}]}
  r=await c.act('/costs/bills',credit,admin);assert.equal(r.status,200);await c.read();await c.ok(`/costs/bills/${r.value.record.id}/review`,{reason:'Supplier corrected overbill'});await c.ok(`/costs/bills/${r.value.record.id}/post`)
  await c.ok('/costs/reconcile',{period:'2026-10',balances:[{cost_code:'06-100',amount_cents:100000}],reference:'synthetic-plinth-accounting-corrected-export'})
  for(const e of active)await c.ok(`/costs/exceptions/${e.id}`,{reason:'Approved credit and exact accounting reconciliation agree'})
  exceptions=(await c.api(`/jobs/${c.job.id}/costs/exceptions`)).value;assert.ok(exceptions.items.filter(e=>active.some(a=>a.id===e.id)).every(e=>e.status==='cleared'&&e.resolutions.length===1));assert.equal(exceptions.unassigned.length,0);assert.equal(exceptions.healthy,false,'Historical source follow-ups still need explicit human resolution')
  for(const e of exceptions.items.filter(e=>!e.resolutions.length&&!e.current))await c.ok(`/costs/exceptions/${e.id}`,{reason:'Approved source is now posted and the current external ledger agrees'})
  assert.equal((await c.api(`/jobs/${c.job.id}/costs/exceptions`)).value.healthy,true)
  assert.equal((await c.act('/costs/policy',{budget_limit_cents:0},admin)).status,403)
 }finally{await f.close()}
})
