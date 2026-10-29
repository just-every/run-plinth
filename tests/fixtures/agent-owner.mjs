// Native owner lifecycle and seed data for the agent door's conformance journey.
// No SQL, substitute identity, provider call or production credential.
export default async function({request,origin,claim,displayName,returnTo}) {
 const bootstrap=await request(origin+claim.path,{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:claim.token,displayName,returnTo})})
 if(bootstrap.status!==303)throw Error('Native owner bootstrap returned '+bootstrap.status)
 const cookie=bootstrap.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ')
 const call=async(path,body,method='POST')=>{const response=await request(origin+'/api/plinth/'+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw Error('Native fixture '+path+' HTTP '+response.status+': '+JSON.stringify(value));return value}
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='
 for(const name of ['A Active','B Active sensitive','C Quoting','D Quoting sensitive','E Active cost','F Active sensitive cost']){
  let job=(await call('jobs',{name,client_email:'synthetic-client@example.com',address:'100 Synthetic Avenue, Portland OR 97201'})).job
  job=(await call('jobs/'+job.id+'/quotes',{expected_version:job.version,lines:[{id:'line',description:'Synthetic framing scope',cost_code:'06',phase:'Framing',category:'material',cost_unit_cents:50000,unit:'lot',quantity:'1',unit_cents:100000}],notes:name.includes('sensitive')?'Synthetic SSN 123-45-6789':'Estimator source notes'})).job
  if(name.includes('Quoting')) {
   const captured=(await call(`jobs/${job.id}/products`,{expected_version:job.version,name:'Reviewed fixture product',sku:'FIXTURE',supplier:'Synthetic supplier',source_url:'https://supplier.example.invalid/source',dimensions:'1 ft',cost_quote_cents:100,lead_days:1,captured_on:'2026-10-28',valid_until:'2027-10-28',discontinued:false,evidence:name.includes('sensitive')?'Synthetic SSN 123-45-6789':'Reviewed synthetic source',image:{name:'original.png',mime:'image/png',base64:png}}))
   job=captured.job
   const product=captured.record
   job=(await call(`jobs/${job.id}/products/${product.id}/review`,{expected_version:job.version,revision_id:product.revisions[0].id,confirm:true})).job
  }
  if(name.includes('Active'))job=(await call(`jobs/${job.id}/quotes/${job.quotes[0].id}/accept`,{expected_version:job.version,method:'email',evidence:'Synthetic client acceptance of exact scope',schedule_choice:{kind:'none',reason:'Field dates pending'}})).job
  if(name.includes('cost')){
   const bill={vendor:'Synthetic supplier',reference:'synthetic-plinth-agent-1',dated_on:'2026-10-28',due_on:'2026-11-28',period:'2026-10',document:{name:'original.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4 synthetic-plinth-agent-1').toString('base64')},tax:{percent:'0',reference:'Reviewed zero tax',exemption_reference:'Reviewed exemption',human_reviewed:true},lines:[{cost_code:'06',description:'Unmatched material',subtotal_cents:5000,taxable:false,matches:[]}]}
   for(const reference of ['synthetic-plinth-agent-1','synthetic-plinth-agent-2']){await call(`jobs/${job.id}/costs/bills`,{...bill,reference:name.includes('sensitive')?reference+' Synthetic SSN 123-45-6789':reference,expected_version:job.version});job=(await call('jobs/'+job.id,undefined,'GET')).job}
   let response=await call(`jobs/${job.id}/cost-reconciliation`,{expected_version:job.version,as_of:'2026-10-28',reason:'Owner requests pre-draw source review'});job.version=response.version
   const packet=response.record
   await call(`jobs/${job.id}/cost-reconciliation/${packet.id}/review`,{expected_version:job.version,digest:packet.digest,confirm:true,finding_ids:packet.findings.map(f=>f.id),reason:'Owner reviewed these exact native facts'})
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
