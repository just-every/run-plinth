import test from 'node:test'
import assert from 'node:assert/strict'
import {createFixture} from './helpers.mjs'
import {costFixture} from './cost-support.mjs'

test('COST-005 — three-month source cash and WIP expose a delayed collection trough; recorded accountant close remains fixed while late actual posts in the next open period',async()=>{
 const f=await createFixture();try{
  const c=await costFixture(f)
  for(const month of ['10','11','12']){let r=await c.ok('/costs/bills',{...c.bill('synthetic-plinth-month-'+month),due_on:`2026-${month}-25`,lines:[{cost_code:'06-100',description:'Monthly supplier payable',subtotal_cents:10000,taxable:false,matches:[]}]});await c.ok(`/costs/bills/${r.record.id}/review`,{reason:'Reviewed original supplier invoice and unmatched receipt follow-up'});await c.ok(`/costs/bills/${r.record.id}/post`)}
  await c.ok('/sov',{});await c.read()
  let r=await c.ok('/claims',{description:'October work application',lines:c.job.sov.at(-1).lines.map((l,i)=>({line_id:l.id,completed_cents:i?0:15000,stored_cents:0,evidence:'Reviewed installed work'}))});const claim=r.record;await c.ok(`/claims/${claim.id}/approve`);await c.ok(`/claims/${claim.id}/issue`)
  r=await c.ok('/invoices',{kind:'milestone',description:'Expected November collection',source_application_id:claim.id,recipient_email:'synthetic-plinth-client@example.com',due_on:'2026-11-20',terms:'Net terms'});const invoice=r.record;await c.ok(`/invoices/${invoice.id}/issue`)
  r=await c.ok('/costs/forecasts',{as_of:'2026-10-23',source_as_of:'Reviewed October costs, outstanding procurement and remaining labor',codes:[{cost_code:'06-100',remaining_quantity:'10',minutes_per_unit:'20',labor_hour_cents:6000,outstanding_commitment_cents:100000,unbought_cents:0,risk_cents:0,reference:'Remaining framing labor'},{cost_code:'01-100',remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:0,outstanding_commitment_cents:0,unbought_cents:0,risk_cents:0,reference:'Labor cost is carried in framing package'}]});await c.ok('/costs/cash-dates',{kind:'forecast',source_id:r.record.id+':06-100',expected_on:'2027-01-20',reference:'Builder reviewed January labor plan'})
  const report=async()=>{const r=await c.api(`/jobs/${c.job.id}/costs/cash?start_period=2026-10&months=3&opening_cash_cents=20000`);assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
  const initial=await report();assert.deepEqual(initial.rows.map(r=>r.closing_cents),[10000,15000,5000]);assert.equal(initial.trough_cents,5000);assert.equal(initial.wip.actual_cents,30000);assert.equal(initial.wip.forecast_final_cents,150000);assert.equal(initial.wip.earned_cents,60000);assert.equal(initial.wip.billed_cents,15000);assert.equal(initial.wip.under_billed_cents,45000);assert.ok(initial.outside_horizon.some(e=>e.kind==='expected_delivery'&&e.out_cents===100000),'Unphased open procurement never disappears');assert.ok(initial.outside_horizon.some(e=>e.kind==='forecast_unbought_labor_material_risk'&&e.out_cents===20000&&e.expected_on==='2027-01-20'))
  await c.ok('/costs/cash-dates',{kind:'invoice',source_id:invoice.id,expected_on:'2026-12-20',reference:'Client advised expected December collection; no payment claimed'})
  const delayed=await report();assert.deepEqual(delayed.rows.map(r=>r.closing_cents),[10000,0,5000]);assert.equal(delayed.trough_cents,0)
  r=await c.ok('/costs/periods',{period:'2026-10',accountant_approved:true,accountant_name:'Synthetic external accountant',approval_reference:'synthetic-plinth-accountant-reviewed-october',opening_cash_cents:20000,months:3});const closed=r.record
  assert.equal((await c.act('/costs/periods',{period:'2026-10',accountant_approved:true,accountant_name:'Another',approval_reference:'Cannot rewrite',opening_cash_cents:20000})).status,409)
  r=await c.ok('/costs/sources',{kind:'equipment',reference:'synthetic-plinth-late-october-cost',equipment_reference:'synthetic-plinth-lift-1',dated_on:'2026-10-31',period:'2026-10',cost_code:'06-100',minutes:60,hour_cents:500});const source=r.record;assert.equal((await c.act(`/costs/sources/${source.id}/approve`)).value.error,'cost_period_closed')
  await c.ok(`/costs/sources/${source.id}/approve`,{posting_period:'2026-11'})
  const receipt={confirm:true,method:'check',reference:'synthetic-plinth-late-collection',received_on:'2026-10-31',amount_cents:1000}
  assert.equal((await c.act(`/invoices/${invoice.id}/receipt`,receipt)).value.error,'cost_period_closed')
  await c.ok(`/invoices/${invoice.id}/receipt`,{...receipt,posting_period:'2026-11',adjustment_reference:'Late bank statement arrived after accountant close'})
  const periods=(await c.api(`/jobs/${c.job.id}/costs/periods`)).value.periods;assert.deepEqual(periods[0],closed);const ledger=await c.ledger();assert.equal(ledger.totals.posted_actual_cents,30500);assert.equal(ledger.rows.flatMap(r=>r.sources.billing).filter(e=>e.kind==='collected')[0].period,'2026-11');const entries=ledger.rows.flatMap(r=>r.sources.actual);assert.equal(entries.filter(e=>e.period==='2026-10').reduce((n,e)=>n+e.amount_cents,0),30000);assert.equal(entries.filter(e=>e.period==='2026-11').reduce((n,e)=>n+e.amount_cents,0),500)
 }finally{await f.close()}
})
