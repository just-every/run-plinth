import test from 'node:test'
import assert from 'node:assert/strict'
import {createActiveJob,createFixture} from './helpers.mjs'
import {costFixture,original,costOriginal} from './cost-support.mjs'

test('COST-003 — approved time, burden CSV, equipment and employee originals reconcile once; reimbursement and cross-job assignment correction preserve total actual cost',async()=>{
 const f=await createFixture();try{
  const c=await costFixture(f),date={dated_on:'2026-10-23',period:'2026-10',cost_code:'01-100'}
  let r=await c.ok('/costs/sources',{...date,kind:'time',reference:'synthetic-plinth-time-1',employee_reference:'synthetic-plinth-employee-1',minutes:480,hour_cents:3000,burden_bps:2000});const time=r.record
  assert.equal(time.amount_cents,28800);assert.equal((await c.ledger()).totals.posted_actual_cents,0)
  await c.ok(`/costs/sources/${time.id}/approve`);assert.equal((await c.act(`/costs/sources/${time.id}/approve`)).status,409)
  r=await c.ok('/costs/sources',{...date,kind:'expense',reference:'synthetic-plinth-expense-1',employee_reference:'synthetic-plinth-employee-1',amount_cents:1250,document:original});const expense=r.record
  await c.ok(`/costs/sources/${expense.id}/approve`)
  r=await c.ok('/costs/sources',{...date,cost_code:'06-100',kind:'equipment',reference:'synthetic-plinth-equipment-1',equipment_reference:'synthetic-plinth-lift-1',minutes:90,hour_cents:4000});const equipment=r.record
  assert.equal(equipment.amount_cents,6000);await c.ok(`/costs/sources/${equipment.id}/approve`)
  const csv=`external_id,time_source_id,gross_cents,burden_cents\nsynthetic-plinth-payroll-1,${time.id},25000,5500\n`,payroll={csv,reference:'synthetic-plinth-payroll-register-1',dated_on:'2026-10-24',period:'2026-10'}
  r=await c.ok('/costs/payroll',payroll);const payrollId=r.record.id;assert.equal(r.record.source_totals_cents,30500)
  let ledger=await c.ledger();assert.equal(ledger.totals.posted_actual_cents,37750,'Time provisional is replaced by gross plus burden, not added again')
  assert.equal((await c.act('/costs/payroll',payroll)).status,409)
  const payrollFile=await f.request(`/api/plinth/jobs/${c.job.id}/costs/payroll/${payrollId}/original`,{cookie:f.owner});assert.equal(payrollFile.status,200);assert.equal(await payrollFile.text(),csv,'Original CSV bytes including final newline survive')
  await c.ok(`/costs/sources/${expense.id}/reimburse`,{confirm:true,reference:'synthetic-plinth-reimbursement-check-1'});assert.equal((await c.ledger()).totals.posted_actual_cents,37750);assert.equal((await c.act(`/costs/sources/${expense.id}/reimburse`,{confirm:true,reference:'synthetic-plinth-repeat'})).status,409)
  const expenseFile=await f.request(`/api/plinth/jobs/${c.job.id}/costs/sources/${expense.id}/original`,{cookie:f.owner});assert.deepEqual(Buffer.from(await expenseFile.arrayBuffer()),costOriginal)
  const destination=await createActiveJob(f,'Corrected equipment job','synthetic-plinth-other@example.com');const equipmentEntry=ledger.rows.flatMap(r=>r.sources.actual).find(e=>e.source_id===equipment.id)
  const transfer={entry_id:equipmentEntry.id,target_job_id:destination.id,target_expected_version:destination.version,target_cost_code:'Unassigned',amount_cents:6000,dated_on:'2026-10-25',period:'2026-10',reference:'synthetic-plinth-transfer-1',reason:'Lift used on the other job; explicit reviewed assignment correction'}
  assert.equal((await c.act('/costs/transfers',{...transfer,target_expected_version:1})).status,409,'Stale destination cannot partly remove source actual')
  assert.equal((await c.ledger()).totals.posted_actual_cents,37750)
  r=await c.ok('/costs/transfers',transfer);assert.equal(r.amount_cents,6000)
  const from=await c.ledger(),to=(await c.api(`/jobs/${destination.id}/costs`)).value
  assert.equal(from.totals.posted_actual_cents,31750);assert.equal(to.totals.posted_actual_cents,6000);assert.equal(from.totals.posted_actual_cents+to.totals.posted_actual_cents,37750)
  assert.equal((await c.act('/costs/transfers',{...transfer,target_expected_version:r.target_version,reference:'synthetic-plinth-over-transfer'})).status,409)
  r=await c.ok('/warranties',{kind:'component',name:'Synthetic framing callback',starts_on:'2026-01-01',ends_on:'2028-12-31',terms:'Synthetic recorded component warranty',signed_terms_reference:'synthetic-plinth-warranty-source'});const component=r.record
  r=await c.ok('/warranties',{kind:'case',component_id:component.id,defect_key:'framing',description:'Callback framing repair',reported_on:'2026-10-23',reviewer_email:'builder@example.com'});const callback=r.record
  r=await c.ok(`/warranties/${callback.id}/cost`,{amount_cents:500,cost_code:'01-100',description:'Employee callback receipt',reference:'synthetic-plinth-callback-1'});const callbackCost=r.record
  r=await c.ok('/costs/sources',{...date,kind:'expense',reference:'synthetic-plinth-callback-expense',employee_reference:'synthetic-plinth-employee-1',amount_cents:500,document:original,warranty_cost_id:callbackCost.id});await c.ok(`/costs/sources/${r.record.id}/approve`)
  assert.equal((await c.ledger()).totals.posted_actual_cents,32250,'A linked warranty expense retains its existing callback actual once')
  const timeSources=(await c.api(`/jobs/${c.job.id}/costs/sources`)).value.sources
  assert.equal(timeSources.find(s=>s.id===time.id).payroll_replaced_cents,28800);assert.equal(timeSources.find(s=>s.id===expense.id).reimbursed.reference,'synthetic-plinth-reimbursement-check-1')
 }finally{await f.close()}
})

test('FIELD-002 — corrected crew time split by job and code posts exact approved labor and burden once, with private pay and payroll exports',async()=>{
 const f=await createFixture();try{
  const first=await costFixture(f),second=await costFixture(f)
  const worker=await f.invite('synthetic-plinth-worker-1@example.com','Synthetic carpenter','admin'),other=await f.invite('synthetic-plinth-worker-2@example.com','Synthetic second worker','admin'),admin=await f.invite('synthetic-plinth-supervisor@example.com','Synthetic supervisor','admin')
  const team=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team,person=team.find(p=>p.email==='synthetic-plinth-worker-1@example.com'),otherPerson=team.find(p=>p.email==='synthetic-plinth-worker-2@example.com')
  for(const p of [person,otherPerson]){const r=await f.json('/api/plinth/team/'+p.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'crew',job_ids:[first.job.id,second.job.id],po_limit_cents:0}});assert.equal(r.status,200,JSON.stringify(r.value))}
  const api=async(c,path='',body,cookie=f.owner)=>{const current=(await f.json(`/api/plinth/jobs/${c.job.id}`,{cookie:f.owner})).value.job;return f.json(`/api/plinth/jobs/${c.job.id}/time`+path,{cookie,...(body===undefined?{}:{method:'POST',body:{expected_version:current.version,...body}})})}
  const rate={employee_id:person.id,hour_cents:3000,burden_bps:2000,overtime_bps:15000,human_reviewed:true,reference:'synthetic-plinth-reviewed-rate-1'}
  for(const c of [first,second])assert.equal((await api(c,'/rates',rate)).status,200)
  const entry={dated_on:'2026-10-23',cost_code:'01-100',activity:'Frame the kitchen',minutes:300,break_minutes:30,classification:'regular',reason:'Worker recorded the morning'}
  let r=await api(first,'',entry,worker);assert.equal(r.status,200,JSON.stringify(r.value));const morning=r.value.record.id
  r=await api(first,`/${morning}/correct`,{...entry,minutes:270,reason:'Corrected end time after reviewing the day'},worker);assert.equal(r.status,200);assert.equal(r.value.record.revisions.length,2)
  r=await api(second,'',{...entry,cost_code:'06-100',minutes:120,break_minutes:0,classification:'overtime',reason:'Reviewed overtime allocation at the second job'},worker);assert.equal(r.status,200);const afternoon=r.value.record.id
  assert.equal((await first.ledger()).totals.posted_actual_cents,0)
  assert.equal((await api(first,`/${morning}/approve`,{},worker)).status,403)
  assert.equal((await api(first,'/rates',rate,other)).status,403)
  assert.equal((await api(first,'/payroll.csv',undefined,other)).status,403)
  assert.deepEqual((await api(first,'',undefined,other)).value.entries,[])
  assert.equal((await api(first,`/${morning}/correct`,entry,other)).status,404)
  for(const [c,id,base,burden] of [[first,morning,12000,2400],[second,afternoon,9000,1800]]){
   r=await api(c,`/${id}/approve`,{},admin);assert.equal(r.status,200,JSON.stringify(r.value));assert.equal(r.value.record.approval.base_cents,base);assert.equal(r.value.record.approval.burden_cents,burden)
   assert.equal((await c.ledger()).totals.posted_actual_cents,base+burden)
   assert.equal((await api(c,`/${id}/approve`,{},admin)).status,409)
   assert.equal((await api(c,`/${id}/correct`,entry,worker)).status,409)
   const csv=await f.request(`/api/plinth/jobs/${c.job.id}/time/payroll.csv`,{cookie:f.owner});assert.equal(csv.status,200);const bytes=await csv.text();assert.ok(bytes.includes(`"${base}","${burden}"`));assert.ok(bytes.includes(id));assert.ok(bytes.includes(c.job.id))
   const own=(await api(c,'',undefined,worker)).value;assert.equal(own.entries.length,1);assert.ok(own.entries[0].approval.by);assert.ok(!JSON.stringify(own).includes('hour_cents'));assert.ok(!JSON.stringify(own).includes('burden_cents'));for(const key of ['rates','hour_cents','burden_bps','overtime_bps','amount_cents','base_cents','gross_cents','burden_cents','rate_reference'])assert.ok(!JSON.stringify(own).includes(JSON.stringify(key)),'Worker read excludes '+key)
   const generic=await f.json('/api/plinth/jobs/'+c.job.id,{cookie:f.owner});assert.ok(!('field_time' in generic.value.job))
  }
  r=await api(first,'',{...entry,employee_id:person.id});assert.equal(r.status,200);const prepared=r.value.record.id
  const beforeRefusal=(await api(first)).value.version
  r=await api(first,`/${prepared}/approve`,{});assert.equal(r.status,403);assert.equal(r.value.error,'time_separation','An office preparer cannot approve their own preparation')
  assert.equal((await api(first)).value.version,beforeRefusal)
  r=await api(first,`/${prepared}/correct`,{...entry,minutes:260,reason:'Supervisor corrected the elapsed minutes'},admin);assert.equal(r.status,200)
  const correctedVersion=r.value.version
  r=await api(first,`/${prepared}/approve`,{},admin);assert.equal(r.status,403);assert.equal(r.value.error,'time_separation','An office corrector cannot approve the corrected entry')
  assert.equal((await api(first)).value.version,correctedVersion);assert.equal((await first.ledger()).totals.posted_actual_cents,14400,'Refused approvals post no cost')
  const audit=(await f.json('/api/plinth/audit?action=time.export',{cookie:f.owner})).value.events;assert.equal(audit.length,2,'Payroll downloads are audited without pay values')
  const held=(await api(first)).value.version
  assert.equal((await api(first,'',{...entry,expected_version:held-1},worker)).status,409)
  assert.equal((await api(first)).value.version,held)
  let role=await f.json('/api/plinth/roles',{method:'POST',cookie:f.owner,body:{copy_of:'crew',name:'Synthetic time role',permissions:{time:{view:true,create:true,edit:true}}}});assert.equal(role.status,201);const roleId=role.value.role.id
  let grantNow=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team.find(p=>p.id===person.id)
  assert.equal((await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:grantNow.version,role:'custom',role_id:roleId,job_ids:[first.job.id,second.job.id]}})).status,200)
  assert.equal((await api(first,'',undefined,worker)).status,200)
  let currentRole=role.value.role
  role=await f.json('/api/plinth/roles/'+roleId,{method:'PUT',cookie:f.owner,body:{expected_version:currentRole.version,permissions:{time:{view:false}}}});assert.equal(role.status,200)
  assert.equal((await api(first,'',undefined,worker)).status,403,'Time visibility revocation applies on the next request')
  const agent=await f.agent();assert.equal((await f.request(`/api/plinth/jobs/${first.job.id}/time`,{token:agent})).status,403)
  const grant=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team.find(p=>p.id===person.id)
  assert.equal((await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:grant.version,role:'crew',job_ids:[second.job.id],po_limit_cents:0}})).status,200)
  assert.equal((await api(first,'',undefined,worker)).status,404,'Assignment revocation applies to the next time read')
 }finally{await f.close()}
})

test('FIELD-002 — explicit worker consent gates geofence reminders; arrival and departure never create time or retain worker coordinates',async()=>{
 const f=await createFixture();try{
  const c=await costFixture(f),worker=await f.invite('synthetic-plinth-location-1@example.com','Synthetic field worker','admin'),other=await f.invite('synthetic-plinth-location-2@example.com','Synthetic nonconsenting worker','admin')
  const team=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team
  for(const p of team.filter(p=>p.email.startsWith('synthetic-plinth-location-'))){assert.equal((await f.json('/api/plinth/team/'+p.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'crew',job_ids:[c.job.id],po_limit_cents:0}})).status,200)}
  const api=async(path,body,cookie=worker)=>{const current=(await f.json('/api/plinth/jobs/'+c.job.id,{cookie:f.owner})).value.job;return f.json(`/api/plinth/jobs/${c.job.id}/time`+path,{cookie,...(body===undefined?{}:{method:'POST',body:{expected_version:current.version,...body}})})}
  assert.equal((await api('/site',{latitude:44,longitude:-73,radius_meters:100,label:'Synthetic job site'},f.owner)).status,200)
  const before=(await api('')).value.version
  assert.equal((await api('/location',{latitude:44.0001,longitude:-73.0001},other)).status,403)
  assert.equal((await api('')).value.version,before,'A refused nonconsenting event writes nothing')
  assert.equal((await api('/consent',{consent:true})).status,200)
  let r=await api('/location',{latitude:44.0001,longitude:-73.0001});assert.equal(r.status,200);assert.equal(r.value.record.reminder.kind,'clock_in')
  r=await api('/location',{latitude:44.0001,longitude:-73.0001});assert.equal(r.value.record.reminder,null,'No repeated arrival while still inside')
  r=await api('/location',{latitude:44.1,longitude:-73.1});assert.equal(r.value.record.reminder.kind,'clock_out')
  const own=(await api('')).value;assert.deepEqual(own.entries,[]);assert.ok(!JSON.stringify(own).includes('44.0001'));assert.ok(!JSON.stringify(own).includes('latitude'))
  // Private archive custody contains only the site coordinates, consent and last reminder, never worker positions.
  const stored=await f.db.prepare('SELECT data FROM pl_jobs WHERE id=?').bind(c.job.id).first();assert.ok(!stored.data.includes('44.0001'));assert.ok(!stored.data.includes('44.1'));assert.equal(JSON.parse(stored.data).cost_records.sources.length,0)
  assert.equal((await api('/consent',{consent:false})).status,200)
  r=await api('');assert.equal(r.value.location_choice.consent,false);assert.ok(!r.value.location_choice.reminder)
  const revokedVersion=r.value.version
  const refused=await f.request(`/api/plinth/jobs/${c.job.id}/time/location`,{method:'POST',cookie:worker,body:{latitude:44.987654,longitude:-73.987654},headers:{'content-type':['text','plain'].join('/')}})
  assert.equal(refused.status,403,'Revoked consent refuses location before body parsing or coordinate validation')
  assert.equal((await api('')).value.version,revokedVersion)
  const revoked=JSON.parse((await f.db.prepare('SELECT data FROM pl_jobs WHERE id=?').bind(c.job.id).first()).data).field_time.location_choices[0]
  assert.equal(revoked.consent,false);assert.ok(!('inside' in revoked));assert.ok(!('reminder' in revoked))
  const consentEvents=(await f.json('/api/plinth/audit?action=time.location_consent',{cookie:f.owner})).value.events
  assert.deepEqual(consentEvents.map(e=>e.detail.consent),[false,true],'The same committed audit records distinguish explicit opt-in and revocation')
  assert.ok(consentEvents.every(e=>!JSON.stringify(e).includes('latitude')))
 }finally{await f.close()}
})
