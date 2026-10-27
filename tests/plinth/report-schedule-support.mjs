import assert from 'node:assert/strict'
import {costFixture} from './cost-support.mjs'
export async function packetFixture(f){
 const c=await costFixture(f)
 await c.ok('/sov',{})
 let r=await c.ok('/claims',{description:'Synthetic reviewed framing draw',lines:c.job.sov.at(-1).lines.map(l=>({line_id:l.id,completed_cents:l.id.includes('framing')?100000:50000,stored_cents:0,evidence:'synthetic-plinth-progress-1'}))})
 const claim=r.record.id
 await c.ok('/claims/'+claim+'/approve');await c.ok('/claims/'+claim+'/issue')
 r=await c.ok('/invoices',{kind:'milestone',description:'Synthetic framing invoice',source_application_id:claim,due_on:'2026-11-30',terms:'Net 30',recipient_email:'synthetic-plinth-client@example.com'})
 await c.ok('/invoices/'+r.record.id+'/issue')
 const photo='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
 await c.ok('/diary',{date:'2026-10-27',note:'Published progress',attachments:[{name:'synthetic-plinth-progress.png',base64:photo}]})
 const inspection=Buffer.from('%PDF-1.4\nsynthetic-plinth-inspection-1\n%%EOF\n')
 r=await c.ok('/schedule-constraints',{kind:'inspection',title:'Framing inspection',jurisdiction:'VT',accountable:'Synthetic inspector',task_ids:[],reason:'Review requested',documents:[]})
 await c.ok('/schedule-constraints/'+r.record.id,{action:'cleared',reason:'Recorded inspection passed',documents:[{name:'synthetic-plinth-inspection.pdf',base64:inspection.toString('base64')}]})
 r=await c.api('/vendors',{kind:'subcontractor',name:'Synthetic framing company',trades:['Framing'],contacts:[]});assert.equal(r.status,201);const v=r.value.vendor
 assert.equal((await c.api('/vendors/'+v.id+'/qualifications',{expected_version:v.version,trade:'Framing',status:'qualified',evidence:'synthetic-plinth-qualification-1'})).status,200)
 r=await c.ok('/subcontracts',{vendor_id:v.id,trade:'Framing',scope:'Framing',contact_ids:[],awarded_on:'2026-10-27',amount_cents:100000});const sub=r.record.id
 await c.ok('/subcontracts/'+sub+'/release');await c.ok('/subcontracts/'+sub+'/lien',{state:'VT'})
 r=await f.json('/api/plinth/lien-waiver-templates',{cookie:f.owner,method:'PUT',body:{expected_version:0,templates:[{state:'VT',form:'conditional_progress',name:'Synthetic owner-provided wording',wording:'synthetic-plinth-waiver-wording-1'}]}});assert.equal(r.status,200)
 r=await c.ok('/subcontracts/'+sub+'/draws',{through_date:'2026-10-27',amount_cents:50000});const draw=r.record.id
 r=await c.ok('/subcontracts/'+sub+'/draws/'+draw+'/waivers',{party_id:v.id,kind:'conditional'});const waiver=r.record.id
 const release=Buffer.from('%PDF-1.4\nsynthetic-plinth-signed-waiver-1\n%%EOF\n')
 await c.ok('/subcontracts/'+sub+'/draws/'+draw+'/waivers/'+waiver+'/release',{amount_cents:50000,through_date:'2026-10-27',signer_name:'Synthetic contractor',document:{name:'synthetic-plinth-waiver.pdf',base64:release.toString('base64')}})
 await c.ok('/subcontracts/'+sub+'/draws/'+draw+'/waivers/'+waiver+'/accept',{amount_cents:50000,through_date:'2026-10-27'})
 await c.ok('/costs/sources',{kind:'time',reference:'synthetic-plinth-private-pay-rate',dated_on:'2026-10-27',period:'2026-10',cost_code:'01-100',minutes:60,hour_cents:98765,burden_bps:1000,employee_reference:'synthetic-plinth-private-worker'})
 const bid=await c.act('/bids',{title:'synthetic-plinth-private-bid',trade:'Framing',scope:'Private bid scope',mode:'unpriced',lines:[{cost_code:'06-100',description:'Private bid'}],note:'synthetic-plinth-private-bid-note',due_on:'2026-11-15',plans:[{name:'synthetic-plinth-private-bid.pdf',base64:Buffer.from('%PDF-1.4\nsynthetic-plinth-private-bid-1\n%%EOF').toString('base64')}]})
 assert.equal(bid.status,201,JSON.stringify(bid.value));await c.read()
 return {c,photo,inspection,release,claim}
}
