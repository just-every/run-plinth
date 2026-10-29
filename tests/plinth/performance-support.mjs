import assert from 'node:assert/strict'
export const performanceAddress=label=>['synthetic-plinth-'+label,'dev.localhost'].join(String.fromCharCode(64))
/** The same real public-door setup is used by HTTP assertions and the installed reporting journey. */
export async function performanceFixture(f){
 const reviewer=await f.invite(performanceAddress('performance-reviewer'),'Synthetic cost preparer','admin')
 const call=async(path,body,cookie=f.owner)=>{const r=await f.json('/api/plinth'+path,{cookie,...(body===undefined?{}:{method:'POST',body})});assert.ok(r.status===200||r.status===201,JSON.stringify(r));return r.value}
 const catalog=async(kind,name,value)=>(await call('/estimate-catalog',{kind,name,reason:'Reviewed production baseline',value})).entry
 const rate=await catalog('rate','Reviewed framing hour',{vendor:'Native labor schedule',effective_on:'2026-01-01',unit:'hour',cost_cents:3000,sell_cents:6000,reference:'synthetic-plinth-rate-1'})
 const material=await catalog('rate','Reviewed timber unit',{vendor:'Native material schedule',effective_on:'2026-01-01',unit:'each',cost_cents:100,sell_cents:150,reference:'synthetic-plinth-rate-2'})
 const assembly=await catalog('assembly','Wall assembly',{unit:'ft',parts:[{id:'labor',rate_id:rate.id,description:'Wall framing labor',cost_code:'06-100',phase:'Structure',category:'labor',units_per_dimension:'1',productivity:'5',waste_percent:'0'},{id:'timber',rate_id:material.id,description:'Wall timber',cost_code:'06-200',phase:'Structure',category:'material',units_per_dimension:'1',productivity:'1',waste_percent:'0'}]})
 const template=await catalog('template','Wall remodel',{kind:'remodel',dimensions:{walls:'10'},items:[{id:'wall',assembly_id:assembly.id,dimension:'walls'}]})
 const jobs=[]
 for(let i=0;i<4;i++){
  const name=['Maple completed remodel','Cedar completed remodel','Lost remodel proposal','Open remodel proposal'][i]
  let job=(await call('/jobs',{name,client_email:performanceAddress('performance-client'),address:'22 Synthetic Street'})).job
  const read=async()=>job=(await call('/jobs/'+job.id)).job
  const act=async(path,body={},cookie=f.owner)=>{const r=await call(`/jobs/${job.id}`+path,{expected_version:job.version,...body},cookie);await read();return r}
  const report=async(action,body={})=>{const r=await call(`/reports/performance/jobs/${job.id}/${action}`,{expected_version:job.version,...body});await read();return r}
  const dimensions={walls:i===1?'12':'10'},input={template_id:template.id,as_of:'2026-10-20',dimensions}
  const preview=await act('/estimate-template/preview',input);await act('/estimate-template/apply',{...input,digest:preview.preview.digest},i===1?reviewer:f.owner)
  if(i<2){
   await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Native signed proposal '+i,schedule_choice:{kind:'none',reason:'Schedule recorded separately'}})
   await act('/schedules',{trade:'Framing',description:'Frame walls',start:`2026-10-${20+i}T08:00:00Z`,end:`2026-10-${20+i}T12:00:00Z`});const task=job.schedules.at(-1)
   if(task.status==='draft')await act(`/schedules/${task.id}/approve`)
   await act('/schedule-actuals',{task_id:task.id,actual_start:`2026-10-${20+i}T08:00:00Z`,actual_finish:`2026-10-${20+i}T11:00:00Z`,installed:{quantity:dimensions.walls,unit:'ft',cost_code:'06-100'},evidence:'Measured installed wall length '+i})
   const source=await act('/costs/sources',{kind:'time',reference:'synthetic-plinth-approved-time-'+i,employee_reference:'synthetic-plinth-worker-'+i,dated_on:'2026-10-22',period:'2026-10',cost_code:'06-100',minutes:i===0?120:180,hour_cents:3000,burden_bps:0},reviewer)
   await act(`/costs/sources/${source.record.id}/approve`)
   await act('/costs/sources',{kind:'time',reference:'synthetic-plinth-unapproved-time-'+i,employee_reference:'synthetic-plinth-worker-draft',dated_on:'2026-10-22',period:'2026-10',cost_code:'06-100',minutes:600,hour_cents:3000,burden_bps:0},reviewer)
   await report('complete',{completed_on:'2026-10-23',evidence:'Reviewed finished job '+i,confirm:true})
  }else await report('sales',{quote_id:job.quotes.at(-1).id,stage:i===2?'lost':'submitted',reason:i===2?'Client chose another builder':'Client reviewing proposal',evidence:'Native client correspondence '+i,confirm:true})
  jobs.push({get job(){return job},act,report,read})
 }
 return {call,jobs,assembly,template,rate,material,reviewer}
}

/** Public owner review, actual MCP transport, counterfactual arithmetic and immutable human approval. */
export async function learningJourney(f,c,{approve=true}={}){
 const first=c.jobs[0],second=c.jobs[1],root='/api/plinth/agent-learning',sources=[first,second].map(j=>({id:j.job.id,version:j.job.version})),catalog=(await c.call('/estimate-catalog')).entries.find(e=>e.id===c.assembly.id)
 const input={catalog_id:catalog.id,catalog_version:catalog.version,sources},request=(path,body,credentials={cookie:f.owner})=>f.json(root+path,{...credentials,...(body===undefined?{}:{method:'POST',body})})
 const reviewed=await request('/preview',input);assert.equal(reviewed.status,200,JSON.stringify(reviewed.value))
 for(const change of [{sources:[sources[0],sources[0]]},{sources:[sources[0]]},{sources:[sources[0],{id:c.jobs[3].job.id,version:c.jobs[3].job.version}]},{sources:[sources[0],{...sources[1],version:1}]}])assert.ok((await request('/preview',{...input,...change})).status>=400)
 const token=await f.agent(),admin=await f.invite(performanceAddress('learning-admin'),'Learning office','admin')
 assert.equal((await request('/preview',input,{token})).status,403);assert.equal((await request('/preview',input,{cookie:admin})).status,403)
 assert.equal((await request('/packets',{...input,digest:reviewed.value.preview.digest,confirm:false,reason:'Native owner review'})).status,409)
 const consent=await request('/packets',{...input,digest:reviewed.value.preview.digest,confirm:true,reason:'Only these two completed remodels may inform this draft'});assert.equal(consent.status,201,JSON.stringify(consent.value));const packet=consent.value.packet,path='/packets/'+packet.id
 assert.deepEqual(packet.sources.map(s=>s.id),sources.map(s=>s.id));assert.ok([c.jobs[2],c.jobs[3]].every(j=>!JSON.stringify(packet).includes(j.job.id)))
 const histories=[structuredClone(first.job.quotes),structuredClone(second.job.quotes)],costs=await Promise.all([first,second].map(j=>c.call('/jobs/'+j.job.id+'/costs')))
 const outboundCount=f.messages.length
 const packetRows=packet.sources.map(s=>s.performance.rows.find(r=>r.cost_code==='06-100'));assert.deepEqual(packetRows.map(r=>r.actual_units_per_hour),[5,4]);assert.deepEqual(packetRows.map(r=>r.approved_minutes),[120,180]);assert.deepEqual(packetRows.map(r=>r.actual_cost_cents),[6000,9000]);assert.ok(packet.sources.every(s=>s.performance.rows.find(r=>r.cost_code==='06-200').actual_units_per_hour===null))
 const policy=await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'owner-drafts',class:'*',do:'autonomous'}],spend:{none:true}}}});assert.equal(policy.status,200,JSON.stringify(policy.value))
 let sequence=0
 const mcp=async(name,args={},bearer=token)=>{const r=await f.request('/mcp',{method:'POST',token:bearer,headers:{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name},body:{jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name,arguments:args,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{elicitation:{url:{}}},'io.modelcontextprotocol/clientInfo':{name:'Plinth learning journey',version:'1'}}}}});return {status:r.status,value:await r.json()}}
 const read=()=>mcp('plinth.learning.read',{packet_id:packet.id}),readResult=await read();assert.equal(readResult.value.result?.isError,false,JSON.stringify(readResult));assert.equal(readResult.value.result.structuredContent.record.packet.digest,packet.digest)
 const prepareInput={packet_id:packet.id,input:{request_id:'synthetic-plinth-learning-1',reason:'Two completed jobs support a conservative four feet per hour',productivity_percent:-20,rate_percent:0,risk_percent:0},idempotency_key:'synthetic-plinth-learning-mcp-1'}
 const prepared=await mcp('plinth.learning.prepare',prepareInput);assert.equal(prepared.value.result?.isError,false,JSON.stringify(prepared));const draft=prepared.value.result.structuredContent.record
 assert.deepEqual(draft.replay.map(r=>[r.candidate_cost_cents,r.candidate_margin_cents,r.margin_delta_cents]),[[8500,5000,-1500],[10200,6000,-1800]])
 assert.deepEqual(draft.citations.map(c=>[c.job_id,c.source_version,c.quote_id]),packet.sources.map(s=>[s.id,s.version,s.quote_id]));assert.equal(draft.lesson_input.catalog_id,catalog.id)
 assert.deepEqual(draft.replay.map(r=>r.dimensions),[{walls:'10'},{walls:'12'}]);assert.equal(draft.value.parts[0].productivity,'4.00');assert.ok(draft.observations.every(s=>s.rows.some(r=>r.actual_units_per_hour===null)))
 assert.deepEqual((await mcp('plinth.learning.prepare',prepareInput)).value.result.structuredContent.record,draft)
 assert.equal((await request(path+'/drafts',{...prepareInput.input,request_id:'synthetic-plinth-too-large',productivity_percent:-26})).status,400)
 const rates=await request(path+'/drafts',{...prepareInput.input,request_id:'synthetic-plinth-risk',productivity_percent:0,rate_percent:10,risk_percent:10});assert.equal(rates.status,201);assert.deepEqual(rates.value.draft.replay.map(r=>r.candidate_cost_cents),[8470,10164]);assert.equal(rates.value.draft.value.parts[0].units_per_dimension,'1');assert.equal(rates.value.draft.value.parts[0].rate_factor,'1.10')
 const rejection=await request(path+'/drafts/'+rates.value.draft.id+'/reject',{reason:'Owner rejected compounded allowance'});assert.equal(rejection.status,200)
 assert.equal((await c.call('/estimate-catalog')).entries.find(e=>e.id===catalog.id).version,catalog.version)
 assert.deepEqual((await request(path)).value.drafts.find(r=>r.draft.id===rates.value.draft.id).draft,rates.value.draft);assert.equal((await request(path)).value.drafts.find(r=>r.draft.id===rates.value.draft.id).decision.kind,'rejected')
 const templateInput={catalog_id:c.template.id,catalog_version:1,sources},templatePreview=await request('/preview',templateInput)
 const templatePacket=(await request('/packets',{...templateInput,digest:templatePreview.value.preview.digest,confirm:true,reason:'Review template defaults separately'})).value.packet
 const templateDraft=await request('/packets/'+templatePacket.id+'/drafts',{request_id:'synthetic-plinth-template',reason:'Twenty percent more default wall length for future bids',dimension_percent:{walls:20}})
 assert.equal(templateDraft.status,201,JSON.stringify(templateDraft.value));assert.equal(templateDraft.value.draft.value.dimensions.walls,'12.00');assert.deepEqual(templateDraft.value.draft.replay.map(r=>r.candidate_cost_cents),[7000,8400]);assert.deepEqual(templateDraft.value.draft.replay.map(r=>r.dimensions),[{walls:'10'},{walls:'12'}])
 const newBid=c.jobs[3],bidInput={template_id:c.template.id,as_of:'2026-10-20',dimensions:{walls:'10'}};assert.equal((await newBid.act('/estimate-template/preview',bidInput)).preview.proposal.cost_total_cents,7000)
 if(approve){
  const lesson=(await first.report('lessons',{catalog_id:catalog.id,catalog_version:catalog.version,source_job_ids:[first.job.id,second.job.id],reason:'Human reviewed exact agent draft '+draft.id,value:draft.value})).record
  assert.equal((await newBid.act('/estimate-template/preview',bidInput)).preview.proposal.cost_total_cents,7000)
  await first.report('lessons/'+lesson.id+'/approve',{confirm:true});const future=await newBid.act('/estimate-template/preview',bidInput);assert.equal(future.preview.proposal.cost_total_cents,8500);await newBid.act('/estimate-template/apply',{...bidInput,digest:future.preview.digest});assert.equal(newBid.job.quotes.at(-1).cost_total_cents,8500)
  assert.equal((await read()).value.error?.data?.code,'stale_source');assert.equal((await mcp('plinth.learning.prepare',prepareInput)).value.error?.data?.code,'stale_source','A cached MCP result cannot bypass changed-source checks')
  const selected={catalog_id:catalog.id,catalog_version:2,sources:[first,second].map(j=>({id:j.job.id,version:j.job.version}))},reviewedRate=(await request('/preview',selected)).value.preview
  const ratePacket=(await request('/packets',{...selected,digest:reviewedRate.digest,confirm:true,reason:'Current sources and explicit unit-rate review'})).value.packet
  const unitRate=await mcp('plinth.learning.prepare',{packet_id:ratePacket.id,input:{request_id:'synthetic-plinth-unit-rate',reason:'Reviewed unit rates and bounded callback reserve',productivity_percent:0,rate_percent:10,risk_percent:5},idempotency_key:'synthetic-plinth-unit-rate-mcp'})
  assert.equal(unitRate.value.result?.isError,false,JSON.stringify(unitRate));const rateDraft=unitRate.value.result.structuredContent.record
  assert.deepEqual(rateDraft.replay.map(r=>r.candidate_cost_cents),[9818,11781])
  const beforeRate=structuredClone(newBid.job.quotes),rateLesson=(await first.report('lessons',rateDraft.lesson_input)).record
  assert.equal((await newBid.act('/estimate-template/preview',bidInput)).preview.proposal.cost_total_cents,8500)
  await first.report('lessons/'+rateLesson.id+'/approve',{confirm:true})
  const repriced=await newBid.act('/estimate-template/preview',bidInput);assert.equal(repriced.preview.proposal.cost_total_cents,9818);assert.equal(repriced.preview.proposal.lines.find(l=>l.cost_code==='06-100').cost_unit_cents,3300)
  await newBid.act('/estimate-template/apply',{...bidInput,digest:repriced.preview.digest});assert.equal(newBid.job.quotes.at(-1).cost_total_cents,9818)
  for(const quote of beforeRate)assert.deepEqual(newBid.job.quotes.find(q=>q.id===quote.id),{...quote,status:quote.status==='draft'?'superseded':quote.status})
  assert.deepEqual((await request(path)).value.drafts.find(r=>r.draft.id===rates.value.draft.id).draft,rates.value.draft)

 }
 for(let i=0;i<2;i++){await c.jobs[i].read();assert.deepEqual(c.jobs[i].job.quotes,histories[i]);const after=await c.call('/jobs/'+c.jobs[i].job.id+'/costs');assert.deepEqual(after,{...costs[i],version:after.version})}
 assert.equal(f.messages.length,outboundCount,'Analysis and human catalog review cause no provider delivery')
 return {packet,draft,rejected:rates.value.draft,request,mcp,read,prepareInput,token}
}
