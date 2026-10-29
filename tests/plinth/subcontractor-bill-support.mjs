import assert from 'node:assert/strict'
export const billBytes=Buffer.from('%PDF-1.4\nsynthetic-plinth-1 original subcontractor invoice\n%%EOF\n')
export const correctedBytes=Buffer.from('%PDF-1.4\nsynthetic-plinth-2 corrected subcontractor invoice\n%%EOF\n')
export const billFile=(bytes=billBytes)=>({name:'synthetic-plinth-bill.pdf',mime:'application/pdf',base64:bytes.toString('base64')})
/** Seed a received bill only through the same native doors used by the installed application. */
export async function billReviewFixture(api,{sub,clientEmail}={}){
 const ok=async(path,body,who,status=200)=>{const r=await api(path,body,who);assert.equal(r.status,status,path+': '+JSON.stringify(r.value));return r.value}
 let job=(await ok('/jobs',{name:'Synthetic subcontractor review',client_email:clientEmail??['synthetic-plinth-client','example.invalid'].join('@'),address:'148 Maple Street'},undefined,201)).job
 const act=async(path,body={})=>{const r=await ok('/jobs/'+job.id+path,{expected_version:job.version,...body});if(r.job)job=r.job;else if(r.version)job={...job,version:r.version};return r}
 await act('/quotes',{lines:[{description:'Framing materials',cost_code:'06-100',phase:'Framing',category:'material',quantity:'1',unit:'lot',cost_unit_cents:100000,unit_cents:200000},{description:'Framing labor',cost_code:'01-100',phase:'Framing',category:'labor',quantity:'1',unit:'lot',cost_unit_cents:50000,unit_cents:100000}]})
 await act('/quotes/'+job.quotes[0].id+'/accept',{method:'signed',evidence:'Synthetic exact reviewed contract',schedule_choice:{kind:'none',reason:'Schedule planned separately'}})
 const vendor=(await ok('/vendors',{kind:'subcontractor',name:'Synthetic Framing Company',trades:['Framing'],contacts:[{id:'synthetic-plinth-contact',name:'Synthetic trade contact',email:sub.email}]},undefined,201)).vendor
 await ok('/vendors/'+vendor.id+'/qualifications',{expected_version:vendor.version,trade:'Framing',status:'qualified',evidence:'Synthetic owner-reviewed qualification'})
 const scope=(await act('/subcontracts',{vendor_id:vendor.id,trade:'Framing',scope:'Awarded framing material and labor',contact_ids:['synthetic-plinth-contact'],awarded_on:'2026-10-23',amount_cents:150000})).record
 await act('/subcontracts/'+scope.id+'/release')
 const order=(await act('/orders',{supplier:vendor.name,description:'Awarded framing commitment',source:{kind:'award',subcontract_id:scope.id},lines:[{id:'material',description:'Framing materials',cost_code:'06-100',phase:'Framing',category:'material',quantity:'10',unit:'pack',unit_cents:10000},{id:'labor',description:'Framing labor',cost_code:'01-100',phase:'Framing',category:'labor',quantity:'10',unit:'hour',unit_cents:5000}]})).record
 await act('/orders/'+order.id+'/issue')
 const received=await ok('/subcontractor-portal/'+job.id+'/bills',{expected_version:job.version,subcontract_id:scope.id,reference:'synthetic-plinth-original-1',note:'Original company bill requires correction',amount_cents:77000,attachments:[billFile()]},sub)
 const root='/jobs/'+job.id+'/subcontractor-bill-review',submission=received.record_id
 let source=await ok(root)
 const read=async()=>source=await ok(root)
 const review=async(path,body={},who)=>{const r=await api(root+'/'+submission+path,{expected_version:source.version,...body},who);if(r.status===200&&r.value.register)source=r.value;return r}
 const accept=()=>({cycle_id:source.register[0].cycles.at(-1).id,commitment_digest:source.register[0].commitment_digest,outcome:'accepted',reason:'Reviewed exact company original and coded awarded commitment',confirm:true,document_id:source.register[0].cycles.at(-1).attachments[0].id,dated_on:'2026-10-23',due_on:'2026-11-23',period:'2026-10',tax:{percent:'10',reference:'Synthetic reviewed rate source',exemption_reference:'Synthetic labor exemption evidence',human_reviewed:true},lines:[{order_id:order.id,line_id:'material',subtotal_cents:40000,taxable:true},{order_id:order.id,line_id:'labor',subtotal_cents:20000,taxable:false}]})
 return {root,submission,vendor,scope,order,review,read,accept,api,get job(){return job},get source(){return source}}
}
