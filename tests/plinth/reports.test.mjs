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

test('RPT-001 — historical and sliced portfolio reconciles three jobs to code sources, scopes managers before totals and exports inert CSV and genuine XLSX', async()=>{
 const {portfolioFixture}=await import('./portfolio-support.mjs'),{execFileSync}=await import('node:child_process')
 const f=await createFixture();try{
  const {fixtures,earlier,capture}=await portfolioFixture(f)
  const api=(path,options={})=>f.json('/api/plinth'+path,{cookie:f.owner,...options})
  const columns=['native.contract','portfolio.original_budget','portfolio.revised_budget','portfolio.committed','portfolio.actual','portfolio.forecast','portfolio.margin','portfolio.billed','portfolio.collected','portfolio.backlog','portfolio.slippage','portfolio.open_decisions','portfolio.as_of','portfolio.forecast_stale']
  const spec={expected_version:0,name:'Current portfolio',sharing:'shared',scope:{record_scope:'job',record_ids:null},filters:[],selected_columns:columns}
  let r=await api('/reports/views',{method:'POST',body:spec});assert.equal(r.status,201,JSON.stringify(r.value));const id=r.value.view.id
  const owner=(await api('/reports/views/'+id)).value.report
  assert.equal(owner.rows.length,3)
  for(const [i,c] of fixtures.entries()){
   const values=owner.rows.find(row=>row.id===c.job.id).values
   assert.equal(values['portfolio.actual'].amount_cents,2200*(i+1));assert.equal(values['portfolio.forecast'].amount_cents,103200+2200*i)
   assert.equal(values['portfolio.original_budget'].amount_cents,150000);assert.equal(values['portfolio.revised_budget'].amount_cents,150000)
   assert.equal(values['portfolio.committed'].amount_cents,100000);assert.equal(values['portfolio.margin'].amount_cents,300000-values['portfolio.forecast'].amount_cents)
   assert.equal(values['portfolio.backlog'].amount_cents,300000-30000*(i+1));assert.equal(values['portfolio.billed'].amount_cents,30000*(i+1));assert.equal(values['portfolio.collected'].amount_cents,15000*(i+1))
   assert.equal(values['portfolio.slippage'],1440);assert.equal(values['portfolio.open_decisions'],1);assert.equal(values['portfolio.forecast_stale'],false);assert.match(values['portfolio.as_of'],/^\d{4}-\d{2}-\d{2}$/)
   const source=(await api('/reports/job-sources/'+c.job.id)).value
   assert.equal(source.rows.reduce((n,row)=>n+row.posted_actual_cents,0),values['portfolio.actual'].amount_cents)
   assert.equal(source.rows.flatMap(row=>row.sources.actual).reduce((n,row)=>n+row.amount_cents,0),values['portfolio.actual'].amount_cents)
   assert.equal(source.forecast.codes.reduce((n,row)=>n+row.final_cents,0),values['portfolio.forecast'].amount_cents)
   assert.equal(source.source_version,c.job.version)
   assert.deepEqual(source.schedule.map(r=>r.forecast_finish_variance_minutes),[1440])
   assert.deepEqual(source.open_decisions,[{kind:'selection',id:c.job.selections[0].id,cost_code:'01-100',dated_on:c.job.selections[0].revisions[0].prepared_by.at.slice(0,10)}])
  }
  assert.equal(owner.money_totals.find(t=>t.column_id==='portfolio.actual').amount_cents,13200)
  const query=async portfolio=>{const r=await api('/reports/query',{method:'POST',body:{...spec,portfolio}});assert.equal(r.status,200,JSON.stringify(r.value));return r.value.report}
  const old=await query({snapshot_id:earlier.id})
  assert.deepEqual(old.rows.map(r=>[r.values['portfolio.billed'].amount_cents,r.values['portfolio.collected'].amount_cents,r.values['portfolio.slippage'],r.values['portfolio.open_decisions']]),[[0,0,null,0],[0,0,null,0],[0,0,null,0]])
  assert.equal(old.money_totals.find(t=>t.column_id==='portfolio.actual').amount_cents,13200)
  const labor=await query({cost_code:'01-100'})
  assert.equal(labor.money_totals.find(t=>t.column_id==='native.contract').amount_cents,300000)
  assert.equal(labor.money_totals.find(t=>t.column_id==='portfolio.original_budget').amount_cents,150000)
  assert.equal(labor.money_totals.find(t=>t.column_id==='portfolio.actual').amount_cents,13200)
  assert.equal(labor.money_totals.find(t=>t.column_id==='portfolio.billed').amount_cents,60000)
  assert.equal(labor.money_totals.find(t=>t.column_id==='portfolio.collected').amount_cents,30000)
  assert.equal(labor.money_totals.find(t=>t.column_id==='portfolio.forecast').amount_cents,16200)
  const trade=await query({trade:'framing'})
  assert.deepEqual(new Set(trade.rows.map(r=>r.id)),new Set(fixtures.slice(0,2).map(c=>c.job.id)))
  assert.equal(trade.money_totals.find(t=>t.column_id==='portfolio.actual').amount_cents,6600)
  const noTrade=await query({trade:'Roofing'});assert.deepEqual(noTrade.rows,[]);assert.deepEqual(noTrade.money_totals,[])
  const dated=await query({source_from:'2026-10-24',source_to:'2026-10-24'})
  assert.equal(dated.money_totals.find(t=>t.column_id==='portfolio.actual').amount_cents,13200)
  assert.equal(dated.money_totals.find(t=>t.column_id==='portfolio.collected').amount_cents,0)
  const collectionDate=await query({source_from:'2026-10-25',source_to:'2026-10-25'})
  assert.equal(collectionDate.money_totals.find(t=>t.column_id==='portfolio.collected').amount_cents,90000)
  assert.equal(collectionDate.money_totals.find(t=>t.column_id==='portfolio.actual').amount_cents,0)
  assert.equal((await api('/reports/query',{method:'POST',body:{...spec,portfolio:{source_from:'2026-10-25',source_to:'2026-10-24'}}})).status,400)
  for(const c of fixtures){
   const source=(await api('/reports/job-sources/'+c.job.id+'?portfolio='+encodeURIComponent(JSON.stringify({cost_code:'01-100'})))).value
   assert.deepEqual(source.rows.map(r=>r.cost_code),['01-100'])
   assert.equal(source.rows[0].posted_actual_cents,labor.rows.find(r=>r.id===c.job.id).values['portfolio.actual'].amount_cents)
   assert.equal(source.rows[0].sources.billing.filter(r=>r.kind==='collected').reduce((n,r)=>n+r.amount_cents,0),labor.rows.find(r=>r.id===c.job.id).values['portfolio.collected'].amount_cents)
  }

  const manager=await f.invite('synthetic-plinth-manager@example.com','Assigned manager','admin')
  const person=(await api('/team')).value.team.find(p=>p.email==='synthetic-plinth-manager@example.com')
  const assign=async job_ids=>api('/team/'+person.id,{method:'PUT',body:{expected_version:(await api('/team')).value.team.find(p=>p.id===person.id).version??0,role:'project_manager',job_ids,po_limit_cents:0}})
  assert.equal((await assign([fixtures[0].job.id])).status,200)
  const historical=await capture('Assigned manager and earned billing')
  const managed=await query({snapshot_id:historical.id,manager_id:person.id})
  assert.deepEqual(managed.rows.map(r=>r.id),[fixtures[0].job.id])
  assert.equal(managed.money_totals.find(t=>t.column_id==='portfolio.billed').amount_cents,30000)
  const historicalSpec={...spec,name:'Historical labor slice',portfolio:{snapshot_id:historical.id,cost_code:'01-100',manager_id:person.id}}
  const historicView=await api('/reports/views',{method:'POST',body:historicalSpec});assert.equal(historicView.status,201,JSON.stringify(historicView.value))
  const frozen=await query({snapshot_id:historical.id})
  await fixtures[0].ok('/variations',{description:'Decision recorded after capture',amount_cents:50})
  assert.deepEqual(await query({snapshot_id:historical.id}),frozen,'Later source changes cannot rewrite a capture')
  const oldSource=(await api('/reports/job-sources/'+fixtures[0].job.id+'?portfolio='+encodeURIComponent(JSON.stringify({snapshot_id:earlier.id})))).value
  assert.equal(oldSource.source_version<fixtures[0].job.version,true)
  assert.equal(oldSource.rows.reduce((n,r)=>n+r.client_billed_cents,0),0)
  assert.equal((await api('/reports/snapshots',{cookie:manager,method:'POST',body:{name:'Forbidden capture'}})).status,403)
  for(const format of ['csv','xlsx','pdf']){
   const exported=await f.request('/api/plinth/reports/views/'+historicView.value.view.id+'/export.'+format,{cookie:manager})
   assert.equal(exported.status,200)
   if(format==='csv'){const text=await exported.text();assert.ok(text.includes(historical.id));assert.ok(text.includes('01-100'));assert.ok(!text.includes(fixtures[1].job.id))}
  }

  r=await api('/reports/views/'+id,{cookie:manager});assert.equal(r.status,200)
  assert.deepEqual(r.value.report.annotation.scope_record_ids,[fixtures[0].job.id]);assert.equal(r.value.report.money_totals.find(t=>t.column_id==='portfolio.actual').amount_cents,2200)
  assert.equal((await api('/reports/job-sources/'+fixtures[1].job.id,{cookie:manager})).status,404)
  for(const cookie of [f.owner,manager]){
   const csv=await (await f.request(`/api/plinth/reports/views/${id}/export.csv`,{cookie})).text();assert.ok(csv.includes('portfolio.actual'));if(cookie===manager)assert.ok(!csv.includes(fixtures[1].job.id))
   const response=await f.request(`/api/plinth/reports/views/${id}/export.xlsx`,{cookie});assert.equal(response.status,200)
   const bytes=Buffer.from(await response.arrayBuffer())
   const extracted=execFileSync('python3',['-c','import io,sys,zipfile,xml.etree.ElementTree as ET; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; [ET.fromstring(z.read(n)) for n in z.namelist()]; print(z.read("xl/worksheets/sheet1.xml").decode())'],{input:bytes,encoding:'utf8'})
   assert.ok(extracted.includes('Posted actual cost'));assert.ok(extracted.includes(fixtures[0].job.id));assert.ok(!extracted.includes('<f>'));if(cookie===manager)assert.ok(!extracted.includes(fixtures[1].job.id))
  }
  assert.equal((await assign([])).status,200);assert.equal((await api('/reports/views/'+historicView.value.view.id,{cookie:manager})).status,404);assert.equal((await api('/reports/snapshots',{cookie:manager})).value.snapshots.length,0);assert.equal((await api('/reports/job-sources/'+fixtures[0].job.id+'?portfolio='+encodeURIComponent(JSON.stringify({snapshot_id:historical.id})),{cookie:manager})).status,404);assert.equal((await api('/reports/views/'+id,{cookie:manager})).value.report.rows.length,0)
  const client=await f.invite('synthetic-plinth-client@example.com'),agent=await f.agent()
  for(const options of [{cookie:client},{cookie:undefined,token:agent}])for(const path of ['/reports/views/'+id+'/export.xlsx','/reports/job-sources/'+fixtures[0].job.id])assert.equal((await api(path,options)).status,403)
  r=await api('/roles',{method:'POST',body:{copy_of:'administrator',name:'Report without finances',financial_visible:false}});assert.equal(r.status,201);const role=r.value.role
  assert.equal((await api('/team/'+person.id,{method:'PUT',body:{expected_version:2,role:'custom',role_id:role.id,job_ids:[]}})).status,200)
  assert.equal((await api('/reports/views/'+id,{cookie:manager})).status,404)
  const restrictedSource=await api('/reports/job-sources/'+fixtures[0].job.id,{cookie:manager});assert.equal(restrictedSource.status,200)
  assert.equal(restrictedSource.value.rows,undefined);assert.equal(restrictedSource.value.forecast,null);assert.equal(restrictedSource.value.open_decisions,undefined)
  assert.ok(!Object.values(restrictedSource.value.values).some(v=>typeof v==='object'&&v!==null))
  assert.deepEqual(restrictedSource.value.schedule.map(r=>r.forecast_finish_variance_minutes),[1440])
  assert.ok(!(await api('/reports/records?record_scope=job',{cookie:manager})).value.columns.some(c=>c.id==='portfolio.open_decisions'),'Hidden financial decision counts are unavailable before filtering')
  assert.equal((await api('/reports/query',{cookie:manager,method:'POST',body:{...spec,selected_columns:['native.stage'],filters:[{column_id:'portfolio.open_decisions',operator:'gt',value:0}]}})).status,400,'A hidden decision count cannot influence query membership')
  const historicalCsv='external_id,title,client_email,site_address,quote_cents,accepted_on,currency\naud-portfolio,Historic Australian porch,legacy@example.com,Historic site,100000,2025-10-01,AUD\n'
  let imported=await api('/imports/preview',{method:'POST',body:{csv:historicalCsv}});assert.equal(imported.status,200)
  imported=await api('/imports/commit',{method:'POST',body:{csv:historicalCsv,fingerprint:imported.value.fingerprint}});assert.equal(imported.status,200)
  const historicalJob=(await api('/jobs')).value.jobs.find(j=>j.currency==='AUD')
  const acceptedHistorical=await api('/jobs/'+historicalJob.id+'/quotes/'+historicalJob.quotes[0].id+'/accept',{method:'POST',body:{expected_version:historicalJob.version,method:'email',evidence:'Reviewed historical client acceptance',schedule_choice:{kind:'none',reason:'Historical schedule stays separate'}}})
  assert.equal(acceptedHistorical.status,200,JSON.stringify(acceptedHistorical.value))
  const separated=await query({})
  assert.deepEqual(separated.money_totals.filter(t=>t.column_id==='native.contract').map(t=>[t.currency,t.amount_cents]).sort(),[['AUD',100000],['USD',900000]])
  assert.equal((await api('/reports/query',{cookie:manager,method:'POST',body:{...spec,selected_columns:['native.stage'],portfolio:{cost_code:'01-100'}}})).status,403)
  await fixtures[0].read()
  assert.equal((await api('/jobs/'+fixtures[0].job.id,{method:'DELETE',body:{expected_version:fixtures[0].job.version}})).status,200)
  assert.equal((await query({snapshot_id:historical.id})).rows.length,2)
  assert.equal((await api('/reports/job-sources/'+fixtures[0].job.id+'?portfolio='+encodeURIComponent(JSON.stringify({snapshot_id:historical.id})))).status,404)

 }finally{await f.close()}
})

test('RPT-003 — weekly manager digest and monthly redacted packets retain failed sends, exact originals and current download grants',async()=>{
 const {packetFixture}=await import('./report-schedule-support.mjs')
 let refuse=true,uncertain=false
 const f=await createFixture({now:Date.parse('2026-10-27T10:00:00Z'),mailResponse:async m=>{if(m.subject.startsWith('Your scheduled Plinth')&&m.to.includes('synthetic-plinth-lender@example.com')&&refuse)return Response.json({message:'Synthetic refusal'},{status:422});if(m.subject.startsWith('Your scheduled Plinth')&&uncertain)throw Error('Synthetic connection lost');return Response.json({id:'synthetic-plinth-mail-1'})}})
 try{
  const {c,photo,inspection,release}=await packetFixture(f)
  const manager=await f.invite('synthetic-plinth-manager@example.com','Assigned manager','admin'),lender=await f.invite('synthetic-plinth-lender@example.com','Lender','admin'),client=await f.invite('synthetic-plinth-client@example.com'),foreign=await f.invite('synthetic-plinth-foreign@example.com'),agent=await f.agent()
  const api=(path,options={})=>f.json('/api/plinth'+path,{cookie:f.owner,...options})
  const managerPerson=(await api('/team')).value.team.find(p=>p.email==='synthetic-plinth-manager@example.com')
  const assign=async(ids,version)=>api('/team/'+managerPerson.id,{method:'PUT',body:{expected_version:version,role:'project_manager',job_ids:ids,po_limit_cents:0}})
  assert.equal((await assign([c.job.id],0)).status,200)
  const lenderPerson=(await api('/team')).value.team.find(p=>p.email==='synthetic-plinth-lender@example.com');assert.equal((await api('/team/'+lenderPerson.id,{method:'PUT',body:{expected_version:0,role:'reader',job_ids:[c.job.id],po_limit_cents:0}})).status,200)
  const create=async(audience,cadence,email,options={})=>api('/report-schedules',{method:'POST',body:{job_id:c.job.id,expected_version:(await c.read()).version,audience,cadence,recipient_email:email,anchor_on:'2026-10-27',confirm:true},...options})
  const missingConsent=await create('lender','monthly','synthetic-plinth-lender@example.com',{body:{job_id:c.job.id,expected_version:c.job.version,audience:'lender',cadence:'monthly',recipient_email:'synthetic-plinth-lender@example.com',anchor_on:'2026-10-27'}});assert.equal(missingConsent.status,400)
  for(const cookie of [manager,lender,client])assert.equal((await create('lender','monthly','synthetic-plinth-lender@example.com',{cookie})).status,403)
  assert.equal((await create('lender','monthly','synthetic-plinth-lender@example.com',{cookie:undefined,token:agent})).status,403)
  const weekly=await create('manager','weekly','synthetic-plinth-manager@example.com');assert.equal(weekly.status,201,JSON.stringify(weekly.value))
  const monthly=await create('lender','monthly','synthetic-plinth-lender@example.com');assert.equal(monthly.status,201)
  const clientSchedule=await create('client','monthly','synthetic-plinth-client@example.com');assert.equal(clientSchedule.status,201)
  f.setNow(Date.parse('2026-10-27T08:59:00Z'));await f.scheduled('2026-10-27T08:59:00Z');assert.equal((await api('/report-schedules')).value.schedules.flatMap(r=>r.schedule.deliveries).length,0)
  f.setNow(Date.parse('2026-10-27T10:00:00Z'));await f.scheduled('2026-10-27T10:00:00Z')
  const all=(await api('/report-schedules')).value.schedules;assert.equal(all.length,3)
  const wm=all.find(r=>r.schedule.id===weekly.value.schedule.id),lm=all.find(r=>r.schedule.id===monthly.value.schedule.id)
  assert.equal(wm.schedule.deliveries.length,1);assert.equal(lm.schedule.deliveries.length,1)
  assert.equal(lm.schedule.deliveries[0].status,'refused');assert.equal(lm.schedule.deliveries[0].due_on,'2026-10-27')
  const path=s=>'/api/plinth/report-schedules/'+s.schedule.id+'/downloads/'+s.schedule.deliveries[0].id
  const downloaded=await f.request(path(lm),{cookie:lender});assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('cache-control'),'private, no-store');assert.ok(downloaded.headers.get('content-disposition').startsWith('attachment;'))
  const packet=await downloaded.json();assert.equal(packet.job_id,c.job.id);assert.equal(packet.sov.lines.length,2);assert.deepEqual(packet.sov.lines.map(l=>l.scheduled_cents),[200000,100000])
  assert.deepEqual(packet.applications.map(a=>[a.current_cents,a.total_cents,a.balance_cents]),[[150000,150000,150000]]);assert.deepEqual(packet.applications[0].lines.map(l=>[l.cost_code,l.previous_cents,l.current_cents,l.total_cents,l.balance_cents]),[['06-100',0,100000,100000,100000],['01-100',0,50000,50000,50000]])
  assert.deepEqual(packet.invoices.map(i=>[i.gross_cents,i.due_cents]),[[150000,150000]])
  assert.deepEqual(packet.photos.map(p=>p.base64),[photo]);assert.deepEqual(packet.inspections.map(i=>i.status),['cleared'])
  assert.equal(Buffer.from(packet.inspections[0].documents[0].base64,'base64').compare(inspection),0)
  assert.deepEqual(packet.waivers.map(w=>w.status),['accepted']);assert.equal(Buffer.from(packet.waivers[0].document.base64,'base64').compare(release),0)
  for(const s of [lm,all.find(r=>r.schedule.id===clientSchedule.value.schedule.id)]){
   const payload=await(await f.request(path(s),{cookie:s===lm?lender:client})).text()
   for(const privateValue of ['synthetic-plinth-private-bid','synthetic-plinth-private-worker','synthetic-plinth-private-pay-rate','98765','hour_cents','cost_unit_cents','pricing','cost_records'])assert.ok(!payload.includes(privateValue),privateValue)
  }
  const digest=await(await f.request(path(wm),{cookie:manager})).json();assert.equal(digest.job_id,c.job.id);assert.equal(digest.values['native.contract'].amount_cents,300000)
  for(const credentials of [{cookie:foreign},{cookie:client},{cookie:manager},{token:agent},{}])assert.ok([401,403,404].includes((await f.request(path(lm),credentials)).status))
  const reportMessages=f.messages.filter(m=>m.subject.startsWith('Your scheduled Plinth'));assert.equal(reportMessages.length,3)
  for(const m of reportMessages){assert.ok(m.text.includes('/report-schedules/'));assert.ok(m.html.includes('/report-schedules/'));assert.ok(!m.text.includes('98765'));assert.equal(m.attachments,undefined)}
  await f.scheduled('2026-10-27T12:00:00Z');assert.equal(f.messages.filter(m=>m.subject.startsWith('Your scheduled Plinth')).length,3,'An occurrence never sends twice')
  f.setNow(Date.parse('2026-11-03T10:00:00Z'));await f.scheduled('2026-11-03T10:00:00Z');f.setNow(Date.parse('2026-10-27T10:00:00Z'))
  let rows=(await api('/report-schedules')).value.schedules;assert.deepEqual(rows.find(r=>r.schedule.id===weekly.value.schedule.id).schedule.deliveries.map(d=>d.due_on),['2026-10-27','2026-11-03']);assert.equal(rows.find(r=>r.schedule.id===monthly.value.schedule.id).schedule.deliveries.length,1)
  refuse=false;f.setNow(Date.parse('2026-11-27T10:00:00Z'));await f.scheduled('2026-11-27T10:00:00Z');f.setNow(Date.parse('2026-10-27T10:00:00Z'));rows=(await api('/report-schedules')).value.schedules;assert.deepEqual(rows.find(r=>r.schedule.id===monthly.value.schedule.id).schedule.deliveries.map(d=>[d.due_on,d.status]),[['2026-10-27','refused'],['2026-11-27','accepted']]);
  assert.deepEqual(rows.find(r=>r.schedule.id===weekly.value.schedule.id).schedule.deliveries.map(d=>d.due_on),['2026-10-27','2026-11-03','2026-11-24'],'A missed weekly backlog produces only the latest due occurrence')
  const scheduleAudit=(await api('/audit?job_id='+c.job.id+'&action=report.schedule')).value.events
  assert.equal(scheduleAudit.length,3);assert.ok(scheduleAudit.every(e=>e.actor_role==='owner'&&e.source==='session'&&e.after_ref&&e.detail.schedules.some(s=>s.consent.id===c.job.created_by.id)))
  uncertain=true;await f.scheduled('2026-12-27T10:00:00Z');f.setNow(Date.parse('2026-10-27T10:00:00Z'))
  const unknown=(await api('/report-schedules')).value.schedules.find(r=>r.schedule.id===monthly.value.schedule.id).schedule.deliveries.at(-1);assert.equal(unknown.status,'unknown')
  const uncertainCount=f.messages.length;await f.scheduled('2026-12-27T11:00:00Z');assert.equal(f.messages.length,uncertainCount,'Unknown provider outcomes never resend an occurrence')
  const beforePolicy=await c.read();assert.equal((await api('/jobs/'+c.job.id+'/portal-policy',{method:'POST',body:{expected_version:beforePolicy.version,disabled:{client:['billing'],subcontractor:[]},reason:'Synthetic owner restriction'}})).status,200)
  assert.equal((await f.request(path(lm),{cookie:lender})).status,404,'A prior snapshot cannot bypass current portal restrictions')
  const disabled=await c.read();assert.equal((await api('/jobs/'+c.job.id+'/portal-policy',{method:'POST',body:{expected_version:disabled.version,disabled:{client:[],subcontractor:[]},reason:'Synthetic explicit owner regrant'}})).status,200)
  assert.equal((await assign([],1)).status,200);assert.equal((await f.request(path(wm),{cookie:manager})).status,404)
  assert.equal((await api('/report-schedules/'+monthly.value.schedule.id,{method:'DELETE',body:{}})).status,200);assert.equal((await f.request(path(lm),{cookie:lender})).status,404)
  const copied=await api('/roles',{method:'POST',body:{copy_of:'reader',name:'Synthetic lender reports',financial_visible:true}});assert.equal(copied.status,201)
  assert.equal((await api('/team/'+lenderPerson.id,{method:'PUT',body:{expected_version:1,role:'custom',role_id:copied.value.role.id,job_ids:[c.job.id],po_limit_cents:0}})).status,200)
  const copiedSchedule=await create('lender','monthly','synthetic-plinth-lender@example.com');assert.equal(copiedSchedule.status,201)
  uncertain=false;await f.scheduled('2026-10-27T10:00:00Z')
  const copiedRow=(await api('/report-schedules',{cookie:lender})).value.schedules.find(r=>r.schedule.id===copiedSchedule.value.schedule.id);assert.ok(copiedRow);assert.equal((await f.request(path(copiedRow),{cookie:lender})).status,200)
  assert.equal((await api('/roles/'+copied.value.role.id,{method:'PUT',body:{expected_version:copied.value.role.version,financial_visible:false}})).status,200)
  assert.equal((await f.request(path(copiedRow),{cookie:lender})).status,404,'A custom reader cannot download money after financial visibility is revoked')
  assert.equal((await api('/roles/'+copied.value.role.id,{method:'PUT',body:{expected_version:copied.value.role.version+1,financial_visible:true}})).status,200)
  assert.equal((await f.request(path(copiedRow),{cookie:lender})).status,404,'Restoring financial visibility does not revive an old recurring grant')
  const renewed=await create('lender','monthly',lenderPerson.email);assert.equal(renewed.status,201)
  await f.scheduled('2026-10-27T10:00:00Z')
  const renewedRow=(await api('/report-schedules',{cookie:lender})).value.schedules.find(r=>r.schedule.id===renewed.value.schedule.id)
  assert.ok(renewedRow);assert.equal((await f.request(path(renewedRow),{cookie:lender})).status,200,'An explicit fresh owner grant restores authorized packet access')
  assert.equal((await f.request('/auth/operator/status',{method:'POST',cookie:f.owner,body:{operatorId:lenderPerson.id,status:'inactive'}})).status,200)
  assert.equal((await f.request(path(renewedRow),{cookie:lender})).status,401,'Removing the recipient account revokes its existing session')
  assert.equal((await f.request(path(renewedRow),{cookie:f.owner})).status,404,'Even the owner cannot use a packet grant bound to a removed account')
  const beforeInactiveSend=f.messages.length
  await f.scheduled('2027-01-27T10:00:00Z');f.setNow(Date.parse('2026-10-27T10:00:00Z'))
  assert.ok(!f.messages.slice(beforeInactiveSend).some(m=>m.subject.startsWith('Your scheduled Plinth')&&m.to.includes(lenderPerson.email)),'The scheduler cannot send to a removed account')
  assert.equal((await f.request('/auth/operator/status',{method:'POST',cookie:f.owner,body:{operatorId:lenderPerson.id,status:'active'}})).status,200)
  assert.equal((await f.request(path(renewedRow),{cookie:f.owner})).status,404,'Reactivating an account still requires a fresh owner report grant')
  const restricted=await api('/roles',{method:'POST',body:{copy_of:'administrator',name:'Synthetic manager without money',financial_visible:false}});assert.equal(restricted.status,201)
  const restrictedRole=restricted.value.role
  assert.equal((await api('/team/'+managerPerson.id,{method:'PUT',body:{expected_version:2,role:'custom',role_id:restrictedRole.id,job_ids:[c.job.id],po_limit_cents:0}})).status,200)
  const restrictedSchedule=await create('manager','weekly',managerPerson.email);assert.equal(restrictedSchedule.status,201)
  await f.scheduled('2026-10-27T10:00:00Z')
  const restrictedRow=(await api('/report-schedules',{cookie:manager})).value.schedules.find(r=>r.schedule.id===restrictedSchedule.value.schedule.id)
  assert.ok(restrictedRow);assert.equal(restrictedRow.schedule.deliveries[0].status,'accepted')
  const restrictedDownload=await f.request(path(restrictedRow),{cookie:manager});assert.equal(restrictedDownload.status,200)
  const restrictedDigest=await restrictedDownload.json();assert.equal(restrictedDigest.job_id,c.job.id);assert.equal(restrictedDigest.values['native.stage'],'active')
  assert.equal(restrictedDigest.values['native.contract'],undefined,'A manager digest obeys financial visibility even for an administrator copy')
  assert.ok(!Object.values(restrictedDigest.values).some(value=>value&&typeof value==='object'&&'amount_cents' in value),'No money value reaches a restricted digest')
  assert.ok(!JSON.stringify(restrictedDigest).includes('300000'),'The known populated contract amount is absent')
  const changeFinancial=async(version,financial_visible)=>{const r=await api('/roles/'+restrictedRole.id,{method:'PUT',body:{expected_version:version,financial_visible}});assert.equal(r.status,200)}
  await changeFinancial(restrictedRole.version,true)
  assert.equal((await f.request(path(restrictedRow),{cookie:manager})).status,404,'A role change requires fresh report consent')
  const financialSchedule=await create('manager','weekly',managerPerson.email);assert.equal(financialSchedule.status,201)
  await f.scheduled('2026-10-27T10:00:00Z')
  const financialRow=(await api('/report-schedules',{cookie:manager})).value.schedules.find(r=>r.schedule.id===financialSchedule.value.schedule.id)
  const financialDownload=await f.request(path(financialRow),{cookie:manager});assert.equal(financialDownload.status,200)
  assert.equal((await financialDownload.json()).values['native.contract'].amount_cents,300000,'Fresh owner consent permits the authorized manager money values')
  await changeFinancial(restrictedRole.version+1,false)
  assert.equal((await f.request(path(financialRow),{cookie:manager})).status,404,'Revoking manager financial visibility refuses the old financial snapshot')
  await changeFinancial(restrictedRole.version+2,true)
  assert.equal((await f.request(path(financialRow),{cookie:manager})).status,404,'Restoring manager financial visibility cannot revive the old grant')
  const beforeRevokedSend=f.messages.length
  await f.scheduled('2027-02-27T10:00:00Z');f.setNow(Date.parse('2026-10-27T10:00:00Z'))
  assert.ok(!f.messages.slice(beforeRevokedSend).some(m=>m.subject.startsWith('Your scheduled Plinth')&&m.to.includes(managerPerson.email)),'The scheduler cannot send under either stale manager grant')
  const managerRenewal=await create('manager','weekly',managerPerson.email);assert.equal(managerRenewal.status,201)
  await f.scheduled('2026-10-27T10:00:00Z')
  const managerRenewalRow=(await api('/report-schedules',{cookie:manager})).value.schedules.find(r=>r.schedule.id===managerRenewal.value.schedule.id)
  assert.equal((await f.request(path(managerRenewalRow),{cookie:manager})).status,200,'A fresh owner grant restores manager access after financial revocation')
  const monthEnd=await create('client','monthly',clientSchedule.value.schedule.recipient_email,{body:{job_id:c.job.id,expected_version:(await c.read()).version,audience:'client',cadence:'monthly',recipient_email:clientSchedule.value.schedule.recipient_email,anchor_on:'2027-01-31',confirm:true}});assert.equal(monthEnd.status,201)
  await f.scheduled('2027-01-31T08:59:00Z');f.setNow(Date.parse('2026-10-27T10:00:00Z'))
  assert.deepEqual((await api('/report-schedules')).value.schedules.find(r=>r.schedule.id===monthEnd.value.schedule.id).schedule.deliveries,[],'The anchored monthly report cannot send before 09:00 UTC')
  for(const occurrence of ['2027-01-31','2027-02-28','2027-03-31'])await f.scheduled(occurrence+'T09:00:00Z')
  f.setNow(Date.parse('2026-10-27T10:00:00Z'))
  const monthEndRow=(await api('/report-schedules',{cookie:client})).value.schedules.find(r=>r.schedule.id===monthEnd.value.schedule.id)
  assert.deepEqual(monthEndRow.schedule.deliveries.map(d=>d.due_on),['2027-01-31','2027-02-28','2027-03-31'],'Monthly dates clamp to February then return to the original anchor')
  const fresh=(await c.read());assert.ok(!JSON.stringify(fresh).includes('report_schedules'),'Raw job projection never exposes delivery grants or snapshots')
  assert.equal((await api('/jobs/'+c.job.id,{method:'DELETE',body:{expected_version:fresh.version}})).status,200)
  for(const cookie of [f.owner,manager,client]){
   assert.deepEqual((await api('/report-schedules',{cookie})).value.schedules,[],'Erasure removes the job and all generated report listings')
   for(const row of [wm,lm,copiedRow,renewedRow,restrictedRow,financialRow,managerRenewalRow,monthEndRow])assert.equal((await f.request(path(row),{cookie})).status,404,'A retained link cannot recover an erased packet')
  }
  const afterErasure=f.messages.length
  await f.scheduled('2027-02-27T10:00:00Z');await f.scheduled('2026-10-27T10:00:00Z');f.setNow(Date.parse('2026-10-27T10:00:00Z'))
  assert.equal(f.messages.length,afterErasure,'Neither a future tick nor replay of an old occurrence resurrects an erased report or sends mail')
 }finally{await f.close()}
})

test('Completed estimates reconcile source-linked productivity, native outcomes and current-only authorized reporting',async()=>{
 const {performanceFixture,performanceAddress}=await import('./performance-support.mjs'),f=await createFixture({now:Date.parse('2026-10-27T15:00:00Z')})
 try{
  const c=await performanceFixture(f),report=(await c.call('/reports/performance'))
  assert.deepEqual(report.jobs.map(j=>j.name).sort(),['Cedar completed remodel','Lost remodel proposal','Maple completed remodel','Open remodel proposal'])
  const first=report.jobs.find(j=>j.id===c.jobs[0].job.id),second=report.jobs.find(j=>j.id===c.jobs[1].job.id),a=first.rows.find(r=>r.cost_code==='06-100'),b=second.rows.find(r=>r.cost_code==='06-100')
  assert.equal(first.completion.completed_on,'2026-10-23');assert.equal(second.completion.completed_on,'2026-10-23')
  assert.equal(a.assembly_id,c.assembly.id);assert.equal(a.assembly_version,1);assert.equal(a.trade,'Framing');assert.equal(a.estimated_cost_cents,6000);assert.equal(a.actual_cost_cents,6000)
  assert.equal(a.estimated_minutes,120);assert.equal(a.approved_minutes,120);assert.equal(a.estimated_quantity,10);assert.equal(a.installed_quantity,10);assert.equal(a.actual_units_per_hour,5)
  assert.equal(b.estimated_cost_cents,7200);assert.equal(b.actual_cost_cents,9000);assert.equal(b.estimated_minutes,144);assert.equal(b.approved_minutes,180);assert.equal(b.installed_quantity,12);assert.equal(b.actual_units_per_hour,4)
  assert.equal(a.source.time_ids.length,1);assert.equal(a.source.production.length,1);assert.equal(a.source.actuals.reduce((n,e)=>n+e.amount_cents,0),6000);assert.equal(a.source.quote_id,c.jobs[0].job.quotes.at(-1).id)
  const unknown=first.rows.find(r=>r.cost_code==='06-200');assert.equal(unknown.installed_quantity,null);assert.equal(unknown.actual_units_per_hour,null);assert.equal(unknown.unknown,'Production denominator unknown')
  assert.equal(report.estimators.length,2);const ownerOutcomes=report.estimators.find(e=>e.id===c.jobs[0].job.quotes.at(-1).prepared_by.id),otherOutcomes=report.estimators.find(e=>e.id===c.jobs[1].job.quotes.at(-1).prepared_by.id);assert.deepEqual(Object.fromEntries(['won','lost','open','win_rate'].map(k=>[k,ownerOutcomes[k]])),{won:1,lost:1,open:1,win_rate:0.5});assert.deepEqual(Object.fromEntries(['won','lost','open','win_rate'].map(k=>[k,otherOutcomes[k]])),{won:1,lost:0,open:0,win_rate:1})
  assert.equal(report.jobs.find(j=>j.id===c.jobs[2].job.id).sales.evidence,'Native client correspondence 2');assert.equal(first.sales.evidence,'Native signed proposal 0')
  assert.deepEqual(report.pipeline.find(p=>p.stage==='won'),{currency:'USD',stage:'won',count:2,amount_cents:29700})
  const open=c.jobs[3];for(const stage of ['qualified','estimating','negotiating','submitted','lost']){await open.report('sales',{quote_id:open.job.quotes.at(-1).id,stage,reason:'Reviewed pipeline stage '+stage,evidence:'Native correspondence '+stage,confirm:true});const current=await c.call('/reports/performance');assert.equal(current.jobs.find(j=>j.id===open.job.id).sales.stage,stage);assert.equal(current.pipeline.find(p=>p.stage===stage).count,stage==='lost'?2:1)}
  const stages=(await c.call('/reports/performance')).jobs.find(j=>j.id===open.job.id).sales.history;assert.deepEqual(stages.map(s=>s.stage),['submitted','qualified','estimating','negotiating','submitted','lost']);assert.equal(stages[0].evidence,'Native client correspondence 3')
  const request={template_id:c.template.id,as_of:'2026-10-20',dimensions:{walls:'11'}},reprice=await open.act('/estimate-template/preview',request);await open.act('/estimate-template/apply',{...request,digest:reprice.preview.digest});const renewed=(await c.call('/reports/performance')).jobs.find(j=>j.id===open.job.id);assert.equal(renewed.sales.stage,'estimating');assert.equal(renewed.sales.evidence,null);assert.equal(renewed.sales.history.at(-1).stage,'lost')
  assert.equal((await f.json(`/api/plinth/reports/performance/jobs/${first.id}/sales`,{method:'POST',cookie:f.owner,body:{expected_version:c.jobs[0].job.version,quote_id:c.jobs[0].job.quotes.at(-1).id,stage:'lost',reason:'Invalid downgrade',evidence:'invalid',confirm:true}})).status,409)
  const agent=await f.agent(),client=await f.invite(performanceAddress('performance-client'))
  for(const auth of [{},{token:agent},{cookie:client}])assert.ok([401,403].includes((await f.json('/api/plinth/reports/performance',auth)).status))
  const admin=await f.invite(performanceAddress('performance-scoped'),'Scoped reviewer','admin'),team=(await c.call('/team')).team,person=team.find(p=>p.email===performanceAddress('performance-scoped'))
  let r=await f.json('/api/plinth/roles',{method:'POST',cookie:f.owner,body:{name:'Scoped performance manager',copy_of:'project_manager'}});assert.equal(r.status,201);let role=r.value.role
  r=await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'custom',role_id:role.id,job_ids:[first.id],po_limit_cents:0}});assert.equal(r.status,200)
  let scoped=await f.json('/api/plinth/reports/performance',{cookie:admin});assert.equal(scoped.status,200);assert.deepEqual(scoped.value.jobs.map(j=>j.id),[first.id]);assert.deepEqual(scoped.value.catalog,[],'A scoped project manager cannot read the private company catalog through a report');assert.equal(scoped.value.estimators[0].win_rate,1);assert.equal(scoped.value.estimators[0].lost,0)
  assert.equal((await f.json('/api/plinth/reports/performance/jobs/'+second.id,{cookie:admin})).status,404)
  r=await f.json('/api/plinth/roles/'+role.id,{method:'PUT',cookie:f.owner,body:{expected_version:role.version,name:role.name,financial_visible:false}});assert.equal(r.status,200)
  assert.equal((await f.json('/api/plinth/reports/performance',{cookie:admin})).status,403)
  const publicJob=(await f.json('/api/plinth/jobs/'+first.id,{cookie:client})).value.job;assert.equal(publicJob.estimate_performance,undefined);assert.ok(!JSON.stringify(publicJob).includes('Reviewed finished job'))
  const proposed=(await c.jobs[0].report('lessons',{catalog_id:c.assembly.id,catalog_version:1,source_job_ids:[first.id,second.id],reason:'Private comparison lesson',value:c.assembly.revisions[0].value})).record
  r=await f.json('/api/plinth/roles/'+role.id,{method:'PUT',cookie:f.owner,body:{expected_version:2,name:role.name,financial_visible:true}});assert.equal(r.status,200)
  const privateDownload=await f.json('/api/plinth/reports/performance/jobs/'+first.id,{cookie:admin});assert.equal(privateDownload.status,200);assert.deepEqual(privateDownload.value.performance.lessons,[])
  const toErase=c.jobs[1].job;r=await f.json('/api/plinth/jobs/'+second.id,{method:'DELETE',cookie:f.owner,body:{expected_version:toErase.version}});assert.equal(r.status,200)
  const erasedReport=await c.call('/reports/performance');assert.ok(!erasedReport.jobs.some(j=>j.id===second.id));assert.deepEqual(erasedReport.lessons,[])
  const replay=await f.json(`/api/plinth/reports/performance/jobs/${first.id}/lessons/${proposed.id}/approve`,{method:'POST',cookie:f.owner,body:{expected_version:c.jobs[0].job.version,confirm:true}});assert.equal(replay.status,404)
  assert.equal((await c.call('/estimate-catalog')).entries.find(e=>e.id===c.assembly.id).version,1)
  const credentials=(await c.call('/agent-credentials')).credentials;assert.equal(credentials.length,1);await c.call(`/agent-credentials/${credentials[0].id}/revoke`,{});assert.equal((await f.json('/api/plinth/reports/performance',{token:agent})).status,401)

  assert.equal((await f.json('/api/plinth/reports/performance/jobs/'+c.jobs[3].job.id+'/complete',{method:'POST',cookie:f.owner,body:{expected_version:c.jobs[3].job.version,completed_on:'2026-10-23',evidence:'No actual completion',confirm:true}})).status,409)
 }finally{await f.close()}
})
