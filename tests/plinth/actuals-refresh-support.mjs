import assert from 'node:assert/strict'
import {costFixture} from './cost-support.mjs'
export const refreshCodes=(open=100000)=>[
 {cost_code:'06-100',remaining_quantity:'50',minutes_per_unit:'24',labor_hour_cents:3000,outstanding_commitment_cents:open,unbought_cents:5000,risk_cents:2000,reference:'synthetic-plinth-remaining-50; owner reviewed productivity and unbought materials'},
 {cost_code:'01-100',remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:0,outstanding_commitment_cents:0,unbought_cents:10000,risk_cents:0,reference:'synthetic-plinth-separate-labor-package'}
]
export const storedAllocations=c=>[
 {line_id:'quote:framing',stored_cents:20000,evidence:'synthetic-plinth-reviewed-stored-packs',order_ids:[c.order.id]},
 {line_id:'quote:labor',stored_cents:0,evidence:'synthetic-plinth-no-stored-labor',order_ids:[]}
]
export async function actualsFixture(f){
 const c=await costFixture(f)
 await c.ok('/sov')
 await c.ok('/retainage',{contract_reference:'Synthetic signed retainage terms',rules:[{line_id:'quote:framing',work_bps:1000,stored_bps:500},{line_id:'quote:labor',work_bps:1000,stored_bps:0}],milestones:[{id:'final',name:'Final completion',final:true,completion_requirements:['Signed completion'],waiver_requirements:['Final waiver']}]})
 const claim=(await c.ok('/claims',{description:'Synthetic approved completed work',lines:[{line_id:'quote:framing',completed_cents:20000,stored_cents:0,evidence:'Human approved framing',order_ids:[]},{line_id:'quote:labor',completed_cents:10000,stored_cents:0,evidence:'Human approved labor',order_ids:[]}]})).record
 await c.ok('/claims/'+claim.id+'/approve');await c.ok('/claims/'+claim.id+'/issue')
 const list=async()=>{const r=await c.api('/jobs/'+c.job.id+'/actuals-refresh');assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
 const input=async(extra={})=>({expected_version:(await list()).version,source_digest:(await list()).source_digest,confirm:true,as_of:'2026-11-09',reference:'synthetic-plinth-fresh-native-review',operation_id:crypto.randomUUID(),codes:refreshCodes(),stored_allocations:storedAllocations(c),...extra})
 const preview=async extra=>{await c.read();return c.ok('/actuals-refresh',await input(extra))}
 return {c,claim,list,input,preview}
}
export async function proveActualsRefresh(f){
 const x=await actualsFixture(f),{c}=x,before=await c.read(),outbound=f.messages.length
 const incomplete=(await x.preview({codes:undefined,stored_allocations:undefined})).record
 assert.equal(incomplete.forecast,null);assert.equal(incomplete.sov,null)
 assert.ok(incomplete.unavailable.some(u=>u.scope==='forecast'));assert.ok(incomplete.unavailable.some(u=>u.scope==='SOV'))
 const prepared=await x.input(),first=(await c.ok('/actuals-refresh',prepared)).record
 assert.equal(first.forecast.final_cents,177000);assert.equal(first.forecast.remaining_cents,177000);assert.equal(first.forecast.margin_cents,123000)
 assert.equal(first.codes[0].open_commitment_cents,100000);assert.equal(first.sov.completed_cents,30000);assert.equal(first.sov.stored_cents,20000);assert.equal(first.sov.current_cents,20000)
 assert.equal(first.sov.retainage.cumulative_withheld_cents,4000);assert.equal(first.sov.retainage.current_net_cents,19000)
 assert.ok(first.sources.some(s=>s.kind==='receipt'&&s.id===c.receipts[0].id&&s.dated_on&&s.revision.length===64))
 let r=await c.api('/jobs/'+c.job.id+'/actuals-refresh/'+first.id);assert.equal(r.status,200)
 const version=c.job.version,replayed=await c.act('/actuals-refresh',prepared);assert.equal(replayed.status,200);assert.equal(replayed.value.record.id,first.id);assert.equal(replayed.value.version,version)
 const mismatch=await c.act('/actuals-refresh',{...prepared,reference:'Different reviewed terms'});assert.equal(mismatch.status,409)
 await c.ok('/orders/'+c.order.id+'/receive',{lines:[{line_id:'lumber',quantity:'2'}],reference:'synthetic-plinth-second-source-receipt',received_on:'2026-11-08'})
 assert.equal((await c.act('/actuals-refresh',prepared)).status,409)
 assert.equal((await c.api('/jobs/'+c.job.id+'/actuals-refresh/'+first.id)).status,409)
 const receipt=(await x.preview()).record
 assert.equal(receipt.codes[0].received_cents,70000);assert.equal(receipt.codes[0].delta.received_cents,20000);assert.equal(receipt.codes[0].delta.actual_cents,0);assert.equal(receipt.codes[0].delta.open_commitment_cents,0)
 const bill=(await c.ok('/costs/bills',c.bill())).record
 await c.ok('/costs/bills/'+bill.id+'/review',{reason:'Reviewed exact original and code discrepancy'})
 const unposted=(await x.preview()).record
 assert.equal(unposted.forecast.final_cents,177000);assert.ok(unposted.sources.some(s=>s.id===bill.id&&s.review_state==='reviewed; unposted'&&s.checksums[0]===bill.document.checksum))
 assert.ok(unposted.unavailable.some(u=>u.scope==='reconciliation'))
 await c.ok('/costs/bills/'+bill.id+'/post')
 assert.equal((await c.act('/actuals-refresh',await x.input())).status,409,'Old commitment assumption cannot double count matched costs')
 const posted=(await x.preview({codes:refreshCodes(60000)})).record
 assert.equal(posted.forecast.final_cents,180000);assert.equal(posted.forecast.margin_cents,120000)
 assert.equal(posted.codes[0].actual_cents,33000);assert.equal(posted.codes[0].open_commitment_cents,60000);assert.equal(posted.codes[0].remaining_cents,127000)
 assert.deepEqual(posted.codes[0].delta,{actual_cents:33000,open_commitment_cents:-40000,received_cents:0,remaining_cents:-40000,margin_cents:7000})
 assert.equal(posted.codes[1].actual_cents,10000);assert.equal(posted.codes[1].delta.margin_cents,-10000)
 const credit={...c.bill('synthetic-plinth-corrected-source'),kind:'credit',credit_of:bill.id,tax:{percent:'10',reference:'Synthetic reviewed source correction',human_reviewed:true,exemption_reference:'Synthetic exemption'},lines:[{...c.bill().lines[0],subtotal_cents:10000,matches:[{order_id:c.order.id,receipt_id:c.receipts[0].id,cost_code:'06-100',amount_cents:10000}]}]}
 const correction=(await c.ok('/costs/bills',credit)).record;await c.ok('/costs/bills/'+correction.id+'/review',{reason:'Supplier corrected original line'});await c.ok('/costs/bills/'+correction.id+'/post')
 const corrected=(await x.preview({codes:refreshCodes(70000)})).record
 assert.equal(corrected.codes[0].actual_cents,22000);assert.equal(corrected.codes[0].open_commitment_cents,70000);assert.equal(corrected.codes[0].delta.actual_cents,-11000);assert.equal(corrected.codes[0].delta.open_commitment_cents,10000);assert.equal(corrected.forecast.final_cents,179000)
 assert.equal(corrected.forecast.margin_cents,121000);assert.ok(corrected.sources.some(s=>s.id===correction.id&&s.kind==='credit'&&s.review_state==='human posted'))
 const unsafe=await x.preview({codes:refreshCodes(70000),stored_allocations:[{...storedAllocations(c)[0],stored_cents:80000},storedAllocations(c)[1]]})
 assert.equal(unsafe.record.sov,null);assert.ok(unsafe.record.unavailable.some(u=>u.scope==='SOV'))
 const completion=await x.preview({codes:refreshCodes(70000),stored_allocations:storedAllocations(c).map(r=>({...r,completed_cents:99999}))})
 assert.equal(completion.record.sov,null,'Receipt preview cannot smuggle new completed work')
 const current=await c.read()
 // Ordinary unapproved daily record is unrelated evidence, never completed work or a time approval.
 await c.ok('/diary',{note:'Synthetic unapproved note says framing complete'})
 const afterLog=(await x.preview({codes:refreshCodes(70000)})).record
 assert.equal(afterLog.sov.completed_cents,30000);assert.deepEqual((await c.read()).claims,before.claims)
 for(const key of ['budgets','schedules','retainage','quotes'])assert.deepEqual((await c.read())[key],before[key])
 assert.deepEqual((await c.api('/jobs/'+c.job.id+'/costs/forecasts')).value.forecasts,[])
 const listed=await x.list();assert.equal(listed.previews.length,9);assert.deepEqual(listed.previews.find(r=>r.id===first.id).forecast,first.forecast);assert.equal(listed.previews.at(-1).stale,false)
 assert.ok(listed.previews.find(r=>r.id===first.id).stale);assert.ok(listed.previews.every(r=>r.review_active))
 assert.equal(f.messages.length,outbound,'All native previews make zero provider calls')
 return x
}
