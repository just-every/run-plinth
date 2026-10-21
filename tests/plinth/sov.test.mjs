import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture } from './helpers.mjs'

test('BILL-003 / BILL-001 — coded USD draws retain reviewed tax, reconcile stored materials and approved changes, and issue immutable commercial applications', async()=>{
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
  assert.equal((await act(`/quotes/${quote.id}/accept`,{method:'signed',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'},evidence:'Client signed exact scope and reviewed tax'})).status,200)
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
  const retainage={contract_reference:'Signed Maple Street contract section 9: client retainage',rules:[{line_id:'quote:demo',work_bps:1000,stored_bps:500},{line_id:'quote:framing',work_bps:500,stored_bps:1000},{line_id:'variation:'+change.id,work_bps:750,stored_bps:0}],milestones:[{id:'substantial',name:'Substantial completion',completion_requirements:['Architect substantial-completion record'],waiver_requirements:[]},{id:'final',name:'Final completion',final:true,completion_requirements:['Final inspection record'],waiver_requirements:['Signed final waiver packet']}]}
  const cleanVersion=job.version
  for(const auth of [{cookie:client},{cookie:undefined,token:agent}])assert.equal((await act('/retainage',retainage,auth.cookie,auth.token)).status,403,'BILL-003 only current human job managers record contract retainage')
  assert.equal(job.version,cleanVersion)
  assert.equal((await act('/retainage',{...retainage,rules:retainage.rules.slice(1)})).status,400,'BILL-003 missing line rules cannot silently become zero')
  assert.equal((await act('/retainage',retainage)).status,200)
  const plan=structuredClone(job.retainage.plan)
  let vendor=(await api('/vendors',{kind:'subcontractor',name:'Champlain Framing LLC',trades:['Framing'],contacts:[]})).value.vendor
  assert.equal((await api(`/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Framing',status:'qualified',evidence:'Reviewed framing scope qualifications'})).status,200)
  r=await act('/subcontracts',{vendor_id:vendor.id,trade:'Framing',scope:'Porch framing and closeout',contact_ids:[],awarded_on:'2026-10-20',amount_cents:200000});assert.equal(r.status,200);const subId=r.value.record.id
  assert.equal((await act(`/subcontracts/${subId}/release`)).status,200);assert.equal((await act(`/subcontracts/${subId}/lien`,{state:'VT'})).status,200)
  const supplierTerms={contract_reference:'Signed subcontract SC-318 retainage',rate_bps:750,milestones:retainage.milestones}
  for(const auth of [{cookie:client},{cookie:undefined,token:agent}])assert.equal((await act(`/subcontracts/${subId}/retainage`,supplierTerms,auth.cookie,auth.token)).status,403)
  assert.equal((await act(`/subcontracts/${subId}/retainage`,supplierTerms)).status,200)
  r=await act(`/subcontracts/${subId}/draws`,{through_date:'2026-10-20',amount_cents:80000});assert.equal(r.status,200);const supplierFirst=r.value.record.id
  assert.equal(job.subcontracts[0].retainage_balance.held_cents,6000)
  assert.equal((await act(`/subcontracts/${subId}/draws/${supplierFirst}/payment`,{paid_on:'2026-10-21',amount_cents:80000,reference:'Unsent payment proposal'})).value.error,'supplier_retainage_held','BILL-003 the existing gross-payment door cannot ignore a supplier hold')
  const progress=(demo,framing,stored,variation=11_000)=>({description:'October construction progress',lines:[{line_id:'quote:demo',completed_cents:demo,stored_cents:0,evidence:'Dated site photographs and superintendent review'},{line_id:'quote:framing',completed_cents:framing,stored_cents:stored,evidence:'Framing progress and stored lumber ticket ML-1006',order_ids:[order.id]},{line_id:'variation:'+change.id,completed_cents:variation,stored_cents:0,evidence:'Handrail installed; client-signed change'}]})
  const rejects=[{...progress(50_000,40_000,20_000),lines:[]},progress(100_001,40_000,20_000),progress(50_000,40_000,60_001),{...progress(50_000,40_000,20_000),cumulative_cents:1}, {...progress(50_000,40_000,20_000),lines:progress(50_000,40_000,20_000).lines.map(l=>({...l,evidence:''}))}]
  const sharedReceipt=progress(0,0,40_000);sharedReceipt.lines[0]={...sharedReceipt.lines[0],stored_cents:40_000,order_ids:[order.id],evidence:'Shared receipt evidence'};rejects.push(sharedReceipt)
  const beforeVersion=job.version
  for(const body of rejects)assert.ok([400,409].includes((await act('/claims',body)).status))
  assert.equal((await api(`/jobs/${job.id}`)).value.job.version,beforeVersion,'Rejected progress writes nothing')
  const rounded=await act('/claims',progress(50_005,40_000,20_000));assert.equal(rounded.status,200);assert.equal(rounded.value.record.sov.retainage.lines[0].cumulative_withheld_cents,5001,'BILL-003 round each work/stored calculation half up to cents')
  r=await act('/claims',progress(50_000,40_000,20_000));assert.equal(r.status,200);let first=r.value.record
  assert.equal(first.sov.retainage.cumulative_withheld_cents,9825);assert.equal(first.sov.retainage.held_cents,9825);assert.equal(first.sov.retainage.current_net_cents,111175);assert.equal(first.sov.retainage.lines[1].work_withheld_cents,2000);assert.equal(first.sov.retainage.lines[1].stored_withheld_cents,2000)
  assert.equal(first.sov.total_cents,121_000);assert.equal(first.sov.previous_cents,0);assert.equal(first.sov.current_cents,121_000);assert.equal(first.sov.balance_cents,210_000)
  assert.equal(first.sov.lines[1].stored_orders[0].receipts[0].reference,'Delivery ticket ML-1006')
  assert.equal((await api(`/jobs/${job.id}/claims/${first.id}/application.json`)).status,409)
  for(const auth of [{cookie:client},{cookie:foreign},{cookie:undefined,token:agent}])assert.ok([403,404].includes((await act(`/claims/${first.id}/approve`,{},auth.cookie,auth.token)).status))
  assert.equal((await act(`/claims/${first.id}/approve`)).status,200)
  assert.equal((await act('/retainage',{...retainage,rules:retainage.rules.map(row=>({...row,work_bps:0}))})).status,409,'BILL-003 approved contract terms cannot be rewritten after billing')
  assert.equal((await act(`/claims/${first.id}/issue`)).status,200);first=structuredClone(job.claims.find(c=>c.id===first.id))
  assert.equal((await act(`/claims/${first.id}/issue`)).status,409)
  const applicationPath=`/api/plinth/jobs/${job.id}/claims/${first.id}/application`
  const issued=await f.json(applicationPath+'.json',{cookie:f.owner});assert.equal(issued.status,200);assert.deepEqual(issued.value.application,first.sov);assert.equal(issued.value.issued_by.id,first.exported_by.id)
  assert.deepEqual((await f.json(applicationPath+'.json',{cookie:f.owner})).value,issued.value,'Repeated downloads preserve exact issuance and snapshot')
  const csv=await (await f.request(applicationPath+'.csv',{cookie:f.owner})).text();assert.ok(csv.includes('121000')&&csv.includes('210000')&&csv.includes('06-100')&&csv.includes(change.id))
  const html=await (await f.request(applicationPath+'.html',{cookie:f.owner})).text();assert.ok(html.includes('Maple Street')&&html.includes('licensed AIA')&&html.includes('ML-1006'))
  for(const credentials of [{cookie:client},{cookie:foreign},{token:agent}])for(const ext of ['json','csv','html'])assert.ok([403,404].includes((await f.request(applicationPath+'.'+ext,credentials)).status))
  assert.ok(csv.includes('Cumulative withheld cents'));assert.ok(html.includes('Client retainage')&&html.includes('$98.25'))
  const secondBody=progress(100_000,90_000,10_000)
  r=await act('/claims',secondBody);assert.equal(r.status,200);const stale=r.value.record
  assert.equal((await act(`/orders/${order.id}/receive`,{lines:[{line_id:'lumber',quantity:'1'}],reference:'Delivery ticket ML-1007'})).status,200)
  assert.equal((await act(`/claims/${stale.id}/approve`)).status,409,'Receipt/source changes invalidate an unapproved application')
  r=await act('/claims',secondBody);assert.equal(r.status,200);const second=r.value.record
  assert.equal(second.sov.previous_cents,121_000);assert.equal(second.sov.total_cents,211_000);assert.equal(second.sov.current_cents,90_000);assert.equal(second.sov.lines[1].current_cents,40_000,'Stored reclassification is counted once')
  assert.equal((await act(`/claims/${second.id}/approve`)).status,200);assert.equal((await act(`/claims/${second.id}/issue`)).status,200)
  assert.equal(second.sov.retainage.previous_withheld_cents,9825);assert.equal(second.sov.retainage.current_withheld_cents,6500);assert.equal(second.sov.retainage.cumulative_withheld_cents,16325);assert.equal(second.sov.retainage.current_net_cents,83500)
  const partial={claim_id:second.id,milestone_id:'substantial',lines:[{line_id:'quote:demo',amount_cents:3000},{line_id:'quote:framing',amount_cents:1000}],completion_references:[{requirement:'Architect substantial-completion record',reference:'Signed architect record SC-214, dated 2026-10-21'}],waiver_references:[]}
  assert.equal((await act('/retainage/release',{...partial,completion_references:[]})).status,409,'BILL-003 missing required completion evidence refuses release')
  assert.equal((await act('/retainage/release',{...partial,lines:[{line_id:'quote:demo',amount_cents:10001}]})).status,409,'BILL-003 cannot release more than line hold')
  for(const auth of [{cookie:client},{cookie:undefined,token:agent}])assert.equal((await act('/retainage/release',partial,auth.cookie,auth.token)).status,403)
  const supplierPartial={draw_id:supplierFirst,milestone_id:'substantial',lines:[{draw_id:supplierFirst,amount_cents:3000}],completion_references:[{requirement:'Architect substantial-completion record',reference:'Reviewed subcontract substantial completion SC-318-A'}],waiver_references:[]}
  assert.equal((await act(`/subcontracts/${subId}/retainage/release`,{...supplierPartial,lines:[{draw_id:supplierFirst,amount_cents:6001}]})).status,409)
  assert.equal((await act(`/subcontracts/${subId}/retainage/release`,supplierPartial)).status,200)
  assert.equal(job.subcontracts[0].retainage_balance.held_cents,3000);assert.equal(job.retainage_balance.held_cents,16325,'BILL-003 a supplier release never reduces the client hold')
  assert.equal((await act('/retainage/release',partial)).status,200)
  assert.equal(job.subcontracts[0].retainage_balance.held_cents,3000,'BILL-003 a client release never reduces supplier retainage')
  assert.equal(job.retainage_balance.cumulative_released_cents,4000);assert.equal(job.retainage_balance.held_cents,12325);assert.equal(job.retainage_balance.cumulative_net_cents,198675)
  assert.equal((await act('/retainage/release',partial)).status,409,'BILL-003 a milestone cannot release twice')
  assert.equal(job.orders[0].amount_cents,100000);assert.equal(job.claims.find(c=>c.id===second.id).reconciliation.outstanding_cents,30000,'BILL-003 supplier outstanding value remains separate from client retainage')
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
  const newRules={...retainage,rules:[...retainage.rules,{line_id:'variation:'+credit.id,work_bps:0,stored_bps:0}]}
  assert.equal((await act('/retainage',newRules)).status,200,'BILL-003 newly approved codes append explicit terms without replacing earlier rules')
  const finish=progress(100_000,220_000,0);finish.lines.push({line_id:'variation:'+credit.id,completed_cents:-11_000,stored_cents:0,evidence:'Client approved omitted scope credit'})
  r=await act('/claims',finish);assert.equal(r.status,200);const final=r.value.record
  assert.equal(final.sov.total_cents,320_000);assert.equal(final.sov.current_cents,109_000);assert.equal(final.sov.balance_cents,0)
  assert.equal((await act(`/claims/${final.id}/approve`)).status,200);assert.equal((await act(`/claims/${final.id}/issue`)).status,200)
  const finalRelease={claim_id:final.id,milestone_id:'final',lines:[{line_id:'quote:demo',amount_cents:7000},{line_id:'quote:framing',amount_cents:10000},{line_id:'variation:'+change.id,amount_cents:825}],completion_references:[{requirement:'Final inspection record',reference:'Final inspection FI-228 approved by architect'}],waiver_references:[{requirement:'Signed final waiver packet',reference:'Reviewed signed waivers WP-228 originals in company custody'}]}
  assert.equal((await act('/retainage/release',{...finalRelease,waiver_references:[]})).status,409,'BILL-003 final release waits for required waiver evidence')
  assert.equal((await act('/retainage/release',finalRelease)).status,200)
  assert.equal(job.retainage_balance.cumulative_withheld_cents,21825);assert.equal(job.retainage_balance.cumulative_released_cents,21825);assert.equal(job.retainage_balance.held_cents,0);assert.equal(job.retainage_balance.cumulative_net_cents,320000)
  r=await act(`/subcontracts/${subId}/draws`,{through_date:'2026-11-20',amount_cents:120000,final:true});assert.equal(r.status,200);const supplierFinal=r.value.record.id
  assert.equal(job.subcontracts[0].retainage_balance.withheld_cents,15000);assert.equal(job.subcontracts[0].retainage_balance.held_cents,12000)
  const supplierFinalRelease={draw_id:supplierFinal,milestone_id:'final',lines:[{draw_id:supplierFirst,amount_cents:3000},{draw_id:supplierFinal,amount_cents:9000}],completion_references:[{requirement:'Final inspection record',reference:'Subcontract final inspection SI-318'}],waiver_references:[{requirement:'Signed final waiver packet',reference:'Signed supplier final waiver packet SW-318'}]}
  assert.equal((await act(`/subcontracts/${subId}/retainage/release`,{...supplierFinalRelease,waiver_references:[]})).status,409)
  assert.equal((await act(`/subcontracts/${subId}/retainage/release`,supplierFinalRelease)).status,200)
  assert.equal(job.subcontracts[0].retainage_balance.released_cents,15000);assert.equal(job.subcontracts[0].retainage_balance.held_cents,0);assert.equal(job.subcontracts[0].retainage_balance.net_payable_cents,200000);assert.equal(job.retainage_balance.cumulative_net_cents,320000,'BILL-003 both parties reconcile independently')
  assert.deepEqual(job.retainage.plan.rules.slice(0,3),plan.rules);assert.equal(job.orders[0].amount_cents,100000)
  assert.deepEqual(job.claims.find(c=>c.id===first.id),first);assert.deepEqual(job.quotes.find(q=>q.id===quote.id).pricing,quote.pricing)
  const people=(await api('/team')).value.team,person=people.find(p=>p.email==='draw-pm@example.com')
  assert.equal((await f.json(`/api/plinth/team/${person.id}`,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'project_manager',job_ids:[job.id],po_limit_cents:200_000}})).status,200)
  assert.equal((await f.json(applicationPath+'.json',{cookie:pm})).status,200)
  assert.equal((await f.json(`/api/plinth/team/${person.id}`,{method:'PUT',cookie:f.owner,body:{expected_version:1,role:'project_manager',job_ids:[],po_limit_cents:200_000}})).status,200)
  assert.equal((await f.json(applicationPath+'.json',{cookie:pm})).status,404)
  const visible=(await api(`/jobs/${job.id}`,undefined,client)).value.job
  for(const key of ['retainage','SC-214','WP-228','source_digest','stored_orders','pricing','cost_total_cents','ML-1006'])assert.ok(!JSON.stringify(visible).includes(key),'Client projection omits office reconciliation '+key)
  const legacy=await createActiveJob(f,'Existing cumulative-only billing','legacy@example.com')
  const denied=await api(`/jobs/${legacy.id}/sov`,{expected_version:legacy.version});assert.equal(denied.status,409);assert.equal(denied.value.error,'sov_pricing_required','Unreviewed historic tax never gains invented provenance')
 } finally {await f.close()}
})

test('CARE-001 — exact client-safe handover keeps assigned punch exceptions, separate decisions and contract retainage rules', async()=>{
 const f=await createFixture()
 try {
  const client=await f.invite('handover-client@example.com','Handover client'),foreign=await f.invite('handover-foreign@example.com'),agent=await f.agent()
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{...(body===undefined?{}:{method:'POST',body}),cookie,token})
  let job=(await api('/jobs',{name:'Cedar Street kitchen handover',client_email:'handover-client@example.com',address:'143 Cedar Street, Portland, OR 97205'})).value.job
  const refresh=async()=>job=(await api(`/jobs/${job.id}`)).value.job
  const act=async(path,body={},cookie=f.owner,token)=>{const r=await api(`/jobs/${job.id}`+path,{expected_version:job.version,...body},cookie,token);await refresh();return r}
  assert.equal((await act('/quotes',{lines:[{id:'finish',description:'Kitchen finish works',cost_code:'06-100',phase:'Finish',category:'labor',quantity:'1',unit:'job',unit_cents:100000,cost_unit_cents:70000}]})).status,200)
  const rate=(await api('/pricing-rates',{jurisdiction:'Synthetic handover jurisdiction',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'Human-reviewed signed contract exemption',human_reviewed:true})).value.rate
  const pricing={basis:'sell',as_of:'2026-10-21',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['finish']}},preview=await act('/pricing/preview',pricing)
  assert.equal((await act('/pricing/apply',{...pricing,digest:preview.value.preview.digest})).status,200)
  assert.equal((await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Client signed exact kitchen scope',schedule_choice:{kind:'none',reason:'Closeout schedule recorded separately'}})).status,200)
  assert.equal((await act('/sov',{})).status,200)
  assert.equal((await act('/retainage',{contract_reference:'Signed kitchen retainage rule',rules:[{line_id:'quote:finish',work_bps:1000,stored_bps:0}],milestones:[{id:'final',name:'Final release',final:true,completion_requirements:['Completion certificate'],waiver_requirements:['Final waiver']}]})).status,200)
  const claim=(await act('/claims',{description:'Half completed finish works',lines:[{line_id:'quote:finish',completed_cents:50000,stored_cents:0,evidence:'Reviewed partial completion',order_ids:[]}]})).value.record
  assert.equal((await act(`/claims/${claim.id}/approve`)).status,200)
  const trade=await f.invite('handover-plumber@example.com','Plumbing closeout contact')
  const vendor=(await api('/vendors',{kind:'subcontractor',name:'Synthetic handover plumbing',trades:['Plumbing'],contacts:[{id:'plumber',name:'Plumbing contact',email:'handover-plumber@example.com'}]})).value.vendor
  assert.equal((await api(`/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Plumbing',status:'qualified',evidence:'Reviewed qualification'})).status,200)
  const scope=(await act('/subcontracts',{vendor_id:vendor.id,trade:'Plumbing',scope:'Kitchen plumbing and closeout',contact_ids:['plumber'],awarded_on:'2026-10-21'})).value.record
  assert.equal((await act(`/subcontracts/${scope.id}/release`)).status,200)
  const png={name:'synthetic-plinth-1.png',mime:'image/png',base64:Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64')}
  const issue=(await act('/punch/issues',{title:'Adjust basin trim',description:'Unresolved minor trim adjustment',due_on:'2026-11-10',location:'Kitchen basin',photo:png,annotation:{x:0.3,y:0.4,note:'Trim gap'}})).value.record
  assert.equal((await act(`/punch/issues/${issue.id}/assign`,{subcontract_id:scope.id,email:'handover-plumber@example.com'})).status,200)
  const pdf=Buffer.from('%PDF-1.4\nsynthetic-plinth-1 original document\n%%EOF'),file={name:'synthetic-plinth-1.pdf',mime:'application/pdf',base64:pdf.toString('base64')}
  const kinds=['as-built','selection','manual','inspection','punch','warranty','final-cost','waiver'],documents=[]
  for(const kind of kinds){const r=await act('/handover/documents',{title:'Reviewed '+kind,kind,tags:['handover'],reference:'Exact '+kind+' original revision 1',file});assert.equal(r.status,200,JSON.stringify(r.value));documents.push(r.value.record)}
  const input={title:'Cedar Street final handover',documents:documents.map(d=>({document_id:d.id,revision_id:d.revisions[0].id}))}
  assert.equal((await act('/handover/packages',input)).status,409,'Unreleased punch exception cannot disappear from client handover')
  assert.equal((await act(`/punch/issues/${issue.id}/release`,{confirm:true})).status,200)
  assert.equal((await act('/warranties',{kind:'component',name:'Kitchen faucet',starts_on:'2026-10-21',ends_on:'2027-10-21',signed_terms_reference:'Signed warranty exact original',terms:'One year manufacturer terms'})).status,200)
  const prepared=await act('/handover/packages',input);assert.equal(prepared.status,200,JSON.stringify(prepared.value));const pkg=structuredClone(prepared.value.record)
  assert.equal(pkg.exceptions.length,1);assert.equal(pkg.exceptions[0].id,issue.id);assert.equal(pkg.warranty_references[0].snapshot.terms,'One year manufacturer terms')
  assert.equal((await api(`/jobs/${job.id}/handover`,undefined,client)).value.packages.length,0,'Draft package stays office-only')
  assert.equal((await f.request(`/api/plinth/jobs/${job.id}/handover/files/${documents[0].revisions[0].file.id}`,{cookie:client})).status,404)
  for(const credentials of [{cookie:client},{cookie:undefined,token:agent}])assert.equal((await act('/handover/packages',input,credentials.cookie,credentials.token)).status,403)
  assert.equal((await act(`/handover/packages/${pkg.id}/complete`,{digest:pkg.digest,confirm:true,statement:'Builder complete with basin trim exception',client_safe:false})).status,400)
  assert.equal((await act(`/handover/packages/${pkg.id}/complete`,{digest:pkg.digest,confirm:true,statement:'Builder complete with basin trim exception',client_safe:true})).status,200)
  assert.equal((await act(`/handover/packages/${pkg.id}/accept`,{digest:pkg.digest,confirm:true,statement:'Owner cannot accept for client',exception_ids:[issue.id]})).status,403)
  assert.equal((await act(`/handover/packages/${pkg.id}/accept`,{digest:pkg.digest,confirm:true,statement:'Client accepts listed exception',exception_ids:[]},client)).status,409)
  assert.equal((await act(`/handover/packages/${pkg.id}/accept`,{digest:'stale',confirm:true,statement:'Client accepts listed exception',exception_ids:[issue.id]},client)).status,409)
  assert.equal((await act(`/handover/packages/${pkg.id}/accept`,{digest:pkg.digest,confirm:true,statement:'Client accepts with basin trim still assigned',exception_ids:[issue.id]},client)).status,200)
  assert.equal(job.punch.issues[0].status,'open');assert.equal(job.punch.issues[0].assignment.subcontract_id,scope.id);assert.equal(job.retainage.releases.length,0)
  const accepted=structuredClone(job.handover.packages[0]);assert.notEqual(accepted.completion.by.id,accepted.acceptance.by.id)
  const release={claim_id:claim.id,milestone_id:'final',lines:[{line_id:'quote:finish',amount_cents:5000}],completion_references:[{requirement:'Completion certificate',reference:pkg.id}],waiver_references:[{requirement:'Final waiver',reference:'Reviewed final waiver'}]}
  assert.equal((await act('/retainage/release',release)).status,409,'Client acceptance never bypasses the earned-value final release rule')
  assert.equal((await act('/handover/documents/'+documents[0].id,{reference:'Later as-built revision 2',file:{...file,base64:Buffer.from('%PDF-1.4\nsynthetic-plinth-2\n%%EOF').toString('base64')}})).status,200)
  assert.deepEqual(job.handover.packages[0],accepted,'Later document upload preserves accepted package revisions and decisions')
  const visible=(await api(`/jobs/${job.id}/handover?q=original`,undefined,client)).value
  assert.equal(visible.packages.length,1);assert.deepEqual(visible.documents,[]);assert.equal(visible.packages[0].documents[0].source.revision,1)
  for(const document of visible.packages[0].documents){const r=await f.request(`/api/plinth/jobs/${job.id}/handover/files/${document.source.file.id}`,{cookie:client});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),pdf)}
  assert.equal((await api(`/jobs/${job.id}/handover`,undefined,foreign)).status,404)
  assert.equal((await api(`/jobs/${job.id}/handover`,undefined,trade)).status,404)
  const final=(await act('/claims',{description:'Final human-reviewed earned completion',lines:[{line_id:'quote:finish',completed_cents:100000,stored_cents:0,evidence:'Signed final completion certificate',order_ids:[]}]})).value.record
  assert.equal((await act(`/claims/${final.id}/approve`)).status,200)
  assert.equal((await act('/retainage/release',{...release,claim_id:final.id,lines:[{line_id:'quote:finish',amount_cents:10000}],waiver_references:[]})).status,409)
  assert.equal((await act('/retainage/release',{...release,claim_id:final.id,lines:[{line_id:'quote:finish',amount_cents:10000}]})).status,200)
  assert.equal(job.retainage_balance.held_cents,0);assert.deepEqual(job.handover.packages[0],accepted)
 } finally {await f.close()}
})
