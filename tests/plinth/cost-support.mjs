import assert from 'node:assert/strict'
export const costOriginal=Buffer.from('%PDF-1.4\n% synthetic-plinth-1 original supplier invoice\n%%EOF\n')
export const original={name:'synthetic-plinth-1.pdf',mime:'application/pdf',base64:costOriginal.toString('base64')}
export async function costFixture(f){
 const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{cookie,token,...(body===undefined?{}:{method:'POST',body})})
 let r=await api('/jobs',{name:'Synthetic framing job',client_email:'synthetic-plinth-client@example.com',address:'123 Example Street'});assert.equal(r.status,201);let job=r.value.job
 const act=async(path,body={},cookie=f.owner,token)=>{const r=await api(`/jobs/${job.id}`+path,{expected_version:job.version,...body},cookie,token);if(r.status<300&&cookie===f.owner&&!token){if(r.value.job)job=r.value.job;else if(r.value.version)job={...job,version:r.value.version}}return r}
 const ok=async(path,body={})=>{const r=await act(path,body);assert.equal(r.status,200,`${path}: ${JSON.stringify(r.value)}`);return r.value}
 const read=async()=>{job=(await api(`/jobs/${job.id}`)).value.job;return job}
 await ok('/quotes',{lines:[{id:'framing',description:'Framing materials',cost_code:'06-100',phase:'Framing',category:'material',quantity:'1',unit:'lot',cost_unit_cents:100000,unit_cents:200000},{id:'labor',description:'Framing labor',cost_code:'01-100',phase:'Framing',category:'labor',quantity:'1',unit:'lot',cost_unit_cents:50000,unit_cents:100000}]})
 r=await api('/pricing-rates',{jurisdiction:'Synthetic jurisdiction',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'synthetic-plinth-rate-1',human_reviewed:true});assert.equal(r.status,201);const pricing={basis:'sell',as_of:'2026-10-23',rules:[],tax:{rate_id:r.value.rate.id,taxable_line_ids:['framing','labor']}}
 r=await ok('/pricing/preview',pricing);await ok('/pricing/apply',{...pricing,digest:r.preview.digest})
 await ok(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'email',evidence:'synthetic-plinth-client-acceptance',schedule_choice:{kind:'none',reason:'Separately scheduled'}})
 await ok('/costs/policy',{budget_limit_cents:0,commitment_limit_cents:0,bill_limit_cents:1000000,separate_approval:false,owner_id:job.created_by.id,due_on:'2026-11-01'})
 await ok('/orders',{supplier:'Synthetic Lumber',description:'Framing package',source:{kind:'budget',cost_code:'06-100'},lines:[{id:'lumber',description:'Studs',cost_code:'06-100',quantity:'10',unit:'pack',unit_cents:10000}]})
 const order=job.orders.at(-1);await ok(`/orders/${order.id}/issue`);await ok(`/orders/${order.id}/receive`,{lines:[{line_id:'lumber',quantity:'3'}],reference:'synthetic-plinth-delivery-1'});await ok(`/orders/${order.id}/receive`,{lines:[{line_id:'lumber',quantity:'2'}],reference:'synthetic-plinth-delivery-2'});await read()
 const receipts=job.orders.at(-1).receipts
 const bill=(reference='synthetic-plinth-invoice-1')=>({vendor:'Synthetic Lumber',reference,dated_on:'2026-10-23',due_on:'2026-11-23',period:'2026-10',document:original,tax:{percent:'10',reference:'synthetic-plinth-tax-1',exemption_reference:'synthetic-plinth-labor-exemption',human_reviewed:true},lines:[{cost_code:'06-100',description:'Delivered framing',subtotal_cents:30000,taxable:true,matches:[{order_id:order.id,receipt_id:receipts[0].id,cost_code:'06-100',amount_cents:25000},{order_id:order.id,receipt_id:receipts[1].id,cost_code:'06-100',amount_cents:5000}]},{cost_code:'01-100',description:'Split labor coding reviewed against receipt',subtotal_cents:10000,taxable:false,matches:[{order_id:order.id,receipt_id:receipts[1].id,cost_code:'06-100',amount_cents:10000}]}]})
 const ledger=async()=>{const r=await api(`/jobs/${job.id}/costs`);assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
 return {api,act,ok,read,bill,ledger,order,receipts,get job(){return job}}
}
