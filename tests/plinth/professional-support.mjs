import assert from 'node:assert/strict'

export const professionalOriginal = Buffer.from('%PDF-1.7\nsynthetic-plinth-1 accountable professional original\n%%EOF')
export const professionalFiles = [1,2].map(n=>({name:`synthetic-plinth-${n}.pdf`,mime:'application/pdf',base64:professionalOriginal.toString('base64')}))
export async function professionalClient(f, initial) {
 let job=initial
 const root='/api/plinth/jobs/'+job.id, register=root+'/professional-prerequisites'
 const read=async()=>{const r=await f.json(register,{cookie:f.owner});assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
 const refresh=async()=>{job=(await f.json(root,{cookie:f.owner})).value.job}
 const request=async(path,body={},credentials={cookie:f.owner})=>{const r=await f.json(root+path,{method:'POST',...credentials,body:{expected_version:job.version,...body}});if(r.status===200)job=r.value.job;return r}
 const act=async(path,body={},credentials)=>{const r=await request(path,body,credentials);assert.equal(r.status,200,JSON.stringify(r.value));return r.value.record}
 const evidence=async(row,extra={})=>{const view=await read(),current=view.register.find(r=>r.id===row.id);return {reviewer_id:view.person_id,professional:'Synthetic accountable inspector',qualification:'Recorded professional qualification and jurisdiction reference',effective_on:'2020-01-01',expires_on:'2099-12-31',signed:true,attachments:professionalFiles,source_document_id:current.current_source.document?.id,source_checksum:current.current_source.document?.checksum,...extra}}
 const review=async(row,extra={})=>{const e=row.evidence.at(-1);return {evidence_id:e.id,source_document_id:e.source.document.id,source_checksum:e.source.document.checksum,disposition:'approved',reason:'Reviewed exact professional and source originals for the stated work',confirm:true,...extra}}
 return {get job(){return job},root,register,read,refresh,request,act,evidence,review}
}
/** Seeded through native HTTP for the archive sanity journey. No restored approval grants new authority. */
export async function professionalFixture(f,initial) {
 const c=await professionalClient(f,initial)
 const task=await c.act('/schedules',{trade:'Synthetic inspection trade',start:'2031-02-10T08:00:00Z',end:'2031-02-10T09:00:00Z',description:'Synthetic inspected installation'})
 const constraint=await c.act('/schedule-constraints',{kind:'inspection',title:'Synthetic approved inspection',jurisdiction:'Synthetic jurisdiction',accountable:'Synthetic inspector',task_ids:[task.id],action:'requested',reason:'Inspection required before work'})
 await c.act('/schedule-constraints/'+constraint.id,{action:'cleared',reason:'Original inspection result received',documents:[professionalFiles[0]]})
 let row=await c.act('/professional-prerequisites',{title:'Synthetic professional inspection review',source:{kind:'inspection',source_id:constraint.id},task_ids:[task.id],due_on:'2031-02-09'})
 row=await c.act('/professional-prerequisites/'+row.id+'/evidence',await c.evidence(row))
 row=await c.act('/professional-prerequisites/'+row.id+'/review',await c.review(row))
 return {job:c.job,row,task,original:professionalOriginal}
}
