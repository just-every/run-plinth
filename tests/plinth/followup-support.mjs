import assert from 'node:assert/strict'
export const followupAddress=n=>'synthetic-plinth-'+n+String.fromCharCode(64)+'example.invalid'
/** Native HTTP preparation shared by the installed and Worker sanity journeys. */
export async function followupFixture(f){
 const client=await f.invite(followupAddress(1),'Synthetic follow-up client')
 const api=(path,body,cookie=f.owner)=>f.json('/api/plinth'+path,{method:body===undefined?'GET':'POST',cookie,body})
 async function create(name){
  const result=await api('/jobs',{name,client_email:followupAddress(1),address:'22 Synthetic Street'});assert.equal(result.status,201)
  const c={job:result.value.job}
  c.read=async()=>{const result=await api('/jobs/'+c.job.id);assert.equal(result.status,200);c.job=result.value.job;return c.job}
  c.act=async(path,body={},cookie=f.owner)=>{const result=await api('/jobs/'+c.job.id+path,{expected_version:c.job.version,...body},cookie);assert.equal(result.status,200,JSON.stringify(result.value));await c.read();return result.value}
  await c.act('/quotes',{lines:[{id:'synthetic-plinth-line-1',description:'Reviewed renovation',quantity:'1',unit:'job',unit_cents:100000,cost_unit_cents:50000,cost_code:'06-100',category:'material',phase:'Construction'}]})
  return c
 }
 const estimate=await create('Synthetic estimate follow-up'),active=await create('Synthetic selection and collection')
 const rate=await api('/pricing-rates',{jurisdiction:'Synthetic reviewed jurisdiction',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'synthetic-plinth-tax-1',human_reviewed:true});assert.equal(rate.status,201)
 const pricing={basis:'sell',as_of:'2026-10-27',rules:[],tax:{rate_id:rate.value.rate.id,taxable_line_ids:[],exemption_reference:'Reviewed exempt scope'}}
 const priced=await active.act('/pricing/preview',pricing);await active.act('/pricing/apply',{...pricing,digest:priced.preview.digest})
 await active.act('/quotes/'+active.job.quotes.at(-1).id+'/accept',{method:'signed',evidence:'Synthetic recorded client agreement',schedule_choice:{kind:'none',reason:'Scheduling follows permit'}})
 const choice=(await active.act('/selections',{room:'Kitchen',category:'Flooring',allowance_cents:10000,cost_code:'06-100',decision_on:'2026-10-28',lead_days:7,options:[{name:'Oak',supplier:'Synthetic supplier',specifications:'Reviewed oak boards',price_cents:10000}]})).record
 await active.act('/selections/'+choice.id+'/present',{revision_id:choice.revisions[0].id})
 const invoice=(await active.act('/invoices',{kind:'deposit',description:'Reviewed deposit',amount_cents:10000,recipient_email:followupAddress(1),due_on:'2026-10-28',terms:'Reviewed deposit terms'})).record
 await active.act('/invoices/'+invoice.id+'/issue')
 const people=(await api('/jobs/'+active.job.id+'/followup-rules')).value
 const clientId=people.recipients.find(p=>p.display_name==='Synthetic follow-up client').id,ownerId=people.owner_id
 const config={mode:'event',starts_on:'2026-10-27',stop_on:'2026-12-31',recipients:[clientId],escalation_recipient:ownerId,quiet_start:'20:00',quiet_end:'08:00',time_zone:'America/Chicago',approval_limit_cents:100000,steps:[{after_days:0,label:'First follow-up',escalate:false},{after_days:2,label:'Outstanding owner review',escalate:true}],reason:'Owner reviewed sequence',confirm:true}
 async function consent(c,kind,allowed,cookie){await c.read();return c.act('/followup-consent',{kind,allowed,confirm:true},cookie)}
 for(const [c,kinds] of [[estimate,['estimate']],[active,['selection','collection']]])for(const kind of kinds){await consent(c,kind,true,client);await consent(c,kind,true,f.owner)}
 const preview=async(c,as_of='2026-10-30T15:00:00Z')=>{const result=await api('/jobs/'+c.job.id+'/followup-rules/preview?as_of='+encodeURIComponent(as_of));assert.equal(result.status,200,JSON.stringify(result.value));return result.value}
 return {api,estimate,active,client,clientId,ownerId,config,consent,preview,choice,invoice}
}

/** Exercise the other live source doors without granting private records to external people. */
export async function followupSourceJourney(f,c){
 const {createReleasedScope}=await import('./helpers.mjs')
 const job=c.active,tradeEmail=followupAddress(710),designerEmail=followupAddress(711)
 const trade=await f.invite(tradeEmail,'Synthetic follow-up trade'),designer=await f.invite(designerEmail,'Synthetic follow-up designer')
 const setup=await createReleasedScope(f,job.job,tradeEmail,'Framing');job.job=setup.job
 const task=(await job.act('/schedules',{trade:'Framing',description:'Follow-up framing visit',start:'2026-11-04T15:00:00Z',end:'2026-11-04T16:00:00Z'})).record
 const invitation=(await job.act('/schedules/'+task.id+'/invite',{email:tradeEmail,subcontract_id:setup.scope.id})).record
 await job.act('/rfi-access',{email:designerEmail,role:'designer',sheet_ids:[]})
 const rfi=(await job.act('/rfis',{title:'Confirm framing detail',question:'Which reviewed detail applies?',assignee_email:designerEmail,due_on:'2026-10-29',task_ids:[]})).record
 const owner=(await c.api('/jobs/'+job.job.id+'/followup-rules')).value.recipients.find(p=>p.id===c.ownerId)
 const component=(await job.act('/warranties',{kind:'component',name:'Reviewed fixture',starts_on:'2026-01-01',ends_on:'2028-12-31',terms:'Original fixture terms',signed_terms_reference:'synthetic-plinth-712'})).record
 const warranty=(await job.act('/warranties',{kind:'case',component_id:component.id,defect_key:'synthetic-plinth-713',description:'Fixture adjustment outstanding',reported_on:'2026-10-27',reviewer_email:owner.email})).record
 const bidRoot='/bids/'+job.job.id
 const bidAct=async(path,body,cookie=f.owner)=>{await job.read();const r=await c.api(bidRoot+path,{expected_version:job.job.version,...body},cookie);assert.ok([200,201].includes(r.status),JSON.stringify(r.value));await job.read();return r.value}
 const bid=await bidAct('',{title:'Reviewed framing package',trade:'Framing',scope:'Price the reviewed frame',mode:'unpriced',lines:[{cost_code:'06-100',description:'Reviewed frame'}],note:'Original framing plan',due_on:'2026-10-29',plans:[{name:'synthetic-plinth-714.pdf',base64:Buffer.from('%PDF-1.4\nsynthetic-plinth-714\n%%EOF').toString('base64')}]})
 const packageId=bid.record_id,revision=job.job.bids.at(-1).revisions[0].id
 await bidAct('/'+packageId+'/publish',{revision_id:revision,confirm:true})
 await bidAct('/'+packageId+'/invite',{vendor_id:setup.vendor.id,contact_id:'scope-contact',subcontract_id:setup.scope.id,cost_codes:['06-100'],confirm:true})
 const bidSource=job.job.bids.at(-1).invitations[0]
 for(const kind of ['bid','rfi','confirmation','warranty']){
  await job.act('/followup-consent',{kind,allowed:true,channel:'email',confirm:true},f.owner)
  await job.act('/followup-rules',{...c.config,kind,recipients:[c.ownerId],delivery:true,delivery_confirm:true})
 }
 const preview=await c.preview(job,'2026-10-30T15:00:00Z')
 for(const source of [bidSource,rfi,invitation,warranty])assert.equal(preview.actions.filter(a=>a.source_id===source.id&&a.status==='eligible').length,2)
 assert.equal((await c.api('/jobs/'+job.job.id+'/followup-rules',{...c.config,kind:'bid',expected_version:job.job.version})).status,403,'Private bid reminders cannot name a client recipient')
 const notices=f.messages.filter(m=>m.subject.startsWith('Plinth follow-up:')).length
 await job.act('/followup-rules/run',{confirm:true})
 assert.equal(f.messages.filter(m=>m.subject.startsWith('Plinth follow-up:')).length,notices+4,'Each private source gets one due owner notice, with future escalation withheld')
 await bidAct('/'+packageId+'/decline',{revision_id:revision,reason:'Not pricing this package'},trade)
 const answered=await c.api('/rfi-inbox/'+job.job.id+'/rfis/'+rfi.id+'/respond',{expected_version:job.job.version,text:'Use reviewed detail A',cost_impact_cents:0,date_impact_days:0},designer);assert.equal(answered.status,200,JSON.stringify(answered.value));await job.read()
 const response=job.job.rfis.find(r=>r.id===rfi.id).responses[0]
 await job.act('/rfis/'+rfi.id+'/publish',{response_id:response.id,cost_impact_cents:0,date_impact_days:0,confirm:true})
 await job.act('/rfis/'+rfi.id+'/resolve',{reason:'Reviewed detail resolves the question'})
 await job.read()
 const confirmation=await c.api('/trade-confirmations/'+invitation.id+'/confirm',{expected_version:job.job.version,reason:'I confirm this exact visit',confirm:true},trade);assert.equal(confirmation.status,200,JSON.stringify(confirmation.value));await job.read()
 await job.act('/warranties/'+warranty.id+'/review',{decision:'covered',reason:'Reviewed fixture adjusted',source_reference:'synthetic-plinth-715'})
 await job.act('/warranties/'+warranty.id+'/close',{reason:'Builder verified fixture adjustment',evidence_reference:'synthetic-plinth-716'})
 const after=await c.preview(job,'2026-11-05T15:00:00Z')
 for(const source of [bidSource,rfi,invitation,warranty])assert.ok(after.actions.filter(a=>a.source_id===source.id).every(a=>a.reason==='Source resolved or held'),'Resolved source never escalates: '+source.id)
 await f.scheduled('2026-11-05T15:00:00Z');await job.read()
 await job.act('/followup-rules/run',{confirm:true})
 assert.equal(f.messages.filter(m=>m.subject.startsWith('Plinth follow-up:')).length,notices+4,'Resolution does not dispatch or escalate again')
 assert.equal((await c.api('/jobs/'+job.job.id+'/followup-consent',undefined,trade)).status,404)
 return {preview,after}
}
