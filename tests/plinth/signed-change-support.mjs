import assert from 'node:assert/strict'
export const changeAddress = n => 'synthetic-plinth-'+n+String.fromCharCode(64)+'dev.localhost'
/** A real accepted priced job, native signers and booked work; shared by HTTP, CLI and installed journeys. */
export async function signedChangeFixture(f, {clientEmail=changeAddress('change-client'),clientCookie,tag='window',allowance=0}={}) {
 const client=clientCookie??await f.invite(clientEmail,'Synthetic change client')
 const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{cookie,token,...(body===undefined?{}:{method:'POST',body})})
 let r=await api('/jobs',{name:'Added window '+tag,client_email:clientEmail,address:'123 Synthetic Street'});assert.equal(r.status,201,JSON.stringify(r));let job=r.value.job
 const read=async()=>{const r=await api('/jobs/'+job.id);assert.equal(r.status,200);job=r.value.job;return job}
 const act=async(path,body={},cookie=f.owner,token)=>{const r=await api('/jobs/'+job.id+path,{...body,expected_version:job.version},cookie,token);if(r.value.job&&cookie===f.owner&&!token)job=r.value.job;else if(r.value.version)job={...job,version:r.value.version};return r}
 const ok=async(path,body={},cookie=f.owner)=>{const r=await act(path,body,cookie);assert.equal(r.status,200,path+': '+JSON.stringify(r.value));await read();return r.value}
 const line=(id,description,code,cost,sell)=>({id,description,cost_code:code,phase:'Remodel',category:'material',quantity:'1',unit:'each',cost_unit_cents:cost,unit_cents:sell})
 await ok('/quotes',{lines:[line('base','Original remodel','06-100',100000,200000)]})
 r=await api('/pricing-rates',{jurisdiction:'Synthetic change jurisdiction',kind:'sales',percent:'10',effective_on:'2026-01-01',reference:'synthetic-plinth-reviewed-tax-'+tag,human_reviewed:true});assert.equal(r.status,201);const rate=r.value.rate
 const pricing={basis:'sell',as_of:'2026-10-28',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['base']}}
 r=await ok('/pricing/preview',pricing);await ok('/pricing/apply',{...pricing,digest:r.preview.digest})
 await ok('/quotes/'+job.quotes.at(-1).id+'/accept',{method:'signed',evidence:'Synthetic external acceptance',schedule_choice:{kind:'none',reason:'Separately reviewed work'},budget:{allowances:allowance?[{cost_code:'06-100',amount_cents:allowance}]:[]}})
 await ok('/schedules',{trade:'Synthetic window crew '+tag,description:'Install window '+tag,start:'2026-11-04T08:00:00Z',end:'2026-11-04T12:00:00Z'})
 await ok('/sov',{})
 const priced=async(description='Added window with five days of impact')=>{const input={description,direction:'charge',basis:'sell',as_of:'2026-10-28',lines:[line('window','Additional window','08-500',45000,100000)],rules:[],tax:{rate_id:rate.id,taxable_line_ids:['window']}};const p=await ok('/variation-pricing/preview',input);await ok('/variation-pricing/apply',{...input,digest:p.preview.digest});return job.variations.at(-1)}
 const present=async(variation=job.variations.at(-1),extra={})=>{const list=(await api('/jobs/'+job.id+'/signed-changes')).value;return (await ok('/signed-changes',{variation_id:variation.id,client_id:list.clients.find(c=>c.name==='Synthetic change client')?.id??list.clients[0].id,task_ids:[job.schedules[0].id],extra_days:5,...extra})).record}
 const list=async(cookie=f.owner)=>(await api('/jobs/'+job.id+'/signed-changes',undefined,cookie)).value
 const sign=async(row,cookie=f.owner,name=job.created_by.name)=>ok('/signed-changes/'+row.id+'/sign',{digest:row.digest,confirm:true,name},cookie)
 const billing=row=>({code_assignments:{['variation:'+row.variation_id]:'08-500'},billing:{lines:[{line_id:'quote:base',completed_cents:0,stored_cents:0,evidence:'Original scope not in this draft'},{line_id:'variation:'+row.variation_id,completed_cents:110000,stored_cents:0,evidence:'Proposed signed-window milestone; not certified complete'}],due_on:'2026-12-01',terms:'Review completion and issue separately'}})
 return {api,read,act,ok,priced,present,list,sign,billing,client,rate,get job(){return job}}
}
