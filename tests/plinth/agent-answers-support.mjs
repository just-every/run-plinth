import assert from 'node:assert/strict'
import { takeoffPlan } from '../fixtures/takeoff-plan.mjs'
import { costFixture } from './cost-support.mjs'
import { createActiveJob } from './helpers.mjs'

export async function questionFixture(f,existing){
 let job=existing??await createActiveJob(f,'Synthetic reviewed question',['synthetic-plinth-question','example.invalid'].join('@'))
 const root='/api/plinth/jobs/'+job.id
 const refresh=async()=>{const r=await f.json(root,{cookie:f.owner});assert.equal(r.status,200);job=r.value.job;return job}
 const post=async(path,body={},cookie=f.owner)=>{await refresh();return f.json(root+path,{method:'POST',cookie,body:{expected_version:job.version,...body}})}
 const ok=async(path,body={})=>{const r=await post(path,body);assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
 const plans=[]
 for(const revision of ['A','B']){
  const value=await ok('/plans',{title:'Completion design '+revision,issue_on:'2026-10-28',sheets:[{number:'A1',revision,kind:'plan',page:1,width:400,height:400,document:{name:'synthetic-plinth-'+revision+'.pdf',mime:'application/pdf',base64:takeoffPlan().toString('base64')}}]})
  const set=value.plans.sets.at(-1),sheet=set.sheets[0]
  await ok('/plans/'+set.id+'/approve',{confirm:true,recipient_ids:[]})
  await ok('/plans/'+set.id+'/annotate',{sheet_id:sheet.id,x:20,y:20,text:revision==='A'?'Recorded original completion November 10':'Recorded revised completion November 17; supplier cause unconfirmed'})
  plans.push({kind:'plan',set_id:set.id,sheet_id:sheet.id})
 }
 const decision=(await ok('/variations',{description:'Proposed window revision; client decision still unresolved',amount_cents:25000})).record
 const refs=[...plans,{kind:'decision',decision_id:decision.id}]
 const make=async(sources=refs)=>{const value=await ok('/agent-answers',{question:'Why did completion move, and which cause remains unresolved?',sources,confirm:true});return value.record}
 const packet=await make()
 const cite=source=>({source_id:source.id,digest:source.digest})
 const analysis={facts:[{text:'Both plan revisions are retained; the decision is still a draft',citations:[cite(packet.sources[2])]}],conflicts:[{text:'November 10 conflicts with November 17; a person must resolve the schedule',citations:packet.sources.slice(0,2).map(cite)}],assumptions:[{text:'Supplier availability may explain the delay; this has not been recorded as a fact',citations:[]}],unresolved:['Which approved native schedule change establishes the new completion?']}
 return {root,packet,refs,analysis,post,ok,refresh,make,get job(){return job}}
}
export async function localMcp(f){
 const token=await f.agent()
 const policy=await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'autonomous'}],spend:{none:true}}}});assert.equal(policy.status,200,JSON.stringify(policy.value))
 let next=0
 const call=async(name,args={},credential=token)=>{
  const response=await f.request('/mcp',{method:'POST',token:credential,headers:{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:{jsonrpc:'2.0',id:++next,method:'tools/call',params:{name,arguments:args}}})
  const wire=await response.json();return {status:response.status,wire,value:wire.result?.structuredContent,error:wire.result?._meta?.['com.runeditrun/error']?.code??wire.error?.data?.code}
 }
 const ok=async(name,args)=>{const r=await call(name,args);assert.equal(r.status,200,JSON.stringify(r.wire));assert.ok(r.value,JSON.stringify(r.wire));return r.value}
 return {token,call,ok}
}

export async function proveQuestionAnswers(f){
 const costs=await costFixture(f)
 const time=(await costs.ok('/costs/sources',{kind:'time',reference:'synthetic-plinth-time',employee_reference:'synthetic-plinth-crew',dated_on:'2026-10-28',period:'2026-10',cost_code:'01-100',minutes:60,hour_cents:3000,burden_bps:1000})).record
 await costs.ok('/costs/sources/'+time.id+'/approve',{})
 const entry=(await costs.ledger()).rows.flatMap(r=>r.sources.actual).find(e=>e.source_id===time.id);assert.equal(entry.amount_cents,3300)
 const q=await questionFixture(f,await costs.read()),bidEmail=['synthetic-plinth-bidder','example.invalid'].join('@'),bidCookie=await f.invite(bidEmail)
 let vendor=(await costs.api('/vendors',{kind:'subcontractor',name:'Synthetic question supplier',trades:['Framing'],contacts:[{id:'synthetic-plinth-contact',name:'Synthetic bidder',email:bidEmail}]})).value.vendor
 let qualified=await costs.api('/vendors/'+vendor.id+'/qualifications',{expected_version:vendor.version,trade:'Framing',status:'qualified',evidence:'Reviewed native qualification'});assert.equal(qualified.status,200);vendor=qualified.value.vendor
 const created=await q.post('/bids',{title:'Private framing bid',trade:'Framing',scope:'Private proposed delivery',mode:'unpriced',lines:[{cost_code:'06-100',description:'Framing package'}],note:'Private reviewed bid original',due_on:'2026-11-01',plans:[{name:'synthetic-plinth-bid.pdf',base64:takeoffPlan().toString('base64')}]});assert.equal(created.status,201)
 const bid=created.value.source.bids[0],revision=bid.revisions[0].id
 await q.ok('/bids/'+bid.id+'/publish',{revision_id:revision,confirm:true})
 const invited=await q.ok('/bids/'+bid.id+'/invite',{vendor_id:vendor.id,contact_id:'synthetic-plinth-contact',pre_award:true,cost_codes:['06-100'],confirm:true})
 const invitation=invited.source.bids[0].invitations[0]
 assert.equal((await q.post('/bids/'+bid.id+'/acknowledge',{revision_id:revision},bidCookie)).status,200)
 assert.equal((await q.post('/bids/'+bid.id+'/respond',{revision_id:revision,items:[{cost_code:'06-100',description:'Private framing price',amount_cents:123456}],exclusions:'Delivery date not confirmed',attachments:[]},bidCookie)).status,200)
 const responded=(await f.json('/api/plinth/bids/'+q.job.id,{cookie:f.owner})).value.source.bids[0].invitations[0].responses[0]
 q.packet=await q.make([...q.refs,{kind:'cost',entry_id:entry.id},{kind:'bid',package_id:bid.id,invitation_id:invitation.id,response_id:responded.id}])
 const mcp=await localMcp(f),args={job_id:q.job.id,packet_id:q.packet.id,packet_digest:q.packet.digest}
 const before=structuredClone(await q.refresh()),messages=f.messages.length
 const listed=await mcp.ok('plinth.answers.read',{job_id:q.job.id});assert.ok(listed.record.packets.some(p=>p.id===q.packet.id))
 const read=await mcp.ok('plinth.answers.read',args)
 assert.equal(read.record.sources.length,5);assert.equal(read.record.sources[3].recorded.amount_cents,3300);assert.equal(read.record.sources[4].recorded.response.total_cents,123456);assert.ok(!JSON.stringify(read.record).includes('hour_cents'));assert.equal(read.record.sources[0].recorded.sheet.revision,'A');assert.equal(read.record.sources[1].recorded.sheet.revision,'B')
 assert.match(read.record.sources[1].recorded.annotations[0].text,/November 17/)
 const original=await f.request(read.record.sources[0].href,{cookie:f.owner});assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),takeoffPlan())
 assert.equal((await q.post('/agent-answers',{question:'Unreviewed',sources:q.refs,confirm:false})).status,400)
 q.analysis.facts[0].citations=[{source_id:q.packet.sources[2].id,digest:q.packet.sources[2].digest}];q.analysis.conflicts[0].citations=q.packet.sources.slice(0,2).map(s=>({source_id:s.id,digest:s.digest}))
 const bad={...q.analysis,facts:[{text:'Fabricated citation',citations:[{source_id:'synthetic-plinth-absent',digest:q.packet.sources[0].digest}]}]}
 assert.equal((await mcp.call('plinth.answers.retain',{...args,analysis:bad,idempotency_key:crypto.randomUUID()})).error,'invalid_citation')
 const wrongDigest=structuredClone(q.analysis);wrongDigest.facts[0].citations[0].digest='0'.repeat(64)
 assert.equal((await mcp.call('plinth.answers.retain',{...args,analysis:wrongDigest,idempotency_key:crypto.randomUUID()})).error,'invalid_citation')
 const cross=await createActiveJob(f,'Other private job',['synthetic-plinth-other','example.invalid'].join('@'))
 assert.equal((await mcp.call('plinth.answers.read',{job_id:cross.id,packet_id:q.packet.id})).error,'not_found')
 assert.equal((await q.post('/agent-answers',{question:'Foreign decision',sources:[{kind:'decision',decision_id:cross.quotes[0].id}],confirm:true})).status,404)
 const retained=await mcp.ok('plinth.answers.retain',{...args,analysis:q.analysis,idempotency_key:crypto.randomUUID()})
 assert.equal(retained.record.conflicts.length,1);assert.equal(retained.record.unresolved.length,1);assert.equal(retained.record.assumptions[0].citations.length,0)
 const second=await mcp.ok('plinth.answers.retain',{...args,analysis:{facts:[],conflicts:[],assumptions:[],unresolved:['No evidence resolves the cause yet']},idempotency_key:crypto.randomUUID()})
 assert.notEqual(retained.record.id,second.record.id)
 let history=await mcp.ok('plinth.answers.read',args);assert.equal(history.record.answers.length,2);assert.deepEqual(history.record.answers[0],retained.record)
 const input={...args,answer_id:retained.record.id,input:{kind:'diary',date:'2026-10-28',note:'Review conflicting completion evidence; confirm the cause with the owner.'},idempotency_key:crypto.randomUUID()}
 const unsafe=await mcp.call('plinth.answers.prepare',{...input,input:{...input.input,approve:true},idempotency_key:crypto.randomUUID()});assert.equal(unsafe.error,'invalid')
 const prepared=await mcp.ok('plinth.answers.prepare',input),replay=await mcp.ok('plinth.answers.prepare',input)
 assert.deepEqual(replay,prepared)
 const differentKey=await mcp.ok('plinth.answers.prepare',{...input,idempotency_key:crypto.randomUUID()});assert.equal(differentKey.record.draft.id,prepared.record.draft.id)
 const current=await q.refresh();assert.equal(current.diary.length,before.diary.length+1);assert.equal(current.diary.at(-1).status,'draft');assert.equal(current.diary.at(-1).prepared_by.role,'agent');assert.deepEqual(current.approvals,before.approvals);assert.deepEqual(current.schedules,before.schedules);assert.deepEqual(current.variations,before.variations);assert.equal(current.agent_answers,undefined,'Generic job responses cannot bypass packet review')
 assert.equal((await f.request(q.root+'/costs',{token:mcp.token})).status,403,'Raw cost doors remain refused')
 const heldPolicy=await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'approval',approver:['sponsor'],wait:'PT1H'}],spend:{none:true}}}});assert.equal(heldPolicy.status,200)
 const heldArgs={...args,analysis:q.analysis,idempotency_key:crypto.randomUUID()},pending=await mcp.call('plinth.answers.retain',heldArgs)
 assert.equal(pending.error,'approval_required')
 const approvalId=pending.wire.result._meta['com.runeditrun/error'].approval.id
 const approvalPath='/agents/api/approvals/'+approvalId,approval=(await f.json(approvalPath,{cookie:f.owner})).value.approval
 assert.equal(approval.summary.target.id,q.packet.id);assert.ok(!JSON.stringify(approval.summary).includes(q.packet.question),'Shared approval summaries reveal no question or source content')
 const approved=await f.json(approvalPath+'/approve',{method:'POST',cookie:f.owner,body:{revision:approval.revision,summary_sha256:approval.summary_sha256}});assert.equal(approved.status,200)
 assert.ok((await mcp.ok('plinth.answers.retain',heldArgs)).record.id)
 const reset=await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'autonomous'}],spend:{none:true}}}});assert.equal(reset.status,200)
 const changed=await q.ok('/plans/'+q.refs[1].set_id+'/annotate',{sheet_id:q.refs[1].sheet_id,x:30,y:30,text:'Owner found a changed source explanation'})
 assert.ok(changed.record.id)
 assert.equal((await mcp.call('plinth.answers.read',args)).error,'packet_stale')
 assert.equal((await mcp.call('plinth.answers.prepare',input)).error,'packet_stale','Cached transport replay rechecks native source authority')
 assert.equal((await mcp.call('plinth.answers.retain',heldArgs)).error,'packet_stale','Completed approval replay cannot return stale packet content')
 const fresh=await q.make(),freshArgs={job_id:q.job.id,packet_id:fresh.id,packet_digest:fresh.digest}
 assert.equal((await q.post('/agent-answers/'+fresh.id+'/revoke',{})).status,200)
 assert.equal((await mcp.call('plinth.answers.read',freshArgs)).error,'packet_revoked')
 const credentialRows=(await f.json('/api/plinth/agent-credentials',{cookie:f.owner})).value.credentials
 for(const credential of credentialRows)assert.equal((await f.request('/api/plinth/agent-credentials/'+credential.id+'/revoke',{method:'POST',cookie:f.owner,body:{}})).status,200)
 assert.equal((await mcp.call('plinth.answers.read',args)).status,401)
 const erased=await q.refresh();assert.equal((await f.request(q.root,{method:'DELETE',cookie:f.owner,body:{expected_version:erased.version}})).status,200)
 assert.equal((await f.request(q.root+'/agent-answers/'+q.packet.id,{cookie:f.owner})).status,404)
 const gone=await f.json(approvalPath,{cookie:f.owner});assert.equal(gone.status,404,'Job erasure removes retained approval payloads')
 const cached=await f.db.prepare("SELECT count(*) AS n FROM agent_door_calls WHERE json_extract(outcome,'$.result.record.id') IN (?,?)").bind(retained.record.id,prepared.record.id).first();assert.equal(cached.n,0,'Erasure removes copied native answer payloads, including completed replay outcomes')
 assert.equal(f.messages.length,messages,'Analysis and draft preparation send no notices or provider requests')
}
