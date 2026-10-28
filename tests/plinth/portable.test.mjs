import { submittalFixture } from './submittal-support.mjs'
import {proveConnectorRecovery} from './connector-recovery-support.mjs'
import { stripeEdge, intent } from './payment-fixture.mjs'
import { scannedPlan, takeoffPlan } from '../fixtures/takeoff-plan.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, symlink, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileRecords } from '@runeditrun/rer/modules/portability/files'
import { createActiveJob, createFixture, createReleasedScope } from './helpers.mjs'
import { costFixture, original as costOriginal } from './cost-support.mjs'

test('CLI archive round trip carries jobs, approvals, photos and import custody; later erasure fences an old archive', async () => {
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
    const processor=stripeEdge()
    f=await createFixture({persistTo:source,stripeEdge:processor.handler,webhookReceiver:async()=>new Response(null,{status:202})}); let job=await createActiveJob(f,'Ashgrove kitchen','client@example.com',4_800_000)
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
    const planRoot=`/api/plinth/jobs/${job.id}/plans`
    const planAct=async(path,body)=>{const result=await f.json(planRoot+path,{method:'POST',cookie:f.owner,body:{expected_version:job.version,...body}});assert.equal(result.status,200,JSON.stringify(result.value));job=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:f.owner})).value.job;return result.value}
    const scanned=scannedPlan()
    const archivePlan=await planAct('',{title:'Archive approved field set',issue_on:'2026-10-01',sheets:[{number:'A1',revision:'A',kind:'plan',page:1,width:400,height:400,document:{name:'synthetic-plinth-plan.pdf',mime:'application/pdf',base64:scanned.toString('base64')}}]})
    const archiveSetId=archivePlan.record.id,archiveSheet=archivePlan.plans.sets[0].sheets[0]
    await planAct(`/${archiveSetId}/approve`,{confirm:true,recipient_ids:[archivePlan.plans.person_id]})
    await planAct(`/${archiveSetId}/annotate`,{sheet_id:archiveSheet.id,x:80,y:120,text:'Retained source-revision field annotation'})
    const archiveDistribution=(await planAct(`/${archiveSetId}/acknowledge`,{})).plans.sets[0]
    const archivedSubmittal=await submittalFixture(f,job,{notify:true});job=archivedSubmittal.job
    // Current decision, capacity and RFI records use the same public doors before private recovery.
    const current=async(path,input={})=>{const r=await f.json(`/api/plinth/jobs/${job.id}${path}`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,...input}});assert.equal(r.status,200,JSON.stringify(r.value));job=r.value.job;return r.value.record}
    await f.invite('archive-designer@example.com','Archive designer')
    const capacity=await f.json('/api/plinth/resources',{method:'POST',cookie:f.owner,body:{name:'Archive shared lift',kind:'equipment',capacity:2,reason:'Owned equipment capacity',available:[],leave:[]}});assert.equal(capacity.status,201)
    const archiveTask=await current('/schedules',{trade:'Archive trade',description:'Archive allocated task',start:'2026-11-06T08:00:00Z',end:'2026-11-06T10:00:00Z',travel_minutes:60,resources:[{resource_id:capacity.value.resource.id,units:1}]})
    await current('/rfi-access',{email:'archive-designer@example.com',role:'designer',sheet_ids:[]})
    const archiveRfi=await current('/rfis',{title:'Archive sheet clash',question:'Retain the exact revised detail and source drawing',sheet:{sheet_id:drawing.id,revision_id:drawing.revisions[0].id},task_ids:[archiveTask.id],assignee_email:'archive-designer@example.com',due_on:'2026-11-01',attachments:[{name:'rfi-original.pdf',mime:'application/pdf',base64:drawingBytes.toString('base64')}]})
    await current(`/rfis/${archiveRfi.id}/respond`,{text:'Archive exact revised design response',cost_impact_cents:0,date_impact_days:0,attachments:[{name:'rfi-response.pdf',mime:'application/pdf',base64:drawingBytes.toString('base64')}]})
    const archiveSelection=await current('/selections',{room:'Kitchen',category:'Archive fixture decision',allowance_cents:30000,cost_code:'22-400',decision_on:'2020-01-01',lead_days:14,options:[{name:'Archive exact option',supplier:'Synthetic supply',specifications:'Archive retained specification',price_cents:30000}]})
    await current(`/selections/${archiveSelection.id}/present`,{revision_id:archiveSelection.revisions[0].id})
    await current(`/selections/${archiveSelection.id}/reminder`,{revision_id:archiveSelection.revisions[0].id,reason:'Archive pending decision reminder, not sent',attachments:[{name:'decision-source.pdf',mime:'application/pdf',base64:drawingBytes.toString('base64')}]})
    const meeting=await current('/meetings',{title:'Archive site meeting',held_on:'2026-10-26',agenda:'Review the exact fixture decision',minutes:'Builder reviewed the fixture specification on site.',attendees:['Builder'],decisions:'Keep the archive fixture decision',tags:['fixture'],sheet:'A1',cost_code:'22-400',actions:[{title:'Record the resolved fixture answer',owner_email:'builder@example.com',due_on:'2026-11-01'}]})
    const originalEmail=Buffer.from(['From: Trade Estimator <synthetic-plinth-archive-sub@example.com>','To: builder@example.com','Subject: Archive private subcontractor bid','Message-ID: <synthetic-plinth-archive-bid@example.com>','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="synthetic-plinth-archive"','','--synthetic-plinth-archive','Content-Type: text/plain','','Private archive bid body','','--synthetic-plinth-archive','Content-Type: application/pdf; name="archive-bid.pdf"','Content-Disposition: attachment; filename="archive-bid.pdf"','Content-Transfer-Encoding: base64','',drawingBytes.toString('base64'),'','--synthetic-plinth-archive--',''].join('\r\n'))
    const capturedEmail=await f.json(`/api/plinth/jobs/${job.id}/correspondence`,{method:'POST',cookie:f.owner,body:{kind:'capture',original_base64:originalEmail.toString('base64'),confirm:true}});assert.equal(capturedEmail.status,201,JSON.stringify(capturedEmail.value))
    const captured= capturedEmail.value.messages.find(m=>m.id===capturedEmail.value.id)
    for(const source of ['correspondence:'+captured.id,'files:'+captured.files[0].id]){const annotation=await f.json(`/api/plinth/jobs/${job.id}/decision-search/metadata`,{method:'POST',cookie:f.owner,body:{source,tags:['archive-bid'],sheet:'A1',cost_code:'22-400'}});assert.equal(annotation.status,200,JSON.stringify(annotation.value))}
    const transcriptionSource='files:'+captured.files[0].id,transcriptionText='A1 - Kitchen plan\nA2 - Laundry plan'
    const originalHit=(await f.json(`/api/plinth/jobs/${job.id}/decision-search?`+new URLSearchParams({source:transcriptionSource}),{cookie:f.owner})).value.results[0]
    const transcriptionReview=await f.json(`/api/plinth/jobs/${job.id}/decision-search/transcription-preview`,{method:'POST',cookie:f.owner,body:{source:transcriptionSource,checksum:originalHit.file_checksum,expected_version:job.version,text:transcriptionText}});assert.equal(transcriptionReview.status,200)
    const transcriptionSaved=await f.json(`/api/plinth/jobs/${job.id}/decision-search/transcriptions`,{method:'POST',cookie:f.owner,body:{...transcriptionReview.value,confirm:true}});assert.equal(transcriptionSaved.status,200);job=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:f.owner})).value.job
    await current(`/meetings/${meeting.id}/complete`,{action_id:meeting.actions[0].id,answer:'The exact fixture decision is retained.',message_id:captured.id,links:[{kind:'selection',id:archiveSelection.id}]})
    const archiveClient=await f.invite('client@example.com','Client Chen'),archiveDelegate=await f.invite('synthetic-plinth-301@example.com','Archive delegated designer')
    const archiveShare=await current(`/meetings/${meeting.id}/share`,{operation_id:'synthetic-plinth-archive-share',confirm:true,title:'Reviewed fixture decision for the client',body:'The reviewed fixture selection remains ready for the next meeting.',recipients:[{email:'client@example.com',kind:'client',can_comment:true}]})
    const pendingCopy=await f.json(`/api/plinth/meeting-inbox/${job.id}/${archiveShare.id}/email-copy`,{method:'POST',cookie:archiveClient,body:{expected_version:job.version,kind:'minutes',confirm:true,operation_id:'synthetic-plinth-archive-email-request'}});assert.equal(pendingCopy.status,200);job=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:f.owner})).value.job
    const contact=await f.json(`/api/plinth/customers/${customer.value.customer.id}/contacts`,{method:'POST',cookie:f.owner,body:{expected_version:customer.value.customer.version,id:'synthetic-plinth-301',name:'Archive delegated designer',email:'synthetic-plinth-301@example.com'}});assert.equal(contact.status,201)
    const delegation=await f.json(`/api/plinth/jobs/${job.id}/selections/${archiveSelection.id}/delegations`,{method:'POST',cookie:archiveClient,body:{expected_version:job.version,revision_id:archiveSelection.revisions[0].id,contact_id:'synthetic-plinth-301',statement:'Archive client delegates only this exact revision',confirm:true}});assert.equal(delegation.status,200,JSON.stringify(delegation.value));job=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:f.owner})).value.job
    const delegatedSignature=await f.json(`/api/plinth/selection-delegations/${job.id}/${delegation.value.delegation.id}/sign`,{method:'POST',cookie:archiveDelegate,body:{expected_version:job.version,revision_id:archiveSelection.revisions[0].id,option_id:archiveSelection.revisions[0].options[0].id,statement:'Archive designer signs these exact fixture terms',confirm:true}});assert.equal(delegatedSignature.status,200,JSON.stringify(delegatedSignature.value));job=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:f.owner})).value.job
    const todoInput={title:'Archive closeout checklist',notes:'Private checklist original notes',due_at:'2031-01-01T17:00:00Z',priority:'high',tags:['closeout'],items:[{title:'Review original handover manual',assignee:{kind:'office',email:'builder@example.com'}}],attachments:[{name:'synthetic-plinth-1.png',mime:'image/png',base64:png}]}
    const companyTodo=await f.json('/api/plinth/todos',{method:'POST',cookie:f.owner,body:todoInput});assert.equal(companyTodo.status,201,JSON.stringify(companyTodo.value));const archiveCompanyTodo=companyTodo.value.todo
    const jobTodo=await f.json(`/api/plinth/jobs/${job.id}/todos`,{method:'POST',cookie:f.owner,body:{...todoInput,expected_version:job.version,links:[{kind:'schedule',id:archiveTask.id}]}});assert.equal(jobTodo.status,201,JSON.stringify(jobTodo.value));job=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:f.owner})).value.job
    const savedTodo=structuredClone(job.todos[0]);assert.equal(savedTodo.attachments[0].base64,png)
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
    // BILL-005 decisions and reserved processor instructions use native doors before recovery.
    await bill(`/invoices/${archiveInvoice.id}/credit`,{operation_id:'synthetic-plinth-31',confirm:true,reason:'Synthetic archive reviewed credit',description:'Synthetic agreed invoice correction',lines:[{invoice_line_id:'quote:plumbing',amount_cents:1000}]})
    await bill(`/invoices/${archiveInvoice.id}/write-off`,{operation_id:'synthetic-plinth-32',confirm:true,reason:'Synthetic archive disputed bad debt',dispute_reference:'synthetic-plinth-33',amount_cents:1000})
    const paymentClient=await f.invite('retainage-client@example.com','Synthetic billing client')
    const processorInvoice=await bill('/invoices',{kind:'deposit',description:'Synthetic archive processor deposit',recipient_email:'retainage-client@example.com',due_on:'2026-11-01',terms:'Synthetic reviewed payment terms',amount_cents:2000})
    await bill(`/invoices/${processorInvoice.id}/issue`,{})
    const paymentCheckout=await f.json(`/api/plinth/jobs/${billing.id}/payments`,{method:'POST',cookie:paymentClient,body:{invoice_id:processorInvoice.id,confirm:true}});assert.equal(paymentCheckout.status,201,JSON.stringify(paymentCheckout.value))
    const session=processor.sessions.at(-1);session.payment_intent='synthetic-plinth-34';session.payment_status='paid';session.status='complete';processor.intents.set(session.payment_intent,intent(session.payment_intent,2000))
    const reconcile=await f.json(`/api/plinth/jobs/${billing.id}/payments/${paymentCheckout.value.attempt.id}/reconcile`,{method:'POST',cookie:f.owner,body:{}});assert.equal(reconcile.status,200,JSON.stringify(reconcile.value));billing=(await f.json(`/api/plinth/jobs/${billing.id}`,{cookie:f.owner})).value.job
    const processorOriginal=structuredClone(billing.invoices.find(i=>i.id===processorInvoice.id))
    await bill(`/invoices/${processorInvoice.id}/credit`,{operation_id:'synthetic-plinth-35',confirm:true,reason:'Synthetic archive refundable customer credit',description:'Synthetic agreed processor credit',lines:[{invoice_line_id:processorOriginal.issued.lines[0].id,amount_cents:1500}]})
    const refund=async(operation_id,amount_cents)=>{const response=await f.json(`/api/plinth/jobs/${billing.id}/payments/${paymentCheckout.value.attempt.id}/refund`,{method:'POST',cookie:f.owner,body:{expected_version:billing.version,operation_id,amount_cents,confirm:true,reason:'Synthetic archive exact human refund'}});billing=(await f.json(`/api/plinth/jobs/${billing.id}`,{cookie:f.owner})).value.job;return response}
    assert.equal((await refund('synthetic-plinth-36',500)).status,200)
    processor.refundStatus='pending';assert.equal((await refund('synthetic-plinth-37',500)).status,200)
    processor.loseRefundResponse=true;assert.equal((await refund('synthetic-plinth-38',250)).status,502);processor.loseRefundResponse=false
    const paymentHistory=(await f.json(`/api/plinth/jobs/${billing.id}/payments`,{cookie:f.owner})).value
    assert.deepEqual(paymentHistory.refunds.map(r=>[r.id,r.amount_cents,r.status]).sort(),[['synthetic-plinth-36',500,'succeeded'],['synthetic-plinth-37',500,'pending'],['synthetic-plinth-38',250,'unresolved']])
    const processorEffects=processor.refunds.length;assert.equal(processorEffects,3)



    let warrantyJob=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:f.owner})).value.job
    let warranty=await f.json(`/api/plinth/jobs/${job.id}/warranties`,{method:'POST',cookie:f.owner,body:{expected_version:warrantyJob.version,kind:'component',name:'Archive HVAC',starts_on:'2030-01-01',ends_on:'2035-12-31',terms:'Signed original HVAC warranty',signed_terms_reference:'Archive warranty W-104'}});assert.equal(warranty.status,200);warrantyJob=warranty.value.job
    warranty=await f.json(`/api/plinth/jobs/${job.id}/warranties`,{method:'POST',cookie:f.owner,body:{expected_version:warrantyJob.version,kind:'promise',component_id:warrantyJob.warranties.components[0].id,title:'Archive maintenance agreement',anchor_on:'2031-01-31',interval_unit:'year',interval_count:1,recipient_kind:'office',recipient_email:'builder@example.com',agreement_reference:'Owner recorded explicit reminder agreement'}});assert.equal(warranty.status,200);job=warranty.value.job
    const workflowId=job.continuity[0].id;let resumed=await f.json(`/api/plinth/jobs/${job.id}/continuity/${workflowId}/resume`,{method:'POST',cookie:f.owner,body:{expected_version:job.version}});assert.equal(resumed.status,200);job=resumed.value.job;assert.equal(job.continuity[0].stage,'purchasing')
    const portalContact=await f.invite('synthetic-plinth-portal@example.com','Archive trade contact')
    const portalGrant=await createReleasedScope(f,job,'synthetic-plinth-portal@example.com','Portal trade');job=portalGrant.job
    const portalInput={expected_version:job.version,subcontract_id:portalGrant.scope.id,reference:'synthetic-plinth-portal-1',note:'Private company original retained by CLI custody',attachments:[{name:'synthetic-plinth-portal-1.png',mime:'image/png',base64:png}]}
    r=await f.json(`/api/plinth/subcontractor-portal/${job.id}/bills`,{method:'POST',cookie:portalContact,body:{...portalInput,amount_cents:123400}});assert.equal(r.status,200,JSON.stringify(r.value));job=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:f.owner})).value.job
    r=await f.json(`/api/plinth/subcontractor-portal/${job.id}/compliance`,{method:'POST',cookie:portalContact,body:{...portalInput,expected_version:job.version,kind:'license',issuer:'Synthetic state licensing authority',effective_on:'2026-01-01',expires_on:'2099-12-31'}});assert.equal(r.status,200,JSON.stringify(r.value));job=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:f.owner})).value.job
    const archivePortal=structuredClone(job.portal_submissions),portalCompliance=archivePortal.find(s=>s.kind==='compliance')
    r=await f.json(`/api/plinth/jobs/${job.id}/portal-policy`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,disabled:{client:['photos'],subcontractor:['bills']},reason:'Archived owner access restriction'}});assert.equal(r.status,200);job=r.value.job
    // COST-001..006 share this same private archive and erasure journey.
    const c=await costFixture(f)
    let costResponse=await c.ok('/costs/bills',c.bill());await c.ok(`/costs/bills/${costResponse.record.id}/review`,{reason:'Archive reviewed original'});await c.ok(`/costs/bills/${costResponse.record.id}/post`)
    costResponse=await c.ok('/costs/sources',{kind:'expense',reference:'synthetic-plinth-archive-expense',employee_reference:'synthetic-plinth-employee-1',cost_code:'01-100',dated_on:'2026-10-23',period:'2026-10',amount_cents:1000,document:costOriginal});await c.ok(`/costs/sources/${costResponse.record.id}/approve`)
    costResponse=await c.ok('/costs/sources',{kind:'time',reference:'synthetic-plinth-archive-time',employee_reference:'synthetic-plinth-employee-1',cost_code:'01-100',dated_on:'2026-10-23',period:'2026-10',minutes:480,hour_cents:3000,burden_bps:2000});const time=costResponse.record;await c.ok(`/costs/sources/${time.id}/approve`)
    const payrollCsv=`external_id,time_source_id,gross_cents,burden_cents\nsynthetic-plinth-archive-payroll,${time.id},25000,5500\n`;await c.ok('/costs/payroll',{csv:payrollCsv,reference:'synthetic-plinth-archive-register',dated_on:'2026-10-24',period:'2026-10'})
    await c.ok('/costs/forecasts',{as_of:'2026-10-23',source_as_of:'Archive sources checked',codes:[{cost_code:'06-100',remaining_quantity:'50',minutes_per_unit:'24',labor_hour_cents:3000,outstanding_commitment_cents:60000,unbought_cents:0,risk_cents:0,reference:'Archive framing half complete'},{cost_code:'01-100',remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:0,outstanding_commitment_cents:0,unbought_cents:1000,risk_cents:0,reference:'Archive remaining labor'}]})
    await c.ok('/costs/reconcile',{period:'2026-10',balances:[{cost_code:'06-100',amount_cents:33000},{cost_code:'01-100',amount_cents:41500}],reference:'synthetic-plinth-archive-accounting'})
    const accountant=await f.invite('synthetic-plinth-archive-accountant@example.com','Archive accountant','admin'), accountantId=(await c.api('/team')).value.team.find(p=>p.name==='Archive accountant').id
    assert.equal((await f.json('/api/plinth/team/'+accountantId,{method:'PUT',cookie:f.owner,body:{role:'bookkeeper',job_ids:[c.job.id],expected_version:0}})).status,200)
    await c.ok('/costs/accountant',{accountant_id:accountantId,reason:'Owner granted archive accountant review'})
    const nativeInput={period:'2026-10',opening_cash_cents:200000,months:3},nativePreview=(await c.api(`/jobs/${c.job.id}/costs/period-preview?period=2026-10&opening_cash_cents=200000&months=3`,undefined,accountant)).value
    const review=await c.act('/costs/period-reviews',{...nativeInput,confirm:true,digest:nativePreview.digest,reference:'synthetic-plinth-archive-native-review'},accountant);assert.equal(review.status,200);await c.read()
    await c.ok('/costs/periods',{...nativeInput,native_review_id:review.value.record.id})
    const fieldWorker=await f.invite('synthetic-plinth-archive-field@example.com','Archive field worker','admin')
    const fieldPerson=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team.find(p=>p.email==='synthetic-plinth-archive-field@example.com')
    assert.equal((await f.json('/api/plinth/team/'+fieldPerson.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'crew',job_ids:[c.job.id],po_limit_cents:0}})).status,200)
    const field=async(path,body,cookie=f.owner)=>{const current=(await f.json(`/api/plinth/jobs/${c.job.id}`,{cookie:f.owner})).value.job;const r=await f.json(`/api/plinth/jobs/${c.job.id}/time`+path,{method:'POST',cookie,body:{expected_version:current.version,...body}});assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
    await field('/site',{latitude:44,longitude:-73,radius_meters:100,label:'Archive site'})
    await field('/consent',{consent:true},fieldWorker)
    await field('/location',{latitude:44.000123,longitude:-73.000123},fieldWorker)
    await field('/location',{latitude:44.123456,longitude:-73.123456},fieldWorker)
    const archivedField=(await f.json(`/api/plinth/jobs/${c.job.id}/time`,{cookie:fieldWorker})).value
    assert.equal(archivedField.location_choice.inside,false);assert.equal(archivedField.location_choice.reminder.kind,'clock_out')
    // Native connector secrets stay installation-local while draft replay identity travels with its job.
    const connectorToken=await f.agent(),connectorCredential=(await f.json('/api/plinth/agent-credentials',{cookie:f.owner})).value.credentials[0]
    const connector=await f.json('/api/plinth/connections',{method:'POST',cookie:f.owner,body:{credential_id:connectorCredential.id,receiver:'https://synthetic-plinth.example/synthetic-plinth-private-path?secret=synthetic-plinth-private-query',job_ids:[job.id],event_types:['job.updated'],confirm:true}});assert.equal(connector.status,201,JSON.stringify(connector.value))
    const revokedConnector=await f.json('/api/plinth/connections',{method:'POST',cookie:f.owner,body:{credential_id:connectorCredential.id,receiver:'https://synthetic-plinth.example/revoked',job_ids:[job.id],event_types:['job.updated'],confirm:true}});assert.equal(revokedConnector.status,201)
    assert.equal((await f.json(`/api/plinth/connections/${revokedConnector.value.subscription.id}/revoke`,{method:'POST',cookie:f.owner,body:{}})).status,200)
    const standingGrant=await f.json(`/api/plinth/connections/${connector.value.subscription.id}/grant`,{method:'POST',cookie:f.owner,body:{confirm:true,origin:'https://synthetic-plinth.example',event_types:['job.updated'],payload_class:'references',rate_cap:10,expires_at:new Date(Date.now()+3_600_000).toISOString()}});assert.equal(standingGrant.status,200,JSON.stringify(standingGrant.value))
    job=(await f.json('/api/plinth/jobs/'+job.id,{cookie:f.owner})).value.job
    const connectorDraft=await f.json('/api/plinth/v1/jobs/'+job.id+'/changes',{method:'POST',token:connectorToken,headers:{'idempotency-key':'synthetic-plinth-archive-draft'},body:{expected_version:job.version,description:'Synthetic archive connector draft',amount_cents:100}});assert.equal(connectorDraft.status,201,JSON.stringify(connectorDraft.value))
    job=(await f.json('/api/plinth/jobs/'+job.id,{cookie:f.owner})).value.job
    const {surveyJob,surveySettings}=await import('./satisfaction-support.mjs')
    const surveyArchive=await surveyJob(f,'Synthetic archived satisfaction',job.client_email,archiveClient)
    const surveyOwner=(await surveyArchive.call('/team')).value.team.find(p=>p.role==='owner')
    await surveyArchive.ok('/satisfaction/settings',surveySettings)
    await surveyArchive.ok('/satisfaction/consent',{email_surveys:true},archiveClient)
    const surveySent=await surveyArchive.ok('/satisfaction/send',{...surveyArchive.source,recipient_email:job.client_email,follow_up_id:surveyOwner.id,confirm:true}),surveyId=surveySent.surveys[0].id
    await surveyArchive.ok('/satisfaction/'+surveyId+'/respond',{score:4,answers:['Synthetic archived communication','Synthetic archived workmanship'],comment:'Synthetic archived follow-up'},archiveClient)
    await surveyArchive.ok('/satisfaction/'+surveyId+'/review-permission',{allowed:true},archiveClient)
    const archivedSurveyState=(await surveyArchive.survey()).surveys
    const {performanceFixture}=await import('./performance-support.mjs'),performanceArchive=await performanceFixture(f),performanceSource=performanceArchive.jobs[0],performancePeer=performanceArchive.jobs[1]
    const performanceProposal=await performanceSource.report('lessons',{catalog_id:performanceArchive.assembly.id,catalog_version:1,source_job_ids:[performanceSource.job.id,performancePeer.job.id],reason:'Archive completed-job production lesson',value:performanceArchive.assembly.revisions[0].value})
    await performanceSource.report('lessons/'+performanceProposal.record.id+'/approve',{confirm:true})
    const archivedPerformance=(await performanceArchive.call('/reports/performance/jobs/'+performanceSource.job.id)).performance
    assert.equal(archivedPerformance.lessons[0].approved.catalog_version,2);assert.equal(archivedPerformance.completion.completed_on,'2026-10-23')
    const costJobId=c.job.id
    const cookie=f.owner; await f.close();f=undefined
    const before=join(folder,'before.rer'), after=join(folder,'after.rer'), roundtrip=join(folder,'roundtrip.rer')
    succeeds(command(source,'export','--output',before))
    succeeds(command(destination,'import','--input',before,'--yes'))
    succeeds(command(destination,'export','--output',roundtrip))
    const original=await archive(before), restored=await archive(roundtrip)
    const rows = records => records.filter(r=>r.kind==='part').flatMap(r=>r.items)
    for(const exported of [original,restored]){
      const bytes=JSON.stringify(exported)
      for(const coordinate of ['44.000123','73.000123','44.123456','73.123456'])assert.ok(!bytes.includes(coordinate),'FIELD-002 worker coordinates are absent from every CLI archive record')
      const field=JSON.parse(rows(exported).find(r=>r.table==='pl_jobs'&&r.row.id===costJobId).row.data).field_time
      assert.deepEqual(field.location_choices,[archivedField.location_choice],'FIELD-002 retains only explicit consent and the latest inside state and reminder')
      assert.deepEqual(Object.keys(field.location_choices[0]).sort(),['by','consent','employee_id','inside','reminder'])
    }
    const receiver=await createFixture({persistTo:destination,ownerCookie:cookie})
    try{const outcome=await (await receiver.mf.getWorker()).scheduled({scheduledTime:new Date('2031-01-31T10:00:00Z'),cron:'0 * * * *'});assert.equal(outcome.outcome,'ok');assert.equal(receiver.messages.length,0,'AUTO-002 / CARE-003 restored pending reminders remain inert until an office person reconfirms the agreement under receiving authority')}finally{await receiver.close()}
    for(const exported of [original,restored]){
      for(const value of ['synthetic-plinth-private-path','synthetic-plinth-private-query'])assert.ok(!JSON.stringify(exported).includes(value),'OPS-002 endpoint paths and query credentials never enter a recovery archive')
      assert.deepEqual(rows(exported).find(item=>item.table==='pl_connector_bindings'&&item.row.id===connector.value.subscription.id).row,{id:connector.value.subscription.id,receiver_origin:'https://synthetic-plinth.example',job_ids:JSON.stringify([job.id]),event_types:JSON.stringify(['job.updated']),revoked_at:null},'OPS-002 inert connector scope survives private CLI recovery')
      assert.ok(!JSON.stringify(exported).includes(connector.value.signing_key),'INT-009 signing keys never enter a portable archive')
      assert.ok(!exported[0].tables.some(table=>['pl_connector_subscriptions','pl_connector_deliveries','pl_connector_event_order','pl_api_limits'].includes(table.name)),'INT-009 and INT-014 live receiver and standing-grant authority are excluded from restoration')
      assert.equal(rows(exported).find(item=>item.table==='pl_api_requests'&&item.row.operation_key==='synthetic-plinth-archive-draft').row.record_id,connectorDraft.value.draft.id,'INT-009 draft replay identity survives private CLI recovery')
    }
    for(const records of [rows(original),rows(restored)]){const recovered=JSON.parse(records.find(r=>r.table==='pl_jobs'&&r.row.id===performanceSource.job.id).row.data);assert.deepEqual(recovered.estimate_performance,archivedPerformance);assert.deepEqual(recovered.quotes,performanceSource.job.quotes)}
    const originalRows=rows(original),restoredRows=rows(restored),getCost=records=>JSON.parse(records.find(r=>r.table==='pl_jobs'&&r.row.id===costJobId).row.data).cost_records
    assert.deepEqual(getCost(restoredRows),getCost(originalRows));assert.equal(getCost(restoredRows).bills[0].document.base64,costOriginal.base64);assert.equal(getCost(restoredRows).periods.length,1);assert.equal(getCost(restoredRows).forecasts.length,1);assert.equal(getCost(restoredRows).reconciliations.length,1);assert.equal(Buffer.from(getCost(restoredRows).payroll_imports[0].document.base64,'base64').toString(),payrollCsv);assert.ok(!restoredRows.some(r=>['oa_sessions','oa_credentials','oa_tokens'].includes(r.table)))
    const authority=records=>JSON.parse(records.find(r=>r.table==='pl_jobs'&&r.row.id===costJobId).row.data).accounting_authority
    assert.deepEqual(authority(restoredRows),authority(originalRows));assert.equal(authority(restoredRows).accountant_id,accountantId);assert.equal(getCost(restoredRows).periods[0].native_review.by.id,accountantId);assert.deepEqual(getCost(restoredRows).periods[0].snapshot,nativePreview.snapshot)
    // The complete part stream, including binary cells, is unchanged by a restore.
    assert.ok(rows(original).length > 0)
    const expected=structuredClone(rows(original))
    // Base deliberately increments auth generation at restore to invalidate prior sessions.
    for(const item of expected) if(item.table==='oa_auth_settings') item.row.generation++
    assert.deepEqual(rows(restored),expected)
    const recoveredJob=rows(restored).find(item=>item.table==='pl_jobs'&&item.row.id===job.id);assert.ok(recoveredJob);assert.deepEqual(JSON.parse(recoveredJob.row.data).continuity,job.continuity,'AUTO-002 interrupted draft checkpoint and source links survive recovery unchanged')
    const recoveredPortalJob=JSON.parse(recoveredJob.row.data)
    assert.deepEqual(recoveredPortalJob.submittals,[archivedSubmittal.row],'DOC-004 exact rejected and approved cycles, originals, annotations, reviewer authority and deviations survive CLI recovery')
    assert.equal(recoveredPortalJob.orders.find(o=>o.id===archivedSubmittal.order.id).submittal_release.cycle_id,archivedSubmittal.row.cycles[1].id)
    assert.deepEqual(recoveredPortalJob.submittals[0].notices.map(n=>[n.status,n.cycle_id]),archivedSubmittal.row.cycles.map(c=>['accepted',c.id]),'Supplier notice identities, decisions, recipients and provider outcomes survive recovery without another send')
    assert.deepEqual(recoveredPortalJob.meetings,job.meetings,'DOC-005 private meeting, assigned completion and immutable work snapshot survive CLI recovery');assert.deepEqual(recoveredPortalJob.meeting_shares,originalRows.filter(r=>r.table==='pl_jobs'&&r.row.id===job.id).map(r=>JSON.parse(r.row.data).meeting_shares)[0],'DOC-005 extracts and prior recipient consent survive privately while pending delivery remains inert')
    for(const table of ['pl_mail_messages','pl_mail_files','pl_mail_originals','pl_decision_metadata','pl_file_transcriptions']){const records=records=>records.filter(r=>r.table===table&&r.row.job_id===job.id);assert.ok(records(originalRows).length>0);assert.deepEqual(records(restoredRows),records(originalRows),'DOC-005 private original email, file bytes, checksums and annotations survive recovery')}
    const recoveredSearch=await createFixture({persistTo:destination,ownerCookie:cookie});try{assert.equal((await recoveredSearch.request('/auth/magic-link',{method:'POST',body:{email:['builder','example.com'].join('@')}})).status,202);const confirmation=new URL(recoveredSearch.messages.at(-1).text.match(/https?:\/\/[^\s<>]+/g).find(value=>new URL(value).pathname==='/auth/confirm'));const signedIn=await recoveredSearch.request('/auth/confirm',{method:'POST',body:{token:confirmation.searchParams.get('token')}});assert.equal(signedIn.status,303);const receivingCookie=signedIn.headers.get('set-cookie').split(';')[0];const recoveredPlans=await recoveredSearch.json(planRoot,{cookie:receivingCookie});assert.equal(recoveredPlans.status,200);assert.deepEqual(recoveredPlans.value.plans.sets[0].annotations,archiveDistribution.annotations);assert.deepEqual(recoveredPlans.value.plans.sets[0].recipients,archiveDistribution.recipients);const recoveredPlanOriginal=await recoveredSearch.request(`${planRoot}/${archiveSetId}/files/${archiveSheet.id}`,{cookie:receivingCookie});assert.equal(recoveredPlanOriginal.status,200);assert.deepEqual(Buffer.from(await recoveredPlanOriginal.arrayBuffer()),scanned);const recoveredRegister=await recoveredSearch.json('/api/plinth/jobs/'+job.id+'/submittals',{cookie:receivingCookie});assert.equal(recoveredRegister.status,200);assert.deepEqual(recoveredRegister.value.register,[archivedSubmittal.row]);const restoredCycle=archivedSubmittal.row.cycles.at(-1);const replayNotice=await recoveredSearch.json('/api/plinth/jobs/'+job.id+'/submittals/'+archivedSubmittal.row.id+'/notify',{method:'POST',cookie:receivingCookie,body:{expected_version:recoveredRegister.value.version,cycle_id:restoredCycle.id,product_reference:restoredCycle.product_reference,to:archivedSubmittal.order.vendor_email,confirm:true}});assert.equal(replayNotice.status,409);assert.equal(replayNotice.value.error,'mail_reserved');for(const [cycle,bytes] of [[archivedSubmittal.row.cycles[0],archivedSubmittal.original],[archivedSubmittal.row.cycles[1],archivedSubmittal.revised]]){const originalFile=await recoveredSearch.request('/api/plinth/jobs/'+job.id+'/submittals/files/'+cycle.attachments[0].id,{cookie:receivingCookie});assert.equal(originalFile.status,200);assert.deepEqual(Buffer.from(await originalFile.arrayBuffer()),bytes)}const recoveredPayments=await recoveredSearch.json(`/api/plinth/jobs/${billing.id}/payments`,{cookie:receivingCookie});assert.equal(recoveredPayments.status,200);assert.equal(recoveredPayments.value.enabled,false,'BILL-005 the receiving installation requires its own processor configuration');assert.deepEqual(recoveredPayments.value.refunds,paymentHistory.refunds);assert.deepEqual(recoveredPayments.value.attempts,paymentHistory.attempts);assert.equal(processor.refunds.length,processorEffects);const found=await recoveredSearch.json(`/api/plinth/jobs/${job.id}/decision-search?`+new URLSearchParams({q:'A2 - Laundry plan',tag:'archive-bid',sheet:'A1',cost_code:'22-400'}),{cookie:receivingCookie});assert.equal(found.status,200);assert.ok(found.value.results.some(result=>result.source==='files:'+captured.files[0].id&&result.extraction.status==='complete'));const recoveredText=await recoveredSearch.json(`/api/plinth/jobs/${job.id}/decision-search/transcriptions?`+new URLSearchParams({source:transcriptionSource}),{cookie:receivingCookie});assert.equal(recoveredText.status,200);assert.deepEqual(recoveredText.value.revisions.map(r=>({text:r.text,revision:r.revision,checksum:r.checksum,supplied_by:r.supplied_by})),[{text:transcriptionText,revision:1,checksum:originalHit.file_checksum,supplied_by:transcriptionSaved.value.transcription.supplied_by}]);assert.equal(found.value.results.find(r=>r.source===transcriptionSource).transcription.revision,1);const inactive=await recoveredSearch.json(`/api/plinth/jobs/${job.id}/meeting-shares/${archiveShare.id}/email-preview?request_id=${pendingCopy.value.record.id}`,{cookie:receivingCookie});assert.equal(inactive.status,409);assert.equal(inactive.value.error,'mail_authority');assert.equal(recoveredSearch.messages.length,1,'Only the receiving owner sign-in mail is sent; restored meeting email work stays inert');const historical=await recoveredSearch.json('/api/plinth/jobs/'+surveyArchive.job.id+'/satisfaction',{cookie:receivingCookie});assert.equal(historical.status,200);assert.deepEqual(historical.value.surveys,archivedSurveyState,'CARE-004 exact survey settings, consent attribution, response, review permission and assigned follow-up survive the native CLI archive');const staleSurvey=await recoveredSearch.json('/api/plinth/jobs/'+surveyArchive.job.id+'/satisfaction/'+surveyId+'/request-review',{method:'POST',cookie:receivingCookie,body:{expected_version:historical.value.version,confirm:true}});assert.equal(staleSurvey.status,409);assert.equal(staleSurvey.value.error,'historical_survey');assert.equal(recoveredSearch.messages.length,1,'CARE-004 restored review permission never authorizes an outbound request')}finally{await recoveredSearch.close()}
    const delegationProof=selections=>selections.map(s=>({delegations:s.delegations,signatures:s.revisions.map(r=>r.signature)}))
    assert.deepEqual(delegationProof(recoveredPortalJob.selections),delegationProof(job.selections),'CLIENT-006 delegation, exact signature and delegating client survive CLI archive restore unchanged')
    assert.equal(recoveredPortalJob.selections[0].revisions[0].signature.delegation.delegated_by.name,'Client Chen');assert.equal(recoveredPortalJob.selections[0].revisions[0].signature.delegation.delegate.name,'Archive delegated designer')
    assert.deepEqual(recoveredPortalJob.portal_submissions,archivePortal,'ROLE-003 company/scope identities, submission status and original checksums survive CLI restore')
    assert.deepEqual(recoveredPortalJob.portal_policy,job.portal_policy,'ROLE-003 owner feature restrictions survive CLI restore')
    const recoveredPortalVendor=JSON.parse(rows(restored).find(item=>item.table==='pl_vendors'&&item.row.id===portalGrant.vendor.id).row.data)
    assert.equal(recoveredPortalVendor.compliance[0].id,portalCompliance.compliance_id);assert.equal(recoveredPortalVendor.compliance[0].review,undefined,'ROLE-003 restore never verifies the submitted license')
    assert.ok(rows(restored).some(item=>item.table==='pl_vendor_documents'&&item.row.id===portalCompliance.compliance_id),'ROLE-003 exact company compliance original is included in the private archive')
    for(const submission of archivePortal)for(const file of submission.attachments)assert.ok(rows(restored).some(item=>item.table==='pl_attachments'&&item.row.id===file.id&&item.row.job_id===job.id),'ROLE-003 every job-local original is in the archive')
    assert.deepEqual(JSON.parse(recoveredJob.row.data).todos[0],savedTodo,'TODO-001 job checklist, original photo bytes, assignments and reserved notice identities survive CLI restore')
    const recoveredCompany=rows(restored).find(item=>item.table==='pl_todo_library'&&item.row.id===archiveCompanyTodo.id);assert.ok(recoveredCompany,'TODO-001 company-level records are in the durable archive inventory');const companyData=JSON.parse(recoveredCompany.row.data);assert.equal(companyData.attachments[0].base64,png);assert.deepEqual(companyData.items,archiveCompanyTodo.items);assert.deepEqual(companyData.notices,archiveCompanyTodo.notices)
    assert.ok(!restored[0].tables.some(t=>['oa_sessions','oa_credentials','oa_tokens'].includes(t.name)))
    const serialized=JSON.stringify(restored)
    assert.ok(serialized.includes('Signed archive retainage section RT-104')&&serialized.includes('Human reviewed signed inspection PI-104'),'BILL-003 immutable terms, withholding snapshots and release evidence survive CLI recovery')
    const billingRecords=records=>records.filter(r=>r.table==='pl_jobs'&&r.row.id===billing.id).map(r=>JSON.parse(r.row.data))[0]
    assert.deepEqual(billingRecords(restoredRows).invoices,billingRecords(originalRows).invoices,'BILL-005 original issues, linked correction documents, private write-offs and processor reversal receipts survive recovery exactly')
    assert.deepEqual(billingRecords(restoredRows).invoices.map(i=>[i.corrections,i.write_offs]),billing.invoices.map(i=>[i.corrections,i.write_offs]))
    for(const table of ['pl_payment_attempts','pl_payment_refunds']){
      const select=records=>records.filter(r=>r.table===table);assert.ok(select(originalRows).length);assert.deepEqual(select(restoredRows),select(originalRows),'BILL-005 stable payment identities, exact refund decisions and durable pending reservations survive CLI recovery')
    }
    const restoredRefunds=restoredRows.filter(r=>r.table==='pl_payment_refunds').map(r=>r.row)
    for(const reservation of paymentHistory.refunds){const row=restoredRefunds.find(r=>r.id===reservation.id);assert.ok(row);assert.equal(row.attempt_id,paymentCheckout.value.attempt.id);assert.equal(row.status,reservation.status);assert.equal(row.amount_cents,reservation.amount_cents);assert.equal(row.provider_id,reservation.provider_id);assert.equal(row.created_by,processorOriginal.issued.issued_by.id);assert.equal(row.reason,'Synthetic archive exact human refund')}
    assert.equal(processor.refunds.length,processorEffects,'BILL-005 restoring refund reservations never repeats a processor instruction')
    const recoveredBilling=JSON.parse(rows(restored).find(item=>item.table==='pl_jobs'&&item.row.id===billing.id).row.data);assert.deepEqual(recoveredBilling.remittances,billing.remittances,'BILL-006 remittance evidence, allocation identity, return history and unapplied cash survive CLI recovery');assert.deepEqual(recoveredBilling.retainage,billing.retainage);assert.deepEqual(recoveredBilling.subcontracts[0].retainage,billing.subcontracts[0].retainage,'BILL-003 independent supplier terms and release sources survive CLI recovery');assert.deepEqual(recoveredBilling.invoices.map(i=>i.issued),billing.invoices.map(i=>i.issued),'BILL-002 original invoice numbers, pricing and tax and commercial snapshots survive recovery');assert.deepEqual(recoveredBilling.invoices.map(i=>[i.receipts,i.deposit_applications]),billing.invoices.map(i=>[i.receipts,i.deposit_applications]),'BILL-006 / BILL-002 direct and deposit receipts, original-linked return reversals and unearned deposit allocations survive recovery');assert.equal(rows(restored).find(item=>item.table==='pl_invoice_sequence').row.next_number,Math.max(...billing.invoices.flatMap(i=>[i.number,...(i.corrections??[]).map(c=>c.document.number)]).map(n=>Number(n.split('-').at(-1))))+1,'BILL-002 the next invoice sequence survives private CLI recovery');assert.deepEqual(recoveredBilling.approvals,billing.approvals,'BILL-006 return reasons, evidence and human decisions survive recovery');assert.deepEqual(recoveredBilling.claims,billing.claims,'BILL-003 issued gross/withheld/net application identity survives unchanged')
    assert.ok(serialized.includes('Archive exact revised design response')&&serialized.includes('Archive pending decision reminder, not sent'),'DOC-003 / CLIENT-005 attributed revision and original custody survive recovery');assert.ok(rows(restored).some(r=>r.table==='pl_schedule_resources'&&r.row.id===capacity.value.resource.id),'SCH-003 resource calendars survive recovery')
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
    await proveConnectorRecovery(destination,cookie,{id:connector.value.subscription.id,receiver_origin:'https://synthetic-plinth.example',job_ids:[job.id],event_types:['job.updated'],revoked_at:null},revokedConnector.value.subscription.id,connectorCredential.id,connector.value.signing_key)
    f=await createFixture({persistTo:source,ownerCookie:cookie})
    r=await f.json(`/api/plinth/jobs/${job.id}`,{method:'DELETE',cookie:f.owner,body:{expected_version:job.version}});assert.equal(r.status,200)
    const costCurrent=(await f.json(`/api/plinth/jobs/${costJobId}`,{cookie})).value.job
    const performanceCurrent=(await f.json('/api/plinth/jobs/'+performanceSource.job.id,{cookie})).value.job;assert.equal((await f.request('/api/plinth/jobs/'+performanceSource.job.id,{method:'DELETE',cookie,body:{expected_version:performanceCurrent.version}})).status,200)
    const erasedResponse=await f.request(`/api/plinth/jobs/${costJobId}`,{method:'DELETE',cookie,body:{expected_version:costCurrent.version}});assert.equal(erasedResponse.status,200)
    await f.close(); f=undefined
    succeeds(command(source,'export','--output',after))
    const erasedRows=rows(await archive(after))
    assert.ok(!erasedRows.some(r=>r.table==='pl_jobs'&&r.row.id===costJobId))
    assert.ok(!erasedRows.some(item=>item.table==='pl_plan_file_chunks'&&item.row.job_id===job.id),'DOC-001 erasure removes every large plan chunk')
    assert.ok(!erasedRows.some(item=>item.table==='pl_jobs'&&item.row.id===job.id),'DOC-004 erasure removes the complete register before old-archive replay is fenced')
    assert.ok(!erasedRows.some(r=>r.table==='pl_jobs'&&r.row.id===performanceSource.job.id),'Completed-job lessons and their source estimates disappear before the old archive is fenced')
    assert.ok(!erasedRows.some(item=>item.table==='pl_attachments'&&item.row.job_id===job.id),'ROLE-003 erasure removes job-local submission originals')
    assert.ok(!erasedRows.some(item=>['pl_mail_messages','pl_mail_files','pl_mail_originals','pl_decision_metadata','pl_file_transcriptions'].includes(item.table)&&item.row.job_id===job.id),'DOC-005 erasure removes correspondence originals and annotations before the journal fences the old archive')
    assert.ok(erasedRows.some(item=>item.table==='pl_vendor_documents'&&item.row.id===portalCompliance.compliance_id),'ROLE-003 company compliance evidence keeps its independent company custody')

    await cp(after,join(erased,'after-erasure.rer'))
    const refused=command(erased,'import','--input',before,'--journal','after-erasure.rer','--yes')
    assert.equal(refused.status,4); assert.match(refused.stdout+refused.stderr,/erasure_epoch/)
  } finally { if(f) await f.close(); await rm(folder,{recursive:true,force:true}) }
})
