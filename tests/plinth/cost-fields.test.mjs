import test from 'node:test'
import assert from 'node:assert/strict'
import {createFixture} from './helpers.mjs'
import {costFixture} from './cost-support.mjs'

test('COST-002 — inherited typed financial fields gate native bill posting and job-scoped saved reports retain explicit filters and safe exports',async()=>{
 const f=await createFixture();try{
  const c=await costFixture(f),admin=await f.invite('synthetic-plinth-reviewer@example.com','Reviewing administrator','admin')
  let r=await c.api('/reports/fields',{id:'cost.evidence',record_scope:'financial',name:'Cost review evidence',type:'text',required_at_stages:['posted'],expected_version:0});assert.equal(r.status,201)
  r=await c.ok('/costs/bills',c.bill());const id=r.record.id
  await c.ok(`/costs/bills/${id}/review`,{reason:'Reviewed both receipts and allocation'});assert.equal((await c.act(`/costs/bills/${id}/post`)).value.error,'required_fields')
  const records=(await c.api(`/jobs/${c.job.id}/costs/records`)).value;const record=records.records.find(r=>r.local_id===id)
  assert.equal(record.values['native.amount'].amount_cents,43000);assert.ok(records.columns.some(c=>c.id==='cost.evidence'))
  await c.ok(`/costs/values/${id}`,{custom_fields:{'cost.evidence':'=synthetic-plinth-reviewed-original'},stage:'reviewed'})
  await c.ok(`/costs/bills/${id}/route`,{reviewer_id:c.job.created_by.id,reason:'Office reviewer owns final posting'})
  assert.equal((await c.act(`/costs/bills/${id}/post`,{},admin)).status,403,'Only the designated reviewer posts')
  await c.ok(`/costs/bills/${id}/post`)
  const view={name:'Reviewed supplier bills',sharing:'personal',scope:{record_scope:'financial',record_ids:[record.id]},filters:[{column_id:'cost.evidence',operator:'is_set'}],selected_columns:['native.amount','cost.evidence']}
  r=await c.ok('/costs/views',view);const viewId=r.record.id
  const result=(await c.api(`/jobs/${c.job.id}/costs/views/${viewId}`)).value
  assert.equal(result.report.annotation.count,1);assert.deepEqual(result.report.annotation.requested_record_ids,[record.id]);assert.equal(result.report.money_totals[0].amount_cents,43000)
  assert.equal((await c.api(`/jobs/${c.job.id}/costs/views/${viewId}`,undefined,admin)).status,404,'Personal view creator remains the boundary')
  const csv=await (await f.request(`/api/plinth/jobs/${c.job.id}/costs/views/${viewId}/export.csv`,{cookie:f.owner})).text();assert.ok(csv.includes('requested_record_ids')&&csv.includes('scope_count')&&csv.includes("'=synthetic-plinth-reviewed-original"))
  const client=await f.invite('synthetic-plinth-client@example.com');assert.equal((await c.api(`/jobs/${c.job.id}/costs/records`,undefined,client)).status,403)
 }finally{await f.close()}
})
