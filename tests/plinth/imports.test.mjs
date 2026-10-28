import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { workbookInput, estimateWorkbook } from '../fixtures/workbook-estimate.mjs'
import { createFixture } from './helpers.mjs'

const csv = await readFile(new URL('../fixtures/import-accepted-jobs.csv', import.meta.url), 'utf8')
const invalid = await readFile(new URL('../fixtures/import-invalid-jobs.csv', import.meta.url), 'utf8')
const prefix = '/api/plinth/imports'

test('Reviewed CSV move-in, native adoption, reversible custody and erasure through HTTP', async t => {
  const f = await createFixture()
  const call = (suffix, body, method = 'POST') => f.json(prefix + suffix, { method, cookie: f.owner, ...(body === undefined ? {} : { body }) })
  const nativeJobs = async () => (await f.json('/api/plinth/jobs', { cookie: f.owner })).value.jobs
  const review = async value => { const r = await call('/preview', { csv: value }); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value }
  const commit = async (value, preview) => { const r = await call('/commit', { csv: value, fingerprint: preview.fingerprint }); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value.job }
  try {
    let preview, journal, edited
    await t.test('only a person owner can review; malformed rows and changed approval leave native jobs untouched', async () => {
      assert.equal((await f.request(prefix)).status, 401)
      const client = await f.invite('unrelated@example.test')
      assert.equal((await f.request(prefix + '/preview', { method: 'POST', cookie: client, body: { csv } })).status, 403)
      const agent = await f.agent()
      assert.equal((await f.request(prefix + '/commit', { method: 'POST', token: agent, body: { csv, fingerprint: '0'.repeat(64) } })).status, 403)
      assert.equal((await f.request(prefix + '/preview', { method: 'POST', cookie: f.owner, headers: { origin: 'https://other.example' }, body: { csv } })).status, 403)
      assert.equal((await call('/preview', { csv: invalid })).status, 400)
      assert.equal((await call('/preview', { csv: csv.replace('2026-09-12', '2026-02-30') })).status, 400)
      preview = await review(csv)
      assert.equal(preview.rows.length, 2)
      assert.equal((await nativeJobs()).length, 0)
      assert.equal((await call('', undefined, 'GET')).value.jobs.length, 0)
      assert.equal((await call('/commit', { csv: csv.replace('Northside extension', 'Changed title'), fingerprint: preview.fingerprint })).status, 409)
      assert.equal((await nativeJobs()).length, 0)
    })
    await t.test('approved upload retains exact original, imports inert quotes and replays without duplicates', async () => {
      journal = await commit(csv, preview)
      assert.equal(journal.state, 'completed')
      const jobs = await nativeJobs()
      assert.equal(jobs.length, 2)
      for (const job of jobs) {
        assert.equal(job.status, 'quoting')
        assert.equal(job.quotes[0].status, 'draft')
        assert.equal(job.import_evidence.acceptance_verified, false)
        assert.equal(job.approvals.length, 0)
      }
      edited = jobs.find(job => job.import_evidence.external_id === 'MOVE-001')
      const blocked = await f.json(`/api/plinth/jobs/${edited.id}/schedules`, { method: 'POST', cookie: f.owner, body: { expected_version: edited.version, trade: 'Electrician', start: '2026-11-01T08:00:00Z', end: '2026-11-01T09:00:00Z', description: 'Cannot book an unaccepted source quote' } })
      assert.equal(blocked.status, 409)
      assert.equal((await commit(csv, preview)).id, journal.id)
      assert.equal((await nativeJobs()).length, 2)
      const originals = await call(`/${journal.id}/originals`, undefined, 'GET')
      assert.equal(originals.status, 200)
      assert.equal(Buffer.from(originals.value.originals[0].original.base64, 'base64').toString('utf8'), csv)
    })
    await t.test('undo preserves a quote explicitly accepted in the native job and removes unchanged imported peers', async () => {
      const accepted = await f.json(`/api/plinth/jobs/${edited.id}/quotes/${edited.quotes[0].id}/accept`, { method: 'POST', cookie: f.owner, body: { expected_version: edited.version, method: 'email',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'}, evidence: 'Owner reviewed the original client acceptance email before adoption.' } })
      assert.equal(accepted.status, 200)
      edited = accepted.value.job
      const undo = await call(`/${journal.id}/undo`)
      assert.equal(undo.status, 200, JSON.stringify(undo.value))
      assert.equal(undo.value.job.state, 'undone')
      assert.equal(undo.value.report.dispositions.filter(d => d.disposition === 'retained').length, 1)
      assert.equal(undo.value.report.dispositions.filter(d => d.disposition === 'reversed').length, 1)
      assert.deepEqual(await nativeJobs(), [edited])
      assert.equal((await call(`/${journal.id}/undo`)).status, 200)
    })
    await t.test('bounded apply resumes from its durable journal without another upload', async () => {
      const upload = 'external_id,title,client_email,site_address,quote_cents,accepted_on\n' + Array.from({ length: 12 }, (_, i) => `BATCH-${i},Batch job ${i},batch${i}@example.test,,100000,2026-10-01`).join('\n') + '\n'
      const batch = await commit(upload, await review(upload))
      assert.equal(batch.state, 'applying')
      assert.ok(batch.checkpoint > 0 && batch.checkpoint < batch.total)
      const resumed = await call(`/${batch.id}/resume`)
      assert.equal(resumed.status, 200, JSON.stringify(resumed.value))
      assert.equal(resumed.value.job.state, 'completed')
      assert.equal((await nativeJobs()).filter(job => job.import_evidence?.external_id.startsWith('BATCH-')).length, 12)
      const undone = await call(`/${batch.id}/undo`)
      assert.equal(undone.status, 200, JSON.stringify(undone.value))
      if (undone.value.job.state !== 'undone') assert.equal((await call(`/${batch.id}/resume`)).value.job.state, 'undone')
      assert.equal((await nativeJobs()).filter(job => job.import_evidence?.external_id.startsWith('BATCH-')).length, 0)
    })
    await t.test('native erasure removes source custody, withdraws shared originals and leaves peers reversible', async () => {
      const upload = csv.replaceAll('MOVE-', 'ERASE-')
      const imported = await commit(upload, await review(upload))
      const target = (await nativeJobs()).find(job => job.import_evidence?.external_id === 'ERASE-001')
      const erased = await f.json(`/api/plinth/jobs/${target.id}`, { method: 'DELETE', cookie: f.owner, body: { expected_version: target.version } })
      assert.equal(erased.status, 200, JSON.stringify(erased.value))
      assert.equal((await f.request(`/api/plinth/jobs/${target.id}`, { cookie: f.owner })).status, 404)
      const state = await call(`/${imported.id}`, undefined, 'GET')
      assert.equal(state.status, 200, JSON.stringify(state.value))
      assert.equal(state.value.job.erasedRecords, 1)
      const originals = await call(`/${imported.id}/originals`, undefined, 'GET')
      assert.equal(originals.status, 200)
      assert.equal(originals.value.originals[0].original.status, 'unavailable')
      const receipts = await call('/erasure-journal', undefined, 'GET')
      assert.equal(receipts.status, 200)
      assert.ok(receipts.value.entries.some(entry => entry.recordsErased > 0))
      assert.ok(!JSON.stringify(receipts.value).includes(target.client_email))
      assert.equal((await call(`/${imported.id}/undo`)).status, 200)
      assert.ok(!(await nativeJobs()).some(job => job.import_evidence?.external_id.startsWith('ERASE-')))
      const repeat = await call('/commit', { csv: upload, fingerprint: (await review(upload)).fingerprint })
      assert.equal(repeat.status, 200, JSON.stringify(repeat.value))
      assert.ok(!(await nativeJobs()).some(job => job.id === target.id))
    })
  } finally { await f.close() }
})


test('Owner-reviewed coded workbooks retain exact cells, reconcile cents and fence unsafe adoption through HTTP', async () => {
 const f=await createFixture(),input=await workbookInput()
 const call=(suffix,body,credentials={cookie:f.owner})=>f.json(prefix+suffix,{method:'POST',...credentials,body})
 const jobs=async()=>(await f.json('/api/plinth/jobs',{cookie:f.owner})).value.jobs
 try {
  const inspect=await call('/workbook/inspect',input);assert.equal(inspect.status,200,JSON.stringify(inspect.value));assert.deepEqual(inspect.value.sheets.map(s=>s.name),['Estimate','Notes'])
  const client=await f.invite(input.client_email),agent=await f.agent(),admin=await f.invite(['workbook-office','dev.localhost'].join('@'),'Workbook office','admin')
  for(const credentials of [{cookie:client},{cookie:admin},{token:agent},{}])assert.ok([401,403].includes((await call('/workbook/preview',input,credentials)).status))
  let rejected=await call('/workbook/preview',{...input,mapping:{...input.mapping,reviewed_formulas:false,excluded_rows:{}}})
  assert.equal(rejected.status,200,JSON.stringify(rejected.value));assert.equal(rejected.value.canAdopt,false)
  assert.ok(rejected.value.draft.diagnostics.some(d=>d.code==='formula_review'&&d.cell==='F3'))
  assert.ok(rejected.value.draft.diagnostics.some(d=>d.row===5&&d.message.includes('invalid cost code')))
  assert.equal((await call('/workbook/commit',{...input,mapping:{...input.mapping,reviewed_formulas:false,excluded_rows:{}},fingerprint:rejected.value.fingerprint})).status,409)
  for(const options of [{missingCache:true},{unsupported:true},{macro:true}]){
   const broken={...input,...await estimateWorkbook(options)},review=await call('/workbook/preview',broken)
   assert.equal(review.status,200,JSON.stringify(review.value));assert.equal(review.value.canAdopt,false)
   assert.equal((await call('/workbook/commit',{...broken,fingerprint:review.value.fingerprint})).status,409)
  }
  assert.deepEqual(await jobs(),[])
  const review=await call('/workbook/preview',input);assert.equal(review.status,200,JSON.stringify(review.value));assert.equal(review.value.canAdopt,true)
  assert.equal(review.value.draft.source_totals.total_cents,1422);assert.equal(review.value.draft.source_totals.cost_total_cents,947);assert.deepEqual(review.value.draft.source_totals.rows.map(r=>r.disposition),['included','included','duplicate','excluded']);assert.equal(review.value.draft.total_cents,669);assert.equal(review.value.draft.cost_total_cents,449)
  assert.equal(review.value.draft.provenance[1].cells.quantity.address,'F3');assert.equal(review.value.draft.provenance[1].cells.quantity.formula,'5/4')
  assert.equal((await call('/workbook/commit',{...input,mapping:{...input.mapping,currency:'AUD'},fingerprint:review.value.fingerprint})).status,409)
  const adopted=await call('/workbook/commit',{...input,fingerprint:review.value.fingerprint});assert.equal(adopted.status,200,JSON.stringify(adopted.value));assert.equal(adopted.value.job.state,'completed')
  const imported=(await jobs())[0],quote=imported.quotes[0]
  for(const cookie of [client,admin]){assert.equal((await f.request('/api/plinth/jobs/'+imported.id,{cookie})).status,404);assert.deepEqual((await f.json('/api/plinth/jobs',{cookie})).value.jobs,[])}
  assert.equal(imported.status,'quoting');assert.equal(quote.status,'draft');assert.equal(quote.lines.length,2);assert.equal(quote.lines[1].quantity,'1.25');assert.deepEqual(imported.approvals,[])
  assert.equal((await call('/workbook/commit',{...input,fingerprint:review.value.fingerprint})).value.job.id,adopted.value.job.id);assert.equal((await jobs()).length,1)
  const changed={...input,title:'Different title'},changedPreview=await call('/workbook/preview',changed)
  assert.equal((await call('/workbook/commit',{...changed,fingerprint:changedPreview.value.fingerprint})).status,409)
  const originals=await f.json(`${prefix}/${adopted.value.job.id}/originals`,{cookie:f.owner});assert.equal(originals.status,200);assert.equal(originals.value.originals[0].original.base64,input.base64)
  const report=await f.json(`/api/plinth/jobs/${imported.id}/quotes/${quote.id}/cost-codes.json`,{cookie:f.owner});assert.equal(report.status,200);assert.equal(report.value.total_cents,669);assert.equal(report.value.cost_total_cents,449)
  assert.equal((await f.request(`/api/plinth/jobs/${imported.id}/quotes/${quote.id}/cost-codes.csv`,{cookie:f.owner})).status,200)
  const accepted=await f.json(`/api/plinth/jobs/${imported.id}/quotes/${quote.id}/accept`,{method:'POST',cookie:f.owner,body:{expected_version:imported.version,method:'email',evidence:'Reviewed synthetic source agreement',schedule_choice:{kind:'none',reason:'Separate planning'}}});assert.equal(accepted.status,200)
  const clientView=await f.json(`/api/plinth/jobs/${imported.id}`,{cookie:client});assert.equal(clientView.status,200);assert.equal(clientView.value.job.import_evidence,undefined);assert.equal(clientView.value.job.quotes[0].lines[0].cost_unit_cents,undefined)
  assert.equal((await call('/workbook/commit',{...input,fingerprint:review.value.fingerprint})).status,200)
  const unchanged=(await jobs())[0];assert.deepEqual(unchanged.quotes,accepted.value.job.quotes);assert.deepEqual(unchanged.budgets,accepted.value.job.budgets)
  const erased=await f.json(`/api/plinth/jobs/${imported.id}`,{method:'DELETE',cookie:f.owner,body:{expected_version:unchanged.version}});assert.equal(erased.status,200)
  const custody=await f.json(`${prefix}/${adopted.value.job.id}/originals`,{cookie:f.owner});assert.equal(custody.value.originals[0].original.status,'unavailable')
  await call('/workbook/commit',{...input,fingerprint:review.value.fingerprint});assert.equal((await jobs()).length,0)
 }finally{await f.close()}
})
