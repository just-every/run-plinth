// Native owner lifecycle and seed data for the agent door's conformance journey.
// No SQL, substitute identity, provider call or production credential.
export default async function({request,origin,claim,displayName,returnTo}) {
 const bootstrap=await request(origin+claim.path,{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:claim.token,displayName,returnTo})})
 if(bootstrap.status!==303)throw Error('Native owner bootstrap returned '+bootstrap.status)
 const cookie=bootstrap.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ')
 const call=async(path,body,method='POST')=>{const response=await request(origin+'/api/plinth/'+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw Error('Native fixture '+path+' HTTP '+response.status+': '+JSON.stringify(value));return value}
 const questionJobs=[]
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='
 for(const name of ['A Active','B Active sensitive','C Quoting','D Quoting sensitive']){
  let job=(await call('jobs',{name,client_email:['synthetic-client','example.com'].join(String.fromCharCode(64)),address:'100 Synthetic Avenue, Portland OR 97201'})).job
  job=(await call('jobs/'+job.id+'/quotes',{expected_version:job.version,lines:[{id:'line',description:'Synthetic framing scope',quantity:'1',unit_cents:100000}],notes:name.includes('sensitive')?'Synthetic SSN 123-45-6789':'Estimator source notes'})).job
  if(name.includes('Quoting')) {
   const captured=(await call(`jobs/${job.id}/products`,{expected_version:job.version,name:'Reviewed fixture product',sku:'FIXTURE',supplier:'Synthetic supplier',source_url:'https://supplier.example.invalid/source',dimensions:'1 ft',cost_quote_cents:100,lead_days:1,captured_on:'2026-10-28',valid_until:'2027-10-28',discontinued:false,evidence:name.includes('sensitive')?'Synthetic SSN 123-45-6789':'Reviewed synthetic source',image:{name:'original.png',mime:'image/png',base64:png}}))
   job=captured.job
   const product=captured.record
   job=(await call(`jobs/${job.id}/products/${product.id}/review`,{expected_version:job.version,revision_id:product.revisions[0].id,confirm:true})).job
  }
  if(name.includes('Active'))job=(await call(`jobs/${job.id}/quotes/${job.quotes[0].id}/accept`,{expected_version:job.version,method:'email',evidence:'Synthetic client acceptance of exact scope',schedule_choice:{kind:'none',reason:'Field dates pending'}})).job
  if(name.includes('Active'))questionJobs.push(job)
 }
 for(let n=0;n<questionJobs.length;n++){
  let job=questionJobs[n]
  const response=await call(`jobs/${job.id}/variations`,{expected_version:job.version,description:'Synthetic unanswered completion decision',amount_cents:100})
  job=response.job
  await call(`jobs/${job.id}/agent-answers`,{expected_version:job.version,question:n?'Synthetic SSN 123-45-6789':'Why did completion move? Cause remains unresolved.',sources:[{kind:'decision',decision_id:response.record.id}],confirm:true})
 }
 const catalog=async(kind,value)=>(await call('estimate-catalog',{kind,name:'Synthetic '+kind,reason:'Reviewed synthetic conformance source',value})).entry
 for(const sensitive of [false,true]) {
 const rate=await catalog('rate',{vendor:'Synthetic supplier',effective_on:'2026-01-01',unit:'ft',cost_cents:100,sell_cents:200,reference:'Synthetic source quote'})
 const assembly=await catalog('assembly',{unit:'ft',parts:[{id:'framing',rate_id:rate.id,description:sensitive?'Synthetic SSN 123-45-6789':'Framing material',cost_code:'06',phase:'Framing',category:'material',units_per_dimension:'1',productivity:'1',waste_percent:'0'}]})
 await catalog('template',{kind:'remodel',dimensions:{length:'10'},items:[{id:'frame',assembly_id:assembly.id,dimension:'length'}]})
 }
 // Reviewed completed-job packets are prepared through person doors, before any agent can see them.
 const learningCatalog=(await call('estimate-catalog',undefined,'GET')).entries
 for(const sensitive of [false,true]){
  const template=learningCatalog[sensitive?5:2],sourceJobs=[]
  for(let index=0;index<2;index++){
   let job=(await call('jobs',{name:(sensitive?'G':'E')+' Completed '+index,client_email:['synthetic-learning','dev.localhost'].join(String.fromCharCode(64)),address:'Synthetic site'})).job
   const act=async(path,input)=>{const result=await call('jobs/'+job.id+path,{expected_version:job.version,...input});job=(await call('jobs/'+job.id,undefined,'GET')).job;return result}
   const input={template_id:template.id,dimensions:{length:'10'},as_of:'2026-10-28'},preview=await act('/estimate-template/preview',input)
   await act('/estimate-template/apply',{...input,digest:preview.preview.digest})
   await act('/quotes/'+job.quotes.at(-1).id+'/accept',{method:'signed',evidence:'Owner-reviewed signed synthetic estimate',schedule_choice:{kind:'none',reason:'Dates recorded separately'}})
   const day=20+(sensitive?2:0)+index
   await act('/schedules',{trade:'Framing',description:'Complete framing',start:`2026-10-${day}T08:00:00Z`,end:`2026-10-${day}T10:00:00Z`})
   const task=job.schedules.at(-1);if(task.status==='draft')await act('/schedules/'+task.id+'/approve',{})
   await act('/schedule-actuals',{task_id:task.id,actual_start:`2026-10-${day}T08:00:00Z`,actual_finish:`2026-10-${day}T10:00:00Z`,installed:{quantity:'10',unit:'ft',cost_code:'06'},evidence:'Measured source'})
   await call('reports/performance/jobs/'+job.id+'/complete',{expected_version:job.version,completed_on:'2026-10-23',confirm:true,evidence:sensitive?'Synthetic SSN 123-45-6789':'Human recorded completion'})
   job=(await call('jobs/'+job.id,undefined,'GET')).job;sourceJobs.push({id:job.id,version:job.version})
  }
  const input={sources:sourceJobs,catalog_id:template.id,catalog_version:template.version},preview=(await call('agent-learning/preview',input)).preview
  await call('agent-learning/packets',{...input,digest:preview.digest,confirm:true,reason:'Owner reviewed only these completed synthetic jobs'})
 }
 await call('pricing-rates',{kind:'sales',percent:'0',jurisdiction:'Synthetic reviewed jurisdiction',effective_on:'2026-01-01',reference:'Synthetic rate source',human_reviewed:true})
 return bootstrap
}
