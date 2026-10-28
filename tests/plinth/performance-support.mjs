import assert from 'node:assert/strict'
export const performanceAddress=label=>['synthetic-plinth-'+label,'dev.localhost'].join(String.fromCharCode(64))
/** The same real public-door setup is used by HTTP assertions and the installed reporting journey. */
export async function performanceFixture(f){
 const reviewer=await f.invite(performanceAddress('performance-reviewer'),'Synthetic cost preparer','admin')
 const call=async(path,body,cookie=f.owner)=>{const r=await f.json('/api/plinth'+path,{cookie,...(body===undefined?{}:{method:'POST',body})});assert.ok(r.status===200||r.status===201,JSON.stringify(r));return r.value}
 const catalog=async(kind,name,value)=>(await call('/estimate-catalog',{kind,name,reason:'Reviewed production baseline',value})).entry
 const rate=await catalog('rate','Reviewed framing hour',{vendor:'Native labor schedule',effective_on:'2026-01-01',unit:'hour',cost_cents:3000,sell_cents:6000,reference:'synthetic-plinth-rate-1'})
 const material=await catalog('rate','Reviewed timber unit',{vendor:'Native material schedule',effective_on:'2026-01-01',unit:'each',cost_cents:100,sell_cents:150,reference:'synthetic-plinth-rate-2'})
 const assembly=await catalog('assembly','Wall assembly',{unit:'ft',parts:[{id:'labor',rate_id:rate.id,description:'Wall framing labor',cost_code:'06-100',phase:'Structure',category:'labor',units_per_dimension:'1',productivity:'5',waste_percent:'0'},{id:'timber',rate_id:material.id,description:'Wall timber',cost_code:'06-200',phase:'Structure',category:'material',units_per_dimension:'1',productivity:'1',waste_percent:'0'}]})
 const template=await catalog('template','Wall remodel',{kind:'remodel',dimensions:{walls:'10'},items:[{id:'wall',assembly_id:assembly.id,dimension:'walls'}]})
 const jobs=[]
 for(let i=0;i<4;i++){
  const name=['Maple completed remodel','Cedar completed remodel','Lost remodel proposal','Open remodel proposal'][i]
  let job=(await call('/jobs',{name,client_email:performanceAddress('performance-client'),address:'22 Synthetic Street'})).job
  const read=async()=>job=(await call('/jobs/'+job.id)).job
  const act=async(path,body={},cookie=f.owner)=>{const r=await call(`/jobs/${job.id}`+path,{expected_version:job.version,...body},cookie);await read();return r}
  const report=async(action,body={})=>{const r=await call(`/reports/performance/jobs/${job.id}/${action}`,{expected_version:job.version,...body});await read();return r}
  const dimensions={walls:i===1?'12':'10'},input={template_id:template.id,as_of:'2026-10-20',dimensions}
  const preview=await act('/estimate-template/preview',input);await act('/estimate-template/apply',{...input,digest:preview.preview.digest},i===1?reviewer:f.owner)
  if(i<2){
   await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Native signed proposal '+i,schedule_choice:{kind:'none',reason:'Schedule recorded separately'}})
   await act('/schedules',{trade:'Framing',description:'Frame walls',start:`2026-10-${20+i}T08:00:00Z`,end:`2026-10-${20+i}T12:00:00Z`});const task=job.schedules.at(-1)
   if(task.status==='draft')await act(`/schedules/${task.id}/approve`)
   await act('/schedule-actuals',{task_id:task.id,actual_start:`2026-10-${20+i}T08:00:00Z`,actual_finish:`2026-10-${20+i}T11:00:00Z`,installed:{quantity:dimensions.walls,unit:'ft',cost_code:'06-100'},evidence:'Measured installed wall length '+i})
   const source=await act('/costs/sources',{kind:'time',reference:'synthetic-plinth-approved-time-'+i,employee_reference:'synthetic-plinth-worker-'+i,dated_on:'2026-10-22',period:'2026-10',cost_code:'06-100',minutes:i===0?120:180,hour_cents:3000,burden_bps:0},reviewer)
   await act(`/costs/sources/${source.record.id}/approve`)
   await act('/costs/sources',{kind:'time',reference:'synthetic-plinth-unapproved-time-'+i,employee_reference:'synthetic-plinth-worker-draft',dated_on:'2026-10-22',period:'2026-10',cost_code:'06-100',minutes:600,hour_cents:3000,burden_bps:0},reviewer)
   await report('complete',{completed_on:'2026-10-23',evidence:'Reviewed finished job '+i,confirm:true})
  }else await report('sales',{quote_id:job.quotes.at(-1).id,stage:i===2?'lost':'submitted',reason:i===2?'Client chose another builder':'Client reviewing proposal',evidence:'Native client correspondence '+i,confirm:true})
  jobs.push({get job(){return job},act,report,read})
 }
 return {call,jobs,assembly,template,rate,material,reviewer}
}
