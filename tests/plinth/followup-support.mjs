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
