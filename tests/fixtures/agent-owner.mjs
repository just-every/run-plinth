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
 }
 const catalog=async(kind,value)=>(await call('estimate-catalog',{kind,name:'Synthetic '+kind,reason:'Reviewed synthetic conformance source',value})).entry
 for(const sensitive of [false,true]) {
 const rate=await catalog('rate',{vendor:'Synthetic supplier',effective_on:'2026-01-01',unit:'ft',cost_cents:100,sell_cents:200,reference:'Synthetic source quote'})
 const assembly=await catalog('assembly',{unit:'ft',parts:[{id:'framing',rate_id:rate.id,description:sensitive?'Synthetic SSN 123-45-6789':'Framing material',cost_code:'06',phase:'Framing',category:'material',units_per_dimension:'1',productivity:'1',waste_percent:'0'}]})
 await catalog('template',{kind:'remodel',dimensions:{length:'10'},items:[{id:'frame',assembly_id:assembly.id,dimension:'length'}]})
 }
 await call('pricing-rates',{kind:'sales',percent:'0',jurisdiction:'Synthetic reviewed jurisdiction',effective_on:'2026-01-01',reference:'Synthetic rate source',human_reviewed:true})
 try {
 // A separate native job keeps the explicitly reviewed recovery sources stable during other draft journeys.
 let recoveryJob=(await call('jobs',{name:'E Recovery',client_email:['synthetic-plinth-recovery','example.invalid'].join('@'),address:'Synthetic recovery site'})).job
 const recoveryCall=async(path,input)=>{const value=await call('jobs/'+recoveryJob.id+path,{expected_version:recoveryJob.version,...input});if(value.job)recoveryJob=value.job;else if(value.version)recoveryJob={...recoveryJob,version:value.version};return value}
 await recoveryCall('/quotes',{lines:[{id:'recovery-source',description:'Synthetic recovery scope',quantity:'1',unit_cents:100000,cost_code:'06',cost_unit_cents:30000,phase:'Framing',category:'material',unit:'lot'}]})
 await recoveryCall('/quotes/'+recoveryJob.quotes[0].id+'/accept',{method:'signed',evidence:'Native exact human acceptance',schedule_choice:{kind:'none',reason:'Separate native recovery publication'}})
 const calendar={weekdays:[1,2,3,4,5],start_hour:0,end_hour:24,holidays:[]},tasks=[{id:'synthetic-plinth-recovery-conformance',trade:'Recovery crew',description:'Synthetic native recovery work',owner:'Builder',start:'2026-11-06T08:00:00Z',duration_minutes:60}]
 const plan=await recoveryCall('/schedule/preview',{calendar,tasks});await recoveryCall('/schedule/publish',{calendar,tasks:plan.preview.tasks,digest:plan.preview.digest})
 const order=await recoveryCall('/orders',{supplier:'Synthetic recovery supplier',description:'Unreceived recovery package',source:{kind:'budget',cost_code:'06'},lines:[{id:'recovery-lot',description:'Native recovery lot',cost_code:'06',quantity:'1',unit:'lot',unit_cents:20000}]})
 await recoveryCall('/orders/'+order.record.id+'/issue',{})
 await recoveryCall('/costs/forecasts',{as_of:'2026-11-07',source_as_of:'Native fixture only; external actuals unknown',codes:[{cost_code:'06',remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:0,outstanding_commitment_cents:20000,unbought_cents:10000,risk_cents:0,reference:'Synthetic native remaining costs'}]})
 recoveryJob=(await call('jobs/'+recoveryJob.id,undefined,'GET')).job
 const criteria={schedule_approval_id:recoveryJob.approvals.findLast(a=>a.kind==='schedule.publish').id,budget_id:recoveryJob.budgets[0].id,promised_finish:'2026-11-06T09:00:00.000Z',minimum_margin_cents:70000,tasks:[{task_id:tasks[0].id,quantity:'1',unit:'lot',cost_code:'06'}],order_ids:[order.record.id]}
 const packet=await recoveryCall('/recovery-evidence/preview',{criteria});await recoveryCall('/recovery-evidence',{title:'Synthetic private recovery evidence',criteria,digest:packet.digest,confirm:true})
 } catch(error) { console.error('Native recovery fixture: '+error.message); throw error }
 return bootstrap
}
