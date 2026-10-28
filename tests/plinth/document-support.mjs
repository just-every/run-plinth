import assert from 'node:assert/strict'
import { createActiveJob } from './helpers.mjs'

export const documentOriginal = Buffer.from('%PDF-1.7\nsynthetic-plinth-1 signed original\n%%EOF\n')
export const documentRevision = Buffer.from('%PDF-1.7\nsynthetic-plinth-2 revised original\n%%EOF\n')
export async function documentFixture(f, existing) {
 let job = existing ?? await createActiveJob(f, 'Private document custody', ['synthetic-plinth-doc-client','example.com'].join('@'))
 const root = '/api/plinth/jobs/'+job.id+'/documents'
 const read = async (suffix='') => {const r=await f.json(root+suffix,{cookie:f.owner});assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
 const change = async (tail,body) => {const current=await read(),r=await f.json(root+tail,{method:'POST',cookie:f.owner,body:{expected_version:current.version,...body}});assert.equal(r.status,200,JSON.stringify(r.value));job=(await f.json('/api/plinth/jobs/'+job.id,{cookie:f.owner})).value.job;return r.value.record}
 const folders=[]
 for(const name of ['Contracts','Permits','Warranties'])folders.push(await change('/folders',{name,area:'Documents'}))
 const nested=await change('/folders',{name:'Signed originals',area:'Documents',parent_id:folders[0].id})
 const file=(name,bytes=documentOriginal)=>({name,base64:bytes.toString('base64')})
 const contract=await change('/files',{folder_id:nested.id,name:'Executed construction contract',tags:['signed','construction'],file:file('synthetic-plinth-contract.pdf')})
 const permit=await change('/files',{folder_id:folders[1].id,name:'Building permit',tags:['permit'],file:file('synthetic-plinth-permit.pdf')})
 const warranty=await change('/files',{folder_id:folders[2].id,name:'Plumbing warranty',tags:['closeout'],file:file('synthetic-plinth-warranty.pdf')})
 const revised=await change('/files/'+contract.id+'/versions',{file:file('synthetic-plinth-contract-revised.pdf',documentRevision)})
 const link=await change('/links',{document_id:contract.id,version_id:contract.versions[0].id,kind:'quotes',record_id:job.quotes[0].id})
 const company=async(tail,body)=>{const current=await f.json('/api/plinth/documents',{cookie:f.owner});assert.equal(current.status,200);const r=await f.json('/api/plinth/documents'+tail,{method:'POST',cookie:f.owner,body:{expected_version:current.value.version,...body}});assert.equal(r.status,200,JSON.stringify(r.value));return r.value.record}
 const templates=await company('/folders',{name:'Standard templates',area:'Documents'})
 const template=await company('/files',{folder_id:templates.id,name:'Standard warranty template',tags:['template'],file:file('synthetic-plinth-template.pdf')})
 return {job,root,read,change,folders,nested,contract:revised,permit,warranty,template,link}
}
