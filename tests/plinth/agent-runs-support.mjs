import assert from 'node:assert/strict'
let rpcSequence=0
export const runAddress=label=>['synthetic-plinth-'+label,'dev.localhost'].join(String.fromCharCode(64))
export const runApi=(f,path,body,cookie=f.owner)=>f.json('/api/plinth/agent-runs'+path,{cookie,...(body===undefined?{}:{method:'POST',body})})
export async function runMcp(f,token,name,args={}){
 const response=await f.request('/mcp',{method:'POST',token,headers:{Accept:'application\u002fjson, text\u002fevent-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools\u002fcall','Mcp-Name':name},body:{jsonrpc:'2.0',id:++rpcSequence,method:'tools\u002fcall',params:{name,arguments:{...args,...(name==='plinth.runs.continue'&&!args.idempotency_key?{idempotency_key:'synthetic-plinth-run-call-'+rpcSequence}:{})},_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{elicitation:{url:{}}},'io.modelcontextprotocol/clientInfo':{name:'Plinth run journey',version:'1'}}}}})
 return {status:response.status,value:await response.json()}
}
export async function runPolicy(f){
 const result=await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'owner-drafts',class:'*',do:'autonomous'}],spend:{none:true}}}})
 assert.equal(result.status,200,JSON.stringify(result.value))
}
export async function approvedRun(f,job,{limits={max_tool_calls:3,max_payload_bytes:65536},steps=[{tool:'plinth.jobs.get'},{tool:'plinth.diary.prepare',input:{date:'2026-10-29',note:'Owner-reviewed private forecast review; missing provider costs stay unknown.'}},{tool:'plinth.jobs.get'}],diary_ids=job.diary.map(d=>d.id)}={}){
 const input={job_id:job.id,expected_job_version:job.version,diary_ids,steps,limits}
 const preview=await runApi(f,'/preview',input);assert.equal(preview.status,200,JSON.stringify(preview.value))
 const created=await runApi(f,'',{...input,digest:preview.value.preview.digest,confirm:true,reason:'Owner reviewed exact source packet, fixed native tools and bounded payload'})
 assert.equal(created.status,201,JSON.stringify(created.value))
 return {run:created.value.run,input,preview:preview.value.preview}
}
export const runRecord=r=>{assert.equal(r.value.result?.isError,false,JSON.stringify(r));return r.value.result.structuredContent.record}
export const runRefused=r=>{assert.ok(r.status!==200||r.value.error||r.value.result?.isError,JSON.stringify(r));return r}
export async function runCredential(f,cookie=f.owner){
 const step=await f.request('/auth/step-up',{method:'POST',cookie,body:{action:'credentials:mint',returnTo:'/app'}});assert.equal(step.status,202)
 const link=f.messages.at(-1).text.match(/https?:\/\/[^\s<>]+/g).map(raw=>new URL(raw)).find(url=>url.pathname==='/auth/confirm')
 assert.ok(link)
 const confirmed=await f.request('/auth/confirm',{method:'POST',cookie,body:{token:link.searchParams.get('token')}});assert.equal(confirmed.status,303)
 const created=await f.json('/api/plinth/agent-credentials',{method:'POST',cookie,body:{expires_in_seconds:3600}});assert.equal(created.status,201)
 return created.value.credential.token
}
export async function recoveredRun(f,cookie,expected){
 const owner=f.owner;f.owner=cookie
 try{
  const path='/'+expected.run.id,before=f.messages.length,read=await runApi(f,path)
  assert.equal(read.status,200);assert.equal(read.value.record.run.state,'review_required')
  assert.deepEqual(read.value.record.plan.packet,expected.preview.packet)
  assert.equal(read.value.record.run.next_sequence,1)
  const token=await runCredential(f,cookie);await runPolicy(f);const afterSignIn=f.messages.length
  runRefused(await runMcp(f,token,'plinth.runs.read',{run_id:expected.run.id}))
  runRefused(await runMcp(f,token,'plinth.runs.continue',{run_id:expected.run.id,sequence:1}))
  assert.equal((await runApi(f,path+'/review',{expected_version:read.value.record.run.version,confirm:true,digest:expected.run.digest})).status,409,'Archived digest alone is not destination-owner preview')
  const preview=await runApi(f,path+'/preview');assert.equal(preview.status,200)
  const accepted=await runApi(f,path+'/review',{expected_version:read.value.record.run.version,confirm:true,digest:preview.value.preview.digest});assert.equal(accepted.status,200)
  const requests=await Promise.all([0,1].map(()=>runMcp(f,token,'plinth.runs.continue',{run_id:expected.run.id,sequence:1})))
  const succeeded=requests.filter(r=>r.value.result?.isError===false);assert.ok(succeeded.length>=1,JSON.stringify(requests))
  const one=runRecord(succeeded[0]).checkpoint
  const replay=runRecord(await runMcp(f,token,'plinth.runs.continue',{run_id:expected.run.id,sequence:1}))
  assert.equal(replay.checkpoint.draft_id,one.draft_id)
  const job=(await f.json('/api/plinth/jobs/'+expected.run.job_id,{cookie})).value.job
  assert.equal(job.diary.filter(d=>d.id===one.draft_id).length,1);assert.equal(job.diary.find(d=>d.id===one.draft_id).status,'draft')
  assert.equal(f.messages.length,afterSignIn,'Destination approval and checkpoint replay send no notice')
  assert.ok(afterSignIn>=before)
 }finally{f.owner=owner}
}
