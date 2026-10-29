import assert from 'node:assert/strict'
import {historicalBytes,historicalSource} from '../fixtures/import-history.mjs'
export async function proveHistoricalCustody(f,csv){
 const path='/api/plinth/imports',history=historicalSource('HISTORY-001'),upload=csv.replaceAll('MOVE-','HISTORY-')
 const call=(suffix,body)=>f.json(path+suffix,{cookie:f.owner,...(body?{method:'POST',body}:{})})
 const before=(await f.json('/api/plinth/jobs',{cookie:f.owner})).value.jobs,mail=f.messages.length
 const preview=await call('/preview',{csv:upload,history})
 assert.equal(preview.status,200,JSON.stringify(preview.value))
 assert.deepEqual(preview.value.coverage.historyCounts,{historical:6,duplicate:1,unsupported:1,supplied:1,missing:1})
 assert.equal(preview.value.coverage.fileCounts.proposed,1)
 const records=preview.value.coverage.rows[0].history.records
 assert.equal(records[0].kind,'signed-change');assert.equal(records[0].verified,false)
 assert.equal(records[0].pointer,'/jobs/0/records/0')
 const changed=history.replaceAll('Old signed window change','Changed source claim')
 assert.equal((await call('/commit',{csv:upload,history:changed,fingerprint:preview.value.fingerprint})).status,409)
 const bad=JSON.parse(history);bad.jobs[0].records[0].nativeApproval=true
 assert.equal((await call('/commit',{csv:upload,history:JSON.stringify(bad),fingerprint:preview.value.fingerprint})).status,400)
 assert.deepEqual((await f.json('/api/plinth/jobs',{cookie:f.owner})).value.jobs,before)
 let result=await call('/commit',{csv:upload,history,fingerprint:preview.value.fingerprint})
 assert.equal(result.status,200,JSON.stringify(result.value));const journal=result.value.job
 result=await call('/'+journal.id+'/coverage');assert.equal(result.status,200)
 assert.deepEqual(result.value.coverage.historyCounts,preview.value.coverage.historyCounts)
 assert.equal(result.value.coverage.fileCounts.imported,1)
 const originals=(await call('/'+journal.id+'/originals')).value.originals
 assert.deepEqual(Buffer.from(originals.find(file=>file.name==='source-history.json').original.base64,'base64'),Buffer.from(history))
 assert.deepEqual(Buffer.from(originals.find(file=>file.name==='history-file-0-0').original.base64,'base64'),historicalBytes)
 const jobs=(await f.json('/api/plinth/jobs',{cookie:f.owner})).value.jobs
 let job=jobs.find(job=>job.import_evidence?.external_id==='HISTORY-001')
 assert.equal(job.status,'quoting');assert.equal(job.approvals.length,0);assert.equal(job.variations.length,0)
 assert.equal(job.claims.length,0);assert.equal(job.invoices?.length??0,0);assert.equal(job.schedules.length,0)
 assert.equal((await call('/commit',{csv:upload,history,fingerprint:preview.value.fingerprint})).value.job.id,journal.id)
 assert.equal((await call('/preview',{csv:upload,history})).value.coverage.counts.duplicate,2)
 const edited=await f.json('/api/plinth/jobs/'+job.id+'/quotes',{method:'POST',cookie:f.owner,body:{expected_version:job.version,lines:[{description:'Explicit native review of continuing scope',quantity:1,unit_cents:125000}]}})
 assert.equal(edited.status,200);job=edited.value.job
 assert.equal((await call('/'+journal.id+'/coverage')).value.coverage.fileCounts.conflict,1)
 assert.equal((await call('/commit',{csv:upload,history,fingerprint:preview.value.fingerprint})).status,200)
 assert.deepEqual((await f.json('/api/plinth/jobs/'+job.id,{cookie:f.owner})).value.job,job,'Source replay preserves native review')
 const held=await f.json('/api/plinth/holds',{method:'POST',cookie:f.owner,body:{subject_kind:'job',subject_id:job.id,kind:'legal_hold',reason:'Preserve reviewed source originals',confirm:true}})
 assert.equal(held.status,201)
 assert.equal((await f.json('/api/plinth/jobs/'+job.id,{method:'DELETE',cookie:f.owner,body:{expected_version:job.version}})).status,409)
 assert.ok((await call('/'+journal.id+'/originals')).value.originals.every(file=>file.original.status!=='unavailable'))
 const peer=jobs.find(row=>row.import_evidence?.external_id==='HISTORY-002')
 const heldOriginals=(await call('/'+journal.id+'/originals')).value
 assert.equal((await f.json('/api/plinth/jobs/'+peer.id,{method:'DELETE',cookie:f.owner,body:{expected_version:peer.version}})).status,409,'A peer erasure cannot withdraw a held source')
 assert.deepEqual((await call('/'+journal.id+'/originals')).value,heldOriginals,'Refused erasure preserves every original byte')
 assert.deepEqual((await f.json('/api/plinth/jobs/'+peer.id,{cookie:f.owner})).value.job,peer,'Refused erasure preserves the peer')
 assert.equal((await f.json('/api/plinth/holds/'+held.value.hold.id+'/release',{method:'POST',cookie:f.owner,body:{reason:'Owner reviewed source retention and release'}})).status,200)
 const peerErased=await f.json('/api/plinth/jobs/'+peer.id,{method:'DELETE',cookie:f.owner,body:{expected_version:peer.version}})
 assert.equal(peerErased.status,200,JSON.stringify(peerErased.value))
 const survivingOriginals=(await call('/'+journal.id+'/originals')).value.originals
 assert.deepEqual(Buffer.from(survivingOriginals.find(file=>file.name==='history-file-0-0').original.base64,'base64'),historicalBytes,'Erasing a peer preserves the surviving job original')
 assert.deepEqual(Buffer.from(survivingOriginals.find(file=>file.name==='source-history.json').original.base64,'base64'),Buffer.from(history),'Sidecars without erased content remain intact')
 const erase=await f.json('/api/plinth/jobs/'+job.id,{method:'DELETE',cookie:f.owner,body:{expected_version:job.version}})
 assert.equal(erase.status,200,JSON.stringify(erase.value))
 result=await call('/'+journal.id+'/coverage')
 assert.equal(result.value.coverage.counts.erased,2)
 assert.ok(!JSON.stringify(result.value.coverage).includes('Old signed window change'))
 assert.ok(!JSON.stringify(result.value.coverage).includes('synthetic-plinth-signed-change.txt'))
 assert.ok((await call('/'+journal.id+'/originals')).value.originals.every(file=>file.original.status==='unavailable'),'Erasure withdraws sidecar and every original in the source package')
 assert.equal((await call('/commit',{csv:upload,history,fingerprint:preview.value.fingerprint})).status,200)
 assert.ok(!(await f.json('/api/plinth/jobs',{cookie:f.owner})).value.jobs.some(row=>row.id===job.id))
 assert.equal((await call('/'+journal.id+'/undo',{})).status,200)
 assert.equal(f.messages.length,mail,'Historical financial and signature evidence never invokes a provider')
}
