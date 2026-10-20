import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture } from './helpers.mjs'

test('CARE-003 — immutable component terms, recurring agreed reminders, repeat defects, callback costs and designated coverage decisions',async()=>{
 let mailMode='accepted'
 const f=await createFixture({mailResponse:message=>message.subject.startsWith('Maintenance reminder:')&&message.subject.includes('HVAC')&&mailMode!=='accepted'?new Response(null,{status:mailMode==='unknown'?503:403}):Response.json({id:crypto.randomUUID()})})
 try{
  const client=await f.invite('care-client@example.com'),foreign=await f.invite('elsewhere@example.com'),reviewer=await f.invite('reviewer@example.com','Warranty reviewer','admin'),pm=await f.invite('care-pm@example.com','Warranty manager','admin'),agent=await f.agent()
  let created=await f.json('/api/plinth/jobs',{method:'POST',cookie:f.owner,body:{name:'Maple Street kitchen and covered porch',client_email:'care-client@example.com',time_zone:'America/New_York'}});assert.equal(created.status,201);let job=created.value.job
  created=await f.json(`/api/plinth/jobs/${job.id}/quotes`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,lines:[{description:'Signed remodel scope',quantity:1,unit_cents:1_000_000}]}});assert.equal(created.status,200);job=created.value.job
  created=await f.json(`/api/plinth/jobs/${job.id}/quotes/${job.quotes[0].id}/accept`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,method:'signed',evidence:'Client signed original remodel scope'}});assert.equal(created.status,200);job=created.value.job
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{...(body===undefined?{}:{method:'POST',body}),cookie,token})
  const refresh=async()=>{job=(await api('/jobs/'+job.id)).value.job}
  const act=async(path,body={},cookie=f.owner,token)=>{const r=await api('/jobs/'+job.id+path,{expected_version:job.version,...body},cookie,token);if(r.value.job&&cookie===f.owner&&!token)job=r.value.job;return r}
  const scheduled=async time=>{const worker=await f.mf.getWorker(),r=await worker.scheduled({scheduledTime:new Date(time),cron:'0 * * * *'});assert.equal(r.outcome,'ok');await refresh()}
  const body={kind:'component',name:'HVAC heat-pump system',starts_on:'2031-01-01',ends_on:'2032-12-31',signed_terms_reference:'Signed handover warranty HVAC-104',terms:'Two-year equipment warranty; agreed annual maintenance does not shorten coverage.'}
  for(const credentials of [{cookie:client},{cookie:foreign},{token:agent}])assert.ok([403,404].includes((await act('/warranties',body,credentials.cookie,credentials.token)).status))
  assert.equal((await act('/warranties',{...body,starts_on:'2033-01-01'})).status,400)
  assert.equal((await act('/warranties',body)).status,200);const hvac=structuredClone(job.warranties.components[0])
  assert.equal((await act('/warranties',{...body,name:'Roof membrane',ends_on:'2031-12-31',signed_terms_reference:'Signed roof terms R-204'})).status,200);const roof=structuredClone(job.warranties.components[1])
  assert.equal((await act('/warranties/'+hvac.id+'/edit',{ends_on:'2031-01-01'})).status,409)
  const promise={kind:'promise',component_id:hvac.id,title:'Inspect HVAC filters and condensate drain',anchor_on:'2031-01-31',interval_unit:'month',interval_count:1,ends_on:'2031-03-31',recipient_kind:'client',recipient_email:'care-client@example.com',agreement_reference:'Client email agreeing monthly reminders through March'}
  assert.equal((await act('/warranties',{...promise,agreement_reference:''})).status,400)
  assert.equal((await act('/warranties',{...promise,recipient_email:'elsewhere@example.com'})).status,409)
  assert.equal((await act('/warranties',promise)).status,200);const agreement=job.warranties.promises[0]
  assert.equal((await act('/warranties',{...promise,component_id:roof.id,title:'Inspect roof membrane and flashings',interval_unit:'year',ends_on:'2035-01-31'})).status,200)
  assert.equal((await act('/warranty-reminders/run',{now:Date.parse('2031-01-31T14:00:00Z')})).value.report.attempts,0,'HTTP cannot supply a future internal scheduler clock')
  await scheduled('2031-01-31T13:59:00Z');assert.equal(job.warranties.reminders.length,0)
  mailMode='unknown';await Promise.all([scheduled('2031-01-31T14:00:00Z'),scheduled('2031-01-31T14:00:00Z')]);assert.equal(job.warranties.reminders.length,2)
  const uncertain=structuredClone(job.warranties.reminders.find(r=>r.promise_id===agreement.id));assert.equal(uncertain.status,'unknown');assert.ok(uncertain.label.includes('not be resent'));assert.equal(uncertain.dispatched_by.kind,'scheduler')
  assert.equal(job.warranties.reminders.find(r=>r.promise_id!==agreement.id).status,'accepted')
  const notices=()=>f.messages.filter(m=>m.subject.startsWith('Maintenance reminder:'))
  assert.equal(notices().length,2)
  mailMode='accepted';await scheduled('2031-01-31T15:00:00Z');assert.equal(notices().length,2,'An uncertain occurrence is never automatically resent')
  assert.equal((await act('/warranties/'+agreement.id+'/pause',{reason:'Client paused maintenance notices'})).status,200)
  await scheduled('2031-02-28T14:00:00Z');assert.equal(notices().length,2,'Paused agreements do not send')
  assert.equal((await act('/warranties/'+agreement.id+'/resume',{reason:'Client reconfirmed notices',agreement_reference:''})).status,400)
  assert.equal((await act('/warranties/'+agreement.id+'/resume',{reason:'Client reconfirmed notices',agreement_reference:'New client agreement reference'})).status,200)
  assert.equal(job.warranties.promises[0].anchor_on,'2031-01-31')
  await scheduled('2031-02-28T14:00:00Z');assert.equal(job.warranties.reminders.filter(r=>r.promise_id===agreement.id).at(-1).due_on,'2031-02-28');assert.equal(job.warranties.reminders.at(-1).status,'accepted')
  const beforeDst=notices().length;await scheduled('2031-03-31T12:59:00Z');assert.equal(notices().length,beforeDst,'Daylight saving changes the UTC instant while 09:00 local stays fixed')
  mailMode='refused';await scheduled('2031-03-31T13:00:00Z');assert.equal(job.warranties.reminders.filter(r=>r.promise_id===agreement.id).at(-1).due_on,'2031-03-31');assert.equal(job.warranties.reminders.at(-1).status,'refused','Original January-31 anchor is retained after February clamping')
  const identities=job.warranties.reminders.map(r=>r.promise_id+'|'+r.recipient_email+'|'+r.due_on);assert.equal(new Set(identities).size,identities.length)
  assert.deepEqual(job.warranties.reminders.find(r=>r.id===uncertain.id),uncertain)
  const defect={kind:'case',component_id:hvac.id,defect_key:'condensate-leak',description:'Recurring condensate leak near the end of the signed warranty',reported_on:'2032-12-30',reviewer_email:'reviewer@example.com'}
  assert.equal((await act('/warranties',defect)).status,200);const first=job.warranties.cases.at(-1)
  assert.equal((await act('/warranties',{...promise,title:'Case follow-up inspection',anchor_on:'2033-01-31',ends_on:'2033-12-31',case_id:first.id})).status,200);const casePromise=job.warranties.promises.at(-1)
  assert.equal((await act('/warranties/'+first.id+'/close',{reason:'Inspection complete',evidence_reference:'Visit report'})).status,409)
  assert.equal((await act('/warranties/'+first.id+'/review',{decision:'covered',reason:'Covered condensate drain issue',source_reference:'HVAC-104 clause 4'})).status,403,'Only the designated reviewer decides coverage')
  let r=await act('/warranties/'+first.id+'/review',{decision:'needs_evidence',reason:'Need the service record',source_reference:'HVAC-104'},reviewer);assert.equal(r.status,200);await refresh()
  assert.equal((await act('/warranties/'+first.id+'/close',{reason:'No further work',evidence_reference:'Unreviewed note'})).status,409)
  r=await act('/warranties/'+first.id+'/review',{decision:'covered',reason:'Manufacturer drain fitting is covered',source_reference:'HVAC-104 clause 4 and inspection report V1'},reviewer);assert.equal(r.status,200);await refresh()
  assert.equal((await act('/warranties/'+first.id+'/cost',{amount_cents:12_345,cost_code:'23-100',reference:'Service invoice S-104',description:'Drain repair labor'})).status,200)
  assert.equal((await act('/warranties/'+first.id+'/cost',{amount_cents:-1_000,cost_code:'23-100',reference:'Service invoice credit S-104-C',description:'Supplier credit correction'})).status,200)
  assert.equal((await act('/warranties/'+first.id+'/cost',{amount_cents:-99_999,cost_code:'23-100',reference:'Invalid credit',description:'Exceeds recorded cost'})).status,400)
  assert.equal((await act('/warranties/'+first.id+'/close',{reason:'Builder accepted documented drain repair',evidence_reference:'Repair report and client acknowledgment SR-104'})).status,200)
  assert.equal(job.warranties.promises.find(p=>p.id===casePromise.id).status,'paused')
  assert.equal((await act('/warranties/'+casePromise.id+'/resume',{reason:'Attempt to revive closed work',agreement_reference:'New reference'})).status,409)
  assert.equal((await act('/warranties',defect)).status,200);const repeated=job.warranties.cases.at(-1)
  assert.equal(repeated.repeated,true);assert.deepEqual(repeated.earlier_case_ids,[first.id]);assert.equal(repeated.escalation.reviewer_email,'reviewer@example.com')
  assert.equal(job.warranties.cases[0].costs.reduce((n,c)=>n+c.amount_cents,0),11_345)
  assert.deepEqual(job.warranties.components,[hvac,roof],'Case closure and costs never rewrite signed terms or expiry')
  assert.equal(job.approvals.filter(a=>a.kind==='warranty.review').length,2)
  const roofAgreement=job.warranties.promises[1]
  assert.equal((await act('/warranties/'+roofAgreement.id+'/revoke',{reason:'Client withdrew future reminder agreement'})).status,200)
  const priorCount=notices().length;await scheduled('2032-01-31T14:00:00Z');assert.equal(notices().length,priorCount,'Revoked agreement and ended schedule do not send')
  for(const cookie of [client,foreign]){r=await api('/jobs/'+job.id,undefined,cookie);if(cookie===client){assert.equal(r.status,200);assert.equal(r.value.job.warranties,undefined)}else assert.equal(r.status,404)}
  const team=(await api('/team')).value.team,person=team.find(p=>p.email==='care-pm@example.com')
  assert.equal((await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'project_manager',job_ids:[job.id],po_limit_cents:0}})).status,200)
  r=await act('/warranties',{...promise,title:'PM-configured reminder',anchor_on:'2033-01-31',ends_on:'2033-12-31'},pm);assert.equal(r.status,200);await refresh()
  assert.equal((await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:1,role:'project_manager',job_ids:[],po_limit_cents:0}})).status,200)
  const before=notices().length;await scheduled('2033-01-31T14:00:00Z');assert.equal(notices().length,before,'A removed configuring assignment cannot send')
  assert.equal((await act('/warranty-reminders/run',{},pm)).status,404)
  assert.equal((await act('/warranties',{...promise,title:'Revocable client reminder',anchor_on:'2034-01-31',ends_on:'2034-12-31'})).status,200)
  const people=(await f.json('/auth/operators',{cookie:f.owner})).value,clientPerson=people.find(p=>p.email==='care-client@example.com')
  assert.equal((await f.request('/auth/operator/status',{method:'POST',cookie:f.owner,body:{operatorId:clientPerson.id,status:'inactive'}})).status,200)
  await scheduled('2034-01-31T14:00:00Z');assert.equal(notices().length,before,'Revoked recipients receive nothing')
 }finally{await f.close()}
 for(const [mailProvider,status] of [['development','development'],[null,'unconfigured']]){
  const fixture=await createFixture({mailProvider})
  try{
   let job=await createActiveJob(fixture,'Maintenance transport labels','no-client@example.com')
   const post=async(body,path='/warranties')=>{const r=await fixture.json('/api/plinth/jobs/'+job.id+path,{method:'POST',cookie:fixture.owner,body:{expected_version:job.version,...body}});assert.equal(r.status,200);job=r.value.job}
   await post({kind:'component',name:'Roof',starts_on:'2030-01-01',ends_on:'2035-01-01',terms:'Signed roof warranty',signed_terms_reference:'R-104'})
   await post({kind:'promise',component_id:job.warranties.components[0].id,title:'Roof inspection',anchor_on:'2031-01-31',interval_unit:'year',interval_count:1,recipient_kind:'office',recipient_email:'builder@example.com',agreement_reference:'Owner agreed reminder'})
   await (await fixture.mf.getWorker()).scheduled({scheduledTime:new Date('2031-01-31T15:00:00Z'),cron:'0 * * * *'})
   job=(await fixture.json('/api/plinth/jobs/'+job.id,{cookie:fixture.owner})).value.job;assert.equal(job.warranties.reminders[0].status,status);assert.equal(fixture.messages.length,0,'No provider message is claimed when none was sent')
   await post({kind:'promise',component_id:job.warranties.components[0].id,title:'Leap-day annual inspection',anchor_on:'2032-02-29',ends_on:'2033-02-28',interval_unit:'year',interval_count:1,recipient_kind:'office',recipient_email:'builder@example.com',agreement_reference:'Owner agreed leap-day anchored annual reminders'})
   const leap=job.warranties.promises.at(-1)
   for(const time of ['2032-02-29T10:00:00Z','2033-02-28T10:00:00Z'])await (await fixture.mf.getWorker()).scheduled({scheduledTime:new Date(time),cron:'0 * * * *'})
   job=(await fixture.json('/api/plinth/jobs/'+job.id,{cookie:fixture.owner})).value.job
   assert.deepEqual(job.warranties.reminders.filter(r=>r.promise_id===leap.id).map(r=>r.due_on),['2032-02-29','2033-02-28'],'Annual leap-day promises clamp to February without changing their anchor')

  }finally{await fixture.close()}
 }
})
