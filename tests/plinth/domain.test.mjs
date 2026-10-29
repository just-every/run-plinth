import { readRecoveryReport, checkRecoveryReport } from './recovery-report-support.mjs'
import { proveDrawingReview } from './drawing-review-support.mjs'
import {setPortalFeatures} from './helpers.mjs'
import { scannedPlan, takeoffPlan } from '../fixtures/takeoff-plan.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture, createReleasedScope } from './helpers.mjs'
// Six public business flows share one real Worker to keep local resource use small.
test('Plinth residential job lifecycle through authenticated HTTP',async t=>{
 const f=await createFixture();try{
 const client=await f.invite('client@example.com'),other=await f.invite('other@example.com','Other client'),agent=await f.agent();let job=await createActiveJob(f)
 const path=(suffix='')=>`/api/plinth/jobs/${job.id}${suffix}`
 const mutate=async(suffix,body={},credentials={cookie:f.owner})=>f.json(path(suffix),{method:'POST',...credentials,body:{expected_version:job.version,...body}})
 await t.test('private transport, matching client scope and credential authority',async()=>{
  const longBody='synthetic-plinth-source-text '.repeat(2500)+'synthetic-plinth-source-end'
  const mailAddress=label=>[label,'example.com'].join('@')
  const raw=Buffer.from(['From: '+mailAddress('synthetic-plinth-source'),'To: '+mailAddress('builder'),'Subject: Synthetic long recovery source','Message-ID: <'+mailAddress('synthetic-plinth-long-source')+'>','Content-Type: text/plain; charset=utf-8','',''+longBody].join('\r\n'))
  const captured=await f.json(path('/correspondence'),{method:'POST',cookie:f.owner,body:{kind:'capture',original_base64:raw.toString('base64'),confirm:true}});assert.equal(captured.status,201)
  assert.equal(captured.value.messages.find(message=>message.id===captured.value.id).body,longBody)
  const inventory=await f.request('/api/plinth/recovery/manifest.json',{cookie:f.owner});assert.equal(inventory.status,200);assert.match(inventory.headers.get('content-disposition'),/attachment/)
  const manifest=await inventory.json();assert.ok(manifest.records.some(row=>row.kind==='pl_jobs'));assert.ok(manifest.records.some(row=>row.kind==='revision-reference'));assert.ok(manifest.exclusions.length)
  const admin=await f.invite(['synthetic-plinth-admin','example.com'].join('@'),'Synthetic administrator','admin')
  const snapshot=(await f.json(path(),{cookie:f.owner})).value.job,mailCount=f.messages.length
  const same=await f.json('/api/plinth/recovery/reconcile',{method:'POST',cookie:f.owner,body:{manifest}});assert.equal(same.status,200);assert.equal(same.value.matches,true)
  const changed=structuredClone(manifest),record=changed.records.find(row=>row.kind==='pl_jobs');record.sha256='0'.repeat(64);changed.records.splice(changed.records.findIndex(row=>row.kind==='revision-reference'),1);changed.records.push({kind:'pl_jobs',identity:'synthetic-plinth-missing',sha256:'1'.repeat(64)})
  changed.controls[0].issued_gross_cents++
  const comparison=await f.json('/api/plinth/recovery/reconcile',{method:'POST',cookie:f.owner,body:{manifest:changed}});assert.equal(comparison.status,200);assert.equal(comparison.value.matches,false);assert.ok(comparison.value.records.mismatched.includes(record.identity));assert.deepEqual(comparison.value.records.missing,['synthetic-plinth-missing']);assert.equal(comparison.value.records.extra.length,1);assert.equal(comparison.value.control_totals.match,false)
  for(const format of ['csv','xlsx','pdf']){
   const response=await f.request('/api/plinth/recovery/inventory.'+format,{cookie:f.owner});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store')
   const inventoryReport=await readRecoveryReport(Buffer.from(await response.arrayBuffer()),format);checkRecoveryReport(inventoryReport,manifest,['USD',0,0,0,0,0,0,0]);assert.ok(inventoryReport.text.replace(/\s/g,'').includes('Kitchenrenovation'));assert.ok(inventoryReport.text.replace(/\s/g,'').includes('AgreedrenovationworksincludingGST'));assert.ok(inventoryReport.text.includes('/data/quotes/0/total_cents'))
   if(inventoryReport.rows){
    const bodyRows=inventoryReport.rows.filter(row=>row[0]==='Field'&&row[1]==='pl_mail_messages:'+JSON.stringify([captured.value.id])&&row[2]==='/body')
    assert.equal(bodyRows.map(row=>row[4]).join(''),longBody,'Recovery report retains every character of a supported long correspondence source')
    if(format==='xlsx'){assert.ok(bodyRows.length>1);assert.ok(bodyRows.every(row=>row[4].length<=32767));assert.deepEqual(bodyRows.map(row=>row[5]),bodyRows.map((_,index)=>`${index+1} of ${bodyRows.length}`))}
   }else assert.ok(inventoryReport.text.replace(/\s/g,'').includes(longBody.replace(/\s/g,'')),'PDF retains the full long correspondence source across pages')
   const exported=await f.request('/api/plinth/recovery/reconcile.'+format,{method:'POST',cookie:f.owner,body:{manifest:changed}});assert.equal(exported.status,200)
   const report=await readRecoveryReport(Buffer.from(await exported.arrayBuffer()),format);checkRecoveryReport(report,manifest,['USD',0,0,0,0,0,0,0],true);assert.ok(report.text.includes('synthetic-plinth-missing'));assert.ok(report.text.includes('Inventory differences found'))
   const hostile=structuredClone(manifest);hostile.records.push({kind:'pl_jobs',identity:'=synthetic-plinth-operator',sha256:'1'.repeat(64)})
   const inert=await f.request('/api/plinth/recovery/reconcile.'+format,{method:'POST',cookie:f.owner,body:{manifest:hostile}});assert.equal(inert.status,200)
   const inertReport=await readRecoveryReport(Buffer.from(await inert.arrayBuffer()),format)
   if(inertReport.rows)assert.equal(inertReport.rows.find(row=>row[0]==='Difference'&&row[2]==='missing')[3],(format==='csv'?"'":'')+'=synthetic-plinth-operator','Unverified source identities remain non-executable text in spreadsheet reports')
   for(const credentials of [{cookie:client},{cookie:other},{cookie:admin},{token:agent},{}]){
    assert.ok([401,403].includes((await f.request('/api/plinth/recovery/inventory.'+format,credentials)).status))
    assert.ok([401,403].includes((await f.request('/api/plinth/recovery/reconcile.'+format,{...credentials,method:'POST',body:{manifest}})).status))
   }
  }
  for(const credentials of [{cookie:client},{cookie:other},{cookie:admin},{token:agent},{}]){assert.ok([401,403].includes((await f.request('/api/plinth/recovery/manifest.json',credentials)).status));assert.ok([401,403].includes((await f.request('/api/plinth/recovery/reconcile',{...credentials,method:'POST',body:{manifest}})).status))}
  const invalid=structuredClone(manifest);invalid.records.push(invalid.records[0]);assert.equal((await f.json('/api/plinth/recovery/reconcile',{method:'POST',cookie:f.owner,body:{manifest:invalid}})).status,400)
  for(const format of ['csv','xlsx','pdf'])assert.equal((await f.request('/api/plinth/recovery/reconcile.'+format,{method:'POST',cookie:f.owner,body:{manifest:invalid}})).status,400)
  assert.deepEqual((await f.json(path(),{cookie:f.owner})).value.job,snapshot);assert.equal(f.messages.length,mailCount);assert.deepEqual((await f.json('/api/plinth/recovery/manifest.json',{cookie:f.owner})).value,manifest)

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
  const credentials=await f.json('/api/plinth/agent-credentials',{cookie:f.owner});for(const credential of credentials.value.credentials){assert.equal((await f.request(`/api/plinth/agent-credentials/${credential.id}/revoke`,{method:'POST',cookie:f.owner,body:{}})).status,200)}assert.equal((await f.request('/api/plinth/jobs',{token:agent})).status,401);assert.equal((await f.request('/api/plinth/recovery/manifest.json',{token:agent})).status,401)
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

test('EST-007 / AUTO-002 — exact recorded acceptance freezes one coded original plan and revised budgets drive the next native draw',async()=>{
 const f=await createFixture()
 try{
  const client=await f.invite('budget-client@example.com'),agent=await f.agent()
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{...(body===undefined?{}:{method:'POST',body}),cookie,token})
  let r=await api('/jobs',{name:'Maple Street kitchen and porch',client_email:'budget-client@example.com'});let job=r.value.job
  const act=async(path,body={},cookie=f.owner,token)=>{const r=await api('/jobs/'+job.id+path,{expected_version:job.version,...body},cookie,token);if(r.value.job&&cookie===f.owner&&!token)job=r.value.job;return r}
  const line=(id,code,cost,sell)=>({id,cost_code:code,description:id,quantity:'1',unit:'each',phase:'Remodel',category:'material',cost_unit_cents:cost,unit_cents:sell})
  await act('/quotes',{lines:[line('Tile supply','09-300',60000,100000),line('Plumbing fixtures','22-400',25000,50000)]})
  const quote=job.quotes[0],accept={method:'email',evidence:'Client email agreeing exact dated scope and price',schedule_choice:{kind:'none',reason:'Schedule dates reviewed after permit approval'},budget:{allowances:[{cost_code:'09-300',amount_cents:50000}],commitment_plan:[{cost_code:'09-300',amount_cents:60000,description:'Tile procurement after client choice'}]}}
  assert.equal((await act('/quotes/'+quote.id+'/accept',{...accept,schedule_choice:undefined})).status,400)
  assert.equal((await act('/quotes/'+quote.id+'/accept',accept,undefined,agent)).status,403)
  assert.equal((await act('/quotes/'+quote.id+'/accept',accept)).status,200)
  assert.equal(job.quotes[0].acceptance.method,'email');assert.equal(job.quotes[0].acceptance.evidence,accept.evidence);assert.equal(job.orders.length,0,'A commitments plan creates no vendor order');const original=structuredClone(job.budgets[0]);assert.equal(original.source.id,quote.id);assert.equal(original.source.revision,quote.revision);assert.equal(original.contract_cents,150000);assert.equal(original.schedule.kind,'none');assert.equal(original.schedule.reason,accept.schedule_choice.reason)
  assert.deepEqual(original.codes,[{cost_code:'09-300',revenue_cents:100000,cost_cents:60000,allowance_cents:50000,commitment_plan_cents:60000},{cost_code:'22-400',revenue_cents:50000,cost_cents:25000,allowance_cents:0,commitment_plan_cents:0}]);assert.equal(original.billing_lines.reduce((s,l)=>s+l.scheduled_cents,0),150000)
  assert.equal((await act('/quotes/'+quote.id+'/accept',accept)).status,409)
  let all=(await api('/jobs')).value.jobs;assert.equal(all.filter(j=>j.id===job.id).length,1);assert.equal(job.budgets.length,1)
  r=await act('/claims',{description:'Original first draw',cumulative_cents:30000});const first=r.value.record
  assert.equal(first.reconciliation.budget_revision,1);await act('/claims/'+first.id+'/approve');await act('/claims/'+first.id+'/export');const issued=structuredClone(job.claims[0])
  r=await act('/variations',{description:'Client approved revised porch scope',amount_cents:10000});const variation=r.value.record
  assert.equal(job.budgets.length,1,'An unapproved change cannot affect economics')
  assert.equal((await act('/variations/'+variation.id+'/approve',{},client)).status,200);job=(await api('/jobs/'+job.id)).value.job
  assert.equal(job.budgets.length,2);assert.deepEqual(job.budgets[0],original);assert.equal(job.budgets[1].contract_cents,160000);assert.deepEqual(job.budgets[1].codes.at(-1),{cost_code:'Unassigned',revenue_cents:10000,cost_cents:null,allowance_cents:0,commitment_plan_cents:0});assert.equal(job.budgets[1].billing_lines.at(-1).id,'variation:'+variation.id)
  assert.equal((await act('/variations/'+variation.id+'/approve',{},client)).status,409)
  r=await act('/claims',{description:'Next cumulative draw on revised contract',cumulative_cents:80000});assert.equal(r.value.record.reconciliation.contract_cents,160000);assert.equal(r.value.record.reconciliation.current_cents,50000);assert.equal(r.value.record.reconciliation.remaining_cents,80000);assert.equal(r.value.record.reconciliation.budget_revision,2);assert.deepEqual(job.claims[0],issued)
  const generic=job.continuity.find(w=>w.source.id===variation.id)
  for(let step=0;step<3;step++)assert.equal((await act('/continuity/'+generic.id+'/resume')).status,200)
  const prepared=job.continuity.find(w=>w.id===generic.id)
  assert.equal(prepared.schedule.calendar_day_impact,null);assert.equal(prepared.purchasing.order_id,undefined);assert.equal(prepared.purchasing.lines[0].scheduled_cents,10000);assert.equal(prepared.billing.adjustment_cents,10000);assert.equal(job.orders.length,0)
  assert.equal(job.claims.filter(c=>c.status!=='draft').length,1,'Continuity cannot approve financial work')
  r=await api('/pricing-rates',{jurisdiction:'Reviewed test exemption',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'Reviewed cost-code budget test rate',human_reviewed:true});const rate=r.value.rate
  const codedChange={description:'Two-code revised tile and fixture package',direction:'charge',basis:'sell',as_of:'2026-10-20',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['tile-change','fixture-change']},lines:[line('tile-change','09-300',3000,5000),line('fixture-change','22-400',1000,2000)]}
  r=await act('/variation-pricing/preview',codedChange);assert.equal(r.status,200);await act('/variation-pricing/apply',{...codedChange,digest:r.value.preview.digest});const coded=job.variations.at(-1)
  assert.equal((await act('/variations/'+coded.id+'/approve',{},client)).status,200);job=(await api('/jobs/'+job.id)).value.job
  assert.deepEqual(job.budgets[0],original);assert.equal(job.budgets[2].contract_cents,167000);assert.deepEqual(job.budgets[2].codes.slice(0,2).map(c=>[c.cost_code,c.revenue_cents,c.cost_cents]),[['09-300',105000,63000],['22-400',52000,26000]]);assert.equal(job.budgets[2].billing_lines.reduce((sum,l)=>sum+l.scheduled_cents,0),167000)
  r=await act('/claims',{description:'Next draw includes both revised cost codes',cumulative_cents:81000});assert.equal(r.value.record.reconciliation.budget_revision,3);assert.equal(r.value.record.reconciliation.contract_cents,167000)
  for(const path of ['/jobs/'+job.id,'/jobs']){const shown=(await api(path,undefined,client)).value;assert.ok(!JSON.stringify(shown).includes('budgets'));assert.ok(!JSON.stringify(shown).includes('cost_cents'))}
  // A second acceptance uses an exact, reviewed reusable template in the same atomic job write.
  const calendar={weekdays:[1,2,3,4,5],start_hour:8,end_hour:17,holidays:[]}
  r=await api('/schedule-templates',{name:'Kitchen fit-out',calendar,tasks:[{id:'fitout',trade:'Carpentry',description:'Kitchen cabinetry installation',start:'2026-11-02T08:00:00Z',duration_minutes:60}]});assert.equal(r.status,201);const template=r.value.template
  r=await api('/jobs',{name:'Cedar Lane cabinetry',client_email:'budget-client@example.com',time_zone:'America/New_York'});job=r.value.job;await act('/quotes',{lines:[line('Cabinetry','06-400',100000,150000)]});const q=job.quotes[0],input={template_id:template.id,start:'2026-11-09T13:00:00Z'}
  r=await act('/quotes/'+q.id+'/plan-preview',input);assert.equal(r.status,200);const preview=r.value.preview
  assert.equal((await act('/quotes/'+q.id+'/accept',{...accept,budget:{},schedule_choice:{kind:'template',input:{...input,digest:'stale'}}})).status,409)
  assert.equal((await act('/quotes/'+q.id+'/accept',{...accept,budget:{},schedule_choice:{kind:'template',input:{...input,digest:preview.digest}}})).status,200)
  assert.equal(job.continuity.length,1);assert.equal(job.continuity[0].source.id,q.id);assert.equal(job.continuity[0].budget_id,job.budgets[0].id)
  assert.equal(job.schedules.length,1);assert.equal(job.schedules[0].start,'2026-11-09T13:00:00.000Z');assert.equal(job.time_zone,'America/New_York');assert.equal(job.budgets[0].schedule.application.template_id,template.id);assert.equal(job.budgets[0].schedule.application.template_version,template.version);assert.deepEqual(job.budgets[0].schedule.application.task_ids,job.schedules.map(t=>t.id))
 }finally{await f.close()}
})

test('DOC-003 — sheet-linked field RFI, assigned revised detail, explicit trade distribution and acknowledgment, client-change work hold and revocation',async()=>{
 const f=await createFixture()
 try{
  const field=await f.invite('field@example.com','Field Lead'),designer=await f.invite('designer@example.com','Design Reviewer'),trade=await f.invite('rfi-trade@example.com','Affected Trade'),other=await f.invite('rfi-other@example.com'),client=await f.invite('client@example.com','Client Reviewer'),agent=await f.agent()
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{cookie,token,...(body?{method:'POST',body}:{})})
  let job=(await api('/jobs',{name:'RFI kitchen clash',client_email:'client@example.com'})).value.job
  const read=async()=>{job=(await api(`/jobs/${job.id}`)).value.job;return job}
  const act=async(path,body={},cookie=f.owner,token)=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie,token);await read();return r}
  const inboxAct=async(path,body={},cookie=field)=>{const r=await api(`/rfi-inbox/${job.id}/rfis${path}`,{expected_version:job.version,...body},cookie);await read();return r}
  assert.equal((await act('/quotes',{lines:[{id:'framing',description:'Kitchen framing',cost_code:'06-100',phase:'Structure',category:'labor',quantity:'1',unit:'job',unit_cents:100000,cost_unit_cents:80000}]})).status,200)
  assert.equal((await act(`/quotes/${job.quotes[0].id}/accept`,{method:'email',evidence:'Recorded client acceptance',schedule_choice:{kind:'none',reason:'Field dimensions pending'}})).status,200)
  const drawing=takeoffPlan(),original={name:'kitchen-sheet.pdf',mime:'application/pdf',base64:drawing.toString('base64')}
  assert.equal((await act('/takeoff',{name:'A1 Kitchen',page:1,width:400,height:400,document:original})).status,200);const sheet=job.takeoff[0]
  assert.equal((await act('/schedules',{trade:'Framing',description:'Frame affected wall',start:'2026-11-06T08:00:00Z',end:'2026-11-06T10:00:00Z'})).status,200);const task=job.schedules[0]
  const scopeSetup=await createReleasedScope(f,job,'rfi-trade@example.com','Framing');job=scopeSetup.job
  for(const [email,role,sheet_ids] of [['field@example.com','field',[sheet.id]],['designer@example.com','designer',[]],['rfi-trade@example.com','trade',[]]])assert.equal((await act('/rfi-access',{email,role,sheet_ids,...(role==='trade'?{subcontract_id:scopeSetup.scope.id}:{})})).status,200)
  assert.deepEqual((await api('/rfi-inbox',undefined,other)).value.jobs,[]);assert.equal((await api(`/jobs/${job.id}`,undefined,field)).status,404)
  const source=(await api('/rfi-inbox',undefined,field)).value.jobs[0];assert.equal(source.sheets[0].revisions[0].id,sheet.revisions[0].id);assert.deepEqual(source.cost_codes,['06-100']);assert.equal(source.quotes,undefined)
  const question={title:'Beam and duct clash',question:'Resolve the beam/duct conflict at grid C3',sheet:{sheet_id:sheet.id,revision_id:sheet.revisions[0].id},cost_code:'06-100',task_ids:[task.id],assignee_email:'designer@example.com',due_on:'2026-11-04',attachments:[original]}
  assert.equal((await inboxAct('',question,designer)).status,403)
  assert.equal((await act('/rfis',question,undefined,agent)).status,403)
  let r=await inboxAct('',question);assert.equal(r.status,200);const rfi=r.value.rfi,id=rfi.id;assert.equal(rfi.by.name,'Field Lead');assert.equal(rfi.sheet.document.checksum,sheet.revisions[0].document.checksum)
  assert.equal((await act(`/rfis/${id}/route`,{assignee_email:'designer@example.com',recipient_emails:['rfi-trade@example.com'],reason:'Affected framing trade must review the exact revised detail'})).status,200)
  const secondScope=await createReleasedScope(f,job,'rfi-other@example.com','Framing');job=secondScope.job
  assert.equal((await act('/rfi-access',{email:'rfi-other@example.com',role:'trade',sheet_ids:[],subcontract_id:secondScope.scope.id})).status,200)
  const sourceResponse=await f.request(`/api/plinth/rfi-inbox/${job.id}/files/${sheet.revisions[0].document.id}`,{cookie:designer});assert.equal(sourceResponse.status,200);assert.deepEqual(Buffer.from(await sourceResponse.arrayBuffer()),drawing)
  assert.equal((await f.request(`/api/plinth/rfi-inbox/${job.id}/files/${sheet.revisions[0].document.id}`,{cookie:other})).status,404)
  const detail=Buffer.from('%PDF-1.4\nsynthetic-plinth-2 revised structural detail\n%%EOF'),response={text:'Move the duct opening; install the engineer-reviewed revised detail',cost_impact_cents:15000,date_impact_days:2,attachments:[{name:'revised-detail.pdf',mime:'application/pdf',base64:detail.toString('base64')}]}
  assert.equal((await inboxAct(`/${id}/respond`,response,trade)).status,403)
  r=await inboxAct(`/${id}/respond`,response,designer);assert.equal(r.status,200);let answer=job.rfis[0].responses[0]
  assert.equal((await api('/rfi-inbox',undefined,trade)).value.jobs[0].rfis[0].responses.length,0,'Unreviewed design responses are not distributed')
  const count=job.variations.length,before=structuredClone(job.schedules),messages=f.messages.length
  assert.equal((await act(`/rfis/${id}/publish`,{response_id:answer.id,confirm:true,cost_impact_cents:1,date_impact_days:2})).value.error,'rfi_review')
  assert.equal((await act(`/rfis/${id}/publish`,{response_id:answer.id,confirm:true,cost_impact_cents:15000,date_impact_days:2})).status,200)
  assert.equal(job.variations.length,count+1);const change=job.variations.at(-1);assert.equal(change.status,'draft');assert.equal(change.amount_cents,15000);assert.deepEqual(job.schedules,before);assert.equal(job.orders.length,0);assert.equal(f.messages.length,messages,'Publication is in-app distribution, not claimed email')
  assert.equal((await act(`/rfis/${id}/route`,{assignee_email:'designer@example.com',recipient_emails:['rfi-trade@example.com','rfi-other@example.com'],reason:'Prepare an additional recipient for the next explicit distribution'})).status,200)
  assert.equal((await api('/rfi-inbox',undefined,other)).value.jobs[0].rfis[0].responses.length,0,'Changing routing does not distribute an older exact response to a new recipient')
  assert.equal((await act(`/rfis/${id}/route`,{assignee_email:'designer@example.com',recipient_emails:['rfi-trade@example.com'],reason:'Retain the original distribution for this exact response'})).status,200)
  const tradeRfi=(await api('/rfi-inbox',undefined,trade)).value.jobs[0].rfis[0];assert.equal(tradeRfi.responses[0].text,response.text);assert.equal(tradeRfi.responses[0].cost_impact_cents,undefined);assert.equal(tradeRfi.responses[0].change_pending,true);assert.equal(tradeRfi.responses[0].recipient_grants,undefined,'Private distribution grant snapshots never leak through the trade view')
  const searchPath=`/rfi-inbox/${job.id}/decision-search`
  const found=await api(searchPath+'?'+new URLSearchParams({q:response.text,sheet:sheet.name,cost_code:'06-100'}),undefined,trade)
  assert.equal(found.status,200);assert.equal(found.value.count,1);assert.equal(found.value.results[0].source,'rfi-responses:'+answer.id)
  assert.ok(found.value.results[0].files.some(file=>file.href.endsWith(sheet.revisions[0].document.id)),'Search links the exact distributed sheet even without a browsing grant')
  assert.equal((await api(found.value.results[0].href.replace('/api/plinth',''),undefined,trade)).value.count,1)
  assert.equal((await api(searchPath+'?q='+encodeURIComponent(response.text),undefined,other)).value.count,0,'New routing cannot expose an older published answer')
  const download=await f.request(`/api/plinth/rfi-inbox/${job.id}/files/${answer.attachments[0].id}`,{cookie:trade});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),detail)
  assert.equal((await act(`/schedules/${task.id}/move`,{start:'2026-11-06T11:00:00Z',end:'2026-11-06T13:00:00Z'})).value.error,'schedule_hold')
  assert.equal((await act(`/rfis/${id}/resolve`,{reason:'Too early'})).value.error,'rfi_change_pending')
  assert.equal((await act(`/variations/${change.id}/approve`)).status,403)
  assert.equal((await inboxAct(`/${id}/acknowledge`,{response_id:answer.id},trade)).status,200);assert.equal((await inboxAct(`/${id}/acknowledge`,{response_id:answer.id},trade)).status,409)
  assert.equal((await act(`/variations/${change.id}/approve`,{},client)).status,200);assert.deepEqual(job.schedules,before,'Client change approval never publishes dates automatically')
  assert.equal((await act(`/rfis/${id}/resolve`,{reason:'Client approved extra work; trade acknowledged exact detail'})).status,200);assert.equal(job.rfis[0].resolved.by.name,'Builder')
  assert.equal((await act(`/schedules/${task.id}/move`,{start:'2026-11-06T11:00:00Z',end:'2026-11-06T13:00:00Z'})).status,200)
  assert.equal((await act(`/rfis/${id}/reopen`,{reason:'Further coordination required'})).status,200)
  r=await inboxAct(`/${id}/respond`,{...response,text:'Second revised detail',cost_impact_cents:18000},designer);assert.equal(r.status,200);answer=job.rfis[0].responses.at(-1)
  assert.equal((await act(`/rfis/${id}/publish`,{response_id:answer.id,confirm:true,cost_impact_cents:18000,date_impact_days:2})).status,200);assert.equal(job.variations.at(-1).amount_cents,3000,'A revision changes only the increment from the last approved RFI price')
  const supersededChange=job.variations.at(-1)
  r=await inboxAct(`/${id}/respond`,{...response,text:'Third exact design response',cost_impact_cents:19000},designer);assert.equal(r.status,200);const latest=job.rfis[0].responses.at(-1)
  assert.equal((await act(`/rfis/${id}/publish`,{response_id:latest.id,confirm:true,cost_impact_cents:19000,date_impact_days:2})).status,200)
  assert.equal((await act(`/variations/${supersededChange.id}/approve`,{},client)).value.error,'rfi_stale')
  assert.equal(job.rfis[0].responses[0].text,response.text);assert.equal(job.rfis[0].responses[0].acknowledgments[0].by.name,'Affected Trade')
  const latestChange=job.variations.at(-1);assert.equal((await act(`/variations/${latestChange.id}/approve`,{},client)).status,200)
  assert.equal((await inboxAct(`/${id}/respond`,{...response,text:'Date-only coordination revision',cost_impact_cents:19000,date_impact_days:3},designer)).status,200)
  const dateOnly=job.rfis[0].responses.at(-1);assert.equal((await act(`/rfis/${id}/publish`,{response_id:dateOnly.id,confirm:true,cost_impact_cents:19000,date_impact_days:3})).status,200)
  const dateBudgets=structuredClone(job.budgets);const zeroChange=job.variations.at(-1);assert.equal(zeroChange.amount_cents,0);assert.equal((await act(`/variations/${zeroChange.id}/approve`,{},client)).status,200,'A date-only response still needs explicit native client approval');assert.deepEqual(job.budgets,dateBudgets,'Date-only approval preserves every economic and billing source')
  const pm=await f.invite('rfi-pm@example.com','Assigned RFI PM','admin'),pmRow=(await api('/team')).value.team.find(p=>p.email==='rfi-pm@example.com')
  assert.equal((await f.json('/api/plinth/team/'+pmRow.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'project_manager',job_ids:[job.id],po_limit_cents:0}})).status,200)
  assert.equal((await act('/rfi-access',{email:'field@example.com',role:'field',sheet_ids:[sheet.id]},pm)).status,200,'The assigned PM grants only within this job')
  assert.equal((await act(`/rfis/${id}/route`,{assignee_email:'designer@example.com',recipient_emails:['rfi-trade@example.com'],reason:'Assigned PM coordination'},pm)).status,200)
  assert.equal((await act(`/rfis/${id}/respond`,{...response,text:'Assigned PM exact office response',cost_impact_cents:19000,date_impact_days:0},pm)).status,200)
  const pmAnswer=job.rfis[0].responses.at(-1)
  assert.equal((await act(`/rfis/${id}/publish`,{response_id:pmAnswer.id,confirm:true,cost_impact_cents:19000,date_impact_days:0},pm)).status,200)
  assert.equal((await inboxAct(`/${id}/acknowledge`,{response_id:pmAnswer.id},trade)).status,200)
  const scopeId=scopeSetup.scope.id,contacts=job.subcontracts.find(s=>s.id===scopeId).contact_ids
  for(const change of [{contact_ids:[]},{hold:true}]){
   assert.equal((await act(`/subcontracts/${scopeId}/access`,{...change,reason:'Owner revokes released contact access'})).status,200)
   assert.deepEqual((await api('/rfi-inbox',undefined,trade)).value.jobs,[])
   assert.equal((await api(searchPath+'?q='+encodeURIComponent(response.text),undefined,trade)).status,404,'Next-request search revocation matches file revocation')
   for(const fileId of [sheet.revisions[0].document.id,answer.attachments[0].id])assert.equal((await f.request(`/api/plinth/rfi-inbox/${job.id}/files/${fileId}`,{cookie:trade})).status,404)
   assert.equal((await inboxAct(`/${id}/acknowledge`,{response_id:pmAnswer.id},trade)).status,404)
   assert.equal((await act(`/rfis/${id}/resolve`,{reason:'Old acknowledgment must not bypass revocation'},pm)).value.error,'rfi_contact')
   if(change.contact_ids){assert.equal((await act(`/subcontracts/${scopeId}/access`,{contact_ids:contacts,reason:'Owner reassigns company contact'})).status,200);assert.equal((await act(`/rfis/${id}/resolve`,{reason:'Restoration still needs a fresh distribution'},pm)).value.error,'rfi_contact')}
  }
  assert.equal((await act(`/rfis/${id}/route`,{assignee_email:'designer@example.com',recipient_emails:[],reason:'Publish a new revision to current recipients'},pm)).status,200)
  assert.equal((await act(`/rfis/${id}/resolve`,{reason:'Routing alone cannot repair the old distribution'},pm)).value.error,'rfi_contact')
  assert.equal((await act(`/rfis/${id}/respond`,{...response,text:'Reissued to current contacts',cost_impact_cents:19000,date_impact_days:0},pm)).status,200)
  const republished=job.rfis[0].responses.at(-1)
  assert.equal((await act(`/rfis/${id}/publish`,{response_id:republished.id,confirm:true,cost_impact_cents:19000,date_impact_days:0},pm)).status,200)
  assert.equal((await act(`/rfis/${id}/resolve`,{reason:'Current publication and client decisions complete'},pm)).status,200)
  const outside=await createActiveJob(f,'Other PM job');assert.equal((await api(`/jobs/${outside.id}/rfi-access`,{expected_version:outside.version,email:'field@example.com',role:'field',sheet_ids:[]},pm)).status,404)
  assert.equal((await act(`/subcontracts/${scopeId}/release`)).status,200)
  job=await setPortalFeatures(f,job.id,[],['rfis'])
  assert.deepEqual((await api('/rfi-inbox',undefined,trade)).value.jobs,[])
  assert.equal((await f.request(`/api/plinth/rfi-inbox/${job.id}/files/${answer.attachments[0].id}`,{cookie:trade})).status,404)
  assert.equal((await inboxAct(`/${id}/acknowledge`,{response_id:dateOnly.id},trade)).status,404)
  job=await setPortalFeatures(f,job.id)
  assert.equal((await act('/rfi-access',{email:'rfi-trade@example.com',revoke:true})).status,200)
  assert.deepEqual((await api('/rfi-inbox',undefined,trade)).value.jobs,[]);assert.equal((await f.request(`/api/plinth/rfi-inbox/${job.id}/files/${job.rfis[0].responses[0].attachments[0].id}`,{cookie:trade})).status,404)
  const visible=(await api(`/jobs/${job.id}`,undefined,client)).value.job;assert.equal(visible.rfis,undefined);assert.equal(visible.rfi_access,undefined)
 }finally{await f.close()}
})

test('FIELD-004 — photo observations retain form revisions, qualified trade repairs and exact manager decisions with released client closeout',async()=>{
 const f=await createFixture()
 try{
  const trade=await f.invite('punch-trade@example.com','Assigned Trade'),other=await f.invite('punch-other@example.com','Other Trade'),client=await f.invite('punch-client@example.com','Closeout Client'),pm=await f.invite('punch-pm@example.com','Job Inspector','admin'),agent=await f.agent()
  let job=await createActiveJob(f,'synthetic-plinth-40','punch-client@example.com')
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{cookie,token,...(body?{method:'POST',body}:{})})
  const read=async()=>{job=(await api(`/jobs/${job.id}`)).value.job}
  const act=async(path,body={},cookie=f.owner,token)=>{const r=await api(`/jobs/${job.id}/punch${path}`,{expected_version:job.version,...body},cookie,token);await read();return r}
  let setup=await createReleasedScope(f,job,'punch-trade@example.com','Tile');job=setup.job
  const assignedScope=setup.scope,assignedVendor=setup.vendor
  setup=await createReleasedScope(f,job,'punch-other@example.com','Tile');job=setup.job
  const team=(await api('/team')).value.team.find(p=>p.email==='punch-pm@example.com')
  assert.equal((await f.json('/api/plinth/team/'+team.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'project_manager',job_ids:[job.id],po_limit_cents:0}})).status,200)
  const outside=await createActiveJob(f,'synthetic-plinth-41','punch-client@example.com')
  assert.equal((await api(`/jobs/${outside.id}/punch`,undefined,pm)).status,404)
  assert.equal((await f.request(`/api/plinth/jobs/${job.id}/punch`)).status,401)
  assert.equal((await api(`/jobs/${job.id}/punch`,undefined,undefined,agent)).status,403)
  assert.equal((await api(`/jobs/${job.id}`,undefined,trade)).status,404,'A narrow punch assignment never grants the client job')
  const photo={name:'synthetic-plinth-42.png',mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='}
  let r=await act('/forms',{name:'Wet room inspection',fields:[{id:'dry',label:'Substrate dry',type:'boolean',required:true},{id:'finding',label:'Inspection finding',type:'text',required:true},{id:'finish',label:'Finish',type:'choice',required:true,options:['Tile','Stone']}]},pm)
  assert.equal(r.status,200,JSON.stringify(r.value));const form=r.value.record
  await f.request(`/api/plinth/jobs/${job.id}/takeoff`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,name:'A2 Bath',page:1,width:400,height:400,document:{name:'synthetic-plinth-43.pdf',mime:'application/pdf',base64:takeoffPlan().toString('base64')}}});await read();const sheet=job.takeoff[0]
  const observation={title:'Shower grout gap',description:'Inspect the open grout joint at shower niche',kind:'quality',severity:'high',due_on:'2026-11-04',location:'Upper bath, niche west edge',photo,annotation:{x:.25,y:.75,note:'Open joint at niche corner'},form_id:form.id,answers:{dry:false,finding:'Joint remains open',finish:'Tile'},sheet:{sheet_id:sheet.id,revision_id:sheet.revisions[0].id}}
  assert.equal((await act('/issues',{...observation,answers:{dry:'false',finding:'Invalid',finish:'Tile'}})).status,400)
  assert.equal((await act('/issues',{...observation,annotation:{x:2,y:.5,note:'Outside photo'}})).status,400)
  r=await act('/issues',observation,pm);assert.equal(r.status,200,JSON.stringify(r.value));const issue=r.value.record,id=issue.id
  assert.deepEqual(issue.answers,observation.answers);assert.equal(issue.sheet.revision_id,sheet.revisions[0].id)
  const original=await f.request(`/api/plinth/jobs/${job.id}/punch/files/${issue.photo.id}`,{cookie:f.owner});assert.deepEqual(Buffer.from(await original.arrayBuffer()),Buffer.from(photo.base64,'base64'))
  const hidden=await api(`/jobs/${job.id}`,undefined,client);assert.deepEqual(hidden.value.job.punch.issues,[])
  assert.deepEqual((await api(`/jobs/${job.id}/punch`,undefined,client)).value.issues,[])
  assert.equal((await f.request(`/api/plinth/jobs/${job.id}/punch/files/${issue.photo.id}`,{cookie:client})).status,404)
  assert.equal((await act(`/issues/${id}/assign`,{subcontract_id:assignedScope.id,email:'punch-trade@example.com'},pm)).status,403,'Owner/admin grants the trade assignment')
  assert.equal((await act(`/issues/${id}/assign`,{subcontract_id:assignedScope.id,email:'punch-other@example.com'})).status,409,'A contact from another company cannot be granted this scope')
  r=await act(`/issues/${id}/assign`,{subcontract_id:assignedScope.id,email:'punch-trade@example.com'});assert.equal(r.status,200)
  r=await act('/issues',{...observation,title:'Unresolved niche sealant',description:'Awaiting sealant return',annotation:{x:.5,y:.5,note:'Unresolved sealant'},answers:{dry:false,finding:'Awaiting sealant',finish:'Tile'}});assert.equal(r.status,200);const exception=r.value.record
  assert.equal((await act(`/issues/${exception.id}/assign`,{subcontract_id:assignedScope.id,email:'punch-trade@example.com'})).status,200)
  assert.equal((await act(`/issues/${exception.id}/release`,{confirm:true})).status,200)
  const openClient=(await api(`/jobs/${job.id}/punch`,undefined,client)).value;assert.deepEqual(openClient.issues.map(i=>i.id),[exception.id]);assert.equal(openClient.issues[0].status,'open')
  assert.equal((await act(`/issues/${exception.id}/assign`,{subcontract_id:assignedScope.id,email:'punch-trade@example.com'})).status,200,'Released open exceptions can be reassigned with history retained')
  const inbox=await api('/punch',undefined,trade);assert.equal(inbox.value.jobs.length,1);assert.equal(inbox.value.jobs[0].issues[0].id,id);for(const key of ['quotes','client_email','orders','subcontracts','approvals'])assert.equal(inbox.value.jobs[0][key],undefined)
  assert.deepEqual((await api('/punch',undefined,other)).value.jobs,[])
  assert.equal((await f.request(`/api/plinth/punch/${job.id}/files/${issue.photo.id}`,{cookie:other})).status,404)
  const repair=async(note,cookie=trade,body={})=>{const r=await api(`/punch/${job.id}/issues/${id}/submit`,{expected_version:job.version,note,attachments:[photo],...body},cookie);await read();return r}
  assert.equal((await repair('Unauthorized repair',other)).status,404)
  assert.equal((await act(`/issues/${id}/review`,{decision:'accepted',note:'No submission',evidence:'No original',qualified_review:true,attempt_id:'synthetic-plinth-44'})).status,409)
  r=await repair('First repair: fill joint');assert.equal(r.status,200);const first=structuredClone(r.value.record.attempts[0])
  assert.equal((await repair('Cannot overwrite pending attempt')).status,409)
  assert.equal((await act(`/issues/${id}/review`,{attempt_id:first.id,decision:'rejected',note:'Still a void behind grout',evidence:'Site inspection 2026-11-02',qualified_review:false},pm)).status,400)
  r=await act(`/issues/${id}/review`,{attempt_id:first.id,decision:'rejected',note:'Still a void behind grout',evidence:'Site inspection 2026-11-02',qualified_review:true,attachments:[photo]},pm);assert.equal(r.status,200)
  assert.equal((await act(`/issues/${id}/review`,{attempt_id:first.id,decision:'accepted',note:'Overwrite',evidence:'Overwrite',qualified_review:true},pm)).status,409)
  const rejected=structuredClone(job.punch.issues[0].attempts[0])
  r=await act('/forms/'+form.id,{name:'Wet room inspection',fields:[{id:'new',label:'New revision question',type:'text',required:true}]});assert.equal(r.status,200);assert.equal(r.value.record.revision,2);assert.deepEqual(job.punch.issues[0].form,form)
  r=await repair('Second repair: remove loose grout, pack and finish');assert.equal(r.status,200);const second=r.value.record.attempts[1]
  const exported=await f.request(`/api/plinth/jobs/${job.id}/punch/export.json?status=open&q=grout%20gap`,{cookie:f.owner});assert.equal(exported.status,200);const artifact=await exported.json();assert.equal(artifact.issues.length,1);assert.deepEqual(artifact.issues[0].answers,observation.answers);assert.equal(artifact.issues[0].attempts.length,2);assert.deepEqual(artifact.issues[0].attempts[0],rejected)
  assert.equal((await api(`/jobs/${job.id}/punch?status=open&q=Unrelated`)).value.issues.length,0)
  const csv=await f.request(`/api/plinth/jobs/${job.id}/punch/export.csv?status=open`,{cookie:f.owner});assert.equal(csv.status,200);assert.match(await csv.text(),/Second repair/)
  assert.equal((await act(`/issues/${id}/review`,{attempt_id:first.id,decision:'accepted',note:'Wrong attempt',evidence:'Site visit',qualified_review:true},pm)).status,409)
  r=await act(`/issues/${id}/review`,{attempt_id:second.id,decision:'accepted',note:'Joint is filled and finish inspected',evidence:'Site inspection and original photo 2026-11-03',qualified_review:true,attachments:[photo]},pm);assert.equal(r.status,200)
  assert.equal(job.punch.issues[0].status,'accepted');assert.deepEqual(job.punch.issues[0].attempts[0],rejected);assert.deepEqual((await api(`/jobs/${job.id}/punch`,undefined,client)).value.issues.map(i=>i.id),[exception.id])
  assert.equal((await api(`/jobs/${job.id}/punch?status=open`)).value.issues.length,1)
  assert.equal((await act(`/issues/${id}/release`,{confirm:true},pm)).status,403)
  r=await act(`/issues/${id}/release`,{confirm:true});assert.equal(r.status,200)
  const released=(await api(`/jobs/${job.id}/punch`,undefined,client)).value;assert.equal(released.issues.length,2);assert.equal(released.issues[0].attempts.length,2);assert.equal(released.issues[0].assignment,undefined);assert.deepEqual(released.issues[0].assignments,[]);assert.deepEqual(released.forms,[]);assert.ok(!JSON.stringify(released).includes('punch-trade@example.com'))
  const clientJob=(await api(`/jobs/${job.id}`,undefined,client)).value.job;assert.equal(clientJob.punch.issues[0].id,id);assert.equal(clientJob.punch.issues[0].assignment,undefined)
  const closedPhoto=await f.request(`/api/plinth/jobs/${job.id}/punch/files/${issue.photo.id}`,{cookie:client});assert.equal(closedPhoto.status,200)
  assert.equal((await repair('Cannot overwrite accepted repair')).status,409)
  assert.equal((await act(`/issues/${id}/release`,{confirm:true})).status,409)
  const currentVendor=(await api('/vendors/'+assignedVendor.id)).value.vendor
  r=await api(`/vendors/${assignedVendor.id}/qualifications`,{expected_version:currentVendor.version,trade:'Tile',status:'rejected',evidence:'Qualification withdrawn after inspection'});assert.equal(r.status,200)
  assert.deepEqual((await api('/punch',undefined,trade)).value.jobs,[])
  assert.equal((await f.request(`/api/plinth/punch/${job.id}/files/${issue.photo.id}`,{cookie:trade})).status,404,'Qualification withdrawal removes file access on the next request')
  job=await setPortalFeatures(f,job.id,[],['punch'])
  assert.deepEqual((await api('/punch',undefined,trade)).value.jobs,[])
  assert.equal((await f.request(`/api/plinth/punch/${job.id}/export.json`,{cookie:trade})).status,404)
  assert.equal((await f.request(`/api/plinth/punch/${job.id}/files/${issue.photo.id}`,{cookie:trade})).status,404)
  assert.equal((await repair('Disabled repair')).status,404)
  job=await setPortalFeatures(f,job.id)
  const final=job.punch.issues[0];assert.deepEqual(final.attempts[0],rejected);assert.equal(final.attempts[1].review.decision,'accepted');assert.equal(job.approvals.filter(a=>a.kind==='punch.inspect').length,2)
 }finally{await f.close()}
})

// Versioned integration uses a generated client against the same real native Worker.
test('INT-009 generated client pages scoped jobs and keeps one draft across concurrent replay and key replacement', async () => {
 const {createClient} = await import('../../src/plinth/api-client.mjs')
 const f = await createFixture({now: Date.now()})
 try {
  const clientCookie = await f.invite('client@example.com'), outsider = await f.invite('synthetic-plinth-1@example.com')
  const job = await createActiveJob(f, 'Synthetic Plinth kitchen')
  await createActiveJob(f, 'Synthetic Plinth bath')
  await createActiveJob(f, 'Synthetic Plinth roof')
  const token = await f.agent(), api = createClient({origin: f.origin, token})
  let page = await api.pageJobs({limit: 2}); assert.equal(page.jobs.length, 2); assert.ok(page.next)
  const rest = await api.pageJobs({limit: 2, after: page.next})
  assert.equal(rest.jobs.length, 1); assert.equal(new Set([...page.jobs, ...rest.jobs].map(job => job.id)).size, 3); assert.equal(rest.next, null)
  assert.equal((await f.request('/api/plinth/v1/jobs', {cookie: outsider})).status, 200)
  assert.equal((await f.json('/api/plinth/v1/jobs', {cookie: outsider})).value.jobs.length, 0)
  assert.equal((await f.request('/api/plinth/v1/jobs/'+job.id, {cookie: outsider})).status, 404)
  assert.equal((await f.json('/api/plinth/v1/jobs/'+job.id, {cookie: clientCookie})).value.job.name, job.name)
  const input = {job_id: job.id, 'Idempotency-Key': 'synthetic-plinth-draft-1', body: {expected_version: job.version, description: 'Synthetic reviewed countertop change', amount_cents: 25000}}
  const writes = await Promise.all([api.prepareChange(input), api.prepareChange(input)])
  assert.equal(writes[0].draft.id, writes[1].draft.id)
  assert.equal((await api.prepareChange(input)).draft.id, writes[0].draft.id)
  await assert.rejects(api.prepareChange({...input, body: {...input.body, amount_cents: 30000}}), error => error.status === 409)
  await assert.rejects(api.approveChange({job_id: job.id, change_id: writes[0].draft.id, body: {expected_version: writes[0].job.version}}), error => error.status === 403)
  const root = `/api/plinth/jobs/${job.id}/variations/${writes[0].draft.id}/approve`
  assert.equal((await f.request(root, {method: 'POST', token, body: {expected_version: writes[0].job.version}})).status, 403)
  assert.equal((await f.request(`/api/plinth/v1/jobs/${job.id}/changes/${writes[0].draft.id}/approve`, {method: 'POST', token, body: {expected_version: writes[0].job.version}})).status, 403)
  const oldId = (await f.json('/api/plinth/agent-credentials', {cookie: f.owner})).value.credentials[0].id
  const replacement = await f.agent()
  assert.equal((await f.request(`/api/plinth/agent-credentials/${oldId}/revoke`, {method: 'POST', cookie: f.owner, body: {}})).status, 200)
  assert.equal((await f.request('/api/plinth/v1/jobs', {token})).status, 401)
  assert.equal((await createClient({origin: f.origin, token: replacement}).prepareChange(input)).draft.id, writes[0].draft.id)
  const current = (await f.json('/api/plinth/jobs/'+job.id, {cookie: f.owner})).value.job
  assert.equal(current.variations.length, 1); assert.equal(current.variations[0].status, 'draft'); assert.equal(current.approvals.filter(a => a.kind === 'variation').length, 0)
  // A pinned Worker clock keeps every request in the same rate window.
  const results = await Promise.all(Array.from({length: 61}, () => f.request('/api/plinth/v1/jobs', {token: replacement})))
  assert.ok(results.some(response => response.status === 429)); assert.ok(results.every(response => [200,429].includes(response.status)))
 } finally { await f.close() }
})

test('INT-009 approved-change webhooks retain signed receiver-aware replay and deny revoked grants', async () => {
 const {createClient} = await import('../../src/plinth/api-client.mjs')
 const {createHmac, timingSafeEqual} = await import('node:crypto')
 const received = []; let signingKey, refuse = true
 const f = await createFixture({webhookReceiver: async request => {
  const raw = await request.text(), signature = request.headers.get('plinth-signature'), [timestamp, digest] = signature.split(',').map(part => part.split('=')[1])
  const expected = createHmac('sha256', signingKey).update(timestamp+'.'+raw).digest('hex')
  assert.ok(timingSafeEqual(Buffer.from(expected), Buffer.from(digest)))
  const altered = createHmac('sha256', signingKey).update(timestamp+'.'+raw+' ').digest('hex')
  assert.ok(!timingSafeEqual(Buffer.from(altered), Buffer.from(digest)), 'Changing the exact body invalidates its installation signature')
  const value = JSON.parse(raw); assert.equal(request.headers.get('plinth-event-id'), value.id)
  received.push(value)
  return new Response(null, {status: refuse ? 503 : 202})
 }})
 try {
  const client = await f.invite('client@example.com'), outsider = await f.invite('synthetic-plinth-2@example.com')
  let job = await createActiveJob(f), other = await createActiveJob(f, 'Another receiver scope')
  const token = await f.agent(), credential = (await f.json('/api/plinth/agent-credentials', {cookie: f.owner})).value.credentials[0]
  const post = (path, body = {}, cookie = f.owner, bearer) => f.json('/api/plinth'+path, {method: 'POST', cookie, token: bearer, body})
  const consent = {credential_id: credential.id, receiver: 'https://synthetic-plinth.example/events', job_ids: [job.id], event_types: ['change.approved'], confirm: true}
  assert.equal((await post('/connections', {...consent, confirm: false})).status, 400)
  assert.equal((await post('/connections', {...consent, receiver: 'https://unconfigured.example/events'})).status, 403)
  assert.equal((await post('/connections', consent, undefined, token)).status, 403)
  assert.equal((await post('/connections', consent, outsider)).status, 403)
  const control = createClient({origin: f.origin, cookie: f.owner})
  let r = {status: 201, value: await control.createConnection({body: consent})}; assert.equal(r.status, 201); signingKey = r.value.signing_key; const connection = r.value.subscription.id
  assert.ok(!JSON.stringify((await f.json('/api/plinth/connections', {cookie: f.owner})).value).includes(signingKey))
  r = await post(`/jobs/${job.id}/variations`, {expected_version: job.version, description: 'Synthetic Plinth approved change', amount_cents: 12500}, undefined, token); assert.equal(r.status, 200); job = r.value.job; const change = r.value.record.id
  r = await post(`/jobs/${job.id}/variations/${change}/approve`, {expected_version: job.version}, client); assert.equal(r.status, 200); job = r.value.job
  const list = () => f.json(`/api/plinth/connections/${connection}/events`, {cookie: f.owner})
  const events = (await list()).value.events; assert.equal(events.length, 1); const event = events[0]
  assert.equal(event.type, 'change.approved'); assert.equal(event.subject_id, change); assert.equal(event.job_version, job.version)
  assert.equal((await post(`/jobs/${job.id}/variations/${change}/approve`, {expected_version: job.version}, client)).status, 409)
  assert.equal((await list()).value.events.length, 1)
  assert.equal((await post(`/connections/${connection}/deliver/${event.id}`)).status, 400)
  r = await post(`/connections/${connection}/deliver/${event.id}`, {confirm: true}); assert.equal(r.value.status, 'failed')
  refuse = false
  r = {value: await control.deliverEvent({connection_id: connection, event_id: event.id, body: {confirm: true}})}; assert.equal(r.value.status, 'accepted')
  assert.equal(received.length, 2); assert.deepEqual(received[0], received[1]); assert.equal(received[0].id, event.id)
  assert.deepEqual(Object.keys(received[0]).sort(), ['api_version','created_at','id','job_id','job_version','subject_id','type'].sort())
  const history = await f.json(`/api/plinth/connections/${connection}/deliveries`, {cookie: f.owner}); assert.equal(history.value.deliveries.length, 2)
  const second = await post('/connections', {...consent, job_ids: [other.id]}); assert.equal(second.status, 201)
  assert.equal((await post(`/connections/${second.value.subscription.id}/deliver/${event.id}`, {confirm: true})).status, 404)
  const replacement = await f.agent(), replacementId = (await f.json('/api/plinth/agent-credentials', {cookie: f.owner})).value.credentials[0].id
  r = await post(`/connections/${connection}/rotate`, {credential_id: replacementId}); assert.equal(r.status, 200); assert.notEqual(r.value.signing_key, signingKey); signingKey = r.value.signing_key
  assert.equal((await post(`/agent-credentials/${credential.id}/revoke`)).status, 200)
  assert.equal((await post(`/connections/${connection}/deliver/${event.id}`, {confirm: true})).value.status, 'accepted')
  assert.equal(received[2].id, event.id)
  const liveRevoked = await post('/connections', {...consent, credential_id: replacementId})
  assert.equal(liveRevoked.status, 201)
  assert.equal((await post(`/connections/${liveRevoked.value.subscription.id}/revoke`)).status, 200)
  assert.equal((await post(`/connections/${liveRevoked.value.subscription.id}/deliver/${event.id}`, {confirm: true})).status, 403)
  assert.equal((await f.request('/api/plinth/jobs/'+job.id, {method: 'DELETE', cookie: f.owner, body: {expected_version: job.version}})).status, 200)
  assert.equal((await list()).value.events.length, 0)
  assert.equal((await post(`/connections/${connection}/deliver/${event.id}`, {confirm: true})).status, 404)
  assert.equal(received.length, 3)
  assert.equal((await post(`/agent-credentials/${replacementId}/revoke`)).status, 200)
  assert.equal((await list()).status, 403)
  assert.equal((await post(`/connections/${connection}/deliver/${event.id}`, {confirm: true})).status, 403)
  assert.equal(received.length, 3)
  assert.equal((await post(`/connections/${connection}/revoke`)).status, 200)
  assert.equal((await f.request(`/api/plinth/connections/${connection}/deliveries`, {cookie: f.owner})).status, 200)
 } finally { await f.close() }
})

test('Receiver delivery refuses unsafe configured addresses and never follows redirects', async () => {
 const {connectorFixture} = await import('./connector-support.mjs')
 let address = '93.184.216.34', dnsStatus = 0, redirect = false
 const unsafe = ['http://synthetic-plinth.example', 'https://127.0.0.1', 'https://2130706433', 'https://10.0.0.1', 'https://172.16.0.1', 'https://192.168.1.1', 'https://169.254.169.254', 'https://100.64.0.1', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[fc00::1]', 'https://localhost']
 const f = await connectorFixture({webhookOrigins: ['https://synthetic-plinth.example', ...unsafe].join(','), webhookDns: request => Response.json({Status: dnsStatus, Answer: new URL(request.url).searchParams.get('type') === 'A' ? [{type: 1, data: address}] : []}), receive: () => new Response(null, {status: redirect ? 307 : 202, ...(redirect ? {headers: {location: 'https://127.0.0.1/private'}} : {})})})
 try {
  for (const receiver of unsafe) assert.equal((await f.post('/connections', {...f.consent, receiver})).status, 403, receiver)
  assert.equal(f.received.length, 0)
  address = '10.0.0.1'
  assert.equal((await f.post('/connections', f.consent)).status, 403, 'A configured hostname resolving privately is refused')
  assert.equal((await f.deliver()).status, 403, 'Resolution is checked again at send')
  assert.equal(f.received.length, 0)
  dnsStatus = 2
  assert.equal((await f.deliver()).status, 403, 'DNS failure denies delivery')
  assert.equal(f.received.length, 0)
  dnsStatus = 0; address = '93.184.216.34'
  assert.equal((await f.deliver()).value.status, 'accepted')
  redirect = true
  assert.equal((await f.deliver()).value.status, 'failed')
  assert.deepEqual(f.received.map(row => row.url), [f.consent.receiver, f.consent.receiver], 'No request reaches the redirect target')
 } finally { await f.close() }
})

test('Receiver credential and scoped job grants must be current and can be explicitly regranted', async () => {
 const {connectorFixture} = await import('./connector-support.mjs'), f = await connectorFixture()
 try {
  assert.equal((await f.deliver()).value.status, 'accepted')
  assert.equal((await f.post(`/agent-credentials/${f.credential.id}/revoke`)).status, 200)
  assert.equal((await f.deliver()).status, 403); assert.equal(f.received.length, 1)
  await f.agent()
  const replacement = (await f.json('/api/plinth/agent-credentials', {cookie: f.owner})).value.credentials.find(row => row.id !== f.credential.id && !row.revoked_at)
  const regranted = await f.create({credential_id: replacement.id})
  assert.equal((await f.deliver(regranted.subscription.id)).value.status, 'accepted')
  assert.equal((await f.post(`/connections/${regranted.subscription.id}/revoke`)).status, 200)
  assert.equal((await f.deliver(regranted.subscription.id)).status, 403); assert.equal(f.received.length, 2)
  const other = await createActiveJob(f, 'Oak Street bath')
  const narrowed = await f.create({credential_id: replacement.id, job_ids: [other.id]})
  assert.equal((await f.deliver(narrowed.subscription.id)).status, 404); assert.equal(f.received.length, 2)
  const restored = await f.create({credential_id: replacement.id})
  assert.equal((await f.deliver(restored.subscription.id)).value.status, 'accepted'); assert.equal(f.received.length, 3)
 } finally { await f.close() }
})

test('Receiver payloads disclose references only even when the caller submits a record body', async () => {
 const {connectorFixture} = await import('./connector-support.mjs'), f = await connectorFixture()
 try {
  const result = await f.deliver(undefined, {confirm: true, job: f.job, body: {description: 'Private record body', amount_cents: 123456}})
  assert.equal(result.value.status, 'accepted')
  const payload = JSON.parse(f.received[0].raw)
  assert.deepEqual(payload, {api_version: '1', id: f.event.id, job_id: f.job.id, job_version: f.event.job_version, type: f.event.type, subject_id: f.event.subject_id, created_at: f.event.created_at})
  for (const privateValue of ['Private record body', '123456', f.job.name, f.job.client_email, f.job.address]) assert.ok(!f.received[0].raw.includes(privateValue))
 } finally { await f.close() }
})

test('Every outbound attempt has committed consent naming its owner before the receiver is called', async () => {
 const {connectorFixture} = await import('./connector-support.mjs'), observations = []
 const f = await connectorFixture({receive: async (_request, fixture) => {
  observations.push((await fixture.json('/api/plinth/audit?action=connector.attempt', {cookie: fixture.owner})).value.events)
  return new Response(null, {status: 202})
 }})
 try {
  for (const confirm of [undefined, false, 'true']) assert.equal((await f.deliver(undefined, {confirm})).status, 400)
  assert.equal(f.received.length, 0)
  assert.equal((await f.json('/api/plinth/audit?action=connector.attempt', {cookie: f.owner})).value.events.length, 0)
  for (let n = 1; n <= 2; n++) {
   const result = await f.deliver(); assert.equal(result.value.status, 'accepted')
   assert.equal(observations[n-1].length, n)
   const audit = observations[n-1].find(row => row.detail.attempt_id === result.value.attempt_id)
   assert.ok(audit); assert.equal(audit.actor_name, 'Builder'); assert.equal(audit.actor_role, 'owner'); assert.equal(audit.source, 'session'); assert.ok(audit.actor_id)
   assert.equal(audit.subject_id, f.connection.subscription.id); assert.equal(audit.detail.event_id, f.event.id); assert.equal(audit.detail.consent, true)
  }
 } finally { await f.close() }
})

test('Only the owner session can operate native or versioned receiver controls', async () => {
 const {connectorFixture} = await import('./connector-support.mjs'), f = await connectorFixture()
 try {
  const office = await f.invite('synthetic-plinth-3@example.com', 'Office manager', 'admin'), token = await f.agent()
  for (const prefix of ['/api/plinth/connections', '/api/plinth/v1/connections']) {
   for (const credentials of [{cookie: office}, {token}]) {
    for (const [method, suffix, body] of [['GET', ''], ['GET', '/recovery'], ['POST', '', f.consent], ['GET', `/${f.connection.subscription.id}/events`], ['GET', `/${f.connection.subscription.id}/deliveries`], ['POST', `/${f.connection.subscription.id}/grant`, {confirm: true, origin: 'https://synthetic-plinth.example', event_types: ['job.updated'], payload_class: 'references', rate_cap: 1, expires_at: new Date(Date.now()+600_000).toISOString()}], ['POST', `/${f.connection.subscription.id}/grant/revoke`, {}], ['POST', `/${f.connection.subscription.id}/rotate`, {credential_id: f.credential.id}], ['POST', `/${f.connection.subscription.id}/revoke`, {}], ['POST', `/${f.connection.subscription.id}/deliver/${f.event.id}`, {confirm: true}]]) {
     assert.equal((await f.request(prefix+suffix, {method, body, ...credentials})).status, 403, method+' '+suffix)
    }
   }
  }
  assert.equal(f.received.length, 0)
  assert.equal((await f.deliver()).value.status, 'accepted'); assert.equal(f.received.length, 1)
 } finally { await f.close() }
})

test('INT-014 standing consent sends only future scoped events, enforces its cap and stops on revoke or expiry', async () => {
 const {standingFixture} = await import('./standing-support.mjs')
 let refuse = true
 const f = await standingFixture({eventTypes: ['job.updated', 'change.approved'], receive: () => new Response(null, {status: refuse ? 503 : 202})})
 try {
  const client = await f.invite('client@example.com'), other = await createActiveJob(f, 'Synthetic Plinth separate job')
  const approve = async value => {
   const result = await f.post(`/jobs/${value.job.id}/variations/${value.record.id}/approve`, {expected_version: value.job.version}, client)
   assert.equal(result.status, 200, JSON.stringify(result.value))
   return result.value
  }
  await approve(await f.update())
  await f.scheduled(); assert.equal(f.received.length, 0, 'A connection alone never authorizes unattended delivery')
  for (const changes of [{confirm: false}, {origin: 'https://unconfigured.example'}, {payload_class: 'records'}, {event_types: ['financial.updated']}, {rate_cap: 1.5}, {expires_at: new Date(0).toISOString()}]) {
   const result = await f.post(`/connections/${f.id}/grant`, f.grantBody(changes))
   assert.ok(result.status >= 400 && result.status < 500, JSON.stringify(result.value))
  }
  await f.advance()
  const consent = await f.grant({event_types: ['change.approved'], rate_cap: 1})
  assert.deepEqual((await f.subscription()).grant_event_types, ['change.approved'])
  await f.scheduled(); assert.equal(f.received.length, 0, 'A grant does not sweep up pre-consent history')
  await f.advance()
  const draft = await f.update()
  await f.scheduled(); assert.equal(f.received.length, 0, 'A job.updated event is outside the granted event type')
  await approve(await f.update(other.id))
  await f.scheduled(); assert.equal(f.received.length, 0, 'Another job is outside the connection scope')
  await f.advance(); await approve(draft); await f.scheduled(); assert.equal(f.received.length, 1)
  const sent = JSON.parse(f.received[0].raw)
  assert.equal(sent.type, 'change.approved'); assert.equal(sent.job_id, f.job.id)
  assert.equal(sent.subject_id, draft.record.id)
  await f.advance(3 * 60_000)
  await approve(await f.update()); await f.scheduled(); await f.scheduled()
  assert.equal(f.received.length, 1, 'The failed attempt consumes the grant cap, including its due retry')
  let log = await f.history()
  assert.equal(log.length, 1); assert.equal(log[0].mode, 'standing'); assert.equal(log[0].consent_grant_id, consent.grant_id)
  assert.equal((await f.post(`/connections/${f.id}/grant/revoke`)).status, 200)
  assert.ok((await f.subscription()).grant_revoked_at)
  await f.advance(); await approve(await f.update()); await f.scheduled(); assert.equal(f.received.length, 1)
  assert.deepEqual(await f.history(), log, 'Revoked standing consent retains its inspection log')
  refuse = false
  assert.equal((await f.deliver(f.id)).value.status, 'accepted', 'Revoking standing consent preserves explicit manual delivery')
  log = await f.history(); assert.equal(log.filter(row => row.mode === 'manual').length, 1)
  await f.advance()
  await f.grant({expires_at: new Date(Date.parse(sent.created_at) + 5 * 60_000).toISOString()})
  await f.advance(3 * 60_000); await f.update(); await f.scheduled()
  assert.equal(f.received.length, 2, 'An expired grant never starts a request')
  assert.deepEqual(await f.history(), log)
 } finally { await f.close() }
})

test('INT-014 scheduled retries retain signed event identity across rotation and receiver response loss', async () => {
 const {standingFixture} = await import('./standing-support.mjs')
 const {createHmac, timingSafeEqual} = await import('node:crypto')
 let f, signingKey, consentGrant, attempts = 0
 const completed = new Set(), work = []
 f = await standingFixture({receive: async request => {
  const row = f.received.at(-1), [timestamp, digest] = row.signature.split(',').map(part => part.split('=')[1])
  const expected = createHmac('sha256', signingKey).update(timestamp+'.'+row.raw).digest('hex')
  assert.ok(timingSafeEqual(Buffer.from(expected), Buffer.from(digest)))
  const body = JSON.parse(row.raw)
  const audit = (await f.json('/api/plinth/audit?action=connector.attempt', {cookie: f.owner})).value.events.find(item => item.detail.event_id === body.id && item.detail.grant_id === consentGrant)
  assert.ok(audit, 'Standing consent is committed before the receiver is contacted'); assert.equal(audit.source, 'automation'); assert.equal(audit.detail.consent, true); assert.ok(audit.detail.consent_owner_id)
  assert.equal(request.headers.get('plinth-event-id'), body.id)
  attempts++
  if (attempts === 1) return new Response(null, {status: 503})
  if (!completed.has(body.id)) { completed.add(body.id); work.push(body) }
  if (attempts === 2) throw new TypeError('Synthetic receiver response lost after committing work')
  return new Response(null, {status: 202})
 }})
 try {
  signingKey = f.connection.signing_key
  await f.advance(); const consent = await f.grant(); consentGrant = consent.grant_id
  await f.advance(); const changed = await f.update(); await f.scheduled()
  assert.equal(f.received.length, 1)
  await f.scheduled(); assert.equal(f.received.length, 1, 'Scheduled work waits until the failed attempt is due')
  const rotation = await f.post(`/connections/${f.id}/rotate`, {credential_id: f.credential.id})
  assert.equal(rotation.status, 200); signingKey = rotation.value.signing_key
  await f.advance(2 * 60_000); await f.scheduled(); assert.equal(f.received.length, 2)
  await f.scheduled(); assert.equal(f.received.length, 2, 'The second failure also waits for its later retry')
  const waiting = (await f.history()).filter(row => row.retry_at).sort((a,b) => a.started_at.localeCompare(b.started_at))
  assert.ok(Date.parse(waiting[1].retry_at)-Date.parse(waiting[1].finished_at) > Date.parse(waiting[0].retry_at)-Date.parse(waiting[0].finished_at), 'Repeated failures increase the backoff')
  await f.advance(3 * 60_000); await f.scheduled(); assert.equal(f.received.length, 3)
  assert.equal(new Set(f.received.map(row => row.raw)).size, 1, 'Every retry signs the same event body')
  assert.equal(work.length, 1, 'The receiver deduplicates the work whose acceptance response was lost')
  assert.deepEqual(work[0], {api_version: '1', id: work[0].id, job_id: f.job.id, job_version: changed.job.version, type: 'job.updated', subject_id: null, created_at: work[0].created_at})
  for (const value of [f.job.name, f.job.address, f.job.client_email, changed.record.description]) assert.ok(!f.received[0].raw.includes(value))
  const log = await f.history()
  assert.equal(log.length, 3); assert.equal(log.filter(row => row.status === 'accepted').length, 1)
  assert.ok(log.every(row => row.mode === 'standing' && row.consent_grant_id === consent.grant_id))
  assert.ok(log.filter(row => row.status !== 'accepted').every(row => row.retry_at))
  await f.advance(5 * 60_000); await f.scheduled(); assert.equal(f.received.length, 3, 'Accepted events are not sent again')
 } finally { await f.close() }
})

test('INT-014 consecutive receiver failures pause unattended work until a fresh future-only owner grant', async () => {
 const {standingFixture} = await import('./standing-support.mjs')
 let refuse = true
 const f = await standingFixture({receive: () => new Response(null, {status: refuse ? 503 : 202})})
 try {
  await f.advance(); const original = await f.grant()
  await f.advance(); await f.update(); await f.scheduled()
  await f.advance(2 * 60_000); await f.scheduled()
  await f.advance(3 * 60_000); await f.scheduled()
  assert.equal(f.received.length, 3)
  await f.advance(5 * 60_000); await f.update(); await f.scheduled(); await f.scheduled()
  assert.equal(f.received.length, 3, 'A paused connection cannot send even later events')
  const paused = await f.subscription()
  assert.ok(paused.paused_at); assert.ok(paused.pause_reason); assert.ok(paused.failure_count > 0)
  assert.equal((await f.history()).length, 3)
  refuse = false
  await f.advance(); const renewed = await f.grant()
  assert.notEqual(renewed.grant_id, original.grant_id)
  assert.equal(renewed.paused_at, null)
  assert.equal((await f.subscription()).failure_count, 0)
  await f.scheduled(); assert.equal(f.received.length, 3, 'Renewal does not replay events accumulated during pause')
  await f.advance(); const changed = await f.update(); await f.scheduled()
  assert.equal(f.received.length, 4); assert.equal(JSON.parse(f.received[3].raw).job_version, changed.job.version)
  const log = await f.history()
  assert.equal(log.filter(row => row.status === 'accepted' && row.consent_grant_id === renewed.grant_id).length, 1)
 } finally { await f.close() }
})

test('INT-014 scheduled delivery rechecks current credentials and job existence before contacting the receiver', async () => {
 const {standingFixture} = await import('./standing-support.mjs')
 const f = await standingFixture()
 try {
  await f.advance(); await f.grant()
  await f.advance(); await f.update()
  assert.equal((await f.post(`/agent-credentials/${f.credential.id}/revoke`)).status, 200)
  await f.scheduled(); assert.equal(f.received.length, 0)
  await f.agent()
  const replacement = (await f.json('/api/plinth/agent-credentials', {cookie: f.owner})).value.credentials.find(row => row.id !== f.credential.id && !row.revoked_at)
  assert.equal((await f.post(`/connections/${f.id}/rotate`, {credential_id: replacement.id})).status, 403)
  const current = await f.create({credential_id: replacement.id})
  await f.advance()
  assert.equal((await f.post(`/connections/${current.subscription.id}/grant`, f.grantBody())).status, 200)
  await f.advance(); const changed = await f.update()
  assert.equal((await f.request(`/api/plinth/jobs/${f.job.id}`, {method: 'DELETE', cookie: f.owner, body: {expected_version: changed.job.version}})).status, 200)
  await f.scheduled(); assert.equal(f.received.length, 0, 'An event for an erased job cannot leave the installation')
  assert.deepEqual(await f.history(), [])
  const log = await f.json(`/api/plinth/connections/${current.subscription.id}/deliveries`, {cookie: f.owner})
  assert.equal(log.status, 200); assert.deepEqual(log.value.deliveries, [])
 } finally { await f.close() }
})

// One complete distribution lifecycle through the native HTTP doors and real D1.
test('DOC-001 — approved plan sets supersede exact sheets, notify current recipients and retain pinned originals and annotations',async()=>{
 const f=await createFixture();try{
 const address=n=>['synthetic-plinth-'+n,'example.test'].join('@')
 const client=await f.invite(address(101),'Plan client'),trade=await f.invite(address(102),'Plan trade'),other=await f.invite(address(103),'Unrelated person'),crew=await f.invite(address(104),'Plan crew','admin'),restricted=await f.invite(address(105),'Restricted plan manager','admin')
 let job=await createActiveJob(f,'Versioned plan distribution',address(101));job=(await createReleasedScope(f,job,address(102),'Framing')).job
 const root=`/api/plinth/jobs/${job.id}/plans`,read=async(cookie=f.owner)=>f.json(root,{cookie})
 const people=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team,crewId=people.find(p=>p.email===address(104)).id
 const assign=async(ids,version=0)=>{const r=await f.json('/api/plinth/team/'+crewId,{method:'PUT',cookie:f.owner,body:{expected_version:version,role:'crew',job_ids:ids,po_limit_cents:0}});assert.equal(r.status,200);return r.value.member.version}
 let crewVersion=await assign([job.id])
 const administrator=await f.invite(address(106),'Plan administrator','admin')
 const administratorId=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team.find(p=>p.email===address(106)).id
 const administratorRole=await f.json('/api/plinth/roles',{method:'POST',cookie:f.owner,body:{copy_of:'administrator',name:'Unchanged plan administrator'}});assert.equal(administratorRole.status,201)
 assert.equal((await f.json('/api/plinth/team/'+administratorId,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'custom',role_id:administratorRole.value.role.id,job_ids:[],po_limit_cents:0}})).status,200)
 assert.equal((await read(administrator)).status,200,'An unchanged custom Administrator inherits the ordinary job access policy')
 const restrictedId=people.find(p=>p.email===address(105)).id
 const restrictedRole=await f.json('/api/plinth/roles',{method:'POST',cookie:f.owner,body:{copy_of:'project_manager',name:'Plan review without approval',permissions:{documents:{approve:false}}}});assert.equal(restrictedRole.status,201)
 assert.equal((await f.json('/api/plinth/team/'+restrictedId,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'custom',role_id:restrictedRole.value.role.id,job_ids:[job.id],po_limit_cents:0}})).status,200)

 assert.ok((await read()).value.plans.recipients.some(p=>p.id===administratorId),'The unchanged Administrator is eligible for plan notices')
 const eligible=(await read()).value.plans.recipients,clientId=eligible.find(p=>p.name==='Plan client').id,tradeId=eligible.find(p=>p.name==='Plan trade').id
 const act=async(path,body={},cookie=f.owner)=>{const current=(await read()).value.plans;return f.json(root+path,{method:'POST',cookie,body:{expected_version:current.version,...body}})}
 const scanned=scannedPlan()
 const source=(number,revision,kind='plan',changed=false)=>({number,revision,kind,page:1,width:400,height:400,document:{name:'synthetic-plinth-plan.pdf',mime:'application/pdf',base64:(changed?scanned:takeoffPlan()).toString('base64')}})
 let r=await act('',{title:'Permit set',issue_on:'2026-10-01',sheets:[source('A1','A'),source('S1','A','specification'),source('AD1','A','addendum')]});assert.equal(r.status,200,JSON.stringify(r.value))
 const firstId=r.value.record.id,first=r.value.plans.sets.find(s=>s.id===firstId),old=first.sheets[0],original=structuredClone(first.sheets)
 assert.deepEqual(first.sheets.map(s=>s.kind),['plan','specification','addendum']);assert.equal(first.issue_on,'2026-10-01')
 assert.equal((await read(crew)).value.plans.sets.length,0,'Field staff cannot open an unapproved upload')
 assert.equal((await f.request(`${root}/${firstId}/files/${old.id}`,{cookie:crew})).status,404)
 for(const cookie of [crew,client])assert.ok([403,404].includes((await act(`/${firstId}/approve`,{confirm:true,recipient_ids:[]},cookie)).status))
 const token=await f.agent();assert.equal((await f.json(root,{token})).status,403)
 assert.equal((await act(`/${firstId}/approve`,{recipient_ids:[crewId]})).status,400)
 r=await act(`/${firstId}/approve`,{confirm:true,recipient_ids:[crewId,clientId,tradeId]});assert.equal(r.status,200,JSON.stringify(r.value))
 assert.deepEqual(r.value.plans.sets[0].recipients.map(p=>p.id).sort(),[crewId,clientId,tradeId].sort())
 assert.equal((await read(other)).status,404)
 r=await act(`/${firstId}/annotate`,{sheet_id:old.id,x:80,y:120,text:'Retain framing note on revision A'},crew);assert.equal(r.status,200,JSON.stringify(r.value))
 const annotation=r.value.plans.sets[0].annotations[0];assert.equal(annotation.x,80);assert.equal(annotation.y,120);assert.equal(annotation.sheet_id,old.id);assert.equal(annotation.revision,'A');assert.equal(annotation.by.name,'Plan crew')
 r=await act('',{title:'Construction set',issue_on:'2026-10-10',sheets:[source('A1','B','plan',true),source('S1','B','specification'),source('AD1','B','addendum')]});assert.equal(r.status,200,JSON.stringify(r.value))
 const secondId=r.value.record.id,newSheet=r.value.plans.sets.find(s=>s.id===secondId).sheets[0]
 assert.equal((await read(crew)).value.plans.sets.flatMap(s=>s.sheets).find(s=>s.current).id,old.id,'Pending uploads never replace the approved field drawing')
 assert.equal((await f.request(`${root}/${secondId}/files/${newSheet.id}`,{cookie:crew})).status,404)
 const beforeRefusal=(await read()).value.plans
 assert.equal((await act(`/${secondId}/approve`,{confirm:true,recipient_ids:[crewId]},restricted)).status,403,'Approval requires the independent document approval switch')
 assert.deepEqual((await read()).value.plans,beforeRefusal,'A refused approval writes no notice or state')
 const stale=(await read()).value.plans.version
 r=await act(`/${secondId}/approve`,{confirm:true,recipient_ids:[crewId,clientId,tradeId]});assert.equal(r.status,200,JSON.stringify(r.value))
 assert.equal((await f.json(`${root}/${secondId}/approve`,{method:'POST',cookie:f.owner,body:{expected_version:stale,confirm:true,recipient_ids:[crewId]}})).status,409)
 const administratorPlans=(await read(administrator)).value.plans
 assert.deepEqual(administratorPlans.sets.map(s=>s.id),[firstId,secondId])
 assert.deepEqual((await f.json('/api/plinth/plan-inbox',{cookie:administrator})).value.jobs.map(j=>j.id),[job.id],'The unchanged Administrator can open the plan inbox')
 const field=(await read(crew)).value.plans,latest=field.sets.find(s=>s.id===secondId),historic=field.sets.find(s=>s.id===firstId)
 assert.deepEqual(field.sets.flatMap(s=>s.sheets).filter(s=>s.current).map(s=>s.id).sort(),latest.sheets.map(s=>s.id).sort())
 assert.ok(historic.sheets.every(s=>!s.current));assert.equal(historic.sheets[0].superseded_by.sheet_id,newSheet.id);assert.equal(historic.sheets[0].superseded_by.revision,'B')
 const pin=new URL(historic.sheets[0].href,f.origin);assert.equal(pin.searchParams.get('plan_job'),job.id);assert.equal(pin.searchParams.get('plan_set'),firstId);assert.equal(pin.searchParams.get('plan_sheet'),old.id)
 assert.deepEqual(historic.annotations,[annotation]);assert.deepEqual(latest.annotations,[])
 assert.deepEqual(historic.sheets.map(s=>s.document),original.map(s=>s.document),'Approval preserves exact original document identities and checksums')
 for(const [set,sheet,bytes] of [[firstId,old,takeoffPlan()],[secondId,newSheet,scanned]]){
  const response=await f.request(`${root}/${set}/files/${sheet.id}`,{cookie:crew});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes)
 }
 for(const cookie of [client,trade]){
  const inbox=await f.json('/api/plinth/plan-inbox',{cookie});assert.equal(inbox.status,200);assert.deepEqual(inbox.value.jobs.map(j=>j.id),[job.id]);assert.equal(inbox.value.jobs[0].sets.find(s=>s.id===secondId).recipients.length,1,'Recipients see only their own acknowledgment')
 }
 assert.equal((await read(crew)).value.plans.sets.find(s=>s.id===secondId).recipients[0].acknowledged_by,undefined,'Opening the plan is not acknowledgment')
 r=await act(`/${secondId}/acknowledge`,{},crew);assert.equal(r.status,200);const acknowledgment=r.value.plans.sets.find(s=>s.id===secondId).recipients[0].acknowledged_by;assert.equal(acknowledgment.id,crewId)
 r=await act(`/${secondId}/acknowledge`,{},crew);assert.deepEqual(r.value.plans.sets.find(s=>s.id===secondId).recipients[0].acknowledged_by,acknowledgment)
 r=await act(`/${secondId}/approve`,{confirm:true,recipient_ids:[crewId,clientId,tradeId]});assert.equal(r.status,200);assert.equal(r.value.plans.sets.find(s=>s.id===secondId).recipients.length,3,'Approval replay creates no duplicate notices')
 assert.equal((await act(`/${secondId}/approve`,{confirm:true,recipient_ids:[crewId]})).status,409,'Approved distributions cannot silently change recipients')
 assert.equal((await f.json('/api/plinth/jobs/'+job.id,{cookie:client})).value.job.plan_sets,undefined,'Generic job data never bypasses the plan projection')
 const hidden=await f.invite(address(107),'Manager without document viewing','admin')
 const hiddenId=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team.find(p=>p.email===address(107)).id
 const hiddenRole=await f.json('/api/plinth/roles',{method:'POST',cookie:f.owner,body:{copy_of:'project_manager',name:'Documents hidden',permissions:{documents:{view:false}}}});assert.equal(hiddenRole.status,201)
 assert.equal((await f.json('/api/plinth/team/'+hiddenId,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'custom',role_id:hiddenRole.value.role.id,job_ids:[job.id],po_limit_cents:0}})).status,200)
 assert.equal((await read(hidden)).status,403)
 assert.equal((await f.request(`${root}/${firstId}/files/${old.id}`,{cookie:hidden})).status,403)
 assert.equal((await f.json('/api/plinth/plan-inbox',{cookie:hidden})).status,403)
 for(const path of ['/api/plinth/jobs/'+job.id,'/api/plinth/jobs']){
  const response=await f.json(path,{cookie:hidden});assert.equal(response.status,200)
  const projected=response.value.job??response.value.jobs.find(j=>j.id===job.id)
  assert.equal(projected.plan_sets,undefined)
  assert.ok(!projected.approvals.some(a=>a.kind==='plans.approve'),'Ordinary job JSON cannot expose plan approval snapshots when documents are hidden')
  assert.ok(!JSON.stringify(projected).includes(old.document.name),'Hidden plan filenames cannot leak through job JSON')
 }
 await setPortalFeatures(f,job.id,[],['plans'])
 assert.equal((await read(trade)).status,404);assert.equal((await f.request(`${root}/${firstId}/files/${old.id}`,{cookie:trade})).status,404)
 assert.deepEqual((await f.json('/api/plinth/plan-inbox',{cookie:trade})).value.jobs,[])
 crewVersion=await assign([],crewVersion);assert.equal((await read(crew)).status,404)
 assert.equal((await act(`/${secondId}/acknowledge`,{},crew)).status,404)
 const final=(await f.json('/api/plinth/jobs/'+job.id,{cookie:f.owner})).value.job
 assert.equal((await f.json('/api/plinth/jobs/'+job.id,{method:'DELETE',cookie:f.owner,body:{expected_version:final.version}})).status,200)
 assert.equal((await f.request(`${root}/${firstId}/files/${old.id}`,{cookie:f.owner})).status,404)
 assert.equal((await f.request(`${root}/${secondId}/files/${newSheet.id}`,{cookie:f.owner})).status,404)
 assert.equal((await f.json(root,{method:'POST',cookie:f.owner,body:{expected_version:final.version,title:'Replayed capture',issue_on:'2026-10-10',sheets:[source('A1','C')]}})).status,404,'A replay cannot recreate an erased job')
 assert.deepEqual((await f.json('/api/plinth/plan-inbox',{cookie:client})).value.jobs,[])
 }finally{await f.close()}
})

test('DOC-004 — native window submittal cycles preserve vendor originals and exact reviewer decisions while procurement refuses unsafe release',async()=>{
 const f=await createFixture()
 try{
  const address=n=>['synthetic-plinth-submittal-'+n,'example.test'].join('@')
  const client=await f.invite(address(1),'Submittal client'),manager=await f.invite(address(2),'Designated reviewer','admin'),other=await f.invite(address(3),'Other manager','admin')
  let job=await createActiveJob(f,'Window review house',address(1))
  const team=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team,reviewer=team.find(p=>p.name==='Designated reviewer')
  assert.equal((await f.json('/api/plinth/team/'+reviewer.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'project_manager',job_ids:[job.id],po_limit_cents:200000}})).status,200)
  const root='/api/plinth/jobs/'+job.id
  const read=()=>f.json(root+'/submittals',{cookie:f.owner})
  const act=async(path,body={},cookie=f.owner)=>{const r=await f.json(root+path,{method:'POST',cookie,body:{expected_version:job.version,...body}});if(r.status===200)job=r.value.job;return r}
  const ok=async(path,body={},cookie)=>{const r=await act(path,body,cookie);assert.equal(r.status,200,JSON.stringify(r.value));return r.value.record}
  const unchanged=async(path,body,credentials=f.owner,code)=>{const before=await read(),audit=(await f.db.prepare('SELECT count(*) AS n FROM pl_audit').first()).n,attachments=(await f.db.prepare('SELECT count(*) AS n FROM pl_attachments').first()).n;const r=await act(path,body,credentials);assert.ok([400,403,409].includes(r.status),JSON.stringify(r));if(code)assert.equal(r.value.error,code);assert.deepEqual((await read()).value,before.value);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM pl_audit').first()).n,audit);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM pl_attachments').first()).n,attachments);return r}
  const order=await ok('/orders',{supplier:'Synthetic window supplier',description:'Window schedule W1',amount_cents:120000})
  const original=takeoffPlan(),revised=takeoffPlan(true)
  const submission=(product,bytes,extra={})=>({product_reference:product,required_on:'2026-11-12',specified_scope:'W1 insulated low-e window package',reviewer_id:reviewer.id,deviates:false,attachments:[{name:'synthetic-plinth-window.pdf',mime:'application/pdf',base64:bytes.toString('base64')}],...extra})
  let row=await ok('/submittals',{title:'Window package',order_id:order.id,...submission('Window version one',original,{deviates:true,deviation:'The proposed glass omits the low-e coating'})})
  const id=row.id,first=row.cycles[0],path='/submittals/'+id,release=(cycle,extra={})=>({cycle_id:cycle.id,order_id:order.id,product_reference:cycle.product_reference,confirm:true,...extra})
  assert.deepEqual([first.required_on,first.reviewer.id,first.product_reference],['2026-11-12',reviewer.id,'Window version one']);assert.match(first.deviation,/low-e/);assert.ok(first.attachments[0].checksum)
  await unchanged('/orders/'+order.id+'/issue',{},f.owner,'submittal_unapproved')
  const review={cycle_id:first.id,disposition:'approved',comment:'An unauthorized approval',confirm:true}
  await unchanged(path+'/review',review,f.owner,'submittal_reviewer')
  await unchanged(path+'/review',review,other,'submittal_reviewer')
  await unchanged(path+'/review',review,client)
  await unchanged(path+'/release',release(first),manager,'forbidden')
  const limited=await f.invite(address(4),'Restricted submittal reviewer','admin'),limitedId=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team.find(p=>p.name==='Restricted submittal reviewer').id
  const limitedRole=await f.json('/api/plinth/roles',{method:'POST',cookie:f.owner,body:{name:'Document approval disabled',copy_of:'project_manager',permissions:{documents:{approve:false}}}});assert.equal(limitedRole.status,201)
  assert.equal((await f.json('/api/plinth/team/'+limitedId,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'custom',role_id:limitedRole.value.role.id,job_ids:[job.id],po_limit_cents:0}})).status,200)
  await unchanged(path+'/review',review,limited,'forbidden')
  await unchanged(path+'/resubmit',{cycle_id:first.id,...submission('Other package',original,{reviewer_id:limitedId})},f.owner,'submittal_reviewer')
  const unscopedRole=await f.json('/api/plinth/roles',{method:'POST',cookie:f.owner,body:{name:'Unassigned administrator copy',copy_of:'administrator'}});assert.equal(unscopedRole.status,201)
  assert.equal((await f.json('/api/plinth/team/'+limitedId,{method:'PUT',cookie:f.owner,body:{expected_version:1,role:'custom',role_id:unscopedRole.value.role.id,job_ids:[],po_limit_cents:0}})).status,200)
  assert.equal((await f.json(root+'/submittals',{cookie:limited})).status,404,'Even administrator copies need explicit job assignment at the new document door')
  const beforeUnassigned=await read()
  assert.equal((await f.json(root+'/orders/'+order.id+'/issue',{method:'POST',cookie:limited,body:{expected_version:job.version}})).status,404)
  assert.equal((await f.request(root+'/submittals/files/'+first.attachments[0].id,{cookie:limited})).status,404)
  assert.deepEqual((await read()).value,beforeUnassigned.value,'Unassigned administrator copies cannot change the registered commitment')


  row=await ok(path+'/annotate',{cycle_id:first.id,file_id:first.attachments[0].id,page:1,text:'Coating missing on the submitted glazing schedule'},manager)
  row=await ok(path+'/review',{...review,disposition:'rejected',comment:'Reject this glass and resubmit the specified coating'},manager)
  const rejected=structuredClone(row.cycles[0])
  await unchanged(path+'/review',{...review,comment:'Rewrite the rejected disposition'},manager,'immutable')
  await unchanged(path+'/release',release(first),f.owner,'submittal_unapproved')
  await unchanged(path+'/annotate',{cycle_id:first.id,file_id:first.attachments[0].id,page:1,text:'Rewrite closed review'},manager,'immutable')
  row=await ok(path+'/resubmit',{cycle_id:first.id,...submission('Window version two',revised)})
  const second=row.cycles[1]
  await unchanged(path+'/review',{cycle_id:first.id,disposition:'approved',comment:'Approve stale package',confirm:true},manager,'submittal_version')
  await unchanged(path+'/review',{cycle_id:second.id,disposition:'approved',comment:'Missing consent',confirm:false},manager)
  row=await ok(path+'/review',{cycle_id:second.id,disposition:'approved',comment:'Current glazing matches W1',confirm:true},manager)
  assert.deepEqual(row.cycles[0],rejected);assert.equal(row.cycles[1].decision.by.id,reviewer.id)
  await unchanged(path+'/release',release(second,{product_reference:'Other window model'}),f.owner,'submittal_mismatch')
  await unchanged(path+'/release',release(second,{order_id:'different-commitment'}),f.owner,'submittal_mismatch')
  await unchanged(path+'/release',release(first),f.owner,'submittal_version')
  await unchanged('/orders/'+order.id+'/issue',{},f.owner,'submittal_version')
  await ok(path+'/release',release(second))
  await ok('/orders/'+order.id+'/issue')
  assert.equal(job.orders[0].status,'issued');assert.equal(job.orders[0].submittal_release.cycle_id,second.id);assert.equal(job.orders[0].amount_cents,120000)
  const register=(await read()).value.register[0]
  for(const [cycle,bytes] of [[register.cycles[0],original],[register.cycles[1],revised]]){
   const file=await f.request(root+'/submittals/files/'+cycle.attachments[0].id,{cookie:f.owner});assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes)
   assert.equal((await f.request(root+'/submittals/files/'+cycle.attachments[0].id,{cookie:client})).status,403)
  }
  const projected=(await f.json(root,{cookie:client})).value;assert.ok(!JSON.stringify(projected).includes('Coating missing'));assert.equal(projected.job.submittals,undefined)
  const otherJob=await createActiveJob(f,'Unrelated window job',address(1))
  assert.equal((await f.request('/api/plinth/jobs/'+otherJob.id+'/submittals/files/'+first.attachments[0].id,{cookie:f.owner})).status,404)
  assert.equal((await f.json(root+'/submittals',{token:await f.agent()})).status,403)
  const beforeRevoke=structuredClone((await read()).value.register)
  assert.equal((await f.json('/api/plinth/team/'+reviewer.id,{method:'PUT',cookie:f.owner,body:{expected_version:1,role:'project_manager',job_ids:[],po_limit_cents:200000}})).status,200)
  await unchanged('/orders/'+order.id+'/receive',{amount_cents:100,reference:'Unsafe receipt'},f.owner,'submittal_authority')
  assert.equal((await f.json(root+'/submittals',{cookie:manager})).status,404)
  assert.deepEqual((await read()).value.register,beforeRevoke)
  assert.equal((await f.json('/api/plinth/team/'+reviewer.id,{method:'PUT',cookie:f.owner,body:{expected_version:2,role:'project_manager',job_ids:[job.id],po_limit_cents:200000}})).status,200)
  await unchanged(path+'/release',release(second),f.owner,'submittal_authority')
  row=await ok(path+'/resubmit',{cycle_id:second.id,...submission('Window version three',revised)})
  const third=row.cycles[2]
  await ok(path+'/review',{cycle_id:third.id,disposition:'revise_resubmit',comment:'Provide a clearer mullion detail',confirm:true},manager)
  await unchanged(path+'/release',release(third),f.owner,'submittal_unapproved')
  assert.equal((await f.json(root,{cookie:f.owner})).value.job.approvals.some(a=>a.kind.startsWith('submittal.')),false,'Submittal decisions are served only through the gated register')
  const erased=await f.json(root,{method:'DELETE',cookie:f.owner,body:{expected_version:job.version}});assert.equal(erased.status,200)
  assert.equal((await read()).status,404)
  assert.equal((await f.request(root+'/submittals/files/'+first.attachments[0].id,{cookie:f.owner})).status,404)
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM pl_attachments WHERE job_id=?').bind(job.id).first()).n,0)
 }finally{await f.close()}
})

test('Owner follow-up previews retain revisions, respect current consent and authority, and stop resolved work without side effects',async()=>{
 const {followupFixture,followupAddress}=await import('./followup-support.mjs')
 const f=await createFixture({now:Date.parse('2026-10-27T15:00:00Z')})
 try{
  const c=await followupFixture(f),{estimate,active,config}=c
  for(const [job,kind] of [[estimate,'estimate'],[active,'selection'],[active,'collection']])await job.act('/followup-rules',{...config,kind,...(kind==='collection'?{mode:'scheduled',starts_on:'2026-10-29'}:{})})
  const oldRevision=structuredClone(estimate.job.followup.rules[0].revisions[0])
  await estimate.act('/followup-rules',{...config,kind:'estimate',reason:'Reviewed a second time'})
  assert.deepEqual(estimate.job.followup.rules[0].revisions[0],oldRevision)
  assert.equal(estimate.job.followup.rules[0].revisions.length,2)
  const foreign=await f.invite(followupAddress(2),'Unrelated client'),admin=await f.invite(followupAddress(3),'Synthetic administrator','admin'),agent=await f.agent()
  const root='/api/plinth/jobs/'+estimate.job.id
  const snapshot=await estimate.read(),calls=f.messages.length
  for(const cookie of [c.client,foreign,admin]){
   for(const suffix of ['/followup-rules','/followup-rules/preview?as_of=2026-10-30T15:00:00Z'])assert.equal((await f.json(root+suffix,{cookie})).status,403)
   assert.equal((await f.json(root+'/followup-rules',{method:'POST',cookie,body:{...config,kind:'estimate',expected_version:snapshot.version}})).status,403)
  }
  assert.equal((await f.json(root+'/followup-rules',{token:agent})).status,403)
  assert.equal((await f.json(root+'/followup-consent',{method:'POST',cookie:foreign,body:{kind:'estimate',allowed:true,confirm:true,expected_version:snapshot.version}})).status,404)
  assert.equal((await f.json(root+'/followup-rules',{method:'POST',cookie:f.owner,body:{...config,kind:'estimate',expected_version:snapshot.version-1}})).status,409)
  assert.deepEqual(await estimate.read(),snapshot);assert.equal(f.messages.length,calls)
  const early=await c.preview(estimate,'2026-10-27T15:00:00Z')
  assert.equal(early.actions[0].rule_revision,2);assert.equal(early.actions.filter(a=>a.status==='eligible').length,1);assert.equal(early.actions[1].reason,'Step not due')
  assert.equal((await c.preview(active,'2026-10-28T15:00:00Z')).actions.find(a=>a.source_id===c.invoice.id).reason,'Sequence not started')
  assert.ok((await c.preview(active,'2026-10-30T15:00:00Z')).actions.some(a=>a.source_id===c.invoice.id&&a.status==='eligible'))
  const before=await active.read(),beforeRules=await estimate.read(),beforeCalls=f.messages.length
  const preview=await c.preview(active)
  assert.equal(preview.actions.filter(a=>a.status==='eligible').length,3)
  assert.equal(new Set(preview.actions.map(a=>a.key)).size,preview.actions.length)
  assert.deepEqual(await c.preview(active),preview)
  assert.equal((await f.json('/api/plinth/jobs/'+active.job.id+'/followup-rules/preview',{method:'POST',cookie:f.owner,body:{}})).status,405)
  assert.deepEqual(await active.read(),before);assert.deepEqual(await estimate.read(),beforeRules);assert.equal(f.messages.length,beforeCalls,'Preview never sends mail or instructions')
  assert.ok((await c.preview(estimate,'2026-10-30T02:00:00Z')).actions.every(a=>a.reason==='Recipient quiet hours'))
  assert.ok((await c.preview(estimate,'2027-01-01T15:00:00Z')).actions.every(a=>a.reason==='Stop date passed'))
  await estimate.act('/followup-rules',{...config,kind:'estimate',approval_limit_cents:1})
  assert.ok((await c.preview(estimate)).actions.every(a=>a.reason==='Amount exceeds owner review limit'))
  await estimate.act('/followup-rules',{...config,kind:'estimate',paused:true})
  assert.ok((await c.preview(estimate)).actions.every(a=>a.reason==='Rule paused'))
  await estimate.act('/followup-rules',{...config,kind:'estimate'})
  await c.consent(estimate,'estimate',false,c.client)
  assert.ok((await c.preview(estimate)).actions.every(a=>a.reason==='Recipient opted out; sequence stopped'))
  // Escalation concerns outstanding work only; a client opt-out does not authorize another client notice.
  await estimate.act('/quotes/'+estimate.job.quotes.at(-1).id+'/accept',{method:'signed',evidence:'Synthetic client accepted',schedule_choice:{kind:'none',reason:'Permit pending'}})
  assert.ok((await c.preview(estimate)).actions.every(a=>a.reason==='Source resolved or held'))
  await active.act('/selections/'+c.choice.id+'/sign',{revision_id:c.choice.revisions[0].id,option_id:c.choice.revisions[0].options[0].id,statement:'I approve this exact option',confirm:true},c.client)
  await active.act('/invoices/'+c.invoice.id+'/receipt',{amount_cents:10000,received_on:'2026-10-30',method:'bank',reference:'synthetic-plinth-receipt-1',confirm:true})
  assert.ok((await c.preview(active)).actions.every(a=>a.reason==='Source resolved or held'),'Resolved choice and paid collection never escalate')
  await active.act('/portal-policy',{disabled:{client:['billing','selections'],subcontractor:[]},reason:'Owner revoked portal features'})
  // New outstanding sources must still recheck recipient grants.
  const next=(await active.act('/selections',{room:'Bath',category:'Fixtures',allowance_cents:1000,cost_code:'22-100',decision_on:'2026-10-28',lead_days:1,options:[{name:'Basin',supplier:'Synthetic supplier',specifications:'Reviewed white basin',price_cents:1000}]})).record
  await active.act('/selections/'+next.id+'/present',{revision_id:next.revisions[0].id})
  assert.equal((await c.preview(active)).actions.find(a=>a.source_id===next.id&&!a.escalation).reason,'Recipient has no current access')
  const clientJob=(await f.json('/api/plinth/jobs/'+active.job.id,{cookie:c.client})).value.job;assert.equal(clientJob.followup,undefined,'Private configuration and other people consent never leave the owner door')
  assert.equal((await f.request('/auth/operator/status',{method:'POST',cookie:f.owner,body:{operatorId:c.clientId,status:'inactive'}})).status,200)
  assert.equal((await f.json('/api/plinth/jobs/'+active.job.id+'/followup-consent',{cookie:c.client})).status,401)
  assert.equal((await c.preview(active)).actions.find(a=>a.source_id===next.id&&!a.escalation).reason,'Recipient has no current access')
  assert.equal((await f.json('/api/plinth/jobs/'+active.job.id+'/followup-rules',{method:'POST',cookie:f.owner,body:{...config,kind:'selection',expected_version:active.job.version}})).status,403)
  assert.equal((await f.request('/api/plinth/agent-credentials/'+(await f.json('/api/plinth/agent-credentials',{cookie:f.owner})).value.credentials[0].id+'/revoke',{method:'POST',cookie:f.owner,body:{}})).status,200)
  assert.equal((await f.json(root+'/followup-rules',{token:agent})).status,401)
  const erasedId=active.job.id
  assert.equal((await f.json('/api/plinth/jobs/'+erasedId,{method:'DELETE',cookie:f.owner,body:{expected_version:active.job.version}})).status,200)
  assert.equal((await f.json('/api/plinth/jobs/'+erasedId+'/followup-rules/preview?as_of=2026-10-30T15:00:00Z',{cookie:f.owner})).status,404)
 }finally{await f.close()}
})

test('DOC-002 — office drawing review corrects source-bound proposals, reviews detail links and searches revision markup while refusing stale and revoked access',async()=>{
 const f=await createFixture();try{
  const job=await createActiveJob(f,'Reviewed drawing house',['synthetic-plinth-drawing-client','example.test'].join('@'))
  const proof=await proveDrawingReview(f,job)
  const latest=(await f.json('/api/plinth/jobs/'+job.id,{cookie:f.owner})).value.job
  assert.equal((await f.json('/api/plinth/jobs/'+job.id,{method:'DELETE',cookie:f.owner,body:{expected_version:latest.version}})).status,200)
  for(const path of ['/review-search?q=Reviewed','/'+proof.set.id+'/links/'+proof.link,'/'+proof.set.id+'/files/'+proof.one.id])assert.equal((await f.request('/api/plinth/jobs/'+job.id+'/plans'+path,{cookie:f.owner})).status,404)
  assert.equal((await f.json('/api/plinth/jobs/'+job.id+'/plans/'+proof.set.id+'/recognition-propose',{method:'POST',cookie:f.owner,body:{expected_version:latest.version}})).status,404,'Replay cannot resurrect erased recognition')
 }finally{await f.close()}
})

test('Signed window changes freeze two exact consents, private costs and calendar terms; unsafe decisions never apply economics',async()=>{
 const {signedChangeFixture,changeAddress}=await import('./signed-change-support.mjs'),f=await createFixture()
 try{
  const c=await signedChangeFixture(f),foreign=await f.invite(changeAddress('foreign-signer'),'Foreign client'),agent=await f.agent()
  const variation=await c.priced(),row=await c.present(variation),original=structuredClone(c.job)
  assert.equal(row.document.extra_days,5);assert.equal(row.document.completion_before,'2026-11-04');assert.equal(row.document.revised_completion,'2026-11-09')
  assert.equal(row.private_terms.pricing.base_lines[0].cost_total_cents,45000)
  for(const auth of [{cookie:foreign},{cookie:undefined,token:agent}])assert.ok([403,404].includes((await c.api('/jobs/'+c.job.id+'/signed-changes',undefined,auth.cookie,auth.token)).status))
  const clientList=await c.list(c.client),wire=JSON.stringify(clientList);assert.equal(clientList.changes.length,1)
  for(const secret of ['cost_total_cents','cost_unit_cents','source_digest','private_terms"','45000'])assert.ok(!wire.includes(secret),secret)
  const document=await c.api('/jobs/'+c.job.id+'/signed-changes/'+row.id+'/document.json',undefined,c.client);assert.equal(document.status,200);assert.equal(document.value.digest,row.digest)
  assert.equal((await c.act('/variations/'+variation.id+'/approve',{},c.client)).status,409,'Legacy approval cannot bypass signed execution')
  assert.equal((await c.act('/signed-changes/'+row.id+'/sign',{digest:'changed',name:'Synthetic change client',confirm:true},c.client)).status,409)
  assert.equal((await c.act('/signed-changes/'+row.id+'/sign',{digest:row.digest,name:'Synthetic change client'},c.client)).status,400)
  assert.equal((await c.act('/signed-changes/'+row.id+'/apply',{digest:row.digest,confirm:true,...c.billing(row)})).status,409)
  await c.sign(row)
  assert.equal((await c.act('/signed-changes/'+row.id+'/sign',{digest:row.digest,name:c.job.created_by.name,confirm:true})).status,409)
  await c.sign(row,c.client,'Synthetic change client')
  assert.equal((await c.list()).changes[0].status,'signed');assert.deepEqual(c.job.budgets,original.budgets);assert.deepEqual(c.job.schedules,original.schedules);assert.equal(c.job.variations[0].status,'draft')
  assert.equal((await c.act('/signed-changes/'+row.id+'/apply',{digest:row.digest,...c.billing(row)})).status,400)
  await c.ok('/signed-changes/'+row.id+'/dispute',{digest:row.digest,reason:'Window finish needs revision'},c.client)
  const disputed=(await c.list()).changes[0];assert.equal(disputed.signatures.length,2);assert.equal(disputed.history[0].reason,'Window finish needs revision')
  assert.equal((await c.act('/signed-changes/'+row.id+'/apply',{digest:row.digest,confirm:true,...c.billing(row)})).status,409)
  const revised=await c.present(variation);assert.equal(revised.revision,2)
  await c.ok('/signed-changes/'+revised.id+'/decline',{digest:revised.digest,reason:'Do not add this window'},c.client)
  assert.deepEqual(c.job.budgets,original.budgets);assert.deepEqual(c.job.schedules,original.schedules);assert.deepEqual(c.job.orders,original.orders);assert.deepEqual(c.job.invoices,original.invoices)
  const fresh=await c.present(variation);await c.sign(fresh)
  await c.ok('/schedules',{trade:'Unrelated source crew',description:'New completion source',start:'2026-11-03T08:00:00Z',end:'2026-11-03T09:00:00Z'})
  assert.equal((await c.act('/signed-changes/'+fresh.id+'/sign',{digest:fresh.digest,confirm:true,name:'Synthetic change client'},c.client)).value.error,'change_sources')
  const d=await signedChangeFixture(f,{tag:'revoked',clientEmail:changeAddress('revoked')});await d.priced();const revoked=await d.present();await d.sign(revoked);await d.sign(revoked,d.client,'Synthetic change client')
  const revoke=await f.json('/auth/operator/status',{method:'POST',cookie:f.owner,body:{operatorId:revoked.client.id,status:'inactive'}});assert.equal(revoke.status,200)
  const before=structuredClone(d.job);assert.ok([403,409].includes((await d.act('/signed-changes/'+revoked.id+'/apply',{digest:revoked.digest,confirm:true,...d.billing(revoked)})).status));await d.read();assert.deepEqual(d.job,before)
  const a=await signedChangeFixture(f,{tag:'allowance',clientEmail:changeAddress('signed-allowance'),allowance:50000})
  const terms={room:'Kitchen',category:'Window',allowance_cents:50000,cost_code:'06-100',decision_on:'2026-11-04',lead_days:5,options:[{name:'Larger window',specifications:'Reviewed exact pane and frame',supplier:'Synthetic window supplier',price_cents:160000}]}
  const selection=(await a.ok('/selections',terms)).record,revision=selection.revisions[0]
  await a.ok('/selections/'+selection.id+'/present',{revision_id:revision.id});await a.ok('/selections/'+selection.id+'/sign',{revision_id:revision.id,option_id:revision.options[0].id,statement:'I choose this exact window',confirm:true},a.client)
  const allowanceInput={selection_id:selection.id,revision_id:revision.id,schedule_days:5,impact_reference:'Reviewed five-calendar-day procurement impact',impacts_reviewed:true,basis:'sell',as_of:'2026-10-28',lines:[{id:'allowance-window',description:'Incremental window upgrade',cost_code:'06-100',phase:'Remodel',category:'material',quantity:'1',unit:'each',unit_cents:100000,cost_unit_cents:45000}],rules:[],tax:{rate_id:a.rate.id,taxable_line_ids:['allowance-window']}}
  const allowancePreview=(await a.ok('/allowance-changes/preview',allowanceInput)).preview;await a.ok('/allowance-changes/apply',{...allowanceInput,digest:allowancePreview.digest})
  const allowanceRow=await a.present();assert.deepEqual(allowanceRow.document.allowance,{selection_id:selection.id,selection_revision_id:revision.id,cost_code:'06-100',allowance_cents:50000,economic_delta_cents:110000,prior_economic_delta_cents:0,amount_cents:110000});assert.equal(allowanceRow.document.tax_cents,10000)
  await a.sign(allowanceRow);await a.sign(allowanceRow,a.client,'Synthetic change client')
  await a.ok('/selections/'+selection.id+'/revise',{...terms,options:[{...terms.options[0],price_cents:171000}]})
  assert.equal((await a.act('/signed-changes/'+allowanceRow.id+'/apply',{digest:allowanceRow.digest,confirm:true,...a.billing(allowanceRow)})).value.error,'change_sources');assert.equal(a.job.budgets.length,1)
  const g=await signedChangeFixture(f,{tag:'unpublished',clientEmail:changeAddress('unpublished-client')});await g.priced()
  assert.equal((await g.act('/schedules',{trade:'Synthetic draft crew',description:'Unreviewed unrelated work',start:'2026-11-03T08:00:00Z',end:'2026-11-03T12:00:00Z'},undefined,agent)).status,200);await g.read();assert.equal(g.job.schedules[1].status,'draft')
  const unpublishedBefore=structuredClone(g.job),unpublishedClients=(await g.list()).clients
  const unpublishedDecision=await g.act('/signed-changes',{variation_id:g.job.variations[0].id,client_id:unpublishedClients[0].id,task_ids:[g.job.schedules[0].id],extra_days:5})
  assert.equal(unpublishedDecision.status,409,'A signed change must not implicitly book unrelated draft tasks');await g.read();assert.deepEqual(g.job,unpublishedBefore)
  const b=await signedChangeFixture(f,{tag:'builder-revoked',clientEmail:changeAddress('builder-revoked-client')}),builder=await f.invite(changeAddress('builder-revoked'),'Synthetic change builder','admin');await b.priced();const available=await b.list()
  const builderRow=(await b.ok('/signed-changes',{variation_id:b.job.variations[0].id,client_id:available.clients[0].id,task_ids:[b.job.schedules[0].id],extra_days:5},builder)).record
  await b.sign(builderRow,builder,'Synthetic change builder');await b.sign(builderRow,b.client,'Synthetic change client')
  assert.equal((await f.json('/auth/operator/status',{method:'POST',cookie:f.owner,body:{operatorId:builderRow.builder.id,status:'inactive'}})).status,200)
  const builderBefore=structuredClone(b.job);assert.equal((await b.act('/signed-changes/'+builderRow.id+'/apply',{digest:builderRow.digest,confirm:true,...b.billing(builderRow)})).status,409);await b.read();assert.deepEqual(b.job,builderBefore)
  assert.equal((await f.json('/api/plinth/jobs/'+d.job.id,{method:'DELETE',cookie:f.owner,body:{expected_version:d.job.version}})).status,200)
  assert.equal((await d.act('/signed-changes/'+revoked.id+'/apply',{digest:revoked.digest,confirm:true,...d.billing(revoked)})).status,404);assert.equal((await d.api('/jobs/'+d.job.id+'/signed-changes/'+revoked.id+'/document.json')).status,404,'An erased job cannot be reconstructed by replaying a captured signature or application')
 }finally{await f.close()}
})
