import assert from 'node:assert/strict'
import {createActiveJob} from './helpers.mjs'
import {handoverDocument} from '../fixtures/handover-document.mjs'

export const closeoutAddress = tag => ['synthetic-plinth-closeout-' + tag, 'example.test'].join('@')
export const closeoutPhoto = {name:'synthetic-plinth-closeout.png',mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='}
export async function closeoutFixture(f, initialJob) {
 let job = initialJob ?? await createActiveJob(f, 'Closeout evidence house', closeoutAddress('client'))
 const root = '/api/plinth/jobs/' + job.id
 const read = async () => {const r=await f.json(root,{cookie:f.owner});assert.equal(r.status,200);job=r.value.job;return job}
 const act = async (path,body={},cookie=f.owner,token) => {await read();const r=await f.json(root+path,{method:'POST',cookie,token,body:{expected_version:job.version,...body}});await read();return r}
 const ok = async (path,body={},cookie=f.owner) => {const r=await act(path,body,cookie);assert.equal(r.status,200,JSON.stringify(r.value));return r.value.record}
 const document = async (kind,title,prior) => ok('/handover/documents'+(prior?'/'+prior.id:''),{kind,title,reference:title+' exact source '+(prior?2:1),file:{name:'synthetic-plinth-'+kind+'.pdf',mime:'application/pdf',base64:handoverDocument(title,prior?2:1).toString('base64')}})
 const spec = await document('selection','Window specification'), inspection = await document('inspection','Human inspection record')
 const packageSource = await ok('/handover/packages',{title:'Retained private handover source',documents:[{document_id:spec.id,revision_id:spec.revisions[0].id},{document_id:inspection.id,revision_id:inspection.revisions[0].id}]})
 const diary = await ok('/diary',{date:'2026-10-29',note:'Original repair location photograph',attachments:[closeoutPhoto]})
 const issue = await ok('/punch/issues',{title:'Reopened leaking window',description:'Leak still needs a qualified inspection after repair',due_on:'2026-11-04',location:'Kitchen west wall',photo:closeoutPhoto,annotation:{x:.2,y:.4,note:'Visible joint gap'}})
 const list = () => f.json(root+'/agent-closeout',{cookie:f.owner})
 const sourceKeys = ['document:'+spec.revisions[0].id,'document:'+inspection.revisions[0].id,'photo:'+diary.attachments[0].id,'punch:'+issue.id,'package:'+packageSource.id]
 const requirements = [
  {id:'manual',kind:'manual',title:'Window operating manual required by the signed specification',source_keys:[],proposed_owner:'Window supplier',reason:'Recorded closeout requirement from builder checklist'},
  {id:'specification',kind:'specification',title:'Exact signed window specification',source_keys:[sourceKeys[0]],proposed_owner:'Builder',reason:'Recorded specification requirement'},
  {id:'inspection',kind:'inspection',title:'Retain the human inspection original',source_keys:[sourceKeys[1]],proposed_owner:'Qualified inspector',reason:'Recorded inspection evidence requirement; no certification inferred'},
  {id:'photo',kind:'photo',title:'Retain the original defect photograph',source_keys:[sourceKeys[2]],proposed_owner:'Builder',reason:'Recorded site evidence requirement'},
  {id:'repair',kind:'punch',title:'Repair and qualified builder inspection remain owed',source_keys:[sourceKeys[3]],proposed_owner:'Window trade',reason:'Reopened punch observation'},
  {id:'package',kind:'package',title:'Retain the exact earlier private handover package',source_keys:[sourceKeys[4]],proposed_owner:'Builder',reason:'Recorded immutable package source; later repair evidence is separate'},
 ]
 const capture = (extra={}) => ok('/agent-closeout',{title:'Private closeout comparison',source_keys:sourceKeys,requirements,...extra})
 const review = packet => ok('/agent-closeout/'+packet.id+'/review',{digest:packet.digest,confirm:true,statement:'I reviewed these exact private facts and consent to bounded follow-up drafting only'})
 const draft = packet => ({digest:packet.digest,request_id:'synthetic-plinth-request-1',kind:'visit',requirement_ids:['manual','repair'],proposed_owner:'Window trade',message:'Please supply the exact manual and propose a repair inspection visit. This is an unsent draft.',proposed_window:'Weekday morning, subject to separate human booking'})
 return {get job(){return job},root,read,act,ok,document,list,sourceKeys,requirements,capture,review,draft,spec,inspection,diary,issue,packageSource}
}

export async function closeoutMcp(f,token) {
 const policy={schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'autonomous'}],spend:{none:true}}
 const saved=await f.json('/agents/api/policy',{method:'PUT',cookie:f.owner,body:{document:policy}});assert.equal(saved.status,200,JSON.stringify(saved.value))
 let id=0
 return async (name,args,options={}) => {
  const response=await f.request('/mcp',{method:'POST',token,headers:{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name},body:{jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,...options,arguments:{...args,...(name==='plinth.closeout.followup'?{idempotency_key:args.idempotency_key??crypto.randomUUID()}:{} )},_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}}}})
  const raw=await response.text(),value=raw.startsWith('event:')||raw.startsWith('data:')?JSON.parse(raw.split('\n').find(line=>line.startsWith('data:')).slice(5)):JSON.parse(raw)
  return {status:response.status,value,result:value.result?.structuredContent,error:value.result?._meta?.['com.runeditrun/error']??value.error?.data??value.error}
 }
}
