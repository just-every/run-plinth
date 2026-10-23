import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,cp,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync,execFileSync} from 'node:child_process'
import {fileRecords} from '@runeditrun/rer/modules/portability/files'
import {createFixture} from './helpers.mjs'
import {costFixture,original} from './cost-support.mjs'

test('COST-001 / COST-002 / COST-003 / COST-004 / COST-006 / COST-005 — private CLI archive restores exact cost sources, originals, approvals, forecasts and reconciliation; erasure removes them',async()=>{
 const root=resolve('.'),folder=await mkdtemp(join(tmpdir(),'plinth-cost-archive-')),source=join(folder,'source'),destination=join(folder,'restored'),env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',RER_SERVER_JOURNEY:'1'};delete env.RER_LOCAL_OPERATION
 const rer=join(root,'node_modules/@runeditrun/rer/global/rer.mjs'),command=(cwd,verb,...args)=>{const r=spawnSync(process.execPath,[rer,verb,'--cwd',cwd,'--json','--no-queue',...args],{env,encoding:'utf8',timeout:180000});assert.equal(r.status,0,r.stderr+'\n'+r.stdout)}
 const records=async path=>{const rows=[];for await(const r of fileRecords(path))if(r.kind==='part')rows.push(...r.items);return rows}
 let f
 try{
  for(const target of [source,destination]){for(const path of ['package.json','pnpm-lock.yaml','.node-version','OPERATIONS.json','rer-setup.json','wrangler.jsonc','vite.config.ts','deploy.json','deploy-site.json','scripts','src','public','migrations','README.md','ACCEPTANCE.md','RUN-LOCALLY.md','OPERATIONS.md','SEED-COMMAND-CONTRACT.md','CONTRACT.md','seed.json'])await cp(join(root,path),join(target,path),{recursive:true});await symlink(join(root,'node_modules'),join(target,'node_modules'),'dir')}
  execFileSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','DB','--local','--persist-to',join(source,'.wrangler/state'),'--config',join(source,'wrangler.jsonc')],{env,stdio:'pipe'})
  f=await createFixture({persistTo:source});const c=await costFixture(f)
  let r=await c.ok('/costs/bills',c.bill());await c.ok(`/costs/bills/${r.record.id}/review`,{reason:'Archive reviewed original'});await c.ok(`/costs/bills/${r.record.id}/post`)
  r=await c.ok('/costs/sources',{kind:'expense',reference:'synthetic-plinth-archive-expense',employee_reference:'synthetic-plinth-employee-1',cost_code:'01-100',dated_on:'2026-10-23',period:'2026-10',amount_cents:1000,document:original});await c.ok(`/costs/sources/${r.record.id}/approve`)
  r=await c.ok('/costs/sources',{kind:'time',reference:'synthetic-plinth-archive-time',employee_reference:'synthetic-plinth-employee-1',cost_code:'01-100',dated_on:'2026-10-23',period:'2026-10',minutes:480,hour_cents:3000,burden_bps:2000});const time=r.record;await c.ok(`/costs/sources/${time.id}/approve`)
  const payrollCsv=`external_id,time_source_id,gross_cents,burden_cents\nsynthetic-plinth-archive-payroll,${time.id},25000,5500\n`;await c.ok('/costs/payroll',{csv:payrollCsv,reference:'synthetic-plinth-archive-register',dated_on:'2026-10-24',period:'2026-10'})
  await c.ok('/costs/forecasts',{as_of:'2026-10-23',source_as_of:'Archive sources checked',codes:[{cost_code:'06-100',remaining_quantity:'50',minutes_per_unit:'24',labor_hour_cents:3000,outstanding_commitment_cents:60000,unbought_cents:0,risk_cents:0,reference:'Archive framing half complete'},{cost_code:'01-100',remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:0,outstanding_commitment_cents:0,unbought_cents:1000,risk_cents:0,reference:'Archive remaining labor'}]})
  await c.ok('/costs/reconcile',{period:'2026-10',balances:[{cost_code:'06-100',amount_cents:33000},{cost_code:'01-100',amount_cents:41500}],reference:'synthetic-plinth-archive-accounting'})
  await c.ok('/costs/periods',{period:'2026-10',accountant_approved:true,accountant_name:'Synthetic archive accountant',approval_reference:'synthetic-plinth-archive-close',opening_cash_cents:200000,months:3})
  const before=join(folder,'before.rer'),after=join(folder,'restored.rer'),erased=join(folder,'erased.rer'),jobId=c.job.id,cookie=f.owner
  await f.close();f=undefined;command(source,'export','--output',before);command(destination,'import','--input',before,'--yes');command(destination,'export','--output',after)
  const originalRows=await records(before),restoredRows=await records(after),getCost=rows=>JSON.parse(rows.find(r=>r.table==='pl_jobs'&&r.row.id===jobId).row.data).cost_records
  assert.deepEqual(getCost(restoredRows),getCost(originalRows));assert.equal(getCost(restoredRows).bills[0].document.base64,original.base64);assert.equal(getCost(restoredRows).periods.length,1);assert.equal(getCost(restoredRows).forecasts.length,1);assert.equal(getCost(restoredRows).reconciliations.length,1);assert.equal(Buffer.from(getCost(restoredRows).payroll_imports[0].document.base64,'base64').toString(),payrollCsv);assert.ok(!restoredRows.some(r=>['oa_sessions','oa_credentials','oa_tokens'].includes(r.table)))
  f=await createFixture({persistTo:source,ownerCookie:cookie});let current=(await f.json(`/api/plinth/jobs/${jobId}`,{cookie})).value.job;const erasedResponse=await f.request(`/api/plinth/jobs/${jobId}`,{method:'DELETE',cookie,body:{expected_version:current.version}});assert.equal(erasedResponse.status,200);await f.close();f=undefined;command(source,'export','--output',erased);assert.ok(!(await records(erased)).some(r=>r.table==='pl_jobs'&&r.row.id===jobId))
 }finally{if(f)await f.close();await rm(folder,{recursive:true,force:true})}
})
