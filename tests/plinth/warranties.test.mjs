import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture, createReleasedScope, setPortalFeatures } from './helpers.mjs'

const noRepairPhoto={name:'synthetic-plinth-201.png',mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='}
async function noRepairJourney(f){
 const client=await f.invite('synthetic-plinth-201@example.com','Service Client')
 let job=await createActiveJob(f,'Synthetic no-repair service','synthetic-plinth-201@example.com')
 const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{cookie,token,...(body===undefined?{}:{method:'POST',body})})
 const read=async()=>{const r=await api('/jobs/'+job.id);assert.equal(r.status,200);job=r.value.job}
 const act=async(path,body={},cookie=f.owner,token)=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie,token);await read();return r}
 let r=await act('/warranties',{kind:'component',name:'Kitchen fixture',starts_on:'2026-01-01',ends_on:'2035-12-31',terms:'Original signed fixture terms',signed_terms_reference:'Synthetic signed terms 201'});assert.equal(r.status,200)
 const component=structuredClone(job.warranties.components[0])
 const request=async(description='Fixture leaks')=>{const r=await act('/service',{component_id:component.id,description,availability:'Weekday mornings by agreement',attachments:[noRepairPhoto]},client);assert.equal(r.status,200,JSON.stringify(r.value));return r.value.record.id}
 const id=await request(),item=(caseId=id)=>job.warranties.cases.find(c=>c.id===caseId),path=action=>`/service/${id}/${action}`
 const review=async decision=>{const r=await act(`/warranties/${id}/review`,{decision,reason:'Reviewer inspected fixture documentation: '+decision,source_reference:'Synthetic coverage source 201'});assert.equal(r.status,200,JSON.stringify(r.value));return item().reviews.at(-1)}
 const promise=async(title,caseId=id)=>{const r=await act('/warranties',{kind:'promise',component_id:component.id,...(caseId?{case_id:caseId}:{}),title,anchor_on:'2031-01-01',interval_unit:'month',interval_count:1,recipient_kind:'client',recipient_email:'synthetic-plinth-201@example.com',agreement_reference:'Client agreed to this monthly inspection reminder'});assert.equal(r.status,200);return job.warranties.promises.at(-1).id}
 const scheduled=async time=>{assert.equal((await (await f.mf.getWorker()).scheduled({scheduledTime:new Date(time),cron:'0 * * * *'})).outcome,'ok');await read()}
 return {get job(){return job},client,api,read,act,component,id,item,path,review,request,promise,scheduled}
}

test('CARE-005 — exact not-covered review and builder resolution await client acknowledgment; closure preserves originals and isolates reminders',async()=>{
 const f=await createFixture()
 try{
  const j=await noRepairJourney(f)
  assert.equal((await j.act(j.path('acknowledge-owner'),{reason:'Builder owns the coverage review'})).status,200)
  const otherCase=await j.request('Another fixture remains open'),linked=await j.promise('This case follow-up'),other=await j.promise('Other case follow-up',otherCase),unlinked=await j.promise('Component maintenance',null),paused=await j.promise('Previously paused follow-up'),revoked=await j.promise('Previously revoked follow-up')
  assert.equal((await j.act(`/warranties/${paused}/pause`,{reason:'Client paused this agreement'})).status,200)
  assert.equal((await j.act(`/warranties/${revoked}/revoke`,{reason:'Client revoked this agreement'})).status,200)
  const untouched=structuredClone(j.job.warranties.promises.filter(p=>p.id!==linked))
  const notices=()=>f.messages.filter(m=>m.subject.startsWith('Maintenance reminder:'))
  await j.scheduled('2031-01-01T09:00:00Z');assert.equal(notices().length,3)
  const first=await j.review('not_covered')
  assert.equal((await j.act(j.path('acknowledge-not-covered'),{reason:'Acknowledge before resolution',review_id:first.id},j.client)).status,409)
  assert.equal((await j.act(j.path('resolve-no-repair'),{reason:'Builder explains the not-covered outcome',review_id:first.id})).status,200)
  const oldResolution=structuredClone(j.item().service.no_repair_resolutions.at(-1))
  assert.equal(j.item().status,'open');assert.equal(j.job.warranties.promises.find(p=>p.id===linked).status,'active')
  assert.equal((await j.act(j.path('acknowledge-not-covered'),{reason:'Exact resolution is required',review_id:first.id},j.client)).status,409)
  const latest=await j.review('not_covered')
  assert.equal((await j.act(j.path('acknowledge-not-covered'),{reason:'Stale review acknowledgment',review_id:first.id,resolution_id:oldResolution.id},j.client)).status,409)
  assert.equal((await j.act(j.path('resolve-no-repair'),{reason:'Stale builder review reference',review_id:first.id})).status,409)
  assert.equal((await j.act(j.path('resolve-no-repair'),{reason:'Builder resolves the revised not-covered finding',review_id:latest.id})).status,200)
  const resolution=j.item().service.no_repair_resolutions.at(-1)
  assert.equal((await j.act(j.path('acknowledge-not-covered'),{reason:'Wrong builder resolution',review_id:latest.id,resolution_id:oldResolution.id},j.client)).status,409)
  await j.scheduled('2031-02-01T09:00:00Z');assert.equal(notices().length,6,'Coverage and builder resolution leave all agreed reminders active')
  assert.equal((await j.api(`/jobs/${j.job.id}/service`,undefined,j.client)).value.cases.find(c=>c.id===j.id).status,'open')
  const messages=f.messages.length,body={expected_version:j.job.version,review_id:latest.id,resolution_id:resolution.id,reason:'Client explicitly acknowledges this not-covered decision and builder resolution'}
  const closes=await Promise.all([1,2].map(()=>j.api(`/jobs/${j.job.id}${j.path('acknowledge-not-covered')}`,body,j.client)))
  assert.deepEqual(closes.map(r=>r.status).sort(),[200,409]);await j.read()
  assert.equal(f.messages.length,messages,'Closure introduces no outbound notice')
  assert.equal(j.item().status,'closed');assert.equal(j.item().service.visits.length,0)
  assert.deepEqual(j.item().service.no_repair_resolutions[0],oldResolution)
  assert.equal(j.item().closure.review_id,latest.id);assert.equal(j.item().closure.resolution_id,resolution.id)
  assert.equal(j.item().service.not_covered_acknowledgment.statement,body.reason)
  assert.equal(j.item().reviews.length,2);assert.deepEqual(j.job.warranties.components,[j.component])
  const closed=structuredClone(j.item()),agreement=j.job.warranties.promises.find(p=>p.id===linked)
  assert.equal(agreement.status,'paused');assert.equal(agreement.history.at(-1).action,'case_closed')
  assert.deepEqual(j.job.warranties.promises.filter(p=>p.id!==linked),untouched)
  for(const action of ['withdraw-client','acknowledge-not-covered'])assert.equal((await j.act(j.path(action),{reason:'Attempt to rewrite closed history',review_id:latest.id,resolution_id:resolution.id},j.client)).status,409)
  assert.equal((await j.act(j.path('resolve-no-repair'),{reason:'Attempt to rewrite builder resolution',review_id:latest.id})).status,409)
  assert.equal((await j.act(`/warranties/${j.id}/review`,{decision:'covered',reason:'Attempt to revise closed coverage',source_reference:'New source'})).status,409)
  assert.deepEqual(j.item(),closed)
  await j.scheduled('2031-03-01T09:00:00Z');assert.equal(notices().length,8)
  assert.equal(j.job.warranties.promises.find(p=>p.id===other).status,'active');assert.equal(j.job.warranties.promises.find(p=>p.id===unlinked).status,'active')
  const view=(await j.api(`/jobs/${j.job.id}/service`,undefined,j.client)).value.cases.find(c=>c.id===j.id)
  assert.equal(view.status,'closed');assert.equal(view.service.not_covered_acknowledgment.statement,body.reason)
  const original=await f.request(`/api/plinth/jobs/${j.job.id}/service/files/${closed.service.attachments[0].id}`,{cookie:j.client})
  assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),Buffer.from(noRepairPhoto.base64,'base64'))
 }finally{await f.close()}
})

test('CARE-005 — client withdrawal before ownership, review or visit waits for a currently assigned human builder resolution',async()=>{
 const f=await createFixture()
 try{
  const j=await noRepairJourney(f),pm=await f.invite('synthetic-plinth-202@example.com','Assigned PM','admin'),secondClient=await f.invite('synthetic-plinth-204@example.com','Second assigned client'),linked=await j.promise('Withdrawn case follow-up')
  const customer=await j.api('/customers',{name:'Synthetic service household',kind:'household',contacts:[{id:'second-client',name:'Second assigned client',email:'synthetic-plinth-204@example.com'}],properties:[{id:'service-home',label:'Service home',address:'22 Example Street'}]})
  assert.equal(customer.status,201)
  const contacts=client_contact_ids=>j.act('/customer',{customer_id:customer.value.customer.id,property_id:'service-home',client_contact_ids})
  assert.equal((await contacts(['second-client'])).status,200)
  for(const cookie of [j.client,secondClient])assert.equal((await j.api(`/jobs/${j.job.id}/service`,undefined,cookie)).value.cases[0].status,'open')
  assert.equal((await contacts([])).status,200)
  assert.equal((await j.act(j.path('withdraw-client'),{reason:'A removed client cannot withdraw'},secondClient)).status,404)
  assert.equal((await contacts(['second-client'])).status,200)
  const person=(await j.api('/team')).value.team.find(p=>p.email==='synthetic-plinth-202@example.com')
  const assign=job_ids=>f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:job_ids.length?1:0,role:'project_manager',job_ids,po_limit_cents:0}})
  assert.equal((await assign([])).status,200)
  const messages=f.messages.length
  assert.equal((await j.act(j.path('withdraw-client'),{reason:'Client found the leak came from their portable appliance and withdraws this request'},secondClient)).status,200)
  const withdrawal=structuredClone(j.item().service.withdrawal)
  assert.equal(j.item().status,'open');assert.equal(j.job.warranties.promises.find(p=>p.id===linked).status,'active')
  assert.equal(withdrawal.by.name,'Second assigned client')
  assert.equal((await j.api(`/jobs/${j.job.id}/service`,undefined,j.client)).value.cases[0].service.withdrawal.statement,withdrawal.statement)
  assert.equal((await j.act(j.path('withdraw-client'),{reason:'Replace the first statement'},j.client)).status,409)
  assert.equal((await j.act(j.path('resolve-no-repair'),{reason:'Unassigned PM attempts closure'},pm)).status,404)
  assert.equal((await assign([j.job.id])).status,200)
  assert.equal((await j.act(j.path('resolve-no-repair'),{reason:'Builder records the client withdrawal and resolves the request without a visit'},pm)).status,200)
  assert.equal(f.messages.length,messages)
  assert.equal(j.item().status,'closed');assert.equal(j.item().reviews.length,0);assert.equal(j.item().service.visits.length,0);assert.equal(j.item().service.ownership,undefined)
  assert.deepEqual(j.item().service.withdrawal,withdrawal);assert.equal(j.item().closure.withdrawal_id,withdrawal.id);assert.equal(j.item().closure.closed_by.role,'project_manager')
  assert.equal(j.item().service.no_repair_resolutions[0].basis,'withdrawal');assert.equal(j.job.warranties.promises.find(p=>p.id===linked).status,'paused');assert.deepEqual(j.job.warranties.components,[j.component])
  const original=await f.request(`/api/plinth/jobs/${j.job.id}/service/files/${j.item().service.attachments[0].id}`,{cookie:j.client})
  assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),Buffer.from(noRepairPhoto.base64,'base64'))
 }finally{await f.close()}
})

test('CARE-005 — unresolved or covered requests stay open; office, agent and trade cannot replace client closure statements',async()=>{
 const f=await createFixture()
 try{
  const j=await noRepairJourney(f),trade=await f.invite('synthetic-plinth-203@example.com','Assigned trade'),agent=await f.agent()
  const setup=await createReleasedScope(f,j.job,'synthetic-plinth-203@example.com','Plumbing');await j.read()
  assert.equal((await j.act(j.path('acknowledge-owner'),{reason:'Builder owns coverage review'})).status,200)
  assert.equal((await j.act(j.path('assign'),{subcontract_id:setup.scope.id,email:'synthetic-plinth-203@example.com',reason:'Assign released plumbing contact'})).status,200)
  assert.equal((await j.act(j.path('book'),{start:'2031-01-02T09:00:00Z',end:'2031-01-02T10:00:00Z',reason:'Book the agreed inspection'})).status,200)
  const visit=j.item().service.visits[0]
  assert.equal((await j.api(`/warranty-service/${j.job.id}/${j.id}/submit`,{expected_version:j.job.version,visit_id:visit.id,reason:'Trade documents the attempted repair',attachments:[{...noRepairPhoto,name:'synthetic-plinth-205.png'}]},trade)).status,200);await j.read()
  assert.equal((await j.act(j.path('review'),{visit_id:visit.id,accepted:false,reason:'Builder found the attempted fix did not resolve the leak'})).status,200)
  const retainedVisits=structuredClone(j.item().service.visits)
  for(const decision of [null,'needs_evidence','covered']){
   const review=decision?await j.review(decision):null
   assert.equal((await j.act(j.path('resolve-no-repair'),{reason:'Cannot close unresolved or covered request',review_id:review?.id})).status,409)
   assert.equal((await j.act(j.path('acknowledge-not-covered'),{reason:'Cannot acknowledge unresolved or covered request',review_id:review?.id},j.client)).status,409)
   assert.equal((await j.act(`/warranties/${j.id}/close`,{reason:'Office-only bypass attempt',evidence_reference:'Office note'})).status,409)
   assert.equal(j.item().status,'open')
  }
  const review=await j.review('not_covered')
  assert.equal((await j.act(j.path('resolve-no-repair'),{reason:'Builder resolves not-covered finding',review_id:review.id})).status,200)
  const resolution=j.item().service.no_repair_resolutions.at(-1),body={reason:'Attempt client statement impersonation',review_id:review.id,resolution_id:resolution.id}
  for(const action of ['withdraw-client','acknowledge-not-covered']){
   assert.equal((await j.act(j.path(action),body)).status,403)
   assert.equal((await j.act(j.path(action),body,undefined,agent)).status,403)
   assert.equal((await j.api(`/warranty-service/${j.job.id}/${j.id}/${action}`,{expected_version:j.job.version,...body},trade)).status,403)
  }
  assert.equal((await j.act(j.path('resolve-no-repair'),body,j.client)).status,403)
  assert.equal((await j.act(j.path('resolve-no-repair'),body,undefined,agent)).status,403)
  assert.equal((await j.api(`/warranty-service/${j.job.id}/${j.id}/resolve-no-repair`,{expected_version:j.job.version,...body},trade)).status,403)
  assert.equal(j.item().status,'open')
  await j.review('covered')
  assert.equal((await j.act(j.path('acknowledge-not-covered'),body,j.client)).status,409,'Re-reviewing coverage invalidates the staged resolution')
  assert.equal((await j.act(j.path('resolve-no-repair'),{reason:'Covered request has no accepted repair'})).status,409)
  assert.equal((await j.act(j.path('withdraw-client'),{reason:'Client withdraws this covered request'},j.client)).status,200)
  assert.equal((await j.act(j.path('resolve-no-repair'),{reason:'Builder resolves the client withdrawal'})).status,200)
  assert.equal(j.item().status,'closed');assert.equal(j.item().reviews.at(-1).decision,'covered');assert.deepEqual(j.item().service.visits,retainedVisits)
  const original=await f.request(`/api/plinth/warranty-service/${j.job.id}/files/${retainedVisits[0].submission.attachments[0].id}`,{cookie:trade})
  assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),Buffer.from(noRepairPhoto.base64,'base64'))
 }finally{await f.close()}
})

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
  assert.ok((await f.db.prepare("SELECT count(*) AS n FROM pl_audit WHERE source='automation' AND action='warranty.reminders' AND actor_id LIKE 'automation:%' AND job_id=?").bind(job.id).first()).n>0,'The scheduler records itself as an automation in the audit history')
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
  let repairContact=trade
  let job=await createActiveJob(f,'Synthetic leaking fixture','service-client@example.com')
  const setup=await createReleasedScope(f,job,'service-trade@example.com','Plumbing');job=setup.job
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{cookie,token,...(body===undefined?{}:{method:'POST',body})})
  const read=async()=>{job=(await api('/jobs/'+job.id)).value.job}
  const act=async(path,body={},cookie=f.owner,token)=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie,token);await read();return r}
  const portal=async(path,body={})=>{const r=await api(`/warranty-service/${job.id}${path}`,{expected_version:job.version,...body},repairContact);await read();return r}
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
  const agentJob=(await api(`/jobs/${job.id}`,undefined,undefined,agent)).value.job;assert.equal(agentJob.warranties.cases.length,0);assert.ok(!agentJob.approvals.some(a=>a.subject_id===id),'Draft-agent job/list reads never expose service snapshots')
  assert.equal(item().recorded_by.name,'Repair Client');assert.equal(job.schedules.length,0);assert.equal(job.warranties.promises.length,0,'A client request sends and schedules nothing automatically')
  const external=view=>{const raw=JSON.stringify(view);for(const value of ['service-trade@example.com','service-other@example.com','builder@example.com',...job.subcontracts.map(s=>s.id)])assert.ok(!raw.includes(value),'External service views omit directory emails and award ids');const walk=(v,key)=>{if(!v||typeof v!=='object')return;if(['by','requested_by','booked_by','reviewed_by','closed_by'].includes(key)){assert.deepEqual(Object.keys(v).sort(),['at','name','role']);return}for(const [k,c] of Object.entries(v)){assert.ok(!['subcontract_id','email'].includes(k),'No directory identity field');walk(c,k)}};walk(view)}
  external(r.value)
  r=await act('/service',{...request,description:'Another unassigned service request'},client);assert.equal(r.status,200);const unassignedId=r.value.record.id,unassignedPhoto=job.warranties.cases.find(c=>c.id===unassignedId).service.attachments[0].id
  assert.equal((await act('/warranties',{kind:'case',component_id:component.id,defect_key:'office-only',description:'Office-private coverage case',reported_on:'2031-01-01',reviewer_email:'builder@example.com'})).status,200)
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
  assert.deepEqual(inbox[0].cases.map(c=>c.id),[id]);external(inbox)
  assert.equal((await f.request(`/api/plinth/warranty-service/${job.id}/files/${unassignedPhoto}`,{cookie:trade})).status,404)
  assert.deepEqual((await api(`/jobs/${job.id}/service`,undefined,client)).value.cases.map(c=>c.id),[id,unassignedId],'Clients see service requests and no office-only case')
  const originalId=item().service.attachments[0].id
  for(const [route,cookie] of [[`/jobs/${job.id}/service`,client],[`/warranty-service/${job.id}`,trade]]){const download=await f.request('/api/plinth'+route+'/files/'+originalId,{cookie});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from(photo.base64,'base64'));external(Object.fromEntries(download.headers))}
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
  r=await portal(`/${id}/submit`,{visit_id:visit.id,reason:'Replaced the fixture seal; see original photo',attachments:[photo]});assert.equal(r.status,200);external(r.value);const firstEvidence=item().service.visits[0].submission.attachments[0].id
  assert.equal((await act(path('review'),{visit_id:visit.id,accepted:false,reason:'Leak persists under pressure; return to replace connector'})).status,200)
  assert.equal((await act(`/warranties/${id}/close`,{reason:'Bypass client',evidence_reference:'none'})).value.error,'client_acknowledgment')
  await scheduled('2031-02-01T09:00:00Z');assert.equal(notices().length,2,'Rejecting a fix never closes or pauses agreed follow-up')
  const replacement=await createReleasedScope(f,job,'service-other@example.com','Plumbing');job=replacement.job
  assert.equal((await act(path('assign'),{subcontract_id:replacement.scope.id,email:'service-other@example.com',reason:'Second released company takes the rejected repair'})).status,200);repairContact=other
  assert.deepEqual((await api('/warranty-service',undefined,trade)).value.jobs,[])
  for(const file of [originalId,firstEvidence])assert.equal((await f.request(`/api/plinth/warranty-service/${job.id}/files/${file}`,{cookie:trade})).status,404)
  let reassigned=(await api(`/warranty-service/${job.id}`,undefined,other)).value;external(reassigned)
  assert.deepEqual(Object.keys(reassigned.cases[0].service.visits[0]).sort(),['end','review','start']);assert.equal(reassigned.cases[0].service.visits[0].review.accepted,false)
  assert.ok(!JSON.stringify(reassigned).includes('Replaced the fixture seal'));assert.ok(!JSON.stringify(reassigned).includes(firstEvidence))
  assert.equal((await f.request(`/api/plinth/warranty-service/${job.id}/files/${firstEvidence}`,{cookie:other})).status,404)
  assert.equal((await f.request(`/api/plinth/warranty-service/${job.id}/files/${originalId}`,{cookie:other})).status,200)
  visit=await book('2031-02-02T09:00:00Z','2031-02-02T10:00:00Z')
  r=await portal(`/${id}/submit`,{visit_id:visit.id,reason:'Replaced connector; pressure tested without leak',attachments:[{...photo,name:'synthetic-plinth-102.png'}]});assert.equal(r.status,200);external(r.value)
  assert.equal((await act(path('review'),{visit_id:visit.id,accepted:true,reason:'Builder inspected dry connector and pressure test'})).status,200)
  assert.equal(item().status,'open');assert.equal(agreement.status,'active','Builder acceptance alone never closes a case')
  for(const cookie of [f.owner,trade])assert.ok([403,404].includes((await act(path('acknowledge-client'),{visit_id:visit.id,reason:'Impersonate client'},cookie)).status))
  const before=job.version,closure={expected_version:before,visit_id:visit.id,reason:'Client inspected the dry fixture and acknowledges this repair is complete'}
  const closes=await Promise.all([1,2].map(()=>api(`/jobs/${job.id}/service/${id}/acknowledge-client`,closure,client)));assert.deepEqual(closes.map(r=>r.status).sort(),[200,409]);await read()
  assert.equal(item().status,'closed');assert.equal(item().service.client_acknowledgment.by.name,'Repair Client');assert.equal(item().service.visits.length,2);assert.equal(item().service.visits[0].review.accepted,false);assert.equal(item().service.visits[1].review.accepted,true)
  assert.equal(job.warranties.promises[0].status,'paused');assert.equal(job.warranties.promises[0].history.at(-1).action,'case_closed');assert.deepEqual(job.warranties.components,[component])
  await scheduled('2031-03-01T09:00:00Z');assert.equal(notices().length,2,'Only recorded two-party closure stops the agreed reminders')
  for(const cookie of [client,repairContact]){const view=await api(cookie===client?`/jobs/${job.id}/service`:'/warranty-service',undefined,cookie),shown=cookie===client?view.value:view.value.jobs[0];assert.equal(shown.cases[0].service.visits.length,2);assert.equal(shown.cases[0].status,'closed');external(shown)}
  const people=(await f.json('/auth/operators',{cookie:f.owner})).value,disabled=people.find(p=>p.email==='service-other@example.com')
  assert.equal((await f.request('/auth/operator/status',{method:'POST',cookie:f.owner,body:{operatorId:disabled.id,status:'inactive'}})).status,200)
  assert.equal((await api('/warranty-service',undefined,other)).status,401);assert.equal((await f.request(`/api/plinth/warranty-service/${job.id}/files/${originalId}`,{cookie:other})).status,401)
  // Jobs with a reviewed schedule use that public planner, then link the exact booked task.
  r=await act('/service',{...request,description:'A second fixture needs a planned visit'},client);assert.equal(r.status,200);const plannedId=r.value.record.id
  assert.equal((await act(`/service/${plannedId}/acknowledge-owner`,{reason:'Builder owns the planned repair'})).status,200)
  assert.equal((await act(`/service/${plannedId}/assign`,{subcontract_id:setup.scope.id,email:'service-trade@example.com',reason:'Responsible released plumbing company'})).status,200)
  const calendar={weekdays:[1,2,3,4,5],start_hour:8,end_hour:17,holidays:[]},tasks=[...job.schedules.map(t=>({...t,duration_minutes:60})),{id:'planned-repair-visit',trade:'Plumbing',description:'Reviewed warranty visit',start:'2031-04-01T09:00:00Z',duration_minutes:60}]
  r=await act('/schedule/preview',{calendar,tasks});assert.equal(r.status,200);const digest=r.value.preview.digest
  assert.equal((await act('/schedule/publish',{calendar,tasks,digest})).status,200)
  const booked=job.schedules.find(t=>t.description==='Reviewed warranty visit'),schedule=structuredClone(job.schedules)
  assert.equal((await act(`/service/${plannedId}/book`,{task_id:booked.id,reason:'Link the exact planner-reviewed appointment'})).status,200)
  assert.deepEqual(job.schedules,schedule,'Linking an already published task never rewrites the reviewed plan')
  assert.equal(job.warranties.cases.find(c=>c.id===plannedId).service.visits[0].task_id,booked.id)
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

test('CARE-004 — two completed jobs retain configurable high and low survey responses, assigned follow-up, manager and trade reports and separate ungated review permission',async()=>{
 const {surveyJob,surveyAddress,surveySettings}=await import('./satisfaction-support.mjs')
 const f=await createFixture()
 try{
  const first=await f.invite(surveyAddress(401),'Synthetic high-score client'),second=await f.invite(surveyAddress(402),'Synthetic low-score client'),foreign=await f.invite(surveyAddress(403),'Synthetic unrelated client'),pm=await f.invite(surveyAddress(404),'Synthetic project manager','admin'),crew=await f.invite(surveyAddress(405),'Synthetic crew lead','admin'),agent=await f.agent()
  const a=await surveyJob(f,'Synthetic Plinth first job',surveyAddress(401),first),b=await surveyJob(f,'Synthetic Plinth second job',surveyAddress(402),second)
  const team=(await a.call('/team')).value.team,manager=team.find(p=>p.email===surveyAddress(404)),worker=team.find(p=>p.email===surveyAddress(405))
  for(const [person,role] of [[manager,'project_manager'],[worker,'crew']])assert.equal((await a.call('/team/'+person.id,{expected_version:0,role,job_ids:[a.job.id,b.job.id],po_limit_cents:0},f.owner,'PUT')).status,200)
  for(const [j,n,trade] of [[a,406,'Plumbing'],[b,407,'Electrical']]){await j.read();await createReleasedScope(f,j.job,surveyAddress(n),trade);await j.read()}
  for(const [j,cookie,address] of [[a,first,surveyAddress(401)],[b,second,surveyAddress(402)]]){
   assert.equal((await j.act('/satisfaction/consent',{email_surveys:true})).status,403,'Owner cannot impersonate client consent')
   assert.equal((await j.act('/satisfaction/settings',surveySettings,pm)).status,403)
   await j.ok('/satisfaction/settings',surveySettings)
   const send={...j.source,recipient_email:address,follow_up_id:manager.id,confirm:true}
   assert.equal((await j.act('/satisfaction/send',send)).status,403,'No survey without client email consent')
   await j.ok('/satisfaction/consent',{email_surveys:true},cookie)
   assert.equal((await j.act('/satisfaction/send',{...send,confirm:false})).status,400)
   assert.equal((await j.act('/satisfaction/send',{...send,source_id:'synthetic-plinth-missing'})).status,409)
   assert.equal((await j.act('/satisfaction/send',send,pm)).status,403)
   assert.equal((await j.act('/satisfaction/send',send,cookie)).status,403)
   const r=await j.ok('/satisfaction/send',send);assert.equal(r.surveys.length,1);assert.equal(r.surveys[0].invitation.status,'accepted')
   assert.equal((await j.act('/satisfaction/send',send)).status,409,'Source and recipient cannot be resent')
   const row=r.surveys[0];assert.deepEqual(row.settings.questions,surveySettings.questions);assert.deepEqual(row.context.managers,[{id:manager.id,name:'Synthetic project manager'}]);assert.deepEqual(row.context.crew,[{id:worker.id,name:'Synthetic crew lead'}])
   await j.ok('/satisfaction/settings',{...surveySettings,questions:['Later questions cannot replace a sent survey'],review_url:'https://www.houzz.com/pro/synthetic-plinth-401'})
   assert.deepEqual((await j.survey()).surveys[0].settings,row.settings,'Sent survey retains its exact configuration')
   assert.equal((await j.act('/satisfaction/'+row.id+'/respond',{score:8,answers:['Good','Good']},foreign)).status,404)
  }
  const sa=(await a.survey()).surveys[0],sb=(await b.survey()).surveys[0]
  assert.equal((await a.act('/satisfaction/'+sa.id+'/respond',{score:0,answers:['Good','Good']},first)).status,400)
  assert.equal((await a.act('/satisfaction/'+sa.id+'/respond',{score:9,answers:['Only one answer']},first)).status,400)
  await a.ok('/satisfaction/'+sa.id+'/respond',{score:9,answers:['Clear updates','Excellent finish'],comment:'Synthetic positive feedback'},first)
  await b.ok('/satisfaction/'+sb.id+'/respond',{score:3,answers:['Updates arrived late','Finish needs attention'],comment:'Synthetic unresolved trim defect'},second)
  assert.equal((await a.act('/satisfaction/'+sa.id+'/respond',{score:1,answers:['Replacement','Replacement']},first)).status,409)
  const ar=(await a.survey()).surveys[0],br=(await b.survey()).surveys[0]
  assert.equal(ar.response.score,9);assert.equal(ar.follow_up,undefined);assert.equal(br.response.score,3);assert.equal(br.response.comment,'Synthetic unresolved trim defect');assert.equal(br.follow_up.assignee_id,manager.id)
  const tasks=await a.call('/jobs/'+b.job.id+'/todos',undefined,pm);assert.equal(tasks.status,200);const follow=tasks.value.todos.find(t=>t.id===br.follow_up.todo_id);assert.ok(follow);assert.equal(follow.items[0].assignee.email,manager.email);assert.equal(follow.items[0].completed,false);assert.ok(follow.notes.includes(br.response.comment))
  const report=(await a.call('/reports/satisfaction')).value
  assert.deepEqual(report.managers.map(r=>({id:r.id,count:r.count,average:r.average_score,low:r.low_scores})),[{id:manager.id,count:2,average:6,low:1}])
  assert.deepEqual(report.trades.map(r=>[r.trade,r.count,r.average_score]).sort(),[['Electrical',1,3],['Plumbing',1,9]])
  assert.equal(report.crew[0].count,2);assert.equal(report.crew[0].average_score,6)
  const records=(await a.call('/reports/records?record_scope=job')).value.records
  assert.equal(records.find(r=>r.id===a.job.id).values['native.satisfaction_count'],1);assert.equal(records.find(r=>r.id===b.job.id).values['native.satisfaction_score'],3)
  assert.equal((await a.call('/reports/satisfaction',undefined,first)).status,403)
  const before=f.messages.filter(m=>m.subject.startsWith('Public review invitation:')).length
  assert.equal((await b.act('/satisfaction/'+sb.id+'/request-review',{confirm:true})).status,403)
  await a.ok('/satisfaction/'+sa.id+'/review-permission',{allowed:true},first)
  assert.equal((await a.act('/satisfaction/'+sa.id+'/request-review',{confirm:false})).status,400)
  await a.ok('/satisfaction/'+sa.id+'/request-review',{confirm:true})
  const reviews=f.messages.filter(m=>m.subject.startsWith('Public review invitation:')).slice(before)
  assert.equal(reviews.length,1);assert.deepEqual(reviews[0].to,[surveyAddress(401)]);assert.ok(reviews[0].text.includes(surveySettings.review_url));assert.ok(!reviews[0].text.includes('houzz'))
  await b.ok('/satisfaction/'+sb.id+'/review-permission',{allowed:true},second)
  await b.ok('/satisfaction/'+sb.id+'/request-review',{confirm:true})
  assert.equal(f.messages.filter(m=>m.subject.startsWith('Public review invitation:')).length,before+2,'A low score is equally eligible after permission')
  assert.equal((await b.act('/satisfaction/'+sb.id+'/request-review',{confirm:true})).status,409)
  await a.read();assert.equal((await f.json('/api/plinth/jobs/'+a.job.id+'/satisfaction',{token:agent})).status,403)
  assert.equal((await f.json('/api/plinth/reports/satisfaction',{token:agent})).status,403)
  const view=(await a.call('/jobs/'+a.job.id+'/satisfaction',undefined,first)).value
  assert.equal(view.surveys.length,1);assert.equal(view.surveys[0].context,undefined);assert.equal(view.surveys[0].follow_up,undefined);assert.equal(view.consents,undefined)
  await a.call('/team/'+manager.id,{expected_version:1,role:'project_manager',job_ids:[a.job.id],po_limit_cents:0},f.owner,'PUT')
  const narrowed=(await a.call('/reports/satisfaction',undefined,pm)).value
  assert.deepEqual(narrowed.responses.map(r=>r.job_id),[a.job.id]);assert.equal(narrowed.managers[0].count,1);assert.equal(narrowed.managers[0].average_score,9)
 }finally{await f.close()}
})
