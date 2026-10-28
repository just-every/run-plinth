import assert from 'node:assert/strict'
import {handoverDocument} from '../fixtures/handover-document.mjs'

export const surveyAddress=n=>'synthetic-plinth-'+n+String.fromCharCode(64)+'example.test'
export const surveySettings={title:'Synthetic Plinth closeout survey',questions:['How was communication?','How was workmanship?'],low_score:6,review_url:'https://g.page/r/synthetic-plinth-401/review'}
/** Builds a real handover through the native public doors; shared by HTTP and installed journeys. */
export async function surveyJob(f,name,email,client) {
 const call=(path,body,cookie=f.owner,method='POST')=>f.json('/api/plinth'+path,{cookie,...(body===undefined?{}:{method,body})})
 let r=await call('/jobs',{name,client_email:email,address:'Synthetic Plinth site'});assert.equal(r.status,201,JSON.stringify(r.value));let job=r.value.job
 const read=async()=>{const r=await call('/jobs/'+job.id);assert.equal(r.status,200);job=r.value.job;return job}
 const act=async(path,body={},cookie=f.owner)=>{await read();return call('/jobs/'+job.id+path,{expected_version:job.version,...body},cookie)}
 const ok=async(path,body={},cookie=f.owner)=>{const r=await act(path,body,cookie);assert.equal(r.status,200,JSON.stringify(r.value));return r.value.record??r.value}
 await ok('/quotes',{lines:[{description:'Synthetic signed remodel',quantity:1,unit_cents:1000000}]});await read()
 await ok('/quotes/'+job.quotes[0].id+'/accept',{method:'signed',evidence:'Synthetic client signed scope',schedule_choice:{kind:'none',reason:'Schedule managed separately'}})
 const document=await ok('/handover/documents',{title:'Synthetic handover manual',kind:'manual',tags:['handover'],reference:'Synthetic original manual',file:{name:'synthetic-plinth-401.pdf',mime:'application/pdf',base64:handoverDocument('manual',1).toString('base64')}})
 const pkg=await ok('/handover/packages',{title:name+' closeout',documents:[{document_id:document.id,revision_id:document.revisions[0].id}]})
 await ok('/handover/packages/'+pkg.id+'/complete',{digest:pkg.digest,confirm:true,client_safe:true,statement:'Builder completed the reviewed works'})
 await ok('/handover/packages/'+pkg.id+'/accept',{digest:pkg.digest,confirm:true,exception_ids:[],statement:'Client accepts this exact handover'},client)
 return {get job(){return job},read,act,ok,source:{source_kind:'handover',source_id:pkg.id},call,survey:async()=>{const r=await call('/jobs/'+job.id+'/satisfaction');assert.equal(r.status,200);return r.value}}
}
