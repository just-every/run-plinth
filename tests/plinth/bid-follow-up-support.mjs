import assert from 'node:assert/strict'

/** Seed the ordinary bid doors; caller supplies independently authenticated people. */
export async function bidFollowUpFixture(f,{subs,estimator,clientEmail,due='2026-10-30'}) {
 const api=(path,body,cookie=f.owner)=>f.json('/api/plinth'+path,{method:body===undefined?'GET':'POST',cookie,...(body===undefined?{}:{body})})
 let result=await api('/jobs',{name:'synthetic-plinth-1 windows',client_email:clientEmail,address:'Synthetic procurement site'});assert.equal(result.status,201);let job=result.value.job
 result=await api(`/jobs/${job.id}/quotes`,{expected_version:job.version,lines:[{id:'synthetic-plinth-1',description:'Long-lead windows',quantity:'1',unit:'package',unit_cents:500000,cost_code:'08-100',phase:'Envelope',category:'material'}]});assert.equal(result.status,200,JSON.stringify(result.value));job=result.value.job
 result=await api(`/jobs/${job.id}/quotes/${job.quotes[0].id}/accept`,{expected_version:job.version,method:'signed',evidence:'Synthetic accepted window scope',schedule_choice:{kind:'none',reason:'Procurement review before date promises'}});assert.equal(result.status,200,JSON.stringify(result.value));job=result.value.job
 const people=(await api('/team')).value.team,person=people.find(p=>p.email===estimator.email);assert.ok(person)
 result=await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'estimator',job_ids:[job.id],po_limit_cents:0}});assert.equal(result.status,200)
 let source=(await api(`/bids/${job.id}`)).value.source
 const refresh=async()=>{source=(await api(`/bids/${job.id}`)).value.source;return source}
 const act=async(path,body={},cookie=f.owner,extra={})=>{const r=await f.json(`/api/plinth/bids/${job.id}${path}`,{method:'POST',cookie,body:{expected_version:source.version,...body},...extra});if(r.value.source)source=r.value.source;return r}
 result=await act('',{title:'Long-lead window package',trade:'Windows',scope:'Supply the reviewed window package',mode:'unpriced',lines:[{cost_code:'08-100',description:'Long-lead windows'}],note:'Synthetic window plan',due_on:due,plans:[{name:'synthetic-plinth-1.pdf',base64:Buffer.from('%PDF-1.7\nsynthetic-plinth-1\n%%EOF').toString('base64')}]});assert.equal(result.status,201);const id=result.value.record_id,revision=source.bids[0].revisions[0].id
 assert.equal((await act(`/${id}/publish`,{revision_id:revision,confirm:true})).status,200)
 const vendors=[]
 for(let n=0;n<subs.length;n++) {
  let r=await api('/vendors',{kind:'subcontractor',name:`synthetic-plinth-${n+1}`,trades:['Windows'],contacts:[{id:`synthetic-plinth-${n+1}`,name:`Synthetic window bidder ${n+1}`,email:subs[n].email}]});assert.equal(r.status,201);let vendor=r.value.vendor
  r=await api(`/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Windows',status:'qualified',evidence:'Synthetic reviewed window supplier'});assert.equal(r.status,200);vendor=r.value.vendor;vendors.push(vendor)
  assert.equal((await act(`/${id}/invite`,{vendor_id:vendor.id,contact_id:`synthetic-plinth-${n+1}`,pre_award:true,cost_codes:['08-100'],confirm:true})).status,200)
 }
 return {api,act,refresh,id,revision,job,person,vendors,get source(){return source},plan:{revision_id:revision,required_on_site:'2026-12-01',lead_days:30,remind_on:'2026-10-28',estimator_id:person.id,draft_task:{description:'Install long-lead windows',start:'2026-12-01T08:00:00Z',end:'2026-12-01T09:00:00Z'},confirm:true}}
}
