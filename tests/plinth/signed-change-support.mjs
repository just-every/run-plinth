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

/** An explicit extension of existing withholding terms, reviewed only on application. */
export async function retainedChange(c) {
 await c.ok('/retainage',{contract_reference:'Synthetic reviewed retention terms',rules:[{line_id:'quote:base',work_bps:1000,stored_bps:500}],milestones:[{id:'complete',name:'Reviewed completion',completion_requirements:[],waiver_requirements:[],final:false}]})
 return c.job.retainage.plan
}
/** A household contact has a current job grant independently of its original client. */
export async function changeContact(f,c,email=changeAddress('household-contact')) {
 const before=(await c.list()).clients, cookie=await f.invite(email,'Synthetic household signer')
 const r=await c.api('/customers',{name:'Synthetic household',kind:'household',contacts:[{id:'contact',name:'Synthetic household signer',email}],owner_contact_ids:['contact'],billing_contact_ids:['contact'],properties:[{id:'site',label:'Job site',address:'123 Synthetic Street'}]})
 assert.equal(r.status,201);const customer=r.value.customer
 await c.ok('/customer',{customer_id:customer.id,property_id:'site',client_contact_ids:['contact']})
 return {cookie,customer,person:(await c.list()).clients.find(p=>!before.some(old=>old.id===p.id))}
}
/** Under-allowance source includes its exact reviewed tax and five-day impact. */
export async function allowanceCredit(c) {
 const selection=(await c.ok('/selections',{room:'Kitchen',category:'Window',allowance_cents:50000,cost_code:'06-100',decision_on:'2026-11-04',lead_days:5,options:[{name:'Less costly window',specifications:'Reviewed under allowance',supplier:'Synthetic supplier',price_cents:28000}]})).record,revision=selection.revisions[0]
 await c.ok('/selections/'+selection.id+'/present',{revision_id:revision.id})
 await c.ok('/selections/'+selection.id+'/sign',{revision_id:revision.id,option_id:revision.options[0].id,statement:'I choose this exact window',confirm:true},c.client)
 const input={selection_id:selection.id,revision_id:revision.id,schedule_days:5,impact_reference:'Reviewed five calendar days',impacts_reviewed:true,basis:'sell',as_of:'2026-10-28',lines:[{id:'credit',description:'Under allowance credit',cost_code:'06-100',phase:'Remodel',category:'material',quantity:'1',unit:'each',unit_cents:20000,cost_unit_cents:10000}],rules:[],tax:{rate_id:c.rate.id,taxable_line_ids:['credit']}}
 const preview=(await c.ok('/allowance-changes/preview',input)).preview
 await c.ok('/allowance-changes/apply',{...input,digest:preview.digest})
 return c.job.variations.at(-1)
}
