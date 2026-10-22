import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture, createReleasedScope, setPortalFeatures } from './helpers.mjs'

test('CARE-003 — immutable component terms, recurring agreed reminders, repeat defects, callback costs and designated coverage decisions',async()=>{
 let mailMode='accepted'
 const f=await createFixture({mailResponse:message=>message.subject.startsWith('Maintenance reminder:')&&message.subject.includes('HVAC')&&mailMode!=='accepted'?new Response(null,{status:mailMode==='unknown'?503:403}):Response.json({id:crypto.randomUUID()})})
 try{
  const client=await f.invite('care-client@example.com'),foreign=await f.invite('elsewhere@example.com'),reviewer=await f.invite('reviewer@example.com','Warranty reviewer','admin'),pm=await f.invite('care-pm@example.com','Warranty manager','admin'),agent=await f.agent()
  let created=await f.json('/api/plinth/jobs',{method:'POST',cookie:f.owner,body:{name:'Maple Street kitchen and covered porch',client_email:'care-client@example.com',time_zone:'America/New_York'}});assert.equal(created.status,201);let job=created.value.job
  created=await f.json(`/api/plinth/jobs/${job.id}/quotes`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,lines:[{description:'Signed remodel scope',quantity:1,unit_cents:1_000_000}]}});assert.equal(created.status,200);job=created.value.job
  created=await f.json(`/api/plinth/jobs/${job.id}/quotes/${job.quotes[0].id}/accept`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,method:'signed',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'},evidence:'Client signed original remodel scope'}});assert.equal(created.status,200);job=created.value.job
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


test('CARE-002 — client photo request, scoped visits, rejected repair, two-party closure and reminder history through native HTTP',async()=>{
 const f=await createFixture()
 try{
  const client=await f.invite('service-client@example.com','Repair Client'),trade=await f.invite('service-trade@example.com','Repair Trade'),other=await f.invite('service-other@example.com','Other Company'),agent=await f.agent()
  let job=await createActiveJob(f,'Synthetic leaking fixture','service-client@example.com')
  const setup=await createReleasedScope(f,job,'service-trade@example.com','Plumbing');job=setup.job
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{cookie,token,...(body===undefined?{}:{method:'POST',body})})
  const read=async()=>{job=(await api('/jobs/'+job.id)).value.job}
  const act=async(path,body={},cookie=f.owner,token)=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie,token);await read();return r}
  const portal=async(path,body={})=>{const r=await api(`/warranty-service/${job.id}${path}`,{expected_version:job.version,...body},trade);await read();return r}
  const scheduled=async time=>{assert.equal((await (await f.mf.getWorker()).scheduled({scheduledTime:new Date(time),cron:'0 * * * *'})).outcome,'ok');await read()}
  const photo={name:'synthetic-plinth-101.png',mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='}
  let r=await act('/warranties',{kind:'component',name:'Kitchen faucet',starts_on:'2026-01-01',ends_on:'2035-12-31',terms:'Signed original two-year fixture terms remain unchanged',signed_terms_reference:'Private signed contract reference'});assert.equal(r.status,200)
  const component=structuredClone(job.warranties.components[0]),request={component_id:component.id,description:'Leaking fixture beneath kitchen sink',availability:'Weekdays 08:00–11:00 local; ask before entry',attachments:[photo]}
  assert.equal((await f.request(`/api/plinth/jobs/${job.id}/service`)).status,401)
  assert.equal((await api(`/jobs/${job.id}/service`,undefined,undefined,agent)).status,403)
  assert.equal((await api(`/jobs/${job.id}/service`,undefined,other)).status,404)
  assert.equal((await act('/service',request)).status,403)
  assert.equal((await act('/service',{...request,attachments:[]},client)).status,400)
  r=await act('/service',request,client);assert.equal(r.status,200,JSON.stringify(r.value));const id=r.value.record.id,item=()=>job.warranties.cases.find(c=>c.id===id),path=a=>`/service/${id}/${a}`
  assert.equal(item().recorded_by.name,'Repair Client');assert.equal(job.schedules.length,0);assert.equal(job.warranties.promises.length,0,'A client request sends and schedules nothing automatically')
  assert.equal((await api(`/jobs/${job.id}/service`,undefined,client)).value.cases[0].costs,undefined)
  assert.equal((await api(`/jobs/${job.id}/service`,undefined,client)).value.components[0].terms,undefined)
  assert.deepEqual((await api('/warranty-service',undefined,trade)).value.jobs,[])
  assert.equal((await act(path('acknowledge-owner'),{reason:'I own this service request'},client)).status,403)
  assert.equal((await act(path('acknowledge-owner'),{reason:'Builder acknowledged ownership; reviewer assigned'})).status,200)
  assert.equal((await act(`/warranties/${id}/review`,{decision:'covered',reason:'Covered under the signed fixture warranty',source_reference:'Private review source'})).status,200)
  assert.equal((await act(path('assign'),{subcontract_id:setup.scope.id,email:'service-other@example.com',reason:'Wrong company'})).status,403)
  assert.equal((await act(path('assign'),{subcontract_id:setup.scope.id,email:'service-trade@example.com',reason:'Responsible plumbing subcontractor'})).status,200)
  let inbox=(await api('/warranty-service',undefined,trade)).value.jobs;assert.equal(inbox.length,1);assert.equal(inbox[0].cases[0].service.ownership.by.name,'Builder');assert.equal(inbox[0].cases[0].reviews[0].reason,'Covered under the signed fixture warranty');assert.equal(inbox[0].cases[0].reviews[0].source_reference,undefined)
  assert.equal((await api(`/jobs/${job.id}`,undefined,trade)).status,404,'Repair assignment never creates a client job grant')
  assert.deepEqual((await api('/warranty-service',undefined,other)).value.jobs,[])
  const originalId=item().service.attachments[0].id
  for(const [route,cookie] of [[`/jobs/${job.id}/service`,client],[`/warranty-service/${job.id}`,trade]]){const download=await f.request('/api/plinth'+route+'/files/'+originalId,{cookie});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from(photo.base64,'base64'))}
  assert.equal((await f.request(`/api/plinth/warranty-service/${job.id}/files/${originalId}`,{cookie:other})).status,404)
  const promise={kind:'promise',component_id:component.id,case_id:id,title:'Agreed open repair follow-up',anchor_on:'2031-01-01',interval_unit:'month',interval_count:1,recipient_kind:'client',recipient_email:'service-client@example.com',agreement_reference:'Client explicitly agreed to monthly follow-up until recorded closure'}
  assert.equal((await act('/warranties',promise)).status,200);const agreement=job.warranties.promises[0]
  const notices=()=>f.messages.filter(m=>m.subject.startsWith('Maintenance reminder:'))
  await scheduled('2031-01-01T09:00:00Z');assert.equal(notices().length,1)
  const book=async(start,end)=>{const r=await act(path('book'),{start,end,reason:'Visit agreed within client availability'});assert.equal(r.status,200,JSON.stringify(r.value));return item().service.visits.at(-1)}
  let visit=await book('2031-01-02T09:00:00Z','2031-01-02T10:00:00Z')
  assert.equal((await act(`/schedules/${visit.task_id}/move`,{start:'2031-01-02T10:00:00Z',end:'2031-01-02T11:00:00Z'})).status,200)
  assert.equal((await api(`/jobs/${job.id}/service`,undefined,client)).value.cases[0].service.visits[0].appointment.start,'2031-01-02T10:00:00.000Z')
  assert.equal((await act(path('acknowledge-client'),{visit_id:visit.id,reason:'Too early'},client)).value.error,'builder_acceptance')
  r=await api(`/warranty-service/${job.id}/${id}/submit`,{expected_version:job.version,visit_id:visit.id,reason:'Outsider fix',attachments:[photo]},other);assert.equal(r.status,404)
  assert.equal((await portal(`/${id}/submit`,{visit_id:visit.id,reason:'Replaced the fixture seal; see original photo',attachments:[photo]})).status,200)
  assert.equal((await act(path('review'),{visit_id:visit.id,accepted:false,reason:'Leak persists under pressure; return to replace connector'})).status,200)
  assert.equal((await act(`/warranties/${id}/close`,{reason:'Bypass client',evidence_reference:'none'})).value.error,'client_acknowledgment')
  await scheduled('2031-02-01T09:00:00Z');assert.equal(notices().length,2,'Rejecting a fix never closes or pauses agreed follow-up')
  visit=await book('2031-02-02T09:00:00Z','2031-02-02T10:00:00Z')
  assert.equal((await portal(`/${id}/submit`,{visit_id:visit.id,reason:'Replaced connector; pressure tested without leak',attachments:[{...photo,name:'synthetic-plinth-102.png'}]})).status,200)
  assert.equal((await act(path('review'),{visit_id:visit.id,accepted:true,reason:'Builder inspected dry connector and pressure test'})).status,200)
  assert.equal(item().status,'open');assert.equal(agreement.status,'active','Builder acceptance alone never closes a case')
  for(const cookie of [f.owner,trade])assert.ok([403,404].includes((await act(path('acknowledge-client'),{visit_id:visit.id,reason:'Impersonate client'},cookie)).status))
  const before=job.version,closure={expected_version:before,visit_id:visit.id,reason:'Client inspected the dry fixture and acknowledges this repair is complete'}
  const closes=await Promise.all([1,2].map(()=>api(`/jobs/${job.id}/service/${id}/acknowledge-client`,closure,client)));assert.deepEqual(closes.map(r=>r.status).sort(),[200,409]);await read()
  assert.equal(item().status,'closed');assert.equal(item().service.client_acknowledgment.by.name,'Repair Client');assert.equal(item().service.visits.length,2);assert.equal(item().service.visits[0].review.accepted,false);assert.equal(item().service.visits[1].review.accepted,true)
  assert.equal(job.warranties.promises[0].status,'paused');assert.equal(job.warranties.promises[0].history.at(-1).action,'case_closed');assert.deepEqual(job.warranties.components,[component])
  await scheduled('2031-03-01T09:00:00Z');assert.equal(notices().length,2,'Only recorded two-party closure stops the agreed reminders')
  for(const cookie of [client,trade]){const view=await api(cookie===client?`/jobs/${job.id}/service`:'/warranty-service',undefined,cookie),shown=cookie===client?view.value:view.value.jobs[0];assert.equal(shown.cases[0].service.visits.length,2);assert.equal(shown.cases[0].status,'closed')}
  job=await setPortalFeatures(f,job.id,['warranty'],['warranty'])
  assert.equal((await api(`/jobs/${job.id}/service`,undefined,client)).status,404);assert.deepEqual((await api('/warranty-service',undefined,trade)).value.jobs,[])
  job=await setPortalFeatures(f,job.id)
  const contacts=job.subcontracts[0].contact_ids
  for(const change of [{contact_ids:[]},{hold:true}]){
   assert.equal((await act(`/subcontracts/${setup.scope.id}/access`,{...change,reason:'Owner revokes repair access'})).status,200)
   assert.deepEqual((await api('/warranty-service',undefined,trade)).value.jobs,[]);assert.equal((await f.request(`/api/plinth/warranty-service/${job.id}/files/${originalId}`,{cookie:trade})).status,404)
   if(change.contact_ids)assert.equal((await act(`/subcontracts/${setup.scope.id}/access`,{contact_ids:contacts,reason:'Restore assigned contact'})).status,200)
  }
 }finally{await f.close()}
})
