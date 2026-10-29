import assert from 'node:assert/strict'
import {recoveryNative} from '../fixtures/recovery-native.mjs'
import {createFixture} from './helpers.mjs'
export async function recoveryFixture(f,options={}){
 const call=async(path,body,method='POST')=>{const r=await f.json('/api/plinth/'+path,{method,cookie:f.owner,...(method==='GET'?{}:{body})});assert.equal(r.status,['jobs','resources','pricing-rates'].includes(path)?201:200,JSON.stringify(r.value));return r.value}
 const c=await recoveryNative(call,{name:'Private recovery case',client:['synthetic-plinth-client','example.invalid'].join('@'),...options})
 const post=async(path,body={},auth={cookie:f.owner})=>{const job=await c.read();const result=await f.json('/api/plinth/'+c.root+path,{method:'POST',...auth,body:{expected_version:job.version,...body}});await c.read();return result}
 const policy=await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'autonomous'}],spend:{none:true}}}});assert.equal(policy.status,200,JSON.stringify(policy.value))
 const token=await f.agent();let id=0
 const mcp=async(name,args,credential=token,requestState)=>{
  const response=await f.request('/mcp',{method:'POST',token:credential,headers:{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name},body:{jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,...(requestState?{requestState}:{}),_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{elicitation:{url:{}}}},arguments:{...(name==='plinth.recovery.compare'?{idempotency_key:args.key}:{}),...args}}}})
  const value=await response.json();return {status:response.status,value,record:value.result?.structuredContent?.record,error:value.result?._meta?.['com.runeditrun/error']?.code??value.error?.data?.code}
 }
 return {c,call,post,mcp,token,args:()=>({job_id:c.job.id,request_id:c.request.id})}
}

/** A real CLI-restored packet is historical evidence, never restored agent consent. */
export async function proveRecoveredPackets(destination,oldCookie,expected){
 const f=await createFixture({persistTo:destination,ownerCookie:oldCookie})
 try{
  assert.equal((await f.request('/api/plinth/jobs/'+expected.job.id+'/recovery/requests',{cookie:oldCookie})).status,401)
  assert.equal((await f.request('/auth/magic-link',{method:'POST',body:{email:['builder','example.com'].join('@')}})).status,202)
  const link=f.messages.at(-1).text.match(/https?:\/\/[^\s<>]+/g).map(s=>new URL(s)).find(u=>u.pathname==='/auth/confirm')
  const signed=await f.request('/auth/confirm',{method:'POST',body:{token:link.searchParams.get('token')}});assert.equal(signed.status,303)
  const owner=signed.headers.get('set-cookie').split(';')[0],root='/api/plinth/jobs/'+expected.job.id
  const api=(path,body)=>f.json(root+path,{cookie:owner,...(body?{method:'POST',body}:{})})
  let r=await api('/recovery/requests/'+expected.request.id);assert.equal(r.status,200);assert.equal(r.value.stale,true,'Restore changes native authority generation even at the same origin')
  assert.deepEqual(r.value.record,expected.request,'Immutable rejected alternatives survive the real archive')
  let job=(await api('')).value.job
  r=await api('/recovery/requests/'+expected.request.id+'/compare',{expected_version:job.version,key:'restored-old-consent',alternatives:expected.alternatives});assert.equal(r.value.error,'recovery_stale')
  const sources=(await api('/recovery/sources')).value
  r=await api('/recovery/requests',{expected_version:job.version,source_digest:sources.digest,confirm:true,purpose:'Destination owner explicitly reviews restored native facts',as_of:'2026-10-29',package_order_id:expected.request.package_order_id,package_task_id:expected.request.package_task_id,package_cost_code:expected.request.package_cost_code,labor_cost_code:expected.request.labor_cost_code,share_with_owner_agents:false})
  assert.equal(r.status,200);assert.notEqual(r.value.record.id,expected.request.id);const fresh=r.value.record
  const messages=f.messages.length
  r=await api('/recovery/requests/'+fresh.id+'/compare',{expected_version:r.value.version,key:'destination-review',alternatives:expected.alternatives});assert.equal(r.status,200);assert.equal(r.value.record.alternatives[0].forecast.final_cents,256000)
  const after=(await api('')).value.job;assert.deepEqual(after.schedules,expected.job.schedules);assert.deepEqual(after.orders,expected.job.orders);assert.equal(f.messages.length,messages)
 }finally{await f.close()}
}
