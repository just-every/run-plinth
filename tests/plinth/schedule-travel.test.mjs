import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture, createReleasedScope } from './helpers.mjs'

const date = time => `2026-11-06T${time}Z`

test('SCH-003 — travel-aware bookings and moves preserve exact gaps and refuse atomic cross-site conflicts', async () => {
 const f = await createFixture()
 try {
  let first = await createActiveJob(f, 'North site'), second = await createActiveJob(f, 'South site')
  const read = async job => (await f.json(`/api/plinth/jobs/${job.id}`, {cookie:f.owner})).value.job
  const post = (job, path, body = {}, credentials = {cookie:f.owner}) => f.json(`/api/plinth/jobs/${job.id}${path}`, {method:'POST', ...credentials, body:{expected_version:job.version, ...body}})
  const booking = (start, end, extra = {}) => ({trade:'Carpentry crew',description:'Frame walls',start:date(start),end:date(end),...extra})
  for (const value of [-1, 1.5, 1441, null, '30']) assert.equal((await post(first, '/schedules', booking('08:00:00','09:00:00',{travel_minutes:value}))).status,400)
  let r = await post(first, '/schedules', booking('08:00:00','09:00:00',{travel_minutes:60}));assert.equal(r.status,200);first=r.value.job
  const north = r.value.record.id
  assert.equal(first.approvals.at(-1).snapshot.travel_minutes,60,'Human booking history fixes the reviewed buffer')
  r = await post(second, '/schedules', booking('09:59:59.999','11:00:00'));assert.equal(r.status,409)
  assert.equal(r.value.details.conflicts[0].reason,'travel');assert.equal(r.value.details.conflicts[0].job_id,first.id)
  assert.equal((await read(second)).schedules.length,0,'A travel refusal writes no booking or history')
  r = await post(second, '/schedules', booking('10:00:00','11:00:00',{travel_minutes:90}));assert.equal(r.status,409,'The larger buffer of the two sites applies')
  r = await post(second, '/schedules', booking('10:30:00','11:30:00',{travel_minutes:90}));assert.equal(r.status,200,'Exactly 90 elapsed minutes is feasible');second=r.value.job
  const south = r.value.record.id
  r = await post(first, `/schedules/${north}/move`, {start:date('12:00:00'),end:date('13:00:00')});assert.equal(r.status,409,'The check also applies when moving after the other site')
  assert.equal((await read(first)).schedules[0].start,date('08:00:00').replace('Z','.000Z'))
  r = await post(first, `/schedules/${north}/move`, {start:date('13:00:00'),end:date('14:00:00')});assert.equal(r.status,200);first=r.value.job
  assert.equal(first.schedules[0].travel_minutes,60,'An omitted buffer survives a move')
  r = await post(first, '/schedules', booking('14:00:00','15:00:00',{travel_minutes:60}));assert.equal(r.status,200,'Adjacent work at the same job needs no inter-site travel');first=r.value.job
  r = await post(second, `/schedules/${south}/cancel`);assert.equal(r.status,200);second=r.value.job
  r = await post(first, `/schedules/${north}/move`, {start:date('12:00:00'),end:date('13:00:00'),travel_minutes:0});assert.equal(r.status,200,'Cancelled work consumes no travel capacity');first=r.value.job
  assert.equal(first.schedules.find(s=>s.id===north).travel_minutes,undefined,'Explicit zero clears the buffer')
  const client=await f.invite('client@example.com')
  assert.equal((await post(first,'/schedules',booking('16:00:00','17:00:00',{travel_minutes:60}),{cookie:client})).status,403)
  const third=await createActiveJob(f,'East site'),fourth=await createActiveJob(f,'West site')
  const race=await Promise.all([post(third,'/schedules',{...booking('08:00:00','09:00:00',{travel_minutes:60}),trade:'Roofing crew'}),post(fourth,'/schedules',{...booking('09:30:00','10:30:00',{travel_minutes:60}),trade:'Roofing crew'})])
  assert.deepEqual(race.map(x=>x.status).sort(),[200,409],'Concurrent individually feasible proposals cannot both consume the travel window')
  assert.equal((await read(third)).schedules.length+(await read(fourth)).schedules.length,1)
 } finally {await f.close()}
})

test('SCH-003 — reviewed planners and reusable templates retain travel constraints through publication and UTC offsets', async () => {
 const f=await createFixture()
 try {
  let north=await createActiveJob(f,'North remodel'),south=await createActiveJob(f,'South remodel')
  const post=(job,path,body={})=>f.json(`/api/plinth/jobs/${job.id}${path}`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,...body}})
  let r=await post(north,'/schedules',{trade:'Plumbing crew',description:'Rough in',start:'2026-11-06T08:00:00-05:00',end:'2026-11-06T09:00:00-05:00',travel_minutes:60});assert.equal(r.status,200);north=r.value.job
  const calendar={weekdays:[1,2,3,4,5],start_hour:0,end_hour:24,holidays:[]}
  const task={id:'south-plumbing',trade:'Plumbing crew',description:'Install fixtures',owner:'Site manager',start:'2026-11-06T09:30:00-05:00',duration_minutes:60,travel_minutes:15}
  r=await post(south,'/schedule/preview',{calendar,tasks:[task]});assert.equal(r.status,200)
  assert.equal(r.value.preview.conflicts[0].required_travel_minutes,60);assert.equal(r.value.preview.conflicts[0].available_travel_minutes,30)
  assert.equal((await post(south,'/schedule/publish',{calendar,tasks:r.value.preview.tasks,digest:r.value.preview.digest})).status,409)
  r=await post(south,'/schedule/preview',{calendar,tasks:[{...task,start:'2026-11-06T10:00:00-05:00'}]});assert.equal(r.status,200);assert.deepEqual(r.value.preview.conflicts,[])
  let preview=r.value.preview
  assert.equal((await post(south,'/schedule/publish',{calendar,tasks:preview.tasks.map(t=>({...t,travel_minutes:90})),digest:preview.digest})).status,409,'A changed travel requirement needs a fresh review')
  r=await post(south,'/schedule/publish',{calendar,tasks:preview.tasks,digest:preview.digest});assert.equal(r.status,200);south=r.value.job
  assert.equal(south.schedules[0].travel_minutes,15)
  const omitted=south.schedules.map(({travel_minutes,...task})=>task)
  r=await post(south,'/schedule/preview',{calendar,tasks:omitted});assert.equal(r.status,200);assert.equal(r.value.preview.tasks[0].travel_minutes,15,'Older planner clients cannot silently drop a persisted buffer')
  const templateResponse=await f.json('/api/plinth/schedule-templates',{method:'POST',cookie:f.owner,body:{name:'Plumbing visit with travel',calendar,tasks:south.schedules}})
  assert.equal(templateResponse.status,201);const template=templateResponse.value.template
  assert.equal(template.tasks[0].travel_minutes,15)
  let east=await createActiveJob(f,'East remodel')
  const input={template_id:template.id,start:'2026-11-06T16:00:00Z'}
  r=await post(east,'/schedule-template/preview',input);assert.equal(r.status,200);assert.ok(r.value.preview.conflicts.some(c=>c.reason==='travel'),'A translated template cannot bypass travel to existing work')
  assert.equal((await post(east,'/schedule-template/apply',{...input,digest:r.value.preview.digest})).status,409)
  input.start='2026-11-06T16:15:00Z'
  r=await post(east,'/schedule-template/preview',input);assert.equal(r.status,200);assert.deepEqual(r.value.preview.conflicts,[]);preview=r.value.preview
  r=await post(east,'/schedule-template/apply',{...input,digest:preview.digest});assert.equal(r.status,200);east=r.value.job
  assert.equal(east.schedules[0].travel_minutes,15)
  const reload=(await f.json(`/api/plinth/jobs/${east.id}`,{cookie:f.owner})).value.job
  assert.equal(reload.schedules[0].travel_minutes,15);assert.equal(reload.approvals.find(a=>a.kind==='schedule.publish').snapshot.after.tasks[0].travel_minutes,15)
  r=await post(south,'/schedule/preview',{calendar,tasks:[...south.schedules,{id:'inspection-marker',trade:'Plumbing crew',owner:'Inspector',description:'Inspection milestone',start:'2026-11-06T15:00:00Z',duration_minutes:0,milestone:true,travel_minutes:1440}]});assert.equal(r.status,200);assert.deepEqual(r.value.preview.conflicts,[],'A zero-duration milestone consumes no crew travel time')
 } finally {await f.close()}
})

test('SCH-003 — crew/equipment calendars, capacity, leave and personally confirmed alternatives fence all booking doors',async()=>{
 const f=await createFixture()
 try{
  const trade=await f.invite('trade@example.com','Riley Trade'),outsider=await f.invite('outsider@example.com'),client=await f.invite('client@example.com'),agent=await f.agent()
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{cookie,token,...(body?{method:'POST',body}:{})})
  let north=await createActiveJob(f,'Private North job'),south=await createActiveJob(f,'South site'),east=await createActiveJob(f,'East site')
  const reload=async job=>(await api(`/jobs/${job.id}`)).value.job
  const act=async(job,path,body={},cookie=f.owner,token)=>api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie,token)
  const t=h=>`2026-11-06T${h}:00:00Z`,win=(start,end,reason)=>({start:t(start),end:t(end),reason})
  let r=await api('/resources',{name:'Shared lifts',kind:'equipment',capacity:2,reason:'Initial owned capacity',available:[win('06','20','Site hours')],leave:[win('12','13','Maintenance')]});assert.equal(r.status,201);let lift=r.value.resource
  r=await api('/resources',{name:'Finish crew',kind:'crew',capacity:1,reason:'Crew roster',available:[],leave:[win('15','16','Leave')]});assert.equal(r.status,201);const crew=r.value.resource
  const booking=(trade,start,end,resources,travel_minutes=0)=>({trade,description:'Site work',start:t(start),end:t(end),resources,travel_minutes})
  for(const cookie of [client,outsider])assert.equal((await api('/resources',undefined,cookie)).status,403)
  assert.equal((await api('/resources',{name:'Agent resource',kind:'crew',capacity:1,reason:'No authority'},undefined,agent)).status,403)
  assert.equal((await act(north,'/schedules',booking('Frame','05','06',[{resource_id:lift.id,units:1}]))).value.error,'resource_conflict')
  assert.equal((await act(north,'/schedules',booking('Frame','12','13',[{resource_id:lift.id,units:1}]))).value.details.conflicts[0].reason,'leave')
  r=await act(north,'/schedules',booking('Frame','08','10',[{resource_id:lift.id,units:1},{resource_id:crew.id,units:1}],60));assert.equal(r.status,200);north=r.value.job;const nt=r.value.record.id
  r=await act(south,'/schedules',booking('Roof','08','10',[{resource_id:lift.id,units:1}]));assert.equal(r.status,200);south=r.value.job;const st=r.value.record.id
  r=await act(east,'/schedules',booking('Electrical','08','10',[{resource_id:lift.id,units:1}]));assert.equal(r.status,409);assert.equal(r.value.details.conflicts[0].reason,'capacity');assert.deepEqual(r.value.details.conflicts.map(c=>c.job_name).sort(),[north.name,south.name].sort());assert.equal((await reload(east)).schedules.length,0)
  assert.equal((await act(east,'/schedules',booking('Electrical','10','11',[{resource_id:crew.id,units:1}]))).status,409,'Crew travel gap is honored across trades and jobs')
  assert.equal((await act(north,`/schedules/${nt}/invite`,{email:'trade@example.com'},client)).status,403)
  let scopeSetup=await createReleasedScope(f,south,'trade@example.com','Roof');south=scopeSetup.job;const scopeId=scopeSetup.scope.id
  r=await act(south,`/schedules/${st}/invite`,{email:'trade@example.com',subcontract_id:scopeId});assert.equal(r.status,200);south=r.value.job;let invitation=r.value.record
  let inbox=(await api('/trade-confirmations',undefined,trade)).value.invitations;assert.equal(inbox.length,1);assert.equal(inbox[0].at_risk,true);assert.equal(inbox[0].job_name,south.name)
  assert.ok(!JSON.stringify(inbox).includes(north.name));assert.equal(inbox[0].quotes,undefined);assert.equal((await api(`/jobs/${south.id}`,undefined,trade)).status,404,'A trade invitation grants no client portal access')
  assert.deepEqual((await api('/trade-confirmations',undefined,outsider)).value.invitations,[])
  assert.equal((await api(`/trade-confirmations/${invitation.id}/confirm`,{expected_version:south.version,reason:'I accept',confirm:true},outsider)).status,404)
  r=await api(`/trade-confirmations/${invitation.id}/alternative`,{expected_version:south.version,start:t('13'),end:t('14'),reason:'Crew available after maintenance'},trade);assert.equal(r.status,200);south=await reload(south);assert.equal(south.schedules[0].start,t('08').replace('Z','.000Z'));assert.equal(south.trade_invitations[0].responses[0].kind,'alternative')
  r=await act(south,`/schedules/${st}/move`,{start:t('13'),end:t('14')});assert.equal(r.status,200);south=r.value.job
  assert.equal((await api(`/trade-confirmations/${invitation.id}/confirm`,{expected_version:south.version,confirm:true,reason:'Old invitation'},trade)).value.error,'invitation_stale')
  r=await act(south,`/schedules/${st}/invite`,{email:'trade@example.com',subcontract_id:scopeId});assert.equal(r.status,200);south=r.value.job;invitation=r.value.record
  r=await api(`/resources/${lift.id}`,{...lift,expected_version:lift.version,reason:'Unexpected maintenance',leave:[...lift.leave,win('13','14','Safety hold')]});assert.equal(r.status,200);lift=r.value.resource
  assert.equal((await api(`/trade-confirmations/${invitation.id}/confirm`,{expected_version:south.version,confirm:true,reason:'I can attend'},trade)).value.error,'resource_conflict','Live availability is rechecked at confirmation')
  r=await api(`/resources/${lift.id}`,{...lift,expected_version:lift.version,reason:'Maintenance completed with staff clearance',leave:lift.leave.slice(0,1)});assert.equal(r.status,200);lift=r.value.resource;assert.equal(lift.history.length,3)
  assert.equal((await api(`/trade-confirmations/${invitation.id}/confirm`,{expected_version:south.version,reason:'Forgot checkbox'},trade)).status,400)
  assert.equal((await api(`/trade-confirmations/${invitation.id}/confirm`,{expected_version:south.version,confirm:true,reason:'I explicitly confirm the exact dates'},trade)).status,200);south=await reload(south)
  inbox=(await api('/trade-confirmations',undefined,trade)).value.invitations;assert.equal(inbox.at(-1).at_risk,false);assert.equal(inbox.at(-1).responses[0].by.name,'Riley Trade')
  assert.equal((await act(south,`/schedules/${st}/move`,{start:t('12'),end:t('13')})).status,409)
  const calendar={weekdays:[1,2,3,4,5],start_hour:0,end_hour:24,holidays:[]},task={id:'capacity-planner',trade:'Drywall',description:'Planner resource',start:t('08'),duration_minutes:60,resources:[{resource_id:lift.id,units:2}]}
  r=await act(east,'/schedule/preview',{calendar,tasks:[task]});assert.equal(r.status,200)
  assert.equal((await act(east,'/schedule/publish',{calendar,tasks:[task],digest:r.value.preview.digest})).value.error,'resource_conflict','Planner publication shares the capacity gate')
  r=await api('/schedule-templates',{name:'Resource allocation template',calendar,tasks:[{...task,start:t('18'),resources:[{resource_id:lift.id,units:2}]}]});assert.equal(r.status,201);const template=r.value.template
  assert.deepEqual(template.tasks[0].resources,[{resource_id:lift.id,units:2}])
  const plan={template_id:template.id,start:t('08')}
  r=await act(east,'/schedule-template/preview',plan);assert.equal(r.status,200);assert.ok(r.value.preview.conflicts.some(c=>c.reason==='capacity'))
  assert.equal((await act(east,'/schedule-template/apply',{...plan,digest:r.value.preview.digest})).value.error,'resource_conflict')
  plan.start=t('18');r=await act(east,'/schedule-template/preview',plan);assert.equal(r.status,200);assert.deepEqual(r.value.preview.conflicts,[])
  r=await act(east,'/schedule-template/apply',{...plan,digest:r.value.preview.digest});assert.equal(r.status,200);east=r.value.job;assert.deepEqual(east.schedules[0].resources,[{resource_id:lift.id,units:2}])
  let draftJob=await createActiveJob(f,'Draft resource check')
  r=await act(draftJob,'/schedules',booking('Agent draft','17','18',[{resource_id:crew.id,units:2}]),undefined,agent);assert.equal(r.status,200);draftJob=r.value.job
  assert.equal((await act(draftJob,`/schedules/${r.value.record.id}/approve`)).value.error,'resource_conflict','Agent drafts cannot bypass the human capacity check')
  const currentVendor=(await api(`/vendors/${scopeSetup.vendor.id}`)).value.vendor
  assert.equal((await api(`/vendors/${currentVendor.id}`,{expected_version:currentVendor.version,contacts:[]})).status,200)
  assert.deepEqual((await api('/trade-confirmations',undefined,trade)).value.invitations,[],'Removing the awarded company contact revokes inbox access on the next request')
  const fourth=await createActiveJob(f,'Atomic A'),fifth=await createActiveJob(f,'Atomic B')
  const race=await Promise.all([act(fourth,'/schedules',booking('Trade A','17','18',[{resource_id:crew.id,units:1}])),act(fifth,'/schedules',booking('Trade B','17','18',[{resource_id:crew.id,units:1}]))]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409])
 }finally{await f.close()}
})
