// Native owner lifecycle and seed data for the agent door's conformance journey.
// No SQL, substitute identity, provider call or production credential.
export default async function({request,origin,claim,displayName,returnTo}) {
 const bootstrap=await request(origin+claim.path,{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:claim.token,displayName,returnTo})})
 if(bootstrap.status!==303)throw Error('Native owner bootstrap returned '+bootstrap.status)
 const cookie=bootstrap.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ')
 const call=async(path,body,method='POST')=>{const response=await request(origin+'/api/plinth/'+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw Error('Native fixture '+path+' HTTP '+response.status+': '+JSON.stringify(value));return value}
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='
 for(const name of ['A Active','B Active sensitive','C Quoting','D Quoting sensitive']){
  let job=(await call('jobs',{name,client_email:'synthetic-client@example.com',address:'100 Synthetic Avenue, Portland OR 97201'})).job
  job=(await call('jobs/'+job.id+'/quotes',{expected_version:job.version,lines:[{id:'line',description:'Synthetic framing scope',quantity:'1',unit_cents:100000}],notes:name.includes('sensitive')?'Synthetic SSN 123-45-6789':'Estimator source notes'})).job
  if(name.includes('Quoting')) {
   const captured=(await call(`jobs/${job.id}/products`,{expected_version:job.version,name:'Reviewed fixture product',sku:'FIXTURE',supplier:'Synthetic supplier',source_url:'https://supplier.example.invalid/source',dimensions:'1 ft',cost_quote_cents:100,lead_days:1,captured_on:'2026-10-28',valid_until:'2027-10-28',discontinued:false,evidence:name.includes('sensitive')?'Synthetic SSN 123-45-6789':'Reviewed synthetic source',image:{name:'original.png',mime:'image/png',base64:png}}))
   job=captured.job
   const product=captured.record
   job=(await call(`jobs/${job.id}/products/${product.id}/review`,{expected_version:job.version,revision_id:product.revisions[0].id,confirm:true})).job
  }
  if(name.includes('Active'))job=(await call(`jobs/${job.id}/quotes/${job.quotes[0].id}/accept`,{expected_version:job.version,method:'email',evidence:'Synthetic client acceptance of exact scope',schedule_choice:{kind:'none',reason:'Field dates pending'}})).job
  if(name.includes('Active')) {
   let response = await call(`jobs/${job.id}/selections`, {expected_version:job.version,room:'Kitchen',category:'Fixture',allowance_cents:1000,cost_code:'22',decision_on:'2026-11-09',lead_days:14,options:[{name:'Synthetic choice',supplier:'Synthetic supplier',specifications:name.includes('sensitive')?'Synthetic SSN 123-45-6789':'Reviewed fixture dimensions',price_cents:1000}]})
   job=response.job;const selection=response.record
   response=await call(`jobs/${job.id}/schedules`,{expected_version:job.version,trade:'Fixture '+name,description:'Fixture installation',start:'2026-11-30T08:00:00Z',end:'2026-11-30T10:00:00Z'})
   job=response.job;const task=response.record
   await call(`jobs/${job.id}/decision-graphs`,{expected_version:job.version,as_of:'2026-11-10',confirm:true,review:'Owner explicitly reviews these fixture sources for a private draft',links:[{selection_id:selection.id,revision_id:selection.revisions[0].id,task_ids:[task.id],product_ids:[],rfi_ids:[],order_ids:[],lead_days:14,review_days:5,buffer_days:2}]})
  }
 }
 const catalog=async(kind,value)=>(await call('estimate-catalog',{kind,name:'Synthetic '+kind,reason:'Reviewed synthetic conformance source',value})).entry
 for(const sensitive of [false,true]) {
 const rate=await catalog('rate',{vendor:'Synthetic supplier',effective_on:'2026-01-01',unit:'ft',cost_cents:100,sell_cents:200,reference:'Synthetic source quote'})
 const assembly=await catalog('assembly',{unit:'ft',parts:[{id:'framing',rate_id:rate.id,description:sensitive?'Synthetic SSN 123-45-6789':'Framing material',cost_code:'06',phase:'Framing',category:'material',units_per_dimension:'1',productivity:'1',waste_percent:'0'}]})
 await catalog('template',{kind:'remodel',dimensions:{length:'10'},items:[{id:'frame',assembly_id:assembly.id,dimension:'length'}]})
 }
 await call('pricing-rates',{kind:'sales',percent:'0',jurisdiction:'Synthetic reviewed jurisdiction',effective_on:'2026-01-01',reference:'Synthetic rate source',human_reviewed:true})
 return bootstrap
}
