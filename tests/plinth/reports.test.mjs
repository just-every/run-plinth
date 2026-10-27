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
