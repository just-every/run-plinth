import assert from 'node:assert/strict'
export const ticket={name:'synthetic-plinth-delivery.csv',mime:'text/csv',base64:Buffer.from('material,delivered,damaged\nStud packs,5,1\n').toString('base64')}
export async function inventoryFixture(f){
 const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{cookie,token,...(body===undefined?{}:{method:'POST',body})})
 const create=async(name)=>{
  let r=await api('/jobs',{name,client_email:['client','dev.localhost'].join('@'),address:'Synthetic inventory site'});assert.equal(r.status,201);let job=r.value.job
  const act=async(path,body={})=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});assert.equal(r.status,200,JSON.stringify(r.value));job=r.value.job;return r.value.record}
  await act('/quotes',{lines:[{id:'synthetic-plinth-material',description:'Stud packs',cost_code:'06-100',phase:'Framing',category:'material',quantity:'1',unit:'lot',cost_unit_cents:100000,unit_cents:200000}]})
  await act(`/quotes/${job.quotes[0].id}/accept`,{method:'signed',evidence:'Synthetic exact acceptance',schedule_choice:{kind:'none',reason:'Plan site work separately'}})
  return {get job(){return job},act}
 }
 const source=await create('Synthetic material source'),target=await create('Synthetic material destination')
 const order=await source.act('/orders',{supplier:'Synthetic Lumber',description:'Stock custody order',source:{kind:'budget',cost_code:'06-100'},lines:[{id:'synthetic-plinth-studs',description:'Stud packs',cost_code:'06-100',quantity:'10',unit:'pack',unit_cents:10000}]});await source.act(`/orders/${order.id}/issue`)
 let version=source.job.version
 const read=async(id=source.job.id,cookie=f.owner,token)=>api(`/jobs/${id}/inventory`,undefined,cookie,token)
 const act=async(action,body={},cookie=f.owner,token)=>{const r=await api(`/jobs/${source.job.id}/inventory/${action}`,{expected_version:version,operation_id:crypto.randomUUID(),...body},cookie,token);if(r.status===200)version=r.value.version;return r}
 const receive={order_id:order.id,location:'North covered rack',received_on:'2026-10-27',reference:'Synthetic delivery ticket',document:ticket,lines:[{line_id:'synthetic-plinth-studs',quantity:'5',damaged:'1',expected_quantity:'6'}]}
 return {api,source,target,order,read,act,receive,get version(){return version}}
}
