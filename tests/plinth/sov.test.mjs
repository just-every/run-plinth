import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture } from './helpers.mjs'

test('BILL-001 — coded USD draws retain reviewed tax, reconcile stored materials and approved changes, and issue immutable commercial applications', async()=>{
 const f=await createFixture()
 try {
  const client=await f.invite('draw-client@example.com'),foreign=await f.invite('foreign@example.com'),pm=await f.invite('draw-pm@example.com','Assigned manager','admin'),agent=await f.agent()
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{...(body===undefined?{}:{method:'POST',body}),cookie,token})
  let r=await api('/jobs',{name:'Maple Street whole-house renovation and covered porch',client_email:'draw-client@example.com',address:'148 Maple Street, Burlington, VT 05401'});assert.equal(r.status,201);let job=r.value.job
  const act=async(path,body={},cookie=f.owner,token)=>{const result=await api(`/jobs/${job.id}`+path,{expected_version:job.version,...body},cookie,token);if(result.value.job&&cookie===f.owner&&!token)job=result.value.job;return result}
  const line=(id,description,code,cost,sell)=>({id,description,cost_code:code,phase:'Remodel',category:'material',quantity:'1',unit:'each',cost_unit_cents:cost,unit_cents:sell})
  assert.equal((await act('/quotes',{lines:[line('demo','Demolition and site protection','02-410',50_000,100_000),line('framing','Framing materials and installation','06-100',90_000,200_000)]})).status,200)
  r=await api('/pricing-rates',{jurisdiction:'Synthetic integration jurisdiction',kind:'sales',percent:'10',effective_on:'2026-01-01',reference:'Reviewed fixture rate schedule',human_reviewed:true});assert.equal(r.status,201);const rate=r.value.rate
  const pricing={basis:'sell',as_of:'2026-10-20',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['framing'],exemption_reference:'Reviewed demolition exemption'}}
  r=await act('/pricing/preview',pricing);assert.equal(r.status,200)
  assert.equal((await act('/pricing/apply',{...pricing,digest:r.value.preview.digest})).status,200)
  const quote=job.quotes.at(-1)
  assert.equal(quote.total_cents,320_000)
  assert.equal((await act(`/quotes/${quote.id}/accept`,{method:'signed',evidence:'Client signed exact scope and reviewed tax'})).status,200)
  const pricedChange={description:'Client-approved porch handrail upgrade',direction:'charge',basis:'sell',as_of:'2026-10-20',lines:[line('handrail','Porch handrail upgrade','06-100',5000,10_000)],rules:[],tax:{rate_id:rate.id,taxable_line_ids:['handrail']}}
  r=await act('/variation-pricing/preview',pricedChange);assert.equal(r.status,200);const preview=r.value.preview
  assert.equal((await act('/variation-pricing/apply',{...pricedChange,digest:'stale'})).status,409)
  assert.equal((await act('/variation-pricing/apply',{...pricedChange,digest:preview.digest},undefined,agent)).status,403)
  assert.equal((await act('/variation-pricing/apply',{...pricedChange,digest:preview.digest})).status,200)
  const change=job.variations.at(-1);assert.equal(change.amount_cents,11_000)
  r=await act(`/variations/${change.id}/approve`,{},client);assert.equal(r.status,200);assert.ok(!JSON.stringify(r.value.record).includes('cost_unit_cents'));assert.ok(!JSON.stringify(r.value.record).includes('pricing'));job=(await api(`/jobs/${job.id}`)).value.job
  const sourceChange=structuredClone(job.variations.at(-1))
  assert.equal((await act('/sov',{code_assignments:{['variation:'+change.id]:'06-100'}},undefined,agent)).status,403)
  assert.equal((await act('/sov',{code_assignments:{['variation:'+change.id]:'06-100'}},client)).status,403)
  assert.equal((await act('/sov',{code_assignments:{['variation:'+change.id]:'06-100'}})).status,200)
  const originalSov=structuredClone(job.sov[0]);assert.equal(originalSov.contract_cents,331_000);assert.deepEqual(originalSov.sources.quote.pricing,quote.pricing);assert.deepEqual(originalSov.sources.variations[0].pricing,sourceChange.pricing)
  assert.equal((await act('/sov',{})).status,409,'Same approved sources cannot create duplicate baselines')
  assert.equal((await act('/orders',{supplier:'Maple Lumber',description:'Framing lumber',source:{kind:'budget',cost_code:'06-100'},lines:[{id:'lumber',description:'Framing package',cost_code:'06-100',quantity:'10',unit:'package',unit_cents:10_000}]})).status,200)
  const order=job.orders.at(-1)
  assert.equal((await act(`/orders/${order.id}/issue`)).status,200)
  assert.equal((await act(`/orders/${order.id}/receive`,{lines:[{line_id:'lumber',quantity:'6'}],reference:'Delivery ticket ML-1006'})).status,200)
  const progress=(demo,framing,stored,variation=11_000)=>({description:'October construction progress',lines:[{line_id:'quote:demo',completed_cents:demo,stored_cents:0,evidence:'Dated site photographs and superintendent review'},{line_id:'quote:framing',completed_cents:framing,stored_cents:stored,evidence:'Framing progress and stored lumber ticket ML-1006',order_ids:[order.id]},{line_id:'variation:'+change.id,completed_cents:variation,stored_cents:0,evidence:'Handrail installed; client-signed change'}]})
  const rejects=[{...progress(50_000,40_000,20_000),lines:[]},progress(100_001,40_000,20_000),progress(50_000,40_000,60_001),{...progress(50_000,40_000,20_000),cumulative_cents:1}, {...progress(50_000,40_000,20_000),lines:progress(50_000,40_000,20_000).lines.map(l=>({...l,evidence:''}))}]
  const sharedReceipt=progress(0,0,40_000);sharedReceipt.lines[0]={...sharedReceipt.lines[0],stored_cents:40_000,order_ids:[order.id],evidence:'Shared receipt evidence'};rejects.push(sharedReceipt)
  const beforeVersion=job.version
  for(const body of rejects)assert.ok([400,409].includes((await act('/claims',body)).status))
  assert.equal((await api(`/jobs/${job.id}`)).value.job.version,beforeVersion,'Rejected progress writes nothing')
  r=await act('/claims',progress(50_000,40_000,20_000));assert.equal(r.status,200);let first=r.value.record
  assert.equal(first.sov.total_cents,121_000);assert.equal(first.sov.previous_cents,0);assert.equal(first.sov.current_cents,121_000);assert.equal(first.sov.balance_cents,210_000)
  assert.equal(first.sov.lines[1].stored_orders[0].receipts[0].reference,'Delivery ticket ML-1006')
  assert.equal((await api(`/jobs/${job.id}/claims/${first.id}/application.json`)).status,409)
  for(const auth of [{cookie:client},{cookie:foreign},{cookie:undefined,token:agent}])assert.ok([403,404].includes((await act(`/claims/${first.id}/approve`,{},auth.cookie,auth.token)).status))
  assert.equal((await act(`/claims/${first.id}/approve`)).status,200)
  assert.equal((await act(`/claims/${first.id}/issue`)).status,200);first=structuredClone(job.claims.find(c=>c.id===first.id))
  assert.equal((await act(`/claims/${first.id}/issue`)).status,409)
  const applicationPath=`/api/plinth/jobs/${job.id}/claims/${first.id}/application`
  const issued=await f.json(applicationPath+'.json',{cookie:f.owner});assert.equal(issued.status,200);assert.deepEqual(issued.value.application,first.sov);assert.equal(issued.value.issued_by.id,first.exported_by.id)
  assert.deepEqual((await f.json(applicationPath+'.json',{cookie:f.owner})).value,issued.value,'Repeated downloads preserve exact issuance and snapshot')
  const csv=await (await f.request(applicationPath+'.csv',{cookie:f.owner})).text();assert.ok(csv.includes('121000')&&csv.includes('210000')&&csv.includes('06-100')&&csv.includes(change.id))
  const html=await (await f.request(applicationPath+'.html',{cookie:f.owner})).text();assert.ok(html.includes('Maple Street')&&html.includes('licensed AIA')&&html.includes('ML-1006'))
  for(const credentials of [{cookie:client},{cookie:foreign},{token:agent}])for(const ext of ['json','csv','html'])assert.ok([403,404].includes((await f.request(applicationPath+'.'+ext,credentials)).status))
  const secondBody=progress(100_000,90_000,10_000)
  r=await act('/claims',secondBody);assert.equal(r.status,200);const stale=r.value.record
  assert.equal((await act(`/orders/${order.id}/receive`,{lines:[{line_id:'lumber',quantity:'1'}],reference:'Delivery ticket ML-1007'})).status,200)
  assert.equal((await act(`/claims/${stale.id}/approve`)).status,409,'Receipt/source changes invalidate an unapproved application')
  r=await act('/claims',secondBody);assert.equal(r.status,200);const second=r.value.record
  assert.equal(second.sov.previous_cents,121_000);assert.equal(second.sov.total_cents,211_000);assert.equal(second.sov.current_cents,90_000);assert.equal(second.sov.lines[1].current_cents,40_000,'Stored reclassification is counted once')
  assert.equal((await act(`/claims/${second.id}/approve`)).status,200);assert.equal((await act(`/claims/${second.id}/issue`)).status,200)
  assert.deepEqual(job.claims.find(c=>c.id===first.id),first,'A later draw never changes a previously issued application')
  assert.equal((await act('/claims',{description:'Bypass coded billing',cumulative_cents:220_000})).status,409)
  const creditInput={...pricedChange,description:'Credit for omitted porch trim',direction:'credit'}
  r=await act('/variation-pricing/preview',creditInput);assert.equal(r.status,200)
  assert.equal((await act('/variation-pricing/apply',{...creditInput,digest:r.value.preview.digest})).status,200)
  const credit=job.variations.at(-1)
  assert.equal((await act(`/variations/${credit.id}/approve`,{},client)).status,200);job=(await api(`/jobs/${job.id}`)).value.job
  assert.equal((await act('/claims',progress(100_000,120_000,0))).status,409,'A newly approved change needs a reviewed SOV revision')
  assert.equal((await act('/sov',{code_assignments:{['variation:'+credit.id]:'06-100'}})).status,200)
  assert.equal(job.sov.length,2);assert.deepEqual(job.sov[0],originalSov);assert.equal(job.sov[1].contract_cents,320_000)
  const finish=progress(100_000,220_000,0);finish.lines.push({line_id:'variation:'+credit.id,completed_cents:-11_000,stored_cents:0,evidence:'Client approved omitted scope credit'})
  r=await act('/claims',finish);assert.equal(r.status,200);const final=r.value.record
  assert.equal(final.sov.total_cents,320_000);assert.equal(final.sov.current_cents,109_000);assert.equal(final.sov.balance_cents,0)
  assert.equal((await act(`/claims/${final.id}/approve`)).status,200);assert.equal((await act(`/claims/${final.id}/issue`)).status,200)
  assert.deepEqual(job.claims.find(c=>c.id===first.id),first);assert.deepEqual(job.quotes.find(q=>q.id===quote.id).pricing,quote.pricing)
  const people=(await api('/team')).value.team,person=people.find(p=>p.email==='draw-pm@example.com')
  assert.equal((await f.json(`/api/plinth/team/${person.id}`,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'project_manager',job_ids:[job.id],po_limit_cents:200_000}})).status,200)
  assert.equal((await f.json(applicationPath+'.json',{cookie:pm})).status,200)
  assert.equal((await f.json(`/api/plinth/team/${person.id}`,{method:'PUT',cookie:f.owner,body:{expected_version:1,role:'project_manager',job_ids:[],po_limit_cents:200_000}})).status,200)
  assert.equal((await f.json(applicationPath+'.json',{cookie:pm})).status,404)
  const visible=(await api(`/jobs/${job.id}`,undefined,client)).value.job
  for(const key of ['source_digest','stored_orders','pricing','cost_total_cents','ML-1006'])assert.ok(!JSON.stringify(visible).includes(key),'Client projection omits office reconciliation '+key)
  const legacy=await createActiveJob(f,'Existing cumulative-only billing','legacy@example.com')
  const denied=await api(`/jobs/${legacy.id}/sov`,{expected_version:legacy.version});assert.equal(denied.status,409);assert.equal(denied.value.error,'sov_pricing_required','Unreviewed historic tax never gains invented provenance')
 } finally {await f.close()}
})
