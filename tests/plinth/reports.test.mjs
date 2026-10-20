import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from './helpers.mjs'

test('RPT-004 — typed fields, required construction gates, personal/shared delayed-job views and precisely scoped currency-safe exports', async () => {
 const f=await createFixture()
 try {
  const client=await f.invite('client@example.com','Client'),admin=await f.invite('reports@example.com','Office reports','admin'),pm=await f.invite('pm@example.com','Project manager','admin'),token=await f.agent()
  const api=(path,options={})=>f.json('/api/plinth'+path,{cookie:f.owner,...options})
  let config=0
  const field=async(record_scope,name,type,required_at_stages=[])=>{const r=await api('/reports/fields',{method:'POST',body:{expected_version:config,record_scope,name,type,required_at_stages}});assert.equal(r.status,201,JSON.stringify(r.value));config=r.value.version;return r.value.fields.find(f=>f.name===name).id}
  const permit=await field('job','Permit jurisdiction','text',['active','construction']),risk=await field('job','Risk score','number'),permitDate=await field('job','Permit issued','date'),ready=await field('job','Mobilized','boolean'),margin=await field('job','Internal margin','money'),customerField=await field('customer','Referral source','text'),vendorField=await field('vendor','Region','text'),billField=await field('financial','Reviewed source','boolean',['issued'])
  let r=await api('/jobs',{method:'POST',body:{name:'Maple Street delayed remodel',client_email:'client@example.com'}});let job=r.value.job
  const act=async(path,body={})=>{const r=await api(`/jobs/${job.id}${path}`,{method:'POST',body:{expected_version:job.version,...body}});if(r.status===200)job=r.value.job;return r}
  r=await act('/quotes',{lines:[{description:'Kitchen remodel',quantity:1,unit_cents:4_800_000}]});assert.equal(r.status,200)
  const quote=job.quotes[0],version=job.version
  r=await act(`/quotes/${quote.id}/accept`,{method:'signed',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'},evidence:'Signed proposal MS-104'});assert.equal(r.value.error,'required_fields');assert.equal((await api(`/jobs/${job.id}`)).value.job.version,version)
  for(const options of [{cookie:client},{cookie:undefined,token}]){const denied=await api(`/jobs/${job.id}/quotes/${quote.id}/accept`,{...options,method:'POST',body:{expected_version:job.version,method:'signed',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'},evidence:'Unauthorized attempt'}});assert.equal(denied.status,403);assert.ok(!JSON.stringify(denied.value).includes('Permit jurisdiction'))}
  assert.equal((await api(`/reports/values/job/${job.id}`,{method:'PUT',body:{expected_version:0,stage:'construction',values:{}}})).status,409)
  assert.equal((await api(`/reports/values/job/${job.id}`,{method:'PUT',body:{expected_version:0,values:{[permitDate]:'2026-02-30'}}})).status,400)
  assert.equal((await api(`/reports/values/job/${job.id}`,{method:'PUT',body:{expected_version:0,values:{unknown:'unsafe'}}})).status,400)
  r=await api(`/reports/values/job/${job.id}`,{method:'PUT',body:{expected_version:0,stage:'construction',values:{[permit]:'Burlington, Vermont',[risk]:2.5,[permitDate]:'2026-10-15',[ready]:false,[margin]:{amount_cents:500_000,currency:'USD'}}}});assert.equal(r.status,200);assert.equal(r.value.record.values[ready],false);assert.equal(r.value.record.values[risk],2.5)
  assert.equal((await api(`/reports/values/job/${job.id}`,{method:'PUT',body:{expected_version:0,values:{[permit]:'stale'}}})).status,409)
  assert.equal((await act(`/quotes/${quote.id}/accept`,{method:'signed',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'},evidence:'Signed proposal MS-104'})).status,200)
  const accepted=structuredClone(job.quotes[0])
  assert.equal((await act('/schedules',{trade:'Maple framing crew',description:'Kitchen framing',start:'2026-11-02T08:00:00Z',end:'2026-11-02T17:00:00Z'})).status,200)
  assert.equal((await act('/schedule-baseline',{name:'Contract promise',reason:'Reviewed original framing commitment'})).status,200)
  const task=job.schedules[0]
  assert.equal((await act(`/schedules/${task.id}/move`,{start:'2026-11-04T08:00:00Z',end:'2026-11-04T17:00:00Z',reason:'Supplier delay, client notified'})).status,200)
  const baseline=structuredClone(job.schedule_baselines[0])
  r=await api('/jobs',{method:'POST',body:{name:'Cedar Street on-time porch',client_email:'client@example.com'}});assert.equal(r.status,201);const other=r.value.job
  const viewBody={expected_version:0,name:'Shared delayed jobs',sharing:'shared',scope:{record_scope:'job',record_ids:null},filters:[{column_id:'native.delayed',operator:'eq',value:true}],selected_columns:['native.stage','native.delayed','native.contract',permit,risk,margin]}
  r=await api('/reports/views',{method:'POST',cookie:admin,body:viewBody});assert.equal(r.status,201,JSON.stringify(r.value));const view=r.value.view
  r=await api(`/reports/views/${view.id}`);assert.equal(r.status,200,JSON.stringify(r.value));const report=r.value.report
  assert.deepEqual(report.rows.map(r=>r.id),[job.id]);assert.equal(report.annotation.scope_count,2);assert.equal(report.annotation.count,1);assert.deepEqual(report.annotation.filters,viewBody.filters);assert.equal(report.rows[0].values[permit],'Burlington, Vermont');assert.deepEqual(report.money_totals.find(t=>t.column_id===margin),{column_id:margin,currency:'USD',amount_cents:500_000,count:1})
  const exported=await f.request(`/api/plinth/reports/views/${view.id}/export.csv`,{cookie:f.owner});assert.equal(exported.status,200);const csv=await exported.text();assert.ok(csv.includes('filters')&&csv.includes('native.delayed')&&csv.includes('scope_record_ids')&&csv.includes('record_scope')&&csv.includes('count'));assert.ok(csv.includes(job.name));assert.ok(!csv.includes(other.name));assert.ok(csv.includes(JSON.stringify(viewBody.filters).replaceAll('"','""')));assert.ok(csv.includes(JSON.stringify(report.annotation.scope_record_ids).replaceAll('"','""')))
  // Every schema, value, query, view and export door rejects clients and bearer agents.
  for(const options of [{cookie:client},{cookie:undefined,token}]){
   for(const path of ['/reports/schema','/reports/records?record_scope=job','/reports/views',`/reports/views/${view.id}`,`/reports/views/${view.id}/export.csv`,`/reports/values/job/${job.id}`])assert.equal((await api(path,options)).status,403,path)
   assert.equal((await api('/reports/query',{...options,method:'POST',body:{...viewBody,selected_columns:[margin]}})).status,403)
  }
  const people=(await api('/team')).value.team,person=people.find(p=>p.email==='pm@example.com')
  assert.equal((await api(`/team/${person.id}`,{method:'PUT',body:{expected_version:0,role:'project_manager',job_ids:[job.id],po_limit_cents:500_000}})).status,200)
  r=await api(`/reports/views/${view.id}`,{cookie:pm});assert.equal(r.status,200);assert.equal(r.value.report.annotation.scope_count,1);assert.deepEqual(r.value.report.annotation.scope_record_ids,[job.id])
  assert.equal((await api('/reports/records?record_scope=financial',{cookie:pm})).status,403)
  assert.equal((await api('/reports/fields',{method:'POST',cookie:pm,body:{}})).status,403)
  assert.ok((await api('/reports/schema',{cookie:pm})).value.fields.every(f=>f.record_scope==='job'))
  let pmValues=(await api(`/reports/values/job/${job.id}`,{cookie:pm})).value.record
  pmValues=await api(`/reports/values/job/${job.id}`,{method:'PUT',cookie:pm,body:{expected_version:pmValues.version,stage:'construction',values:{[risk]:3.75}}});assert.equal(pmValues.status,200);assert.equal(pmValues.value.record.values[risk],3.75)
  assert.equal((await api(`/reports/values/job/${other.id}`,{cookie:pm})).status,404)
  assert.equal((await api('/reports/views',{method:'POST',cookie:pm,body:viewBody})).status,403)
  r=await api('/reports/views',{method:'POST',cookie:pm,body:{...viewBody,name:'My framing delays',sharing:'personal'}});assert.equal(r.status,201);const personal=r.value.view
  assert.equal((await api(`/reports/views/${personal.id}`,{cookie:admin})).status,404)
  assert.equal((await api('/reports/query',{method:'POST',cookie:pm,body:{...viewBody,scope:{record_scope:'job',record_ids:[other.id]}}})).status,400)
  // Other record kinds use the same typed definitions and report boundary.
  r=await api('/customers',{method:'POST',body:{name:'Chen household',kind:'household',contacts:[],properties:[],owner_contact_ids:[],billing_contact_ids:[]}});assert.equal(r.status,201);const customer=r.value.customer
  assert.equal((await api(`/reports/values/customer/${customer.id}`,{method:'PUT',body:{expected_version:0,stage:'qualified',values:{[customerField]:'Client referral'}}})).status,200)
  r=await api('/vendors',{method:'POST',body:{kind:'vendor',name:'Maple Supply',trades:[],service_areas:[],contacts:[]}});assert.equal(r.status,201);const vendor=r.value.vendor
  assert.equal((await api(`/reports/values/vendor/${vendor.id}`,{method:'PUT',body:{expected_version:0,values:{[vendorField]:'=Northeast'}}})).status,200)
  r=await act('/orders',{supplier:'Maple Supply',description:'Framing lumber',amount_cents:100_000});assert.equal(r.status,200);const order=r.value.record
  assert.equal((await act(`/orders/${order.id}/issue`)).value.error,'required_fields')
  const financialId=`${job.id}:order:${order.id}`
  assert.equal((await api(`/reports/values/financial/${financialId}`,{method:'PUT',body:{expected_version:0,stage:'issued',values:{[billField]:true}}})).status,200)
  assert.equal((await act(`/orders/${order.id}/issue`)).status,200)
  for(const [scope,id,column] of [['customer',customer.id,customerField],['vendor',vendor.id,vendorField],['financial',financialId,billField]]){
   r=await api('/reports/views',{method:'POST',body:{expected_version:0,name:`Selected ${scope}`,sharing:'personal',scope:{record_scope:scope,record_ids:[id]},filters:[],selected_columns:[column]}});assert.equal(r.status,201)
   const text=await (await f.request(`/api/plinth/reports/views/${r.value.view.id}/export.csv`,{cookie:f.owner})).text();assert.ok(text.includes(id));if(scope==='vendor')assert.ok(text.includes("'=Northeast"),'CSV formula cells are inert')
  }
  const historicalCsv='external_id,title,client_email,site_address,quote_cents,accepted_on,currency\naud-legacy,Historic Australian porch,legacy@example.com,Historic site,100000,2025-10-01,AUD\n'
  let imported=await api('/imports/preview',{method:'POST',body:{csv:historicalCsv}});assert.equal(imported.status,200)
  imported=await api('/imports/commit',{method:'POST',body:{csv:historicalCsv,fingerprint:imported.value.fingerprint}});assert.equal(imported.status,200)
  const historical=(await api('/jobs')).value.jobs.find(j=>j.currency==='AUD');assert.ok(historical)
  assert.equal((await api(`/reports/values/job/${historical.id}`,{method:'PUT',body:{expected_version:0,values:{[margin]:{amount_cents:90_000,currency:'USD'}}}})).status,400)
  assert.equal((await api(`/reports/values/job/${historical.id}`,{method:'PUT',body:{expected_version:0,values:{[margin]:{amount_cents:90_000,currency:'AUD'}}}})).status,200)
  const currencies=await api('/reports/query',{method:'POST',body:{...viewBody,name:'Margins by currency',filters:[],selected_columns:[margin]}});assert.equal(currencies.status,200)
  assert.deepEqual(currencies.value.report.money_totals.map(t=>[t.currency,t.amount_cents]).sort(),[['AUD',90_000],['USD',500_000]])
  assert.deepEqual(job.quotes[0],accepted);assert.deepEqual(job.schedule_baselines[0],baseline,'Custom records and queries do not rewrite past approvals')
  // Required rules also apply when changed after a job was sold, at real construction publication.
  const inspection=await field('job','Inspection permit','text',['construction'])
  assert.equal((await act('/schedules',{trade:'Drywall crew',description:'Drywall start',start:'2026-11-10T08:00:00Z',end:'2026-11-10T17:00:00Z'})).value.error,'required_fields')
  r=await api(`/reports/values/job/${job.id}`);assert.equal((await api(`/reports/values/job/${job.id}`,{method:'PUT',body:{expected_version:r.value.record.version,stage:'construction',values:{[inspection]:'Permit inspection passed, record BVT-2026-104'}}})).status,200)
  assert.equal((await act('/schedules',{trade:'Drywall crew',description:'Drywall start',start:'2026-11-10T08:00:00Z',end:'2026-11-10T17:00:00Z'})).status,200)
  assert.equal((await api(`/jobs/${job.id}`,{method:'DELETE',body:{expected_version:job.version}})).status,200)
  assert.equal((await api(`/reports/values/job/${job.id}`)).status,404)
  assert.equal((await api(`/reports/values/financial/${financialId}`)).status,404)
  assert.equal((await api(`/reports/views/${view.id}`)).value.report.annotation.count,0,'Erased job values never reappear in a saved view')
 } finally {await f.close()}
})
