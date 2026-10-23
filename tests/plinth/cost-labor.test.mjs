import test from 'node:test'
import assert from 'node:assert/strict'
import {createActiveJob,createFixture} from './helpers.mjs'
import {costFixture,original,costOriginal} from './cost-support.mjs'

test('COST-003 — approved time, burden CSV, equipment and employee originals reconcile once; reimbursement and cross-job assignment correction preserve total actual cost',async()=>{
 const f=await createFixture();try{
  const c=await costFixture(f),date={dated_on:'2026-10-23',period:'2026-10',cost_code:'01-100'}
  let r=await c.ok('/costs/sources',{...date,kind:'time',reference:'synthetic-plinth-time-1',employee_reference:'synthetic-plinth-employee-1',minutes:480,hour_cents:3000,burden_bps:2000});const time=r.record
  assert.equal(time.amount_cents,28800);assert.equal((await c.ledger()).totals.posted_actual_cents,0)
  await c.ok(`/costs/sources/${time.id}/approve`);assert.equal((await c.act(`/costs/sources/${time.id}/approve`)).status,409)
  r=await c.ok('/costs/sources',{...date,kind:'expense',reference:'synthetic-plinth-expense-1',employee_reference:'synthetic-plinth-employee-1',amount_cents:1250,document:original});const expense=r.record
  await c.ok(`/costs/sources/${expense.id}/approve`)
  r=await c.ok('/costs/sources',{...date,cost_code:'06-100',kind:'equipment',reference:'synthetic-plinth-equipment-1',equipment_reference:'synthetic-plinth-lift-1',minutes:90,hour_cents:4000});const equipment=r.record
  assert.equal(equipment.amount_cents,6000);await c.ok(`/costs/sources/${equipment.id}/approve`)
  const csv=`external_id,time_source_id,gross_cents,burden_cents\nsynthetic-plinth-payroll-1,${time.id},25000,5500\n`,payroll={csv,reference:'synthetic-plinth-payroll-register-1',dated_on:'2026-10-24',period:'2026-10'}
  r=await c.ok('/costs/payroll',payroll);const payrollId=r.record.id;assert.equal(r.record.source_totals_cents,30500)
  let ledger=await c.ledger();assert.equal(ledger.totals.posted_actual_cents,37750,'Time provisional is replaced by gross plus burden, not added again')
  assert.equal((await c.act('/costs/payroll',payroll)).status,409)
  const payrollFile=await f.request(`/api/plinth/jobs/${c.job.id}/costs/payroll/${payrollId}/original`,{cookie:f.owner});assert.equal(payrollFile.status,200);assert.equal(await payrollFile.text(),csv,'Original CSV bytes including final newline survive')
  await c.ok(`/costs/sources/${expense.id}/reimburse`,{confirm:true,reference:'synthetic-plinth-reimbursement-check-1'});assert.equal((await c.ledger()).totals.posted_actual_cents,37750);assert.equal((await c.act(`/costs/sources/${expense.id}/reimburse`,{confirm:true,reference:'synthetic-plinth-repeat'})).status,409)
  const expenseFile=await f.request(`/api/plinth/jobs/${c.job.id}/costs/sources/${expense.id}/original`,{cookie:f.owner});assert.deepEqual(Buffer.from(await expenseFile.arrayBuffer()),costOriginal)
  const destination=await createActiveJob(f,'Corrected equipment job','synthetic-plinth-other@example.com');const equipmentEntry=ledger.rows.flatMap(r=>r.sources.actual).find(e=>e.source_id===equipment.id)
  const transfer={entry_id:equipmentEntry.id,target_job_id:destination.id,target_expected_version:destination.version,target_cost_code:'Unassigned',amount_cents:6000,dated_on:'2026-10-25',period:'2026-10',reference:'synthetic-plinth-transfer-1',reason:'Lift used on the other job; explicit reviewed assignment correction'}
  assert.equal((await c.act('/costs/transfers',{...transfer,target_expected_version:1})).status,409,'Stale destination cannot partly remove source actual')
  assert.equal((await c.ledger()).totals.posted_actual_cents,37750)
  r=await c.ok('/costs/transfers',transfer);assert.equal(r.amount_cents,6000)
  const from=await c.ledger(),to=(await c.api(`/jobs/${destination.id}/costs`)).value
  assert.equal(from.totals.posted_actual_cents,31750);assert.equal(to.totals.posted_actual_cents,6000);assert.equal(from.totals.posted_actual_cents+to.totals.posted_actual_cents,37750)
  assert.equal((await c.act('/costs/transfers',{...transfer,target_expected_version:r.target_version,reference:'synthetic-plinth-over-transfer'})).status,409)
  r=await c.ok('/warranties',{kind:'component',name:'Synthetic framing callback',starts_on:'2026-01-01',ends_on:'2028-12-31',terms:'Synthetic recorded component warranty',signed_terms_reference:'synthetic-plinth-warranty-source'});const component=r.record
  r=await c.ok('/warranties',{kind:'case',component_id:component.id,defect_key:'framing',description:'Callback framing repair',reported_on:'2026-10-23',reviewer_email:'builder@example.com'});const callback=r.record
  r=await c.ok(`/warranties/${callback.id}/cost`,{amount_cents:500,cost_code:'01-100',description:'Employee callback receipt',reference:'synthetic-plinth-callback-1'});const callbackCost=r.record
  r=await c.ok('/costs/sources',{...date,kind:'expense',reference:'synthetic-plinth-callback-expense',employee_reference:'synthetic-plinth-employee-1',amount_cents:500,document:original,warranty_cost_id:callbackCost.id});await c.ok(`/costs/sources/${r.record.id}/approve`)
  assert.equal((await c.ledger()).totals.posted_actual_cents,32250,'A linked warranty expense retains its existing callback actual once')
  const timeSources=(await c.api(`/jobs/${c.job.id}/costs/sources`)).value.sources
  assert.equal(timeSources.find(s=>s.id===time.id).payroll_replaced_cents,28800);assert.equal(timeSources.find(s=>s.id===expense.id).reimbursed.reference,'synthetic-plinth-reimbursement-check-1')
 }finally{await f.close()}
})
