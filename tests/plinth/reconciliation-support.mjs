import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export async function reconciliationRequest(c){
 const packet=(await c.ok('/cost-reconciliation',{as_of:'2026-10-23',reason:'Owner requests pre-draw native cost reconciliation'})).record
 return packet
}
export async function reviewReconciliation(c,packet,findings=packet.findings){
 return c.ok(`/cost-reconciliation/${packet.id}/review`,{digest:packet.digest,confirm:true,finding_ids:findings.map(f=>f.id),reason:'Owner inspected exact cited sources for this request'})
}
export async function mcp(f,token,name,args){
 const response=await f.request('/mcp',{method:'POST',token,headers:{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name},body:{jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:'Native reconciliation journey',version:'1'}}}}})
 const raw=await response.text(),value=raw.startsWith('data:')?JSON.parse(raw.split('\n').find(l=>l.startsWith('data:')).slice(5)):JSON.parse(raw)
 return {status:response.status,value}
}
export async function nativeAgentPolicy(f){
 const result=await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'native-drafts',class:'*',do:'autonomous'}],spend:{none:true}}}})
 assert.equal(result.status,200,JSON.stringify(result.value))
}
export async function archiveCostPacket(c){
 await c.read()
 const packet=await reconciliationRequest(c);await reviewReconciliation(c,packet)
 const proposal=(await c.ok(`/cost-reconciliation/${packet.id}/propose`,{digest:packet.digest})).record
 await c.ok(`/cost-reconciliation/${packet.id}/decide`,{digest:packet.digest,proposal_id:proposal.id,finding_id:proposal.findings[0].id,decision:'rejected',reason:'Owner retains the suggestion without taking its proposed action'})
 return (await c.api(`/jobs/${c.job.id}/cost-reconciliation`)).value.packets.find(p=>p.id===packet.id)
}
export async function proveRestoredCostPacket(f,cookie,jobId,packet){
 const root=`/api/plinth/jobs/${jobId}`,read=await f.json(root+'/cost-reconciliation',{cookie});assert.equal(read.status,200)
 const restored=read.value.packets.find(p=>p.id===packet.id);assert.equal(restored.review_required,true,'Restored history supplies no standing agent consent');assert.deepEqual(restored.decisions,packet.decisions);assert.deepEqual(restored.proposals,packet.proposals)
 const before=await f.json(root+'/costs',{cookie})
 const attempt=await f.json(root+'/cost-reconciliation/'+packet.id+'/propose',{method:'POST',cookie,body:{expected_version:read.value.version,digest:packet.digest}});assert.equal(attempt.status,409)
 assert.equal((await f.json(root+'/cost-reconciliation/'+packet.id+'/reviewed',{cookie})).status,409)
 assert.deepEqual((await f.json(root+'/costs',{cookie})).value,before.value,'Restored packet cannot change native costs')
}
