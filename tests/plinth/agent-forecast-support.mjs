import assert from 'node:assert/strict'

export async function reviewForecast(c,overrides={}){
 await c.read()
 const available=(await c.api(`/jobs/${c.job.id}/agent-forecasts/sources`)).value
 return c.ok('/agent-forecasts',{as_of:'2026-10-21',due_on:'2026-11-01',reference:'synthetic-plinth-forecast reviewed native facts',sources:available.sources.map(s=>({key:s.key,revision:s.revision,as_of:'2026-10-21',valid_until:'2026-10-31'})),...overrides})
}
export function forecastCodes(){return [{cost_code:'06-100',remaining_quantity:'50',minutes_per_unit:'24',labor_hour_cents:3000,outstanding_commitment_cents:60000,unbought_cents:5000,risk_cents:2000,reference:'synthetic-plinth-1 dated labor assumption; measured elapsed productivity is not crew time'},{cost_code:'01-100',remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:0,outstanding_commitment_cents:0,unbought_cents:10000,risk_cents:0,reference:'synthetic-plinth-2 separate remaining labor package'}]}
export async function proveAgentForecast(f,c){
 const frame='frame'+c.job.id.replaceAll('-',''),finish='finish'+c.job.id.replaceAll('-','')
 const plan={calendar:{weekdays:[0,1,2,3,4,5,6],start_hour:8,end_hour:16,holidays:[]},tasks:[{id:frame,trade:'Synthetic framing',description:'Measured framing',owner:'Owner',start:'2026-10-19T08:00:00Z',duration_minutes:1500,predecessors:[]},{id:finish,trade:'Synthetic finish',description:'Delayed package install',owner:'Owner',start:'2026-10-19T08:00:00Z',duration_minutes:480,predecessors:[{id:frame,lag_minutes:0}]}]}
 const preview=await c.ok('/schedule/preview',plan);await c.ok('/schedule/publish',{...plan,digest:preview.preview.digest})
 await c.ok('/schedule-actuals',{task_id:frame,actual_start:'2026-10-19T08:00:00Z',installed:{quantity:'50',unit:'unit',cost_code:'06-100'},evidence:'synthetic-plinth-50 measured units at observation time'})
 await c.ok(`/orders/${c.order.id}/promise`,{promised_on:'2026-10-26',reason:'synthetic-plinth-3 delayed delivery promise; not receipt'})
 const current=await c.read(),economics=structuredClone({budgets:current.budgets,schedules:current.schedules,orders:current.orders,approvals:current.approvals})
 const input={observed_at:'2026-10-21T12:00:00Z',codes:forecastCodes(),production:[{task_id:frame,total_quantity:'100',unit:'unit'}],deliveries:[{task_id:finish,order_id:c.order.id}]}
 const first=(await reviewForecast(c,input)).record,native=first.forecast.native_cost,dates=first.forecast.schedule
 assert.equal(native.remaining_cents,137000);assert.equal(native.final_cents,180000);assert.equal(native.margin_cents,120000)
 assert.equal(dates.production[0].elapsed_minutes,1200);assert.equal(dates.production[0].minutes_per_unit,'24.000');assert.equal(dates.production[0].remaining_quantity,'50.000');assert.equal(dates.production[0].remaining_minutes,1200)
 assert.equal(dates.completion_before,'2026-10-23T09:00:00.000Z');assert.equal(dates.completion_after,'2026-10-26T16:00:00.000Z')
 assert.equal(first.forecast.accounting_actual_cents,null);assert.equal(first.forecast.complete_margin_cents,null);assert.ok(first.uncertainties.some(u=>u.source==='accounting'&&u.owner_id===current.created_by.id))
 assert.ok(first.sources.some(s=>s.key==='budget'&&s.facts.id===current.budgets.at(-1).id));assert.ok(first.sources.every(s=>s.id.startsWith(current.id)&&s.revision.length===64))
 const policy=await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'autonomous'}],spend:{none:true}}}});assert.equal(policy.status,200,JSON.stringify(policy.value))
 const token=await f.agent(),outbound=f.messages.length;let sequence=0
 const mcp=async(name,args,options={})=>{const r=await f.json('/mcp',{method:'POST',token,headers:{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name},body:{jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name,arguments:args,...options,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{elicitation:{url:{}}}}}}});assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
 const args={job_id:current.id,request_id:first.id},read=await mcp('plinth.forecast.read',args)
 assert.ok(!read.result.isError,JSON.stringify(read));assert.deepEqual(read.result.structuredContent.record,first)
 let prepareKey=crypto.randomUUID()
 const prepared=await mcp('plinth.forecast.prepare',{...args,packet_digest:first.digest,idempotency_key:prepareKey})
 assert.ok(!prepared.result.isError,JSON.stringify(prepared));const proposal=prepared.result.structuredContent.record
 assert.deepEqual(proposal.packet,first);assert.equal(proposal.prepared_by.role,'agent');await c.read()
 const replay=await mcp('plinth.forecast.prepare',{...args,packet_digest:first.digest,idempotency_key:crypto.randomUUID()});assert.equal(replay.result.structuredContent.record.id,proposal.id);await c.read()
 assert.equal((await c.api(`/jobs/${current.id}/agent-forecasts`)).value.proposals.length,1)
 assert.equal((await c.api(`/jobs/${current.id}/costs`,undefined,undefined,token)).status,403,'Packet review never opens raw costs to an agent')
 const withheld=(await reviewForecast(c,{sources:[],reference:'synthetic-plinth-withheld'})).record
 assert.equal(withheld.sources.length,0);assert.equal(withheld.forecast.native_cost,null);assert.equal(withheld.forecast.schedule,null);assert.ok(withheld.uncertainties.some(u=>u.source==='ledger'&&u.state==='withheld'))
 const sourceList=(await c.api(`/jobs/${current.id}/agent-forecasts/sources`)).value.sources
 const stale=(await reviewForecast(c,{sources:sourceList.filter(s=>s.key==='ledger').map(s=>({key:s.key,revision:s.revision,as_of:'2026-10-01',valid_until:'2026-10-20'}))})).record
 assert.ok(stale.uncertainties.some(u=>u.source==='ledger'&&u.state==='stale'));assert.equal(stale.forecast.native_cost,null)
 const secondInput=structuredClone(input);secondInput.codes[0].minutes_per_unit='30';secondInput.codes[0].unbought_cents=8000
 const second=(await reviewForecast(c,secondInput)).record;assert.equal(second.forecast.native_cost.final_cents,198000);assert.equal(second.forecast.native_cost.margin_cents,102000);assert.ok(second.uncertainties.some(u=>u.source==='productivity:'+frame&&u.state==='unverified'),'Conflicting labor assumptions remain assigned uncertainty')
 await c.ok(`/agent-forecasts/${second.id}/revoke`)
 assert.ok((await mcp('plinth.forecast.prepare',{job_id:current.id,request_id:second.id,packet_digest:second.digest,idempotency_key:crypto.randomUUID()})).result.isError)
 const protectedRequest=(await reviewForecast(c,{...input,reference:'Synthetic SSN 123-45-6789'})).record,protectedArgs={job_id:current.id,request_id:protectedRequest.id}
 const held={schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'approval',approver:['sponsor'],wait:'PT1H'},{id:'standard',class:'standard',do:'review'}],reviewers:['sponsor'],spend:{none:true}}
 assert.equal((await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:held}})).status,200)
 assert.ok((await mcp('plinth.forecast.prepare',{...args,packet_digest:first.digest,idempotency_key:prepareKey})).result.isError,'Changed policy cannot replay private forecast contents from a prior decision')
 const pending=await mcp('plinth.forecast.read',protectedArgs),handle=pending.result._meta['com.runeditrun/approval']
 assert.equal(pending.result.resultType,'input_required');assert.ok(!JSON.stringify(pending).includes('123-45-6789'))
 const approval=(await f.json('/agents/api/approvals/'+handle.id,{cookie:f.owner})).value.approval
 const approved=await f.json('/agents/api/approvals/'+handle.id+'/approve',{method:'POST',cookie:f.owner,body:{revision:approval.revision,summary_sha256:approval.summary_sha256}});assert.equal(approved.status,200,JSON.stringify(approved.value))
 const authorized=await mcp('plinth.forecast.read',protectedArgs,{requestState:pending.result.requestState});assert.equal(authorized.result.structuredContent.record.id,protectedRequest.id)
 await c.ok('/agent-forecasts/'+protectedRequest.id+'/revoke')
 const revokedReplay=await mcp('plinth.forecast.read',protectedArgs,{requestState:pending.result.requestState});assert.ok(revokedReplay.result.isError);assert.ok(!JSON.stringify(revokedReplay).includes('123-45-6789'),'Revocation closes an approved read receipt too')
 assert.equal((await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'autonomous'}],spend:{none:true}}}})).status,200)
 prepareKey=crypto.randomUUID();assert.ok(!(await mcp('plinth.forecast.prepare',{...args,packet_digest:first.digest,idempotency_key:prepareKey})).result.isError)
 await c.ok(`/orders/${c.order.id}/promise`,{promised_on:'2026-10-27',reason:'synthetic-plinth-4 new vendor promise'})
 assert.ok((await mcp('plinth.forecast.read',args)).result.isError,'Changed native sources invalidate the reviewed packet')
 assert.ok((await mcp('plinth.forecast.prepare',{...args,packet_digest:first.digest,idempotency_key:prepareKey})).result.isError,'A cached MCP reply must not disclose a packet after its sources change')
 const list=(await c.api(`/jobs/${current.id}/agent-forecasts`)).value
 assert.deepEqual(list.proposals[0].packet,first);assert.ok(list.requests.find(r=>r.id===first.id).stale_sources.includes('procurement'))
 assert.equal((await c.act('/agent-forecasts',{sources:[]},undefined,token)).status,403)
 const after=await c.read();assert.deepEqual(after.budgets,economics.budgets);assert.deepEqual(after.schedules,economics.schedules);assert.equal(after.orders[0].amount_cents,economics.orders[0].amount_cents);assert.deepEqual(after.approvals.filter(a=>!a.kind.startsWith('purchase_order.promise')),economics.approvals.filter(a=>!a.kind.startsWith('purchase_order.promise')))
 assert.equal(f.messages.length,outbound,'Forecast review, preparation and replay cause no outbound delivery')
 assert.equal(after.agent_forecasts,undefined,'Generic projections never expose reviewed private packets')
 const erased=await f.request('/api/plinth/jobs/'+current.id,{method:'DELETE',cookie:f.owner,body:{expected_version:after.version}});assert.equal(erased.status,200)
 assert.ok((await mcp('plinth.forecast.prepare',{...args,packet_digest:first.digest,idempotency_key:prepareKey})).result.isError,'An erased forecast cannot be reconstructed by replaying its cached preparation')
 assert.equal((await c.api('/jobs/'+current.id+'/agent-forecasts')).status,404)
 const credentials=(await c.api('/agent-credentials')).value.credentials
 for(const credential of credentials)assert.equal((await c.api(`/agent-credentials/${credential.id}/revoke`,{})).status,200)
 assert.equal((await f.request('/mcp',{method:'POST',token,headers:{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/list'},body:{jsonrpc:'2.0',id:++sequence,method:'tools/list',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}}}})).status,401)
 return first
}

export async function proveForecastAuthority(f,job,client,other,token){
 const root='/api/plinth/jobs/'+job.id+'/agent-forecasts',available=await f.json(root+'/sources',{cookie:f.owner})
 assert.equal(available.status,200);const source=available.value.sources.find(s=>s.key==='estimate')
 const input={expected_version:job.version,as_of:'2026-10-21',due_on:'2026-11-01',reference:'synthetic-plinth-private-review',sources:[{key:source.key,revision:source.revision,as_of:'2026-10-21',valid_until:'2026-11-01'}]}
 for(const credentials of [{cookie:client},{cookie:other},{token}]){
  assert.equal((await f.request(root+'/sources',credentials)).status,403)
  assert.equal((await f.request(root,{method:'POST',body:input,...credentials})).status,403)
 }
 const reviewed=await f.json(root,{method:'POST',cookie:f.owner,body:input});assert.equal(reviewed.status,200,JSON.stringify(reviewed.value));job={...job,version:reviewed.value.version}
 const request=reviewed.value.record
 for(const credentials of [{cookie:client},{cookie:other},{token}])assert.equal((await f.request(root+'/'+request.id,credentials)).status,403)
 const published=await f.json('/api/plinth/jobs/'+job.id,{cookie:client});assert.equal(published.status,200);assert.ok(!JSON.stringify(published.value).includes(input.reference))
 const wrong=await f.json(root,{method:'POST',cookie:f.owner,body:{...input,expected_version:job.version,sources:[{...input.sources[0],revision:'0'.repeat(64)}]}});assert.equal(wrong.status,409)
 assert.equal((await f.json('/api/plinth/jobs/'+job.id,{cookie:f.owner})).value.job.version,job.version,'Invalid review and unauthorized calls leave no partial packet or business write')
 return {job,request}
}
