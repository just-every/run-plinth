import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture } from './helpers.mjs'
// Six public business flows share one real Worker to keep local resource use small.
test('Plinth residential job lifecycle through authenticated HTTP',async t=>{
 const f=await createFixture();try{
 const client=await f.invite('client@example.com'),other=await f.invite('other@example.com','Other client'),agent=await f.agent();let job=await createActiveJob(f)
 const path=(suffix='')=>`/api/plinth/jobs/${job.id}${suffix}`
 const mutate=async(suffix,body={},credentials={cookie:f.owner})=>f.json(path(suffix),{method:'POST',...credentials,body:{expected_version:job.version,...body}})
 await t.test('private transport, matching client scope and credential authority',async()=>{
  assert.equal((await f.request('/api/plinth/jobs')).status,401)
  assert.equal((await f.request(path(),{cookie:other})).status,404)
  const listing=await f.json('/api/plinth/jobs',{cookie:other});assert.equal(listing.value.jobs.length,0)
  const cross=await f.request(path('/variations'),{method:'POST',cookie:f.owner,headers:{origin:'https://other.example'},body:{expected_version:job.version,description:'Unauthorized request',amount_cents:100}});assert.equal(cross.status,403)
  assert.equal((await mutate('/quotes',{lines:[{description:'Replacement',quantity:1,unit_cents:99}]})).status,409)
  assert.equal((await f.request('/api/plinth/jobs',{method:'POST',token:agent,body:{name:'Agent cannot create job',client_email:'client@example.com'}})).status,403)
 })
 await t.test('agent preparation, client decision and immutable variation evidence',async()=>{
  let r=await mutate('/variations',{description:'Client requested stone benchtop',amount_cents:100_000},{token:agent});assert.equal(r.status,200);job=r.value.job;const id=r.value.record.id
  assert.equal((await mutate(`/variations/${id}/approve`,{},{token:agent})).status,403)
  assert.equal((await mutate(`/variations/${id}/approve`)).status,403)
  assert.equal((await mutate(`/variations/${id}/approve`,{},{cookie:other})).status,404)
  r=await mutate(`/variations/${id}/approve`,{},{cookie:client});assert.equal(r.status,200);job=r.value.job
  const approval=job.approvals.find(a=>a.subject_id===id);assert.equal(approval.prepared_by.role,'agent');assert.equal(approval.approved_by.role,'member');assert.equal(approval.snapshot.amount_cents,100_000)
  assert.equal((await mutate(`/variations/${id}/approve`,{},{cookie:client})).status,409)
 })
 await t.test('trade scheduling blocks overlaps across jobs and stale writers',async()=>{
  const schedule={trade:'North Electrical',start:'2026-11-01T08:00:00+10:00',end:'2026-11-01T12:00:00+10:00',description:'Rough-in'}
  let r=await mutate('/schedules',schedule);assert.equal(r.status,200);const stale=job.version;job=r.value.job
  assert.equal((await mutate('/schedules',{...schedule,expected_version:stale})).status,409)
  const second=await createActiveJob(f,'Bathroom','client@example.com');r=await f.json(`/api/plinth/jobs/${second.id}/schedules`,{method:'POST',cookie:f.owner,body:{...schedule,expected_version:second.version}});assert.equal(r.status,409);assert.equal(r.value.error,'schedule_conflict')
  const concurrent=await Promise.all([mutate('/variations',{description:'Alternative A',amount_cents:100}),mutate('/variations',{description:'Alternative B',amount_cents:200})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);job=concurrent.find(r=>r.status===200).value.job
 })
 await t.test('site diary retains original photo bytes and client-safe published custody',async()=>{
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='
  let r=await mutate('/diary',{date:'2026-11-01',note:'Electrical rough-in complete.',attachments:[{name:'rough-in.png',mime:'image/png',base64:png}]},{token:agent});assert.equal(r.status,200);job=r.value.job;const diary=r.value.record
  let visible=await f.json(path(),{cookie:client});assert.ok(!visible.value.job.diary.some(d=>d.id===diary.id))
  const photo=()=>path(`/diary/${diary.id}/attachments/${diary.attachments[0].id}`)
  assert.equal((await f.request(photo(),{cookie:client})).status,404)
  r=await mutate(`/diary/${diary.id}/approve`);assert.equal(r.status,200);job=r.value.job
  const response=await f.request(photo(),{cookie:client});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(png,'base64'))
  assert.equal((await f.request(photo(),{cookie:other})).status,404)
  assert.equal((await mutate('/diary',{note:'Unsafe upload',attachments:[{name:'unsafe.svg',mime:'image/svg+xml',base64:Buffer.from('<svg/>').toString('base64')}]})).status,400)
 })
 await t.test('supplier commitments, partial receipts and cumulative claim approval/export reconcile once',async()=>{
  let r=await mutate('/orders',{supplier:'Build Supplies',description:'Stone and cabinetry',amount_cents:250_000},{token:agent});assert.equal(r.status,200);job=r.value.job;const order=r.value.record.id
  assert.equal((await mutate(`/orders/${order}/issue`,{},{token:agent})).status,403)
  r=await mutate(`/orders/${order}/issue`);assert.equal(r.status,200);job=r.value.job
  r=await mutate(`/orders/${order}/receive`,{amount_cents:150_000,reference:'Delivery docket 1001'});assert.equal(r.status,200);job=r.value.job
  assert.equal((await mutate(`/orders/${order}/receive`,{amount_cents:100_001,reference:'Over-delivery'})).status,409)
  r=await mutate('/claims',{cumulative_cents:400_000,description:'Rough-in stage'},{token:agent});assert.equal(r.status,200);job=r.value.job;let claim=r.value.record.id
  assert.equal((await mutate(`/claims/${claim}/approve`,{},{token:agent})).status,403)
  r=await mutate(`/claims/${claim}/approve`);assert.equal(r.status,200);job=r.value.job
  const parallel=await Promise.all([mutate(`/claims/${claim}/export`),mutate(`/claims/${claim}/export`)]);assert.ok(parallel.every(r=>[200,409].includes(r.status)));assert.ok(parallel.some(r=>r.status===200));r=parallel.find(r=>r.status===200);job=r.value.job
  const report=r.value.report.reconciliation;assert.equal(report.contract_cents,1_100_000);assert.equal(report.previous_cents,0);assert.equal(report.current_cents,400_000);assert.equal(report.commitments_cents,250_000);assert.equal(report.received_cents,150_000);assert.equal(report.outstanding_cents,100_000)
  const repeated=await mutate(`/claims/${claim}/export`);assert.equal(repeated.status,200);assert.deepEqual(repeated.value.report,r.value.report);assert.equal(repeated.value.job.version,job.version)
  r=await mutate('/claims',{cumulative_cents:700_000,description:'Cabinetry stage'});assert.equal(r.status,200);job=r.value.job;claim=r.value.record.id
  r=await mutate(`/orders/${order}/receive`,{amount_cents:100_000,reference:'Final delivery'});assert.equal(r.status,200);job=r.value.job
  assert.equal((await mutate(`/claims/${claim}/approve`)).status,409)
  r=await mutate('/claims',{cumulative_cents:700_000,description:'Cabinetry stage reconciled'});assert.equal(r.status,200);job=r.value.job;claim=r.value.record.id
  r=await mutate(`/claims/${claim}/approve`);assert.equal(r.status,200);job=r.value.job;r=await mutate(`/claims/${claim}/export`);assert.equal(r.status,200);job=r.value.job;assert.equal(r.value.report.reconciliation.previous_cents,400_000);assert.equal(r.value.report.reconciliation.current_cents,300_000)
  assert.equal((await mutate('/claims',{cumulative_cents:1_100_001,description:'Overclaim'})).status,409)
 })
 await t.test('erasure removes job/photo custody and revoked credentials lose access',async()=>{
  assert.equal((await f.request(path(),{method:'DELETE',cookie:client,body:{expected_version:job.version}})).status,403)
  const photo=job.diary[0];const response=await f.request(path(),{method:'DELETE',cookie:f.owner,body:{expected_version:job.version}});assert.equal(response.status,200)
  assert.equal((await f.request(path(),{cookie:f.owner})).status,404)
  assert.equal((await f.request(path(`/diary/${photo.id}/attachments/${photo.attachments[0].id}`),{cookie:f.owner})).status,404)
  const credentials=await f.json('/api/plinth/agent-credentials',{cookie:f.owner});for(const credential of credentials.value.credentials){assert.equal((await f.request(`/api/plinth/agent-credentials/${credential.id}/revoke`,{method:'POST',cookie:f.owner,body:{}})).status,200)}assert.equal((await f.request('/api/plinth/jobs',{token:agent})).status,401)
  const signout=await f.request('/auth/signout',{method:'POST',cookie:f.owner,body:{}});assert.equal(signout.status,204);assert.equal((await f.request('/api/plinth/jobs',{cookie:f.owner})).status,401)
 })
 }finally{await f.close()}
})

test('INT-006 — calendar subscription scopes approved work, moves/cancels stable events and revokes private links', async () => {
 const { default: ICAL } = await import('ical.js')
 const f = await createFixture()
 try {
  const client = await f.invite('calendar-client@example.com', 'Morgan Chen')
  const other = await f.invite('unrelated@example.com', 'Unrelated client')
  const agent = await f.agent()
  let job = await createActiveJob(f, 'Maple Street remodel', 'calendar-client@example.com', 48_000_000)
  const second = await createActiveJob(f, 'Oak Street addition', 'unrelated@example.com', 32_000_000)
  const root = `/api/plinth/jobs/${job.id}`
  const post = (path, body = {}, cookie = f.owner, token) => f.json(root + path, { method: 'POST', cookie, token, body: { expected_version: job.version, ...body } })
  let r = await post('/schedules', {trade:'North Electrical',description:'Rough-in; kitchen, café\nSecond floor',start:'2026-11-01T01:30:00-04:00',end:'2026-11-01T02:30:00-05:00'})
  assert.equal(r.status,200); job=r.value.job; const booked=r.value.record.id
  r=await post('/schedules',{trade:'Draft plumber',description:'Private draft',start:'2026-11-03T08:00:00-05:00',end:'2026-11-03T12:00:00-05:00'},undefined,agent)
  assert.equal(r.status,200);job=r.value.job
  r=await f.json(`/api/plinth/jobs/${second.id}/schedules`,{method:'POST',cookie:f.owner,body:{expected_version:second.version,trade:'Other job trade',description:'Never in Maple feed',start:'2026-11-02T08:00:00-05:00',end:'2026-11-02T12:00:00-05:00'}})
  assert.equal(r.status,200)
  assert.equal((await post('/calendar',{action:'rotate'},other)).status,404)
  assert.equal((await post('/calendar',{action:'rotate'},undefined,agent)).status,403)
  assert.equal((await f.request(root+'/calendar',{method:'POST',body:{action:'rotate',expected_version:job.version}})).status,401)
  r=await post('/calendar',{action:'rotate'},client);assert.equal(r.status,200);let path=r.value.urlPath
  assert.equal((await f.request(root+'/calendar',{method:'POST',cookie:client,headers:{origin:'https://other.example'},body:{action:'rotate',expected_version:job.version}})).status,403)
  assert.equal((await post('/calendar',{action:'rotate',expected_version:job.version-1},client)).status,409)
  const read=async p=>{const response=await f.request(p);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/calendar/);assert.match(response.headers.get('cache-control'),/no-store/);const text=await response.text();return {text,events:new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent')}}
  let calendar=await read(path);assert.equal(calendar.events.length,1)
  const initial=new ICAL.Event(calendar.events[0]);const uid=initial.uid
  assert.equal(initial.summary,'North Electrical');assert.equal(initial.description,'Rough-in; kitchen, café\nSecond floor')
  assert.equal(initial.startDate.toJSDate().toISOString(),'2026-11-01T05:30:00.000Z');assert.equal(initial.endDate.toJSDate().toISOString(),'2026-11-01T07:30:00.000Z')
  assert.doesNotMatch(calendar.text,/Private draft|Never in Maple|48000000|calendar-client@|Maple Street|22 Example/)
  assert.equal((await f.request(path,{method:'POST',body:{}})).status,405)
  r=await post(`/schedules/${booked}/move`,{start:'2026-11-02T09:00:00-05:00',end:'2026-11-02T11:00:00-05:00',expected_version:job.version-1});assert.equal(r.status,409)
  r=await f.json(`/api/plinth/jobs/${second.id}`,{cookie:f.owner});const otherJob=r.value.job
  r=await f.json(`/api/plinth/jobs/${second.id}/schedules`,{method:'POST',cookie:f.owner,body:{expected_version:otherJob.version,trade:'North Electrical',description:'Conflicting booked work',start:'2026-11-05T08:00:00-05:00',end:'2026-11-05T12:00:00-05:00'}});assert.equal(r.status,200)
  r=await post(`/schedules/${booked}/move`,{start:'2026-11-05T09:00:00-05:00',end:'2026-11-05T11:00:00-05:00'});assert.equal(r.status,409)
  calendar=await read(path);assert.equal(new ICAL.Event(calendar.events[0]).startDate.toJSDate().toISOString(),'2026-11-01T05:30:00.000Z')
  assert.equal((await post(`/schedules/${booked}/move`,{start:'2026-11-04T08:00:00-05:00',end:'2026-11-04T12:00:00-05:00'},client)).status,403)
  r=await post(`/schedules/${booked}/move`,{start:'2026-11-04T08:00:00-05:00',end:'2026-11-04T12:00:00-05:00'});assert.equal(r.status,200);job=r.value.job
  calendar=await read(path);let event=new ICAL.Event(calendar.events[0]);assert.equal(event.uid,uid);assert.equal(event.sequence,1);assert.equal(event.startDate.toJSDate().toISOString(),'2026-11-04T13:00:00.000Z')
  assert.equal((await post(`/schedules/${booked}/cancel`,{},undefined,agent)).status,403)
  r=await post(`/schedules/${booked}/cancel`);assert.equal(r.status,200);job=r.value.job
  calendar=await read(path);event=new ICAL.Event(calendar.events[0]);assert.equal(event.uid,uid);assert.equal(event.sequence,2);assert.equal(calendar.events[0].getFirstPropertyValue('status'),'CANCELLED')
  const history=await f.json(root,{cookie:f.owner});assert.deepEqual(history.value.job.approvals.filter(a=>a.kind.startsWith('schedule.')).map(a=>a.kind).sort(),['schedule.cancel','schedule.move'])
  r=await post('/calendar',{action:'rotate'},client);assert.equal(r.status,200);assert.equal((await f.request(path)).status,404);path=r.value.urlPath;await read(path)
  r=await post('/calendar',{action:'revoke'},client);assert.equal(r.status,200);assert.equal((await f.request(path)).status,404)
  r=await post('/calendar',{action:'rotate'},client);assert.equal(r.status,200);const clientPath=r.value.urlPath
  const people=await f.json('/auth/operators',{cookie:f.owner});const person=people.value.find(p=>p.email==='calendar-client@example.com')
  assert.equal((await f.request('/auth/operator/status',{method:'POST',cookie:f.owner,body:{operatorId:person.id,status:'inactive'}})).status,200)
  assert.equal((await f.request(clientPath)).status,404)
  r=await post('/calendar',{action:'rotate'});assert.equal(r.status,200);path=r.value.urlPath
  assert.equal((await f.request(root,{method:'DELETE',cookie:f.owner,body:{expected_version:job.version}})).status,200)
  assert.equal((await f.request(path)).status,404)
 } finally { await f.close() }
})
