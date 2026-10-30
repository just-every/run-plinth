import assert from 'node:assert/strict'
import {openingInput} from '../fixtures/workbook-opening.mjs'
export async function openingJob(f){
 const api=(path,body,cookie=f.owner)=>f.json('/api/plinth'+path,{cookie,...(body===undefined?{}:{method:'POST',body})})
 let r=await api('/jobs',{name:'Synthetic opening source job',client_email:['opening-client','dev.localhost'].join('@')});assert.equal(r.status,201);let job=r.value.job
 const act=async(path,body={})=>{const r=await api('/jobs/'+job.id+path,{expected_version:job.version,...body});assert.equal(r.status,200,JSON.stringify(r.value));if(r.value.job)job=r.value.job;else if(r.value.version)job={...job,version:r.value.version};return r.value}
 await act('/quotes',{lines:[{id:'frame',description:'Framing source',cost_code:'06-100',phase:'Framing',category:'material',quantity:'1',unit:'lot',cost_unit_cents:100000,unit_cents:200000},{id:'labor',description:'Labor source',cost_code:'01-100',phase:'Framing',category:'labor',quantity:'1',unit:'lot',cost_unit_cents:50000,unit_cents:100000}]})
 r=await api('/pricing-rates',{jurisdiction:'Synthetic opening jurisdiction',kind:'sales',percent:'10',effective_on:'2026-01-01',reference:'Synthetic supplied tax schedule',human_reviewed:true});assert.equal(r.status,201)
 const pricing={basis:'sell',as_of:'2026-10-01',rules:[],tax:{rate_id:r.value.rate.id,taxable_line_ids:['frame','labor']}}
 r=await act('/pricing/preview',pricing);await act('/pricing/apply',{...pricing,digest:r.preview.digest})
 await act('/quotes/'+job.quotes.at(-1).id+'/accept',{method:'signed',evidence:'Owner reviewed exact historical signed scope',schedule_choice:{kind:'none',reason:'Separate schedule review'}})
 await act('/sov',{})
 await act('/retainage',{contract_reference:'Reviewed source agreement retainage',rules:job.sov.at(-1).lines.map(l=>({line_id:l.id,work_bps:500,stored_bps:500})),milestones:[{id:'complete',name:'Final completion',final:true,completion_requirements:['Owner reviewed completion evidence'],waiver_requirements:[]}]})
 return {api,act,get job(){return job}}
}
export async function proveOpeningImport(f){
 const c=await openingJob(f),input=await openingInput(c.job),root='/api/plinth/jobs/'+c.job.id,door='/api/plinth/imports/workbook',call=(action,body,cookie=f.owner)=>f.json(door+action,{method:'POST',cookie,body}),read=()=>f.json(root,{cookie:f.owner})
 const baseline=structuredClone({quotes:c.job.quotes,budgets:c.job.budgets,sov:c.job.sov,retainage:c.job.retainage})
 for(const broken of [await openingInput(c.job,{missingCache:true}),await openingInput(c.job,{mismatch:true}),{...input,ledger_reviewed:false},{...input,mapping:{...input.mapping,excluded_rows:{}}}]){const preview=await call('/preview',broken);assert.equal(preview.status,200,JSON.stringify(preview.value));assert.equal(preview.value.canAdopt,false);assert.equal((await call('/commit',{...broken,reviewed_at:preview.value.reviewed_at,fingerprint:preview.value.fingerprint})).status,409);assert.equal((await read()).value.job.version,c.job.version)}
 const preview=await call('/preview',input);assert.equal(preview.status,200,JSON.stringify(preview.value));assert.equal(preview.value.canAdopt,true);assert.equal(preview.value.draft.source_totals.actual_cents,28500);assert.equal(preview.value.draft.target_totals.actual_cents,28000);assert.equal(preview.value.draft.ledger_totals.actual_cents,28000)
 const approved={...input,reviewed_at:preview.value.reviewed_at,fingerprint:preview.value.fingerprint}
 assert.equal((await call('/commit',{...approved,ledger:{...input.ledger,base64:Buffer.from(Buffer.from(input.ledger.base64,'base64').toString().replace('20000','20001')).toString('base64')}})).status,409)
 const committed=await call('/commit',approved);assert.equal(committed.status,200,JSON.stringify(committed.value));assert.equal(committed.value.job.state,'completed')
 let job=(await read()).value.job;assert.deepEqual({quotes:job.quotes,budgets:job.budgets,sov:job.sov,retainage:job.retainage},baseline);assert.equal(job.claims.length,1);const historical=job.claims[0];assert.equal(historical.cumulative_cents,55000);assert.equal(historical.sov.retainage.held_cents,2750)
 let ledger=await f.json(root+'/costs',{cookie:f.owner});assert.equal(ledger.status,200);assert.equal(ledger.value.totals.posted_actual_cents,28000);assert.equal(ledger.value.totals.recorded_supplier_payment_cents,20000);assert.equal(ledger.value.totals.supplier_retained_cents,1000);assert.equal(ledger.value.totals.payable_cents,7000);assert.equal(ledger.value.totals.client_billed_cents,55000);assert.equal(ledger.value.totals.client_collected_cents,33000)
 const originals=await f.json('/api/plinth/imports/'+committed.value.job.id+'/originals',{cookie:f.owner});assert.equal(originals.status,200);assert.equal(originals.value.originals.length,2);assert.ok(originals.value.originals.some(o=>o.original.base64===input.base64));assert.ok(originals.value.originals.some(o=>o.original.base64===input.ledger.base64))
 assert.equal((await call('/commit',approved)).status,200);assert.equal((await read()).value.job.claims.length,1)
 const post=async(path,body)=>{const current=(await read()).value.job;return f.json(root+path,{method:'POST',cookie:f.owner,body:{expected_version:current.version,...body}})}
 const invoice={kind:'milestone',source_application_id:historical.id,description:'Cannot charge imported history again',due_on:'2026-11-01',terms:'Reviewed source agreement',recipient_email:c.job.client_email}
 assert.equal((await post('/invoices',invoice)).status,409);assert.equal((await post('/invoices',{...invoice,kind:'deposit',source_application_id:undefined,amount_cents:330000})).status,409)
 const next=await post('/claims',{description:'Next native progress after opening',lines:[{line_id:'quote:frame',completed_cents:66000,stored_cents:0,evidence:'Reviewed new work'},{line_id:'quote:labor',completed_cents:16500,stored_cents:0,evidence:'Reviewed new labor'}]});assert.equal(next.status,200,JSON.stringify(next.value));assert.equal(next.value.record.sov.previous_cents,55000);assert.equal(next.value.record.sov.current_cents,27500)
 assert.equal((await post('/claims/'+next.value.record.id+'/approve',{})).status,200)
 const issued=await post('/claims/'+next.value.record.id+'/issue',{});assert.equal(issued.status,200,JSON.stringify(issued.value))
 const invoiceDraft=await post('/invoices',{...invoice,source_application_id:next.value.record.id,description:'New work after imported historical billing'});assert.equal(invoiceDraft.status,200,JSON.stringify(invoiceDraft.value));const invoiceIssue=await post('/invoices/'+invoiceDraft.value.record.id+'/issue',{});assert.equal(invoiceIssue.status,200,JSON.stringify(invoiceIssue.value))
 const after=(await read()).value.job,native=after.invoices.at(-1);assert.equal(native.issued.gross_cents,27500);assert.equal(native.issued.tax_cents,2500);assert.equal(native.issued.withheld_cents,1375);assert.equal(native.issued.payable_cents,26125)
 ledger=await f.json(root+'/costs',{cookie:f.owner});assert.equal(ledger.value.totals.posted_actual_cents,28000);assert.equal(ledger.value.totals.client_billed_cents,82500);assert.equal(ledger.value.totals.client_collected_cents,33000)
 const client=await f.invite(c.job.client_email);assert.equal((await f.request(root+'/costs',{cookie:client})).status,403);assert.equal((await call('/preview',input,client)).status,403)
 const undo=await f.json('/api/plinth/imports/'+committed.value.job.id+'/undo',{method:'POST',cookie:f.owner,body:{}});assert.equal(undo.status,200,JSON.stringify(undo.value));assert.ok(undo.value.report.dispositions.some(d=>d.disposition==='retained'));assert.equal((await read()).value.job.invoices.length,after.invoices.length)
 assert.deepEqual({quotes:after.quotes,budgets:after.budgets,sov:after.sov,retainage:after.retainage},baseline)
 const erased=await f.json(root,{method:'DELETE',cookie:f.owner,body:{expected_version:after.version}});assert.equal(erased.status,200,JSON.stringify(erased.value));const withdrawn=await f.json('/api/plinth/imports/'+committed.value.job.id+'/originals',{cookie:f.owner});assert.equal(withdrawn.status,200,JSON.stringify(withdrawn.value));assert.ok(withdrawn.value.originals.every(o=>o.original.status==='unavailable'),'Erasure withdraws both the source workbook and the separately retained ledger')
 assert.equal((await call('/commit',approved)).status,404);assert.equal((await read()).status,404)
 return {job:after,input,approved,journal:committed.value.job.id}
}
