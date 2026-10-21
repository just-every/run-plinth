import { takeoffPlan } from '../fixtures/takeoff-plan.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, symlink, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileRecords } from '@runeditrun/rer/modules/portability/files'
import { createActiveJob, createFixture } from './helpers.mjs'

test('BILL-006 / BILL-002 / BILL-003 / AUTO-002 / EST-004 / EST-005 / CARE-003 / EST-003 / EST-002 / CRM-001 / INT-006 / NATIVE-011 — CLI archive round trip carries jobs, approvals, photos and import custody; later erasure fences an old archive', async () => {
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
    r=await f.json(`/api/plinth/jobs/${job.id}/products`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,name:'Archive faucet specification',sku:'AF-108',supplier:'Archive Plumbing Supply',source_url:'https://supplier.example.com/faucets/AF-108',dimensions:'8 inch reach, single-hole mount',cost_quote_cents:28450,lead_days:14,captured_on:'2026-10-01',valid_until:'2027-01-01',discontinued:false,evidence:'Archive supplier quote AP-1048',image:{name:'faucet.png',mime:'image/png',base64:png}}});assert.equal(r.status,200);job=r.value.job
    const supplierProduct=job.products[0];r=await f.json(`/api/plinth/jobs/${job.id}/products/${supplierProduct.id}/review`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,revision_id:supplierProduct.revisions[0].id,confirm:true}});assert.equal(r.status,200);job=r.value.job
    const drawingBytes=takeoffPlan();r=await f.json(`/api/plinth/jobs/${job.id}/takeoff`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,name:'Archive A1 kitchen drawing',page:1,width:400,height:400,document:{name:'original-plans.pdf',mime:'application/pdf',base64:drawingBytes.toString('base64')}}});assert.equal(r.status,200);job=r.value.job
    const drawing=job.takeoff[0];r=await f.json(`/api/plinth/jobs/${job.id}/takeoff/${drawing.id}/calibrate`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,revision_id:drawing.revisions[0].id,points:[{x:50,y:350},{x:250,y:350}],length:'20',unit:'ft'}});assert.equal(r.status,200);job=r.value.job
    r=await f.json(`/api/plinth/jobs/${job.id}/takeoff/${drawing.id}/measure`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,revision_id:drawing.revisions[0].id,calibration_id:job.takeoff[0].calibrations[0].id,kind:'length',points:[{x:50,y:250},{x:250,y:250}],name:'Archive measured kitchen wall',dimension:'walls',annotation:'Original retained scale and annotation'}});assert.equal(r.status,200);job=r.value.job
    const csv=await readFile(new URL('../fixtures/import-accepted-jobs.csv',import.meta.url),'utf8')
    const preview=await f.json('/api/plinth/imports/preview',{method:'POST',cookie:f.owner,body:{csv}});assert.equal(preview.status,200)
    r=await f.json('/api/plinth/imports/commit',{method:'POST',cookie:f.owner,body:{csv,fingerprint:preview.value.fingerprint}});assert.equal(r.status,200)
    r=await f.json(`/api/plinth/jobs/${job.id}/calendar`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,action:'rotate'}});assert.equal(r.status,200);const feedPath=r.value.urlPath
    const catalog=await f.json('/api/plinth/estimate-catalog',{method:'POST',cookie:f.owner,body:{kind:'rate',name:'Archive wallboard rate',reason:'Reviewed vendor quote',value:{vendor:'Cascade Supply',effective_on:'2026-10-01',unit:'square feet',cost_cents:125,sell_cents:200,reference:'CS-1042'}}});assert.equal(catalog.status,201)
    const taxRate=await f.json('/api/plinth/pricing-rates',{method:'POST',cookie:f.owner,body:{effective_on:'2026-10-01',jurisdiction:'Synthetic archive jurisdiction',kind:'sales',percent:'7.5',reference:'Reviewed archive fixture rate schedule',human_reviewed:true}});assert.equal(taxRate.status,201)
    // BILL-003: populate a separate priced job through the same native doors before archiving.
    let billing=(await f.json('/api/plinth/jobs',{method:'POST',cookie:f.owner,body:{name:'Archive client retainage contract',client_email:'retainage-client@example.com',address:'412 Maple Street, Portland, OR 97205'}})).value.job
    const bill=async(path,input)=>{const r=await f.json(`/api/plinth/jobs/${billing.id}${path}`,{method:'POST',cookie:f.owner,body:{expected_version:billing.version,...input}});assert.equal(r.status,200,JSON.stringify(r.value));billing=r.value.job;return r.value.record}
    await bill('/quotes',{lines:[{id:'plumbing',description:'Plumbing rough-in and finish',cost_code:'22-100',phase:'Plumbing',category:'subcontract',quantity:'1',unit:'job',unit_cents:100000,cost_unit_cents:80000}]})
    const pricingInput={basis:'sell',as_of:'2026-10-01',rules:[],tax:{rate_id:taxRate.value.rate.id,taxable_line_ids:['plumbing']}}
    const priced=await f.json(`/api/plinth/jobs/${billing.id}/pricing/preview`,{method:'POST',cookie:f.owner,body:{expected_version:billing.version,...pricingInput}});assert.equal(priced.status,200)
    await bill('/pricing/apply',{...pricingInput,digest:priced.value.preview.digest})
    await bill(`/quotes/${billing.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Archive signed external plumbing agreement',schedule_choice:{kind:'none',reason:'Plumbing dates planned separately'}})
    await bill('/sov',{})
    await bill('/retainage',{contract_reference:'Signed archive retainage section RT-104',rules:[{line_id:'quote:plumbing',work_bps:500,stored_bps:1000}],milestones:[{id:'substantial',name:'Substantial completion',completion_requirements:['Plumbing inspection'],waiver_requirements:[]}]})
    const billingClaim=await bill('/claims',{description:'Archive rough-in draw',lines:[{line_id:'quote:plumbing',completed_cents:50000,stored_cents:0,evidence:'Plumbing rough-in inspection PI-104',order_ids:[]}]})
    await bill(`/claims/${billingClaim.id}/approve`,{})
    await bill(`/claims/${billingClaim.id}/issue`,{})
    await bill('/retainage/release',{claim_id:billingClaim.id,milestone_id:'substantial',lines:[{line_id:'quote:plumbing',amount_cents:1000}],completion_references:[{requirement:'Plumbing inspection',reference:'Human reviewed signed inspection PI-104'}],waiver_references:[]})
    assert.equal(billing.retainage_balance.held_cents,1500)
    const archiveVendor=(await f.json('/api/plinth/vendors',{method:'POST',cookie:f.owner,body:{kind:'subcontractor',name:'Archive Plumbing LLC',trades:['Plumbing'],contacts:[]}})).value.vendor
    assert.equal((await f.json(`/api/plinth/vendors/${archiveVendor.id}/qualifications`,{method:'POST',cookie:f.owner,body:{expected_version:archiveVendor.version,trade:'Plumbing',status:'qualified',evidence:'Reviewed plumbing qualification archive source'}})).status,200)
    const archiveSub=await bill('/subcontracts',{vendor_id:archiveVendor.id,trade:'Plumbing',scope:'Archive plumbing installation',contact_ids:[],awarded_on:'2026-10-20',amount_cents:80000})
    await bill(`/subcontracts/${archiveSub.id}/release`,{});await bill(`/subcontracts/${archiveSub.id}/lien`,{state:'OR'})
    await bill(`/subcontracts/${archiveSub.id}/retainage`,{contract_reference:'Supplier archive retainage SR-104',rate_bps:1000,milestones:[{id:'rough',name:'Rough-in completion',completion_requirements:['Supplier rough-in inspection'],waiver_requirements:[]}]})
    const archiveDraw=await bill(`/subcontracts/${archiveSub.id}/draws`,{through_date:'2026-10-20',amount_cents:40000})
    await bill(`/subcontracts/${archiveSub.id}/retainage/release`,{draw_id:archiveDraw.id,milestone_id:'rough',lines:[{draw_id:archiveDraw.id,amount_cents:1000}],completion_references:[{requirement:'Supplier rough-in inspection',reference:'Signed supplier inspection SI-104'}],waiver_references:[]})
    assert.equal(billing.subcontracts[0].retainage_balance.held_cents,3000)
    const archiveDeposit=await bill('/invoices',{kind:'deposit',description:'Archive original contract deposit',recipient_email:'retainage-client@example.com',due_on:'2026-11-01',terms:'Due within 14 days',amount_cents:10000})
    await bill(`/invoices/${archiveDeposit.id}/issue`,{})
    await bill(`/invoices/${archiveDeposit.id}/receipt`,{amount_cents:4000,received_on:'2026-10-21',reference:'Archive bank statement receipt BS-104A',method:'bank',confirm:true})
    const depositReceipts=await bill(`/invoices/${archiveDeposit.id}/receipt`,{amount_cents:6000,received_on:'2026-10-21',reference:'Archive bank statement receipt BS-104B',method:'bank',confirm:true})
    const returnedDepositReceipt=depositReceipts.receipts.at(-1)
    const archiveInvoice=await bill('/invoices',{kind:'milestone',description:'Archive issued rough-in invoice',recipient_email:'retainage-client@example.com',due_on:'2026-11-15',terms:'Progress application approved by builder',source_application_id:billingClaim.id})
    await bill(`/invoices/${archiveInvoice.id}/issue`,{});await bill(`/invoices/${archiveInvoice.id}/apply-deposit`,{deposit_invoice_id:archiveDeposit.id,amount_cents:4000})
    assert.equal(billing.invoice_deposit_liability_cents,6000)
    await bill(`/invoices/${archiveDeposit.id}/return-receipt`,{receipt_id:returnedDepositReceipt.id,amount_cents:2500,returned_on:'2026-10-22',reference:'Archive partial deposit return BS-109A',reason:'Staff reviewed partial bank deposit return notice',confirm:true})
    assert.equal(billing.invoice_deposit_liability_cents,3500)
    await bill(`/invoices/${archiveDeposit.id}/return-receipt`,{receipt_id:returnedDepositReceipt.id,returned_on:'2026-10-23',reference:'Archive deposit return BS-109',reason:'Staff reviewed bank deposit return notice',confirm:true})
    assert.equal(billing.invoice_deposit_liability_cents,0)
    const directReceipts=await bill(`/invoices/${archiveInvoice.id}/receipt`,{amount_cents:1000,received_on:'2026-10-23',reference:'Archive single-invoice check 1501',method:'check',confirm:true})
    await bill(`/invoices/${archiveInvoice.id}/return-receipt`,{receipt_id:directReceipts.receipts.at(-1).id,amount_cents:300,returned_on:'2026-10-23',reference:'Archive partial check return 1501A',reason:'Staff reviewed partial returned-check notice',confirm:true})
    await bill(`/invoices/${archiveInvoice.id}/return-receipt`,{receipt_id:directReceipts.receipts.at(-1).id,returned_on:'2026-10-24',reference:'Archive check return 1501',reason:'Staff reviewed returned-check notice',confirm:true})
    const remittance=await bill('/remittances',{amount_cents:12000,received_on:'2026-10-22',reference:'Archive bank remittance BS-106',evidence:'Staff reviewed bank statement and client remittance',method:'bank',confirm:true,allocations:[{invoice_id:archiveInvoice.id,amount_cents:8000}]})
    await bill(`/remittances/${remittance.id}/return`,{returned_on:'2026-10-23',reference:'Archive bank return BS-107',reason:'Bank recorded the returned remittance',confirm:true})
    await bill('/remittances',{amount_cents:10000,received_on:'2026-10-24',reference:'Archive unapplied bank remittance BS-108',evidence:'Staff reviewed a later bank receipt, retained unapplied',method:'check',confirm:true,allocations:[]})


    let warrantyJob=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:f.owner})).value.job
    let warranty=await f.json(`/api/plinth/jobs/${job.id}/warranties`,{method:'POST',cookie:f.owner,body:{expected_version:warrantyJob.version,kind:'component',name:'Archive HVAC',starts_on:'2030-01-01',ends_on:'2035-12-31',terms:'Signed original HVAC warranty',signed_terms_reference:'Archive warranty W-104'}});assert.equal(warranty.status,200);warrantyJob=warranty.value.job
    warranty=await f.json(`/api/plinth/jobs/${job.id}/warranties`,{method:'POST',cookie:f.owner,body:{expected_version:warrantyJob.version,kind:'promise',component_id:warrantyJob.warranties.components[0].id,title:'Archive maintenance agreement',anchor_on:'2031-01-31',interval_unit:'year',interval_count:1,recipient_kind:'office',recipient_email:'builder@example.com',agreement_reference:'Owner recorded explicit reminder agreement'}});assert.equal(warranty.status,200);job=warranty.value.job
    const workflowId=job.continuity[0].id;let resumed=await f.json(`/api/plinth/jobs/${job.id}/continuity/${workflowId}/resume`,{method:'POST',cookie:f.owner,body:{expected_version:job.version}});assert.equal(resumed.status,200);job=resumed.value.job;assert.equal(job.continuity[0].stage,'purchasing')
    const cookie=f.owner; await f.close();f=undefined
    const before=join(folder,'before.rer'), after=join(folder,'after.rer'), roundtrip=join(folder,'roundtrip.rer')
    succeeds(command(source,'export','--output',before))
    succeeds(command(destination,'import','--input',before,'--yes'))
    succeeds(command(destination,'export','--output',roundtrip))
    const original=await archive(before), restored=await archive(roundtrip)
    const receiver=await createFixture({persistTo:destination,ownerCookie:cookie})
    try{const outcome=await (await receiver.mf.getWorker()).scheduled({scheduledTime:new Date('2031-01-31T10:00:00Z'),cron:'0 * * * *'});assert.equal(outcome.outcome,'ok');assert.equal(receiver.messages.length,0,'AUTO-002 / CARE-003 restored pending reminders remain inert until an office person reconfirms the agreement under receiving authority')}finally{await receiver.close()}
    const rows = records => records.filter(r=>r.kind==='part').flatMap(r=>r.items)
    // The complete part stream, including binary cells, is unchanged by a restore.
    assert.ok(rows(original).length > 0)
    const expected=structuredClone(rows(original))
    // Base deliberately increments auth generation at restore to invalidate prior sessions.
    for(const item of expected) if(item.table==='oa_auth_settings') item.row.generation++
    assert.deepEqual(rows(restored),expected)
    const recoveredJob=rows(restored).find(item=>item.table==='pl_jobs'&&item.row.id===job.id);assert.ok(recoveredJob);assert.deepEqual(JSON.parse(recoveredJob.row.data).continuity,job.continuity,'AUTO-002 interrupted draft checkpoint and source links survive recovery unchanged')
    assert.ok(!restored[0].tables.some(t=>['oa_sessions','oa_credentials','oa_tokens'].includes(t.name)))
    const serialized=JSON.stringify(restored)
    assert.ok(serialized.includes('Signed archive retainage section RT-104')&&serialized.includes('Human reviewed signed inspection PI-104'),'BILL-003 immutable terms, withholding snapshots and release evidence survive CLI recovery')
    const recoveredBilling=JSON.parse(rows(restored).find(item=>item.table==='pl_jobs'&&item.row.id===billing.id).row.data);assert.deepEqual(recoveredBilling.remittances,billing.remittances,'BILL-006 remittance evidence, allocation identity, return history and unapplied cash survive CLI recovery');assert.deepEqual(recoveredBilling.retainage,billing.retainage);assert.deepEqual(recoveredBilling.subcontracts[0].retainage,billing.subcontracts[0].retainage,'BILL-003 independent supplier terms and release sources survive CLI recovery');assert.deepEqual(recoveredBilling.invoices.map(i=>i.issued),billing.invoices.map(i=>i.issued),'BILL-002 original invoice numbers, pricing/tax and commercial snapshots survive recovery');assert.deepEqual(recoveredBilling.invoices.map(i=>[i.receipts,i.deposit_applications]),billing.invoices.map(i=>[i.receipts,i.deposit_applications]),'BILL-006 / BILL-002 direct/deposit receipts, original-linked return reversals and unearned deposit allocations survive recovery');assert.equal(rows(restored).find(item=>item.table==='pl_invoice_sequence').row.next_number,Math.max(...billing.invoices.map(i=>Number(i.number.split('-').at(-1))))+1,'BILL-002 the next invoice sequence survives private CLI recovery');assert.deepEqual(recoveredBilling.approvals,billing.approvals,'BILL-006 return reasons, evidence and human decisions survive recovery');assert.deepEqual(recoveredBilling.claims,billing.claims,'BILL-003 issued gross/withheld/net application identity survives unchanged')
    assert.ok(serialized.includes(taxRate.value.rate.id)&&serialized.includes('Reviewed archive fixture rate schedule'),'EST-003 reviewed jurisdiction source and dated rate revisions survive CLI recovery')
    assert.ok(serialized.includes(catalog.value.entry.id)&&serialized.includes('CS-1042'),'EST-002 catalog source identities and dated revisions survive CLI recovery')
    assert.ok(serialized.includes('Archive warranty W-104')&&serialized.includes('Archive maintenance agreement'),'CARE-003 terms, agreements and attribution survive the private CLI archive');assert.ok(!restored[0].tables.some(t=>t.name==='pl_warranty_scheduler'),'Transient scheduler cursor is excluded')
    assert.ok(serialized.includes(drawing.revisions[0].document.checksum)&&serialized.includes('Original retained scale and annotation'),'EST-004 PDF bytes, drawing revision, calibration and measurement sources survive CLI archive recovery')
    assert.ok(serialized.includes('Archive supplier quote AP-1048')&&serialized.includes(supplierProduct.revisions[0].image.checksum),'EST-005 original supplier images, source identities and reviewed capture snapshots survive private CLI recovery')
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
