import assert from 'node:assert/strict'
import {createActiveJob} from './helpers.mjs'
import {recoveryFixture} from './recovery-support.mjs'

/** Continue a partly installed package through the same reviewed recovery door. */
export async function proveRemainingRecovery({c,post}){
 let r=await post('/schedule-actuals',{task_id:c.install,actual_start:'2026-11-02T08:00:00Z',installed:{quantity:'2',unit:'pack',cost_code:'01-100'},evidence:'Two early units installed; eight await delayed material'})
 assert.equal(r.status,200,JSON.stringify(r.value));await c.review()
 const before=await c.read(),row=c.request
 r=await post('/recovery/requests',{source_digest:c.sources.digest,confirm:true,purpose:'Remaining installation after a recorded partial start',as_of:'2026-11-05',package_order_id:row.package_order_id,package_task_id:row.package_task_id,package_cost_code:row.package_cost_code,labor_cost_code:row.labor_cost_code,labor_task_id:row.labor_task_id,share_with_owner_agents:false})
 assert.equal(r.status,200,JSON.stringify(r.value));const path='/recovery/requests/'+r.value.record.id
 r=await post(path+'/compare',{key:'synthetic-plinth-remaining',alternatives:c.alternatives});assert.equal(r.status,200,JSON.stringify(r.value));const proposal=r.value.record
 assert.deepEqual(proposal.alternatives.map(a=>a.schedule.tasks.find(t=>t.id===c.install).start),['2026-11-09T08:00:00.000Z','2026-11-06T08:00:00.000Z'],'Remaining installation follows material arrival, not historical actual start')
 assert.deepEqual(proposal.alternatives.map(a=>a.schedule.completion_after),['2026-11-10T16:00:00.000Z','2026-11-06T16:00:00.000Z'])
 assert.deepEqual(proposal.alternatives.map(a=>[a.labor_capacity.required_minutes,a.labor_capacity.available_minutes,a.native_feasible]),[['960',960,true],['960',960,true]])
 r=await post(path+'/review/'+proposal.id,{digest:proposal.digest,alternative_id:'expedite',decision:'retain',reason:'Keep the feasible remaining-work comparison for separate human decisions'});assert.equal(r.status,200)
 const short=structuredClone(c.alternatives);short[1].schedule.tasks.find(t=>t.id===c.install).duration_minutes=240
 r=await post(path+'/compare',{key:'synthetic-plinth-insufficient-remaining',alternatives:short});assert.equal(r.status,200);const insufficient=r.value.record
 assert.equal(insufficient.alternatives[1].labor_capacity.available_minutes,480);assert.equal(insufficient.alternatives[1].native_feasible,false)
 r=await post(path+'/review/'+insufficient.id,{digest:insufficient.digest,alternative_id:'expedite',decision:'retain',reason:'Past work cannot supply missing remaining crew hours'});assert.equal(r.value.error,'recovery_infeasible')
 const after=await c.read();for(const field of ['schedule_actuals','schedules','orders','budgets','approvals'])assert.deepEqual(after[field],before[field],'Recovery never rewrites recorded progress or native decisions')
 await c.review()
}

/** Erase a booking source after its facts and a conflict were copied elsewhere. */
export async function proveRecoveryBookingErasure(f){
 const {c,post,mcp,token,args}=await recoveryFixture(f),unrelated=c.request.id
 let other=await createActiveJob(f,'Synthetic private booking source',['synthetic-plinth-booking','example.invalid'].join('@'))
 const marker='synthetic-plinth-private-booking-erasure',root='/api/plinth/jobs/'+other.id
 let r=await f.json(root+'/schedules',{method:'POST',cookie:f.owner,body:{expected_version:other.version,trade:'Separate synthetic trade',description:marker,start:'2026-11-09T08:00:00Z',end:'2026-11-10T16:00:00Z',resources:[{resource_id:c.resource.id,units:2}]}})
 assert.equal(r.status,200,JSON.stringify(r.value));other=r.value.job;await c.review()
 const packetPath='/api/plinth/'+c.root+'/recovery/requests/'+c.request.id
 assert.ok(JSON.stringify((await f.json(packetPath,{cookie:f.owner})).value).includes(marker))
 r=await mcp('plinth.recovery.compare',{...args(),key:'synthetic-plinth-erased-booking',alternatives:c.alternatives});assert.ok(r.record,JSON.stringify(r.value));const proposalId=r.record.id
 const stored=(await f.json(packetPath,{cookie:f.owner})).value.record
 assert.ok(stored.proposals.find(p=>p.id===proposalId).alternatives[0].schedule.conflicts.some(conflict=>conflict.job_id===other.id),'Seed an actual derived cross-job resource conflict')
 const policy=await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'approval',approver:['sponsor'],wait:'PT1H'}],spend:{none:true}}}});assert.equal(policy.status,200)
 r=await mcp('plinth.recovery.read',args());const pending=r.value.result,approval=pending._meta['com.runeditrun/approval']
 const reviewed=(await f.json('/agents/api/approvals/'+approval.id,{cookie:f.owner})).value.approval
 r=await f.json('/agents/api/approvals/'+approval.id+'/approve',{method:'POST',cookie:f.owner,body:{revision:reviewed.revision,summary_sha256:reviewed.summary_sha256}});assert.equal(r.value.approval.state,'executed')
 assert.ok(JSON.stringify((await mcp('plinth.recovery.read',args(),token,pending.requestState)).record).includes(marker),'A completed approval contains the private copy before erasure')
 r=await f.json('/api/plinth/holds',{method:'POST',cookie:f.owner,body:{subject_kind:'job',subject_id:c.job.id,kind:'legal_hold',reason:'Preserve reviewed recovery evidence',confirm:true}});assert.equal(r.status,201);const hold=r.value.hold
 r=await f.json(root,{method:'DELETE',cookie:f.owner,body:{expected_version:other.version}});assert.equal(r.status,409);assert.equal(r.value.error,'retention_hold')
 assert.equal((await f.json(packetPath,{cookie:f.owner})).status,200,'A refused erasure preserves the shared evidence')
 assert.equal((await f.json('/api/plinth/holds/'+hold.id+'/release',{method:'POST',cookie:f.owner,body:{reason:'Owner releases the recovery evidence for erasure'}})).status,200)
 const before=await c.read()
 r=await f.json(root,{method:'DELETE',cookie:f.owner,body:{expected_version:other.version}});assert.equal(r.status,200,JSON.stringify(r.value))
 assert.equal((await f.json(root,{cookie:f.owner})).status,404);assert.equal((await f.json(packetPath,{cookie:f.owner})).status,404)
 const after=await c.read();assert.equal(after.version,before.version+1);for(const field of ['schedules','schedule_actuals','orders','budgets','approvals'])assert.deepEqual(after[field],before[field])
 const inventory=await f.json('/api/plinth/'+c.root+'/recovery/requests',{cookie:f.owner})
 assert.ok(inventory.value.requests.some(row=>row.id===unrelated),'Unrelated historical packets survive')
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM agent_door_approvals WHERE id=?').bind(approval.id).first()).n,0,'Erasure removes completed cross-job read approvals')
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM agent_door_calls WHERE key=?').bind('synthetic-plinth-erased-booking').first()).n,0,'Erasure removes autonomous comparison replay handles')
 for(const table of ['pl_jobs','agent_door_approvals']){
  const column=table==='pl_jobs'?'data':'result'
  assert.ok(!(await f.db.prepare(`SELECT ${column} AS data FROM ${table}`).all()).results.some(row=>row.data?.includes(marker)),'Private copies are removed from persisted records')
 }
 assert.equal((await mcp('plinth.recovery.read',args(),token,pending.requestState)).error,'not_found')
 assert.equal((await mcp('plinth.recovery.compare',{...args(),key:'synthetic-plinth-erased-booking',alternatives:c.alternatives})).error,'not_found','Replayed capture cannot recreate erased recovery evidence')
}
