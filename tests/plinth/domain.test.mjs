import { takeoffPlan } from '../fixtures/takeoff-plan.mjs'
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
  const tradeRfi=(await api('/rfi-inbox',undefined,trade)).value.jobs[0].rfis[0];assert.equal(tradeRfi.responses[0].text,response.text);assert.equal(tradeRfi.responses[0].cost_impact_cents,undefined);assert.equal(tradeRfi.responses[0].change_pending,true)
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
  const zeroChange=job.variations.at(-1);assert.equal(zeroChange.amount_cents,0);assert.equal((await act(`/variations/${zeroChange.id}/approve`,{},client)).status,200,'A date-only response still needs explicit native client approval')
  assert.equal((await act('/rfi-access',{email:'rfi-trade@example.com',revoke:true})).status,200)
  assert.deepEqual((await api('/rfi-inbox',undefined,trade)).value.jobs,[]);assert.equal((await f.request(`/api/plinth/rfi-inbox/${job.id}/files/${job.rfis[0].responses[0].attachments[0].id}`,{cookie:trade})).status,404)
  const visible=(await api(`/jobs/${job.id}`,undefined,client)).value.job;assert.equal(visible.rfis,undefined);assert.equal(visible.rfi_access,undefined)
 }finally{await f.close()}
})
