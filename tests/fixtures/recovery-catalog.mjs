import assert from 'node:assert/strict'

// Reuse the same reviewed assembly in two ordinary room estimate items.
export async function reusedAssemblyEstimate(f){
 const post=(path,body)=>f.json(path,{method:'POST',cookie:f.owner,body})
 const catalog=async(kind,name,value)=>{const r=await post('/api/plinth/estimate-catalog',{kind,name,value,reason:'Reviewed synthetic room estimate'});assert.equal(r.status,201,JSON.stringify(r.value));return r.value.entry}
 const rate=await catalog('rate','Synthetic wall material',{vendor:'Synthetic supply',effective_on:'2026-01-01',unit:'square feet',cost_cents:100,sell_cents:200,reference:'synthetic-plinth-1'})
 const assembly=await catalog('assembly','Synthetic wall assembly',{unit:'square feet',parts:[{id:'synthetic-plinth-part',rate_id:rate.id,description:'Wall material',cost_code:'09-M',phase:'Walls',category:'material',units_per_dimension:'1',productivity:'1',waste_percent:'0'}]})
 const template=await catalog('template','Two rooms with one assembly',{kind:'remodel',dimensions:{kitchen:'100',laundry:'50'},items:[{id:'kitchen',assembly_id:assembly.id,dimension:'kitchen'},{id:'laundry',assembly_id:assembly.id,dimension:'laundry'}]})
 const created=await post('/api/plinth/jobs',{name:'Synthetic two room estimate',client_email:['synthetic-plinth-client','example.com'].join('@'),address:'Synthetic site'});assert.equal(created.status,201)
 const job=created.value.job,request={template_id:template.id,as_of:'2026-10-19',expected_version:job.version},root='/api/plinth/jobs/'+job.id+'/estimate-template'
 const preview=await post(root+'/preview',request);assert.equal(preview.status,200,JSON.stringify(preview.value))
 const applied=await post(root+'/apply',{...request,digest:preview.value.preview.digest});assert.equal(applied.status,200,JSON.stringify(applied.value))
 assert.equal(applied.value.job.quotes[0].lines.length,2)
 assert.equal(applied.value.job.quotes[0].total_cents,30000)
 return {job:applied.value.job,assembly}
}
