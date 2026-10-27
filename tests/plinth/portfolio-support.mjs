import assert from 'node:assert/strict'
import {costFixture} from './cost-support.mjs'
export async function portfolioFixture(f) {
 const api=(path,body)=>f.json('/api/plinth'+path,{cookie:f.owner,...(body===undefined?{}:{method:'POST',body})})
 const fixtures=[]
 for(let i=0;i<3;i++){
  const c=await costFixture(f)
  const source=await c.ok('/costs/sources',{kind:'time',reference:'synthetic-plinth-portfolio-'+i,dated_on:'2026-10-24',period:'2026-10',cost_code:'01-100',minutes:60*(i+1),hour_cents:2000,burden_bps:1000,employee_reference:'synthetic-plinth-worker-'+i})
  await c.ok(`/costs/sources/${source.record.id}/approve`)
  fixtures.push(c)
 }
 const capture=async name=>{const r=await api('/reports/snapshots',{name});assert.equal(r.status,201,JSON.stringify(r.value));return r.value.snapshot}
 const earlier=await capture('Before earned billing and schedule changes')
 for(const [i,c] of fixtures.entries()){
  const day=String(2+i*5).padStart(2,'0'),late=String(3+i*5).padStart(2,'0')
  await c.ok('/schedules',{trade:i===2?'Plumbing':'Framing',description:'Portfolio scheduled work',start:`2026-11-${day}T08:00:00Z`,end:`2026-11-${day}T17:00:00Z`})
  await c.ok('/schedule-baseline',{name:'Original promise',reason:'Reviewed original schedule'})
  await c.ok(`/schedules/${c.job.schedules[0].id}/move`,{start:`2026-11-${late}T08:00:00Z`,end:`2026-11-${late}T17:00:00Z`,reason:'Reviewed supplier delay'})
  const choice=await c.ok('/selections',{room:'Kitchen',category:'Framing detail',allowance_cents:1000,cost_code:'01-100',decision_on:'2026-11-24',lead_days:1,options:[{name:'Reviewed framing finish',specifications:'Synthetic option',supplier:'Synthetic framing trade',price_cents:1000}]})
  await c.ok(`/selections/${choice.record.id}/present`,{revision_id:choice.record.revisions[0].id})
  await c.ok('/sov',{})
  const claim=await c.ok('/claims',{description:'Earned framing draw',lines:[{line_id:'quote:framing',completed_cents:20000*(i+1),stored_cents:0,evidence:'Installed framing'},{line_id:'quote:labor',completed_cents:10000*(i+1),stored_cents:0,evidence:'Performed labor'}]})
  await c.ok(`/claims/${claim.record.id}/approve`);await c.ok(`/claims/${claim.record.id}/issue`)
  const invoice=await c.ok('/invoices',{kind:'milestone',source_application_id:claim.record.id,description:'Earned framing invoice',recipient_email:c.job.client_email,due_on:'2026-11-24',terms:'Reviewed USD terms'})
  await c.ok(`/invoices/${invoice.record.id}/issue`)
  await c.ok(`/invoices/${invoice.record.id}/receipt`,{amount_cents:15000*(i+1),method:'bank',received_on:'2026-10-25',reference:'synthetic-plinth-collection-'+i,confirm:true})
  await c.ok('/costs/forecasts',{as_of:'2026-10-27',source_as_of:'Synthetic reviewed current source',codes:[{cost_code:'01-100',remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:2000,outstanding_commitment_cents:0,unbought_cents:1000,risk_cents:0,reference:'synthetic-plinth-labor'},{cost_code:'06-100',remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:0,outstanding_commitment_cents:100000,unbought_cents:0,risk_cents:0,reference:'synthetic-plinth-materials'}]})
 }
 return {api,fixtures,capture,earlier}
}
