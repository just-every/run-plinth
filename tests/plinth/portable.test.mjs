import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, symlink, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileRecords } from '@runeditrun/rer/modules/portability/files'
import { createActiveJob, createFixture } from './helpers.mjs'

test('CARE-003 / EST-003 / EST-002 / CRM-001 / INT-006 / NATIVE-011 — CLI archive round trip carries jobs, approvals, photos and import custody; later erasure fences an old archive', async () => {
  const root = resolve('.'), folder = await mkdtemp(join(tmpdir(), 'plinth-portable-'))
  const source = join(folder,'source'), destination = join(folder,'restored'), erased = join(folder,'erased')
  const env = {...process.env, CI:'true', WRANGLER_SEND_METRICS:'false', RER_SERVER_JOURNEY:'1'}
  // These are separate installations; each command must acquire its own lock.
  delete env.RER_LOCAL_OPERATION
  const rer = join(root,'node_modules/@runeditrun/rer/global/rer.mjs')
  async function checkout(target) {
    for (const file of ['package.json','pnpm-lock.yaml','.node-version','OPERATIONS.json','rer-setup.json','wrangler.jsonc','vite.config.ts','deploy.json','deploy-site.json','scripts','src','public','migrations','README.md','ACCEPTANCE.md','RUN-LOCALLY.md','OPERATIONS.md','SEED-COMMAND-CONTRACT.md','CONTRACT.md','seed.json']) await cp(join(root,file),join(target,file),{recursive:true})
    await symlink(join(root,'node_modules'),join(target,'node_modules'),'dir')
  }
  const command = (target, verb, ...args) => spawnSync(process.execPath,[rer,verb,'--cwd',target,'--json','--no-queue',...args],{env,encoding:'utf8',timeout:180_000})
  const succeeds = r => { assert.equal(r.status,0,r.stderr+'\n'+r.stdout); return r }
  const archive = async path => { const records=[]; for await (const r of fileRecords(path)) records.push(r); return records }
  let f
  try {
    await checkout(source); await checkout(destination); await checkout(erased)
    execFileSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','DB','--local','--persist-to',join(source,'.wrangler/state'),'--config',join(source,'wrangler.jsonc')],{env,stdio:'pipe'})
    f=await createFixture({persistTo:source}); let job=await createActiveJob(f,'Ashgrove kitchen','client@example.com',4_800_000)
    let customer=await f.json('/api/plinth/customers',{method:'POST',cookie:f.owner,body:{name:'Chen household archive',kind:'household',contacts:[{id:'archive-client',name:'Client Chen',email:'client@example.com'}],properties:[{id:'archive-home',label:'Home',address:'148 Maple Street, Portland, OR 97205'}],owner_contact_ids:['archive-client'],billing_contact_ids:['archive-client']}});assert.equal(customer.status,201)
    let linked=await f.json(`/api/plinth/jobs/${job.id}/customer`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,customer_id:customer.value.customer.id,property_id:'archive-home',client_contact_ids:['archive-client']}});assert.equal(linked.status,200);job=linked.value.job
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='
    let r=await f.json(`/api/plinth/jobs/${job.id}/diary`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,date:'2026-10-15',note:'Framing inspected; ready for electrical rough-in.',attachments:[{name:'framing.png',mime:'image/png',base64:png}]}})
    assert.equal(r.status,200); job=r.value.job
    const csv=await readFile(new URL('../fixtures/import-accepted-jobs.csv',import.meta.url),'utf8')
    const preview=await f.json('/api/plinth/imports/preview',{method:'POST',cookie:f.owner,body:{csv}});assert.equal(preview.status,200)
    r=await f.json('/api/plinth/imports/commit',{method:'POST',cookie:f.owner,body:{csv,fingerprint:preview.value.fingerprint}});assert.equal(r.status,200)
    r=await f.json(`/api/plinth/jobs/${job.id}/calendar`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,action:'rotate'}});assert.equal(r.status,200);const feedPath=r.value.urlPath
    const catalog=await f.json('/api/plinth/estimate-catalog',{method:'POST',cookie:f.owner,body:{kind:'rate',name:'Archive wallboard rate',reason:'Reviewed vendor quote',value:{vendor:'Cascade Supply',effective_on:'2026-10-01',unit:'square feet',cost_cents:125,sell_cents:200,reference:'CS-1042'}}});assert.equal(catalog.status,201)
    const taxRate=await f.json('/api/plinth/pricing-rates',{method:'POST',cookie:f.owner,body:{effective_on:'2026-10-01',jurisdiction:'Synthetic archive jurisdiction',kind:'sales',percent:'7.5',reference:'Reviewed archive fixture rate schedule',human_reviewed:true}});assert.equal(taxRate.status,201)
    let warrantyJob=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:f.owner})).value.job
    let warranty=await f.json(`/api/plinth/jobs/${job.id}/warranties`,{method:'POST',cookie:f.owner,body:{expected_version:warrantyJob.version,kind:'component',name:'Archive HVAC',starts_on:'2030-01-01',ends_on:'2035-12-31',terms:'Signed original HVAC warranty',signed_terms_reference:'Archive warranty W-104'}});assert.equal(warranty.status,200);warrantyJob=warranty.value.job
    warranty=await f.json(`/api/plinth/jobs/${job.id}/warranties`,{method:'POST',cookie:f.owner,body:{expected_version:warrantyJob.version,kind:'promise',component_id:warrantyJob.warranties.components[0].id,title:'Archive maintenance agreement',anchor_on:'2031-01-31',interval_unit:'year',interval_count:1,recipient_kind:'office',recipient_email:'builder@example.com',agreement_reference:'Owner recorded explicit reminder agreement'}});assert.equal(warranty.status,200);job=warranty.value.job
    const cookie=f.owner; await f.close();f=undefined
    const before=join(folder,'before.rer'), after=join(folder,'after.rer'), roundtrip=join(folder,'roundtrip.rer')
    succeeds(command(source,'export','--output',before))
    succeeds(command(destination,'import','--input',before,'--yes'))
    succeeds(command(destination,'export','--output',roundtrip))
    const original=await archive(before), restored=await archive(roundtrip)
    const receiver=await createFixture({persistTo:destination,ownerCookie:cookie})
    try{const outcome=await (await receiver.mf.getWorker()).scheduled({scheduledTime:new Date('2031-01-31T10:00:00Z'),cron:'0 * * * *'});assert.equal(outcome.outcome,'ok');assert.equal(receiver.messages.length,0,'CARE-003 restored pending reminders remain inert until an office person reconfirms the agreement under receiving authority')}finally{await receiver.close()}
    const rows = records => records.filter(r=>r.kind==='part').flatMap(r=>r.items)
    // The complete part stream, including binary cells, is unchanged by a restore.
    assert.ok(rows(original).length > 0)
    const expected=structuredClone(rows(original))
    // Base deliberately increments auth generation at restore to invalidate prior sessions.
    for(const item of expected) if(item.table==='oa_auth_settings') item.row.generation++
    assert.deepEqual(rows(restored),expected)
    assert.ok(!restored[0].tables.some(t=>['oa_sessions','oa_credentials','oa_tokens'].includes(t.name)))
    const serialized=JSON.stringify(restored)
    assert.ok(serialized.includes(taxRate.value.rate.id)&&serialized.includes('Reviewed archive fixture rate schedule'),'EST-003 reviewed jurisdiction source and dated rate revisions survive CLI recovery')
    assert.ok(serialized.includes(catalog.value.entry.id)&&serialized.includes('CS-1042'),'EST-002 catalog source identities and dated revisions survive CLI recovery')
    assert.ok(serialized.includes('Archive warranty W-104')&&serialized.includes('Archive maintenance agreement'),'CARE-003 terms, agreements and attribution survive the private CLI archive');assert.ok(!restored[0].tables.some(t=>t.name==='pl_warranty_scheduler'),'Transient scheduler cursor is excluded')
    assert.ok(serialized.includes('Chen household archive'));assert.ok(serialized.includes('archive-client'));
    assert.ok(serialized.includes('Ashgrove kitchen')); assert.ok(serialized.includes(png)); assert.ok(serialized.includes('accepted-jobs.csv'))
    assert.ok(!serialized.includes(feedPath.split('/').at(-1).replace('.ics','')))
    assert.ok(!restored[0].tables.some(t=>t.name==='pl_calendar_tokens'))
    assert.ok(!serialized.includes('test-session-secret-for-plinth-integration-only-2026'))
    f=await createFixture({persistTo:source,ownerCookie:cookie})
    r=await f.json(`/api/plinth/jobs/${job.id}`,{method:'DELETE',cookie:f.owner,body:{expected_version:job.version}});assert.equal(r.status,200)
    await f.close(); f=undefined
    succeeds(command(source,'export','--output',after))
    await cp(after,join(erased,'after-erasure.rer'))
    const refused=command(erased,'import','--input',before,'--journal','after-erasure.rer','--yes')
    assert.equal(refused.status,4); assert.match(refused.stdout+refused.stderr,/erasure_epoch/)
  } finally { if(f) await f.close(); await rm(folder,{recursive:true,force:true}) }
})
