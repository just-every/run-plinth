import assert from 'node:assert/strict'
import { costFixture } from './cost-support.mjs'
import { createReleasedScope } from './helpers.mjs'
export async function recoveryEvidenceFixture(f){
 const c=await costFixture(f),tradeAddress=['synthetic-plinth-52','example.invalid'].join('@'),trade=await f.invite(tradeAddress,'Recovery trade contact')
 let released=await createReleasedScope(f,c.job,tradeAddress,'Framing');await c.read()
 const calendar={weekdays:[1,2,3,4,5],start_hour:0,end_hour:24,holidays:[]},tasks=[{id:'synthetic-plinth-recovery-task',trade:'Framing',description:'Recovery framing',owner:'Site owner',start:'2026-11-06T08:00:00Z',duration_minutes:60}]
 const preview=await c.ok('/schedule/preview',{calendar,tasks});await c.ok('/schedule/publish',{calendar,tasks:preview.preview.tasks,digest:preview.preview.digest,revision_name:'Recovery dates',reason:'Human reviews native recovery dates'})
 let r=await c.ok(`/schedules/${tasks[0].id}/invite`,{email:tradeAddress,subcontract_id:released.scope.id});const invitation=r.record
 r=await c.api(`/trade-confirmations/${invitation.id}/confirm`,{expected_version:c.job.version,confirm:true,reason:'I personally confirm the exact booked dates'},trade);assert.equal(r.status,200,JSON.stringify(r.value));await c.read()
 r=await c.ok('/orders',{supplier:'Synthetic recovery supplier',description:'Recovery delivery',source:{kind:'budget',cost_code:'06-100'},lines:[{id:'recovery-lot',description:'Recovery package',cost_code:'06-100',quantity:'2',unit:'pack',unit_cents:10000}],promised_on:'2026-11-06'});const order=r.record;await c.ok(`/orders/${order.id}/issue`)
 const forecast=async()=>{const ledger=await c.ledger();return c.ok('/costs/forecasts',{as_of:'2026-11-07',source_as_of:'Exact reviewed native sources; external actuals remain unknown',codes:ledger.rows.map(row=>({cost_code:row.cost_code,remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:0,outstanding_commitment_cents:row.open_commitment_cents,unbought_cents:0,risk_cents:0,reference:'Native remaining commitment only'}))})}
 await forecast();await c.read()
 const criteria={schedule_approval_id:c.job.approvals.findLast(a=>a.kind==='schedule.publish').id,budget_id:c.job.budgets.at(-1).id,promised_finish:'2026-11-06T09:00:00Z',minimum_margin_cents:150000,tasks:[{task_id:tasks[0].id,quantity:'2',unit:'pack',cost_code:'06-100'}],order_ids:[order.id]}
 const review=await c.ok('/recovery-evidence/preview',{criteria})
 r=await c.ok('/recovery-evidence',{title:'Private recovery comparison',criteria,digest:review.digest,confirm:true});let recovery=r.record
 const refresh=async()=>{const p=await c.ok('/recovery-evidence/preview',{case_id:recovery.id});await c.ok(`/recovery-evidence/${recovery.id}/review`,{digest:p.digest,confirm:true});recovery=(await c.api(`/jobs/${c.job.id}/recovery-evidence/${recovery.id}`)).value.case;return recovery}
 const observation=()=>({observation_id:'synthetic-plinth-observation-'+recovery.packets.at(-1).id,packet_id:recovery.packets.at(-1).id,observed_on:'2026-11-07',observation:'Native evidence compared; no final recovery decision',risks:[{description:'Obtain independently reconciled actuals and final human review',owner_id:c.job.created_by.id,due_on:'2026-11-30'}]})
 const assess=async(input=observation())=>{const result=await c.ok(`/recovery-evidence/${recovery.id}/assess`,input);recovery=(await c.api(`/jobs/${c.job.id}/recovery-evidence/${recovery.id}`)).value.case;return result.record}
 const state=async()=>{const result=(await c.api(`/jobs/${c.job.id}/recovery-evidence/${recovery.id}`)).value;recovery=result.case;return result.state}
 const reviewInput=()=>({packet_id:recovery.packets.at(-1).id,assessment_id:recovery.assessments.at(-1)?.id,confirm:true,reason:'Human reviews only the exact native outcome; independent accounting remains required'})
 const completeNative=async()=>{
  await c.ok(`/orders/${order.id}/receive`,{lines:[{line_id:'recovery-lot',quantity:'2'}],reference:'synthetic-plinth-native-delivery',received_on:'2026-11-06'})
  await c.ok('/schedule-actuals',{task_id:criteria.tasks[0].task_id,actual_start:'2026-11-06T08:00:00Z',actual_finish:'2026-11-06T09:00:00Z',installed:{quantity:'2',unit:'pack',cost_code:'06-100'},evidence:'Human records the installed native lot'})
  await c.ok('/costs/reconcile',{period:'2026-11',balances:[],reference:'Synthetic native review only; external accounting remains unproved'})
  await forecast();await refresh();return assess()
 }
 return {c,order,criteria,forecast,refresh,assess,observation,state,reviewInput,completeNative,trade,invitation,vendor:released.vendor,get recovery(){return recovery}}
}
