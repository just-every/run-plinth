import {setPortalFeatures} from './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createFixture} from './helpers.mjs'

test('BILL-005 — human corrections preserve paid and retained invoices, close reviewed tax exactly, isolate disputed write-offs and void only untouched requests',async()=>{
 const f=await createFixture();try{
  const email='synthetic-plinth-client-5@example.com',client=await f.invite(email),foreign=await f.invite('synthetic-plinth-client-6@example.com'),agent=await f.agent(),admin=await f.invite('synthetic-plinth-admin-5@example.com','Office administrator','admin')
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{...(body===undefined?{}:{method:'POST',body}),cookie,token})
  let job=(await api('/jobs',{name:'Reviewed change invoice correction ledger',client_email:email,address:'22 Synthetic Street'})).value.job
  const attempt=(path,body={},cookie=f.owner,token)=>api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie,token)
  const read=async()=>job=(await api(`/jobs/${job.id}`)).value.job
  const act=async(path,body={},cookie=f.owner)=>{const r=await attempt(path,body,cookie);assert.equal(r.status,200,JSON.stringify(r.value));job=r.value.job;return r.value.record}
  const unchanged=async(path,body,status)=>{const before=await read(),r=await attempt(path,body);assert.equal(r.status,status,JSON.stringify(r.value));assert.deepEqual(await read(),before)}
  await act('/quotes',{lines:[{id:'synthetic-plinth-scope-5',description:'Reviewed exempt original scope',cost_code:'06-100',category:'material',phase:'Construction',quantity:'1',unit:'job',unit_cents:50000,cost_unit_cents:30000}]})
  const rate=(await api('/pricing-rates',{jurisdiction:'Human reviewed synthetic jurisdiction',kind:'sales',percent:'10',effective_on:'2026-01-01',reference:'synthetic-plinth-tax-5',human_reviewed:true})).value.rate
  const pricing={basis:'sell',as_of:'2026-10-21',rules:[],tax:{rate_id:rate.id,taxable_line_ids:[],exemption_reference:'Reviewed original scope exemption'}}
  const preview=await attempt('/pricing/preview',pricing);assert.equal(preview.status,200);await act('/pricing/apply',{...pricing,digest:preview.value.preview.digest})
  await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Reviewed synthetic signed contract',schedule_choice:{kind:'none',reason:'Construction planned separately'}})
  const change={description:'Taxable client approved addition',direction:'charge',basis:'sell',as_of:'2026-10-21',lines:[{id:'synthetic-plinth-change-5',description:'Added taxable finish',cost_code:'06-100',phase:'Addition',category:'material',quantity:'1',unit:'job',unit_cents:10001,cost_unit_cents:6000}],rules:[],tax:{rate_id:rate.id,taxable_line_ids:['synthetic-plinth-change-5']}}
  const priced=await attempt('/variation-pricing/preview',change);assert.equal(priced.status,200);await act('/variation-pricing/apply',{...change,digest:priced.value.preview.digest})
  await act(`/variations/${job.variations.at(-1).id}/approve`,{},client);await read();await act('/sov',{code_assignments:{['variation:'+job.variations.at(-1).id]:'06-100'}})
  const changeId=job.variations.at(-1).id,sourceId='variation:'+changeId,quoteId='quote:synthetic-plinth-scope-5'
  const invoiceInput={kind:'milestone',recipient_email:email,due_on:'2026-11-04',terms:'Due within fourteen calendar days under the reviewed agreement'}
  const issue=async(originalCents,description)=>{
   const claim=await act('/claims',{description,lines:[{line_id:quoteId,completed_cents:originalCents,stored_cents:0,evidence:'Reviewed original work'},{line_id:sourceId,completed_cents:11001,stored_cents:0,evidence:'Reviewed installed addition'}]})
   await act(`/claims/${claim.id}/approve`);await act(`/claims/${claim.id}/issue`)
   const row=await act('/invoices',{...invoiceInput,source_application_id:claim.id,description});await act(`/invoices/${row.id}/issue`);return job.invoices.find(i=>i.id===row.id)
  }
  const paid=await issue(0,'Issued change-order milestone'),paidId=paid.id,original=structuredClone(paid.issued)
  assert.equal(original.gross_cents,11001);assert.equal(original.tax_cents,1000)
  const originalHtml=await(await f.request(`/api/plinth/jobs/${job.id}/invoices/${paidId}/document.html`,{cookie:f.owner})).text()
  await act(`/invoices/${paidId}/receipt`,{amount_cents:11001,method:'bank',received_on:'2026-10-22',reference:'synthetic-plinth-settlement-5',confirm:true})
  const receipt=structuredClone(job.invoices.find(i=>i.id===paidId).receipts[0])
  const correction={operation_id:'synthetic-plinth-operation-5',confirm:true,reason:'Private negotiated material dispute and office review',description:'Agreed partial credit for the addition',lines:[{invoice_line_id:sourceId,amount_cents:3333}]},path=`/invoices/${paidId}`
  const draftClerk=await f.invite('synthetic-plinth-invoice-clerk@example.com','Invoice draft clerk','admin')
  const clerkRole=await api('/roles',{copy_of:'administrator',name:'Invoice drafting without approval',permissions:{invoices:{approve:false}}});assert.equal(clerkRole.status,201)
  const clerk=(await api('/team')).value.team.find(p=>p.email==='synthetic-plinth-invoice-clerk@example.com')
  assert.equal((await f.json('/api/plinth/team/'+clerk.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'custom',role_id:clerkRole.value.role.id,job_ids:[],po_limit_cents:0}})).status,200)
  assert.equal((await attempt(path+'/credit',correction,draftClerk)).status,403,'Invoice draft editing never grants final correction approval')
  for(const [cookie,token,status] of [[client,undefined,403],[foreign,undefined,404],[undefined,agent,403]])assert.equal((await attempt(path+'/credit',correction,cookie,token)).status,status)
  await unchanged(path+'/credit',{...correction,confirm:false},400);await unchanged(path+'/credit',{...correction,reason:''},400)
  await unchanged(path+'/credit',{...correction,lines:[{invoice_line_id:sourceId,amount_cents:11002}]},409)
  await unchanged(path+'/credit',{...correction,lines:[{invoice_line_id:sourceId,amount_cents:1.5}]},400)
  await unchanged(path+'/credit',{...correction,lines:[...correction.lines,...correction.lines]},400)
  await unchanged(path+'/debit',correction,409)
  await act(path+'/credit',correction)
  let current=job.invoices.find(i=>i.id===paidId),credit=structuredClone(current.corrections[0])
  assert.equal(current.balance.due_cents,-3333);assert.equal(current.balance.received_cents,11001);assert.equal(current.balance.credited_cents,3333)
  assert.equal(credit.document.tax_cents,-303);assert.equal(credit.document.subtotal_cents,-3030);assert.equal(credit.document.original_invoice_id,paidId);assert.equal(credit.document.original_invoice_number,original.number)
  assert.equal(credit.document.terms,original.terms);assert.equal(credit.document.due_on,original.due_on)
  assert.equal(credit.document.accounting_entries.reduce((n,e)=>n+e.debit_cents-e.credit_cents,0),0)
  assert.equal(credit.document.accounting_entries.find(e=>e.account==='accounts_receivable').credit_cents,3333)
  await unchanged(path+'/credit',correction,409)
  await unchanged(path+'/credit',{...correction,operation_id:'synthetic-plinth-operation-stale-5',expected_version:job.version-1},409)
  await unchanged(path+'/void',{...correction,operation_id:'synthetic-plinth-void-paid-5',lines:undefined},409)
  await act(path+'/debit',{...correction,operation_id:'synthetic-plinth-operation-6',description:'Restore the separately reviewed part of the credit',lines:[{invoice_line_id:sourceId,amount_cents:1000}]})
  current=job.invoices.find(i=>i.id===paidId);assert.equal(current.balance.due_cents,-2333);assert.equal(current.balance.debited_cents,1000);assert.equal(current.corrections[1].document.tax_cents,91)
  const raceInput={...correction,operation_id:'synthetic-plinth-operation-7',expected_version:job.version,lines:[{invoice_line_id:sourceId,amount_cents:1}]}
  const race=await Promise.all([1,2].map(()=>attempt(path+'/credit',raceInput)));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);await read()
  await act(path+'/credit',{...correction,operation_id:'synthetic-plinth-operation-8',lines:[{invoice_line_id:sourceId,amount_cents:8667}]})
  current=job.invoices.find(i=>i.id===paidId)
  assert.equal(current.balance.payable_cents,0);assert.equal(current.balance.due_cents,-11001);assert.equal(current.corrections.reduce((n,c)=>n+c.document.tax_cents,0),-1000)
  assert.deepEqual(current.corrections[0],credit);assert.deepEqual(current.issued,original);assert.deepEqual(current.receipts,[receipt])
  const residual=await issue(50000,'Separate disputed original-scope residual'),residualPath=`/invoices/${residual.id}`
  await act(residualPath+'/receipt',{amount_cents:10000,method:'check',received_on:'2026-10-23',reference:'synthetic-plinth-settlement-6',confirm:true})
  const writeoff={operation_id:'synthetic-plinth-operation-9',amount_cents:40000,confirm:true,reason:'Private disputed residual accepted as uncollectible',dispute_reference:'synthetic-plinth-dispute-5'}
  await unchanged(residualPath+'/write-off',{...writeoff,amount_cents:40001},409)
  await unchanged(residualPath+'/write-off',{...writeoff,dispute_reference:''},400)
  await unchanged(residualPath+'/credit',{...correction,lines:[{invoice_line_id:quoteId,amount_cents:1}]},409)
  await act(residualPath+'/write-off',writeoff,admin)
  const written=job.invoices.find(i=>i.id===residual.id);assert.equal(written.balance.due_cents,0);assert.equal(written.balance.written_off_cents,40000);assert.equal(written.balance.credited_cents,0);assert.equal(written.balance.received_cents,10000)
  assert.equal(written.write_offs[0].accounting_entries.reduce((n,e)=>n+e.debit_cents-e.credit_cents,0),0)
  assert.deepEqual(written.issued,residual.issued);await unchanged(residualPath+'/write-off',writeoff,409)
  assert.equal(JSON.stringify((await api(`/jobs/${job.id}`,undefined,client)).value).includes('accounting_entries'),false)
  const deposit=await act('/invoices',{...invoiceInput,kind:'deposit',amount_cents:10000,description:'Unpaid deposit request to void'}),depositPath=`/invoices/${deposit.id}`
  await act(depositPath+'/issue');const depositOriginal=structuredClone(job.invoices.find(i=>i.id===deposit.id).issued)
  await act(depositPath+'/credit',{...correction,operation_id:'synthetic-plinth-operation-10',lines:[{invoice_line_id:depositOriginal.lines[0].id,amount_cents:1}]})
  await act(depositPath+'/void',{operation_id:'synthetic-plinth-operation-11',confirm:true,reason:'Private duplicate request review',description:'Void of unused deposit request'})
  const voided=job.invoices.find(i=>i.id===deposit.id)
  assert.equal(voided.balance.due_cents,0);assert.equal(voided.corrections.at(-1).document.kind,'void');assert.equal(voided.corrections.at(-1).document.gross_cents,-9999)
  assert.equal(voided.corrections.reduce((n,c)=>n+c.document.tax_cents,0),-depositOriginal.tax_cents);assert.deepEqual(voided.issued,depositOriginal)
  await unchanged(depositPath+'/credit',{...correction,operation_id:'synthetic-plinth-operation-12'},409)
  const tiny=await act('/invoices',{...invoiceInput,kind:'deposit',amount_cents:1,description:'Small original share before reviewed debit'}),tinyPath=`/invoices/${tiny.id}`
  await act(tinyPath+'/issue');const tinyOriginal=structuredClone(job.invoices.find(i=>i.id===tiny.id).issued),tinyLine=tinyOriginal.lines[0].id
  assert.equal(tinyOriginal.tax_cents,0)
  await act(tinyPath+'/debit',{...correction,operation_id:'synthetic-plinth-operation-13',lines:[{invoice_line_id:tinyLine,amount_cents:1000}]})
  assert.equal(job.invoices.find(i=>i.id===tiny.id).corrections[0].document.tax_cents,16,'A debit uses remaining reviewed source tax even when the original tiny share rounded to zero')
  await act(tinyPath+'/credit',{...correction,operation_id:'synthetic-plinth-operation-14',lines:[{invoice_line_id:tinyLine,amount_cents:501}]})
  await act(tinyPath+'/credit',{...correction,operation_id:'synthetic-plinth-operation-15',lines:[{invoice_line_id:tinyLine,amount_cents:500}]})
  const closed=job.invoices.find(i=>i.id===tiny.id)
  assert.equal(closed.balance.payable_cents,0);assert.equal(closed.corrections.reduce((n,c)=>n+c.document.tax_cents,0),0,'Separate partial credits close both original and debit tax lots exactly')
  assert.deepEqual(closed.issued,tinyOriginal)
  for(const endpoint of [`/jobs/${job.id}`,'/jobs',`/jobs/${job.id}/invoices/${paidId}/document.json`]){
   const response=await api(endpoint,undefined,client);assert.equal(response.status,200)
   const serialized=JSON.stringify(response.value);assert.equal(serialized.includes(correction.reason),false);assert.equal(serialized.includes(writeoff.reason),false);assert.equal(serialized.includes(writeoff.dispute_reference),false);assert.equal(serialized.includes('Private duplicate request review'),false)
   const shown=response.value.invoice??(response.value.job??response.value.jobs.find(j=>j.id===job.id)).invoices.find(i=>i.id===paidId)
   const {accounting_entries: _entries,...publicDocument}=credit.document;assert.deepEqual(shown.corrections[0].document,publicDocument);assert.equal(shown.corrections[0].document.accounting_entries,undefined);assert.equal(shown.corrections[0].operation_id,undefined)
  }
  assert.equal(await(await f.request(`/api/plinth/jobs/${job.id}/invoices/${paidId}/document.html`,{cookie:f.owner})).text(),originalHtml)
  const documents=job.invoices.flatMap(i=>(i.corrections??[]).map(c=>c.document.number));assert.equal(new Set(documents).size,documents.length)
  assert.ok(job.approvals.some(a=>a.kind==='invoice.credit'&&a.snapshot.reason===correction.reason));assert.ok(job.approvals.some(a=>a.kind==='invoice.write_off'&&a.snapshot.reason===writeoff.reason))
  job=(await api('/jobs',{name:'Retained contract draw corrections',client_email:email,address:'22 Synthetic Street'})).value.job
  await act('/quotes',{lines:[{id:'synthetic-plinth-retained-5',description:'Reviewed taxable retained work',cost_code:'06-100',category:'material',phase:'Construction',quantity:'1',unit:'job',unit_cents:10000,cost_unit_cents:5000}]})
  const retainedPricing={...pricing,tax:{rate_id:rate.id,taxable_line_ids:['synthetic-plinth-retained-5']}}
  const retainedPreview=await attempt('/pricing/preview',retainedPricing);assert.equal(retainedPreview.status,200)
  await act('/pricing/apply',{...retainedPricing,digest:retainedPreview.value.preview.digest})
  await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Reviewed retained contract',schedule_choice:{kind:'none',reason:'Schedule separately'}})
  await act('/sov',{})
  const retainedLine='quote:synthetic-plinth-retained-5'
  await act('/retainage',{contract_reference:'Signed five percent contract hold',rules:[{line_id:retainedLine,work_bps:500,stored_bps:500}],milestones:[{id:'synthetic-plinth-completion',name:'Inspected completion',completion_requirements:['Inspection'],waiver_requirements:[]}]})
  const app=await act('/claims',{description:'Taxable retained work',lines:[{line_id:retainedLine,completed_cents:11000,stored_cents:0,evidence:'Reviewed installed work'}]})
  await act(`/claims/${app.id}/approve`);await act(`/claims/${app.id}/issue`)
  const retained=await act('/invoices',{...invoiceInput,source_application_id:app.id,description:'Retained draw'})
  await act(`/invoices/${retained.id}/issue`)
  const retainedOriginal=structuredClone(job.invoices.find(i=>i.id===retained.id).issued),retainedPath=`/invoices/${retained.id}`
  assert.equal(retainedOriginal.withheld_cents,550)
  await act(retainedPath+'/receipt',{amount_cents:10450,method:'bank',received_on:'2026-10-26',reference:'synthetic-plinth-retained-payment',confirm:true})
  await act(retainedPath+'/credit',{...correction,operation_id:'synthetic-plinth-retained-credit',lines:[{invoice_line_id:retainedLine,amount_cents:1100}]})
  let retainedCurrent=job.invoices.find(i=>i.id===retained.id)
  assert.equal(retainedCurrent.balance.due_cents,-1100);assert.equal(retainedCurrent.balance.withheld_cents,550);assert.equal(retainedCurrent.corrections[0].document.tax_cents,-100)
  await unchanged(retainedPath+'/credit',{...correction,operation_id:'synthetic-plinth-retained-excess',lines:[{invoice_line_id:retainedLine,amount_cents:9900}]},409)
  await act(retainedPath+'/debit',{...correction,operation_id:'synthetic-plinth-retained-debit',lines:[{invoice_line_id:retainedLine,amount_cents:550}]})
  await act('/retainage/release',{claim_id:app.id,milestone_id:'synthetic-plinth-completion',lines:[{line_id:retainedLine,amount_cents:550}],completion_references:[{requirement:'Inspection',reference:'synthetic-plinth-inspection'}],waiver_references:[]})
  retainedCurrent=job.invoices.find(i=>i.id===retained.id)
  assert.equal(retainedCurrent.balance.due_cents,0);assert.equal(retainedCurrent.balance.released_retainage_cents,550);assert.deepEqual(retainedCurrent.issued,retainedOriginal)
  assert.equal(retainedCurrent.corrections.reduce((n,c)=>n+c.document.tax_cents,0),-50)
  for(const c of retainedCurrent.corrections)assert.equal(c.document.accounting_entries.reduce((n,e)=>n+e.debit_cents-e.credit_cents,0),0)
 }finally{await f.close()}
})

test('BILL-002 — numbered deposit and milestone invoices retain reviewed source tax, bank evidence, unearned liability, partial allocations and independent client/delivery history',async()=>{
 const f=await createFixture()
 try {
  const client=await f.invite('invoice-client@example.com'),foreign=await f.invite('invoice-other@example.com'),agent=await f.agent()
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{...(body===undefined?{}:{method:'POST',body}),cookie,token})
  let job=(await api('/jobs',{name:'Maple Street deposit and framing milestone',client_email:'invoice-client@example.com',address:'2480 Maple Street, Burlington, VT 05401',time_zone:'America/New_York'})).value.job
  const act=async(path,body={},cookie=f.owner,token)=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie,token);if(r.value.job&&cookie===f.owner&&!token)job=r.value.job;return r}
  const read=async()=>job=(await api(`/jobs/${job.id}`)).value.job
  assert.equal((await act('/quotes',{lines:[{id:'material',description:'Framing material',cost_code:'06-100',phase:'Framing',category:'material',quantity:'1',unit:'job',unit_cents:1000000,cost_unit_cents:750000},{id:'labor',description:'Framing labor',cost_code:'06-200',phase:'Framing',category:'labor',quantity:'1',unit:'job',unit_cents:1000000,cost_unit_cents:600000}]})).status,200)
  const rate=(await api('/pricing-rates',{jurisdiction:'Human-reviewed fixture jurisdiction',kind:'sales',percent:'10',effective_on:'2026-01-01',reference:'Reviewed fixture taxable materials and labor exemption',human_reviewed:true})).value.rate
  const price={basis:'sell',as_of:'2026-10-21',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['material'],exemption_reference:'Reviewed labor exemption'}}
  let r=await act('/pricing/preview',price);assert.equal(r.status,200);assert.equal((await act('/pricing/apply',{...price,digest:r.value.preview.digest})).status,200)
  assert.equal((await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Externally signed contract with fixed deposit and framing milestone',schedule_choice:{kind:'none',reason:'Construction dates planned separately'}})).status,200)
  await act('/sov',{})
  const terms={recipient_email:'invoice-client@example.com',due_on:'2026-11-01',terms:'Bank/check within 14 calendar days of invoice; client retainage per signed agreement'}
  const depositInput={...terms,kind:'deposit',description:'Signed contract deposit',amount_cents:200000}
  assert.equal((await act('/invoices',{...depositInput,recipient_email:'unassigned@example.com'})).status,403)
  r=await act('/invoices',depositInput);assert.equal(r.status,200);const depositId=r.value.record.id
  for(const auth of [{cookie:client},{cookie:undefined,token:agent}])assert.equal((await act(`/invoices/${depositId}/issue`,{},auth.cookie,auth.token)).status,403)
  assert.equal((await act(`/invoices/${depositId}/issue`)).status,200)
  const issuedDeposit=structuredClone(job.invoices.find(i=>i.id===depositId).issued);assert.equal(issuedDeposit.earned_revenue_cents,0);assert.equal(issuedDeposit.gross_cents,200000);assert.equal(job.invoice_deposit_liability_cents,0)
  assert.equal((await act(`/invoices/${depositId}/issue`)).status,409)
  job=await setPortalFeatures(f,job.id,['billing'])
  const heldMail=f.messages.length
  assert.equal((await act(`/invoices/${depositId}/send`,{confirm:true})).status,403)
  assert.equal(f.messages.length,heldMail,'A disabled billing preset blocks outbound invoice details before reservation')
  for(const ext of ['json','html','csv'])assert.equal((await f.request(`/api/plinth/jobs/${job.id}/invoices/${depositId}/document.${ext}`,{cookie:client})).status,404)
  job=await setPortalFeatures(f,job.id)
  assert.equal((await act(`/invoices/${depositId}/send`,{confirm:true})).status,200);assert.equal(job.invoices.find(i=>i.id===depositId).delivery.status,'accepted');assert.equal(f.messages.at(-1).to[0],'invoice-client@example.com');assert.equal(job.invoice_deposit_liability_cents,0,'BILL-002 mail acceptance is not funds')
  assert.equal((await act(`/invoices/${depositId}/send`,{confirm:true})).status,409,'BILL-002 one durable mail attempt cannot silently resend')
  const attempt=job.invoices.find(i=>i.id===depositId).delivery.attempt_id,thread=(await f.json(`/api/plinth/jobs/${job.id}/correspondence`,{cookie:f.owner})).value.messages;assert.ok(thread.some(m=>m.id===attempt&&m.kind==='invoice'&&m.required&&m.status==='accepted'),'INT-007 an invoice send joins the job thread as required mail')
  const acknowledgment=await act(`/invoices/${depositId}/accept`,{confirm:true,statement:'I acknowledge this exact deposit invoice'},client);assert.equal(acknowledgment.status,200);assert.ok(!JSON.stringify(acknowledgment.value.record).includes('cost_unit_cents'));assert.ok(!JSON.stringify(acknowledgment.value.record).includes('Reviewed fixture taxable materials')); await read();assert.equal(job.invoice_deposit_liability_cents,0,'BILL-002 client acknowledgment is not payment')
  const receipt={amount_cents:200000,received_on:'2026-10-22',reference:'Bank statement reference BS-104, human checked',method:'bank',confirm:true}
  for(const auth of [{cookie:client},{cookie:undefined,token:agent}])assert.equal((await act(`/invoices/${depositId}/receipt`,receipt,auth.cookie,auth.token)).status,403)
  assert.equal((await act(`/invoices/${depositId}/receipt`,{...receipt,confirm:false})).status,400)
  assert.equal((await act(`/invoices/${depositId}/receipt`,receipt)).status,200);assert.equal(job.invoice_deposit_liability_cents,200000);assert.equal(job.invoices.find(i=>i.id===depositId).balance.due_cents,0)
  assert.equal((await act(`/invoices/${depositId}/receipt`,receipt)).status,409,'BILL-002 replayed bank receipt creates no second liability')
  const milestoneConfig={contract_reference:'Signed contract client retainage section 9',rules:[{line_id:'quote:material',work_bps:500,stored_bps:500},{line_id:'quote:labor',work_bps:500,stored_bps:500}],milestones:[{id:'substantial',name:'Framing substantial completion',completion_requirements:['Framing inspection'],waiver_requirements:[]}]}
  assert.equal((await act('/retainage',milestoneConfig)).status,200)
  r=await act('/claims',{description:'Framing 50% progress application',lines:[{line_id:'quote:material',completed_cents:550000,stored_cents:0,evidence:'Framing materials installed and inspected'},{line_id:'quote:labor',completed_cents:500000,stored_cents:0,evidence:'Superintendent reviewed half-complete labor scope'}]});assert.equal(r.status,200);const appId=r.value.record.id
  assert.equal((await act(`/claims/${appId}/approve`)).status,200);assert.equal((await act(`/claims/${appId}/issue`)).status,200)
  r=await act('/invoices',{...terms,kind:'milestone',description:'Fixed framing milestone',source_application_id:appId});assert.equal(r.status,200);const milestoneId=r.value.record.id
  assert.equal((await act(`/invoices/${milestoneId}/issue`)).status,200)
  const milestone=job.invoices.find(i=>i.id===milestoneId),original=structuredClone(milestone.issued)
  assert.equal(Number(milestone.number.split('-').at(-1)),Number(issuedDeposit.number.split('-').at(-1))+1,'BILL-002 install-wide issued invoice numbers are sequential')
  assert.equal(original.gross_cents,1050000);assert.equal(original.tax_cents,50000);assert.equal(original.subtotal_cents,1000000);assert.equal(original.withheld_cents,52500);assert.equal(original.payable_cents,997500);assert.equal(original.earned_revenue_cents,1000000)
  assert.equal(original.sources.original_budget.revision,1);assert.equal(original.sources.contract.quote.pricing.tax.rate.reference,rate.revisions[0].reference)
  const allocation={deposit_invoice_id:depositId,amount_cents:100000}
  assert.equal((await act(`/invoices/${milestoneId}/apply-deposit`,{...allocation,amount_cents:200001})).status,409)
  assert.equal((await act(`/invoices/${milestoneId}/apply-deposit`,allocation)).status,200)
  assert.equal(job.invoice_deposit_liability_cents,100000);assert.equal(job.invoices.find(i=>i.id===milestoneId).balance.due_cents,897500)
  assert.equal((await act(`/invoices/${milestoneId}/apply-deposit`,allocation)).status,409,'BILL-002 replayed allocation cannot spend a deposit twice')
  assert.equal((await act(`/invoices/${milestoneId}/receipt`,{amount_cents:97500,received_on:'2026-10-25',reference:'Check 1047 entered against framing invoice',method:'check',confirm:true})).status,200)
  assert.equal(job.invoices.find(i=>i.id===milestoneId).balance.due_cents,800000);assert.deepEqual(job.invoices.find(i=>i.id===milestoneId).issued,original,'BILL-002 settlements never rewrite the original issued invoice')
  assert.equal((await act('/retainage/release',{claim_id:appId,milestone_id:'substantial',lines:[{line_id:'quote:material',amount_cents:10000}],completion_references:[{requirement:'Framing inspection',reference:'Signed framing inspection FI-104'}],waiver_references:[]})).status,200)
  assert.equal(job.invoices.find(i=>i.id===milestoneId).balance.released_retainage_cents,10000);assert.equal(job.invoices.find(i=>i.id===milestoneId).balance.due_cents,810000);assert.deepEqual(job.invoices.find(i=>i.id===milestoneId).issued,original)
  assert.equal((await act('/invoices',{...terms,kind:'milestone',description:'Duplicate framing',source_application_id:appId})).status,409)
  const added={description:'Signed added mudroom scope',direction:'charge',basis:'sell',as_of:'2026-10-21',lines:[{id:'mudroom',description:'Added mudroom finish',cost_code:'09-100',phase:'Added scope',category:'material',quantity:'1',unit:'job',unit_cents:300000,cost_unit_cents:200000}],rules:[],tax:{rate_id:rate.id,taxable_line_ids:['mudroom']}}
  r=await act('/variation-pricing/preview',added);assert.equal(r.status,200);assert.equal((await act('/variation-pricing/apply',{...added,digest:r.value.preview.digest})).status,200)
  assert.equal((await act(`/variations/${job.variations.at(-1).id}/approve`,{},client)).status,200);await read()
  r=await act('/invoices',{...depositInput,description:'Approved added-scope deposit',amount_cents:2000000});assert.equal(r.status,200,'BILL-002 later deposits use the current approved contract, including changes')
  assert.equal((await act(`/invoices/${r.value.record.id}/issue`)).status,200)
  assert.equal(job.invoices.at(-1).issued.sources.current_budget.contract_cents,2430000);assert.equal(job.invoices.at(-1).issued.sources.contract.variations.length,1)
  const visible=(await api(`/jobs/${job.id}`,undefined,client)).value.job
  assert.equal(visible.invoices.length,3);assert.equal(visible.invoices.find(i=>i.id===milestoneId).balance.due_cents,810000)
  for(const secret of ['cost_unit_cents','source_digest','Reviewed fixture taxable materials','Framing materials installed and inspected'])assert.ok(!JSON.stringify(visible).includes(secret),'BILL-002 client invoice projections exclude office costs and source evidence')
  for(const ext of ['json','html','csv']){const path=`/api/plinth/jobs/${job.id}/invoices/${milestoneId}/document.${ext}`;assert.equal((await f.request(path,{cookie:client})).status,200);assert.equal((await f.request(path,{cookie:foreign})).status,404);assert.equal((await f.request(path,{token:agent})).status,403)}
  assert.ok(job.approvals.some(a=>a.kind==='invoice.issue')&&job.approvals.some(a=>a.kind==='invoice.receipt')&&job.approvals.some(a=>a.kind==='invoice.apply_deposit')&&job.approvals.some(a=>a.kind==='invoice.accept'))
 } finally {await f.close()}
})

test('BILL-006 — one recorded bank remittance pays multiple milestones, retains unapplied cash and reverses a return without rewriting issued history',async()=>{
 const f=await createFixture()
 try {
  const client=await f.invite('remittance-client@example.com'),other=await f.invite('remittance-other@example.com'),agent=await f.agent()
  const api=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{...(body===undefined?{}:{method:'POST',body}),cookie,token})
  let job=(await api('/jobs',{name:'Maple Street $480,000 remodel with staged ACH remittance',client_email:'remittance-client@example.com',address:'2480 Maple Street, Burlington, VT 05401',time_zone:'America/New_York'})).value.job
  const act=async(path,body={})=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});assert.equal(r.status,200,JSON.stringify(r.value));job=r.value.job;return r.value.record}
  const attempt=(path,body={},cookie=f.owner,token)=>api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie,token)
  await act('/quotes',{lines:[{id:'remodel',description:'Contracted whole-home remodel',cost_code:'01-100',category:'labor',phase:'Remodel',quantity:'1',unit:'job',unit_cents:48000000,cost_unit_cents:32000000}]})
  const rate=(await api('/pricing-rates',{jurisdiction:'Staff-reviewed fixture jurisdiction',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'Reviewed fixture exemption schedule',human_reviewed:true})).value.rate
  const price={basis:'sell',as_of:'2026-10-21',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['remodel']}}
  const preview=await attempt('/pricing/preview',price);assert.equal(preview.status,200)
  await act('/pricing/apply',{...price,digest:preview.value.preview.digest})
  await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Externally signed $480,000 remodel agreement',schedule_choice:{kind:'none',reason:'Schedule planned separately'}})
  await act('/sov',{})
  await act('/retainage',{contract_reference:'Signed agreement five percent withholding',rules:[{line_id:'quote:remodel',work_bps:500,stored_bps:500}],milestones:[{id:'completion',name:'Substantial completion',completion_requirements:['Final inspection'],waiver_requirements:[]}]})
  const ids=[]
  for(const [n,due_on] of ['2026-11-01','2026-12-01','2027-01-01'].entries()){
   const claim=await act('/claims',{description:'Progress draw '+(n+1),lines:[{line_id:'quote:remodel',completed_cents:12000000*(n+1),stored_cents:0,evidence:'Superintendent recorded completed work stage '+(n+1)}]})
   await act(`/claims/${claim.id}/approve`);await act(`/claims/${claim.id}/issue`)
   const invoice=await act('/invoices',{kind:'milestone',source_application_id:claim.id,description:'Milestone '+(n+1),recipient_email:'remittance-client@example.com',due_on,terms:'Bank/check per signed agreement'})
   await act(`/invoices/${invoice.id}/issue`);ids.push(invoice.id)
  }
  const originals=job.invoices.map(i=>structuredClone(i.issued))
  const deposit=await act('/invoices',{kind:'deposit',description:'Separate unearned deposit request',recipient_email:'remittance-client@example.com',due_on:'2026-12-01',terms:'Deposit request only',amount_cents:10000})
  await act(`/invoices/${deposit.id}/issue`)
  const draft=await act('/invoices',{kind:'deposit',description:'Unissued draft stays out of aging',recipient_email:'remittance-client@example.com',due_on:'2026-12-01',terms:'Draft only',amount_cents:10000})
  const input={amount_cents:24000000,received_on:'2026-11-02',reference:'Bank statement ACH trace BS-104',evidence:'Staff compared bank posting with client remittance covering two draws; overpayment retained',method:'bank',confirm:true,allocations:ids.slice(0,2).map(invoice_id=>({invoice_id,amount_cents:11400000}))}
  const unchanged=async(path,body,status)=>{const before=structuredClone(job),r=await attempt(path,body);assert.equal(r.status,status,JSON.stringify(r.value));assert.deepEqual((await api(`/jobs/${job.id}`)).value.job,before,'Refusal leaves every ledger and approval unchanged')}
  await unchanged('/remittances',{...input,confirm:false},400)
  await unchanged('/remittances',{...input,amount_cents:1.5},400)
  await unchanged('/remittances',{...input,received_on:'2026-02-30'},400)
  await unchanged('/remittances',{...input,allocations:[input.allocations[0],input.allocations[0]]},400)
  await unchanged('/remittances',{...input,allocations:[{invoice_id:ids[0],amount_cents:11400001}]},409)
  await unchanged('/remittances',{...input,allocations:[{invoice_id:ids[0],amount_cents:1},{invoice_id:ids[1],amount_cents:11400001}]},409)
  await unchanged('/remittances',{...input,allocations:[{invoice_id:deposit.id,amount_cents:1}]},409)
  await unchanged('/remittances',{...input,allocations:[{invoice_id:draft.id,amount_cents:1}]},409)
  await unchanged('/remittances',{...input,allocations:[{invoice_id:crypto.randomUUID(),amount_cents:1}]},404)
  for(const auth of [{cookie:client},{cookie:other},{cookie:undefined,token:agent}])assert.equal((await attempt('/remittances',input,auth.cookie,auth.token)).status,auth.cookie===other?404:403)
  const schema=await api('/reports/fields',{expected_version:0,record_scope:'financial',name:'Bank reconciliation reference',type:'text',required_at_stages:['recorded','returned']});assert.equal(schema.status,201)
  const fieldId=schema.value.fields[0].id
  await unchanged('/remittances',input,409)
  input.custom_fields={[fieldId]:'Staff reconciled statement BS-104'}
  const recorded=await act('/remittances',input),remittanceId=recorded.id
  const financialPath=`/reports/values/financial/${job.id}:remittance:${remittanceId}`
  const custom=(await api(financialPath)).value.record;assert.equal(custom.values[fieldId],'Staff reconciled statement BS-104')
  assert.equal(recorded.amount_cents,24000000);assert.equal(recorded.allocations.length,2)
  assert.deepEqual(job.invoices.slice(0,3).map(i=>i.balance.due_cents),[0,0,11400000])
  assert.equal(job.invoice_deposit_liability_cents,0,'Unapplied remittance is separate from unearned deposit liability')
  assert.deepEqual(job.invoices.slice(0,3).map(i=>i.issued),originals)
  await unchanged('/remittances',{...input,reference:input.reference.toLowerCase()},409)
  await unchanged(`/invoices/${ids[2]}/receipt`,{amount_cents:1,received_on:'2026-11-03',reference:input.reference,method:'bank',confirm:true},409)
  const report=async(as_of='2026-12-01')=>{const r=await api(`/jobs/${job.id}/receivables?as_of=${as_of}`);assert.equal(r.status,200);return r.value}
  let ledger=await report();assert.equal(ledger.unapplied_cents,1200000);assert.equal(ledger.received_cents,22800000);assert.equal(ledger.due_cents,11400000);assert.equal(ledger.held_retainage_cents,1800000)
  assert.equal(ledger.invoices.length,4,'Draft invoice excluded; deposit request identified separately')
  assert.equal(ledger.invoices.find(i=>i.invoice_id===ids[0]).days_overdue,30)
  assert.equal(ledger.invoices.find(i=>i.invoice_id===ids[0]).bucket,'1-30');assert.equal(ledger.invoices.find(i=>i.invoice_id===ids[1]).bucket,'current','Due date is inclusive')
  await unchanged(`/remittances/${remittanceId}/allocate`,{confirm:true,applied_on:'2026-11-01',allocations:[{invoice_id:ids[2],amount_cents:1200000}]},400)
  await unchanged(`/remittances/${remittanceId}/allocate`,{confirm:true,applied_on:'2026-11-03',allocations:[{invoice_id:ids[2],amount_cents:1200001}]},409)
  await act(`/remittances/${remittanceId}/allocate`,{confirm:true,applied_on:'2026-11-03',allocations:[{invoice_id:ids[2],amount_cents:1200000}]})
  ledger=await report();assert.equal(ledger.unapplied_cents,0);assert.equal(ledger.due_cents,10200000);assert.equal(ledger.received_cents,24000000)
  await unchanged(`/remittances/${remittanceId}/allocate`,{confirm:true,applied_on:'2026-11-03',allocations:[{invoice_id:ids[2],amount_cents:1}]},409)
  const originalAllocations=structuredClone(job.remittances[0].allocations)
  await unchanged(`/remittances/${remittanceId}/return`,{confirm:true,returned_on:'2026-11-02',reference:'Return BS-105',reason:'ACH returned by bank'},400)
  const returned=await act(`/remittances/${remittanceId}/return`,{confirm:true,returned_on:'2026-11-04',reference:'Bank return trace BS-105',reason:'Staff recorded bank notice: ACH returned'})
  assert.equal((await api(financialPath)).value.record.stage,'returned');assert.equal((await api(financialPath)).value.record.values[fieldId],'Staff reconciled statement BS-104');
  assert.equal(returned.returned.amount_cents,24000000);assert.deepEqual(returned.allocations,originalAllocations)
  ledger=await report();assert.equal(ledger.unapplied_cents,0);assert.equal(ledger.received_cents,0);assert.equal(ledger.due_cents,34200000);assert.equal(ledger.held_retainage_cents,1800000)
  assert.deepEqual(ledger.aging,{'current':22800000,'1-30':11400000,'31-60':0,'61-90':0,'91+':0})
  assert.equal((await report('2026-12-02')).aging['31-60'],11400000,'Thirty-one days starts next bucket')
  assert.equal((await report('2026-12-31')).aging['31-60'],11400000,'Sixty days stays in second overdue bucket')
  assert.equal((await report('2027-01-01')).aging['61-90'],11400000)
  assert.equal((await report('2027-01-30')).aging['61-90'],11400000,'Ninety days stays in third bucket')
  assert.equal((await report('2027-01-31')).aging['91+'],11400000)
  for(const invoice of job.invoices.slice(0,3)){assert.equal(invoice.receipts.length,2);assert.equal(invoice.receipts[1].reversal_of,invoice.receipts[0].id);assert.equal(invoice.receipts[1].amount_cents,-invoice.receipts[0].amount_cents);assert.match(invoice.receipts[1].label,/Return recorded by staff/)}
  assert.deepEqual(job.invoices.slice(0,3).map(i=>i.issued),originals)
  await unchanged(`/remittances/${remittanceId}/return`,{confirm:true,returned_on:'2026-11-04',reference:'Duplicate return',reason:'Retry'},409)
  await unchanged(`/remittances/${remittanceId}/allocate`,{confirm:true,applied_on:'2026-11-05',allocations:[{invoice_id:ids[2],amount_cents:1}]},409)
  for(const auth of [{cookie:client},{cookie:other},{cookie:undefined,token:agent}])assert.equal((await api(`/jobs/${job.id}/receivables`,undefined,auth.cookie,auth.token)).status,auth.cookie===other?404:403)
  assert.equal((await f.json(`/api/plinth/jobs/${job.id}/receivables`)).status,401)
  assert.equal((await api(`/jobs/${job.id}/receivables?as_of=2026-02-30`)).status,400)
  for(const path of [`/jobs/${job.id}`,'/jobs']){const value=(await api(path,undefined,client)).value,shown=value.job??value.jobs.find(j=>j.id===job.id);assert.equal(shown.remittances,undefined);assert.equal(JSON.stringify(shown).includes(input.evidence),false);assert.equal(shown.invoices[0].balance.received_cents,0)}
  const path=`/api/plinth/jobs/${job.id}/remittances`,version=job.version,second={...input,amount_cents:10000,reference:'Second remittance held as unapplied cash',allocations:[]}
  const races=await Promise.all([1,2].map(()=>f.json(path,{method:'POST',cookie:f.owner,body:{expected_version:version,...second}})))
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);job=(await api(`/jobs/${job.id}`)).value.job
  assert.equal(job.remittances.length,2);assert.equal((await report()).unapplied_cents,10000)
  const receipt=job.remittances.at(-1)
  await act(`/remittances/${receipt.id}/return`,{confirm:true,returned_on:'2026-11-05',reference:'Unapplied bank return',reason:'Bank returned the entirely unapplied amount'})
  assert.equal((await report()).unapplied_cents,0)
  // Direct invoice receipts predate cross-invoice remittances and need their own return door.
  const milestonePath=`/invoices/${ids[0]}`,depositPath=`/invoices/${deposit.id}`
  const beforeReturnHtml=await (await f.request(`/api/plinth/jobs/${job.id}${milestonePath}/document.html`,{cookie:f.owner})).text()
  await act(`${milestonePath}/receipt`,{amount_cents:10000,received_on:'2026-11-06',reference:'Legacy single-invoice check 1204',method:'check',confirm:true})
  const originalReceipt=structuredClone(job.invoices[0].receipts.at(-1))
  const returnInput={receipt_id:originalReceipt.id,returned_on:'2026-11-07',reference:'Bank returned check 1204',reason:'Staff reviewed returned-check notice; private bank correspondence',confirm:true}
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,confirm:false},400)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,returned_on:'2026-02-30'},400)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,returned_on:'2026-11-05'},400)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,reason:''},400)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,amount_cents:0},400)
  await unchanged(`${depositPath}/return-receipt`,returnInput,404)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,receipt_id:job.invoices[0].receipts[0].id},409)
  for(const auth of [{cookie:client},{cookie:other},{cookie:undefined,token:agent}])assert.equal((await attempt(`${milestonePath}/return-receipt`,returnInput,auth.cookie,auth.token)).status,auth.cookie===other?404:403)
  assert.equal((await f.json(`/api/plinth/jobs/${job.id}${milestonePath}/return-receipt`,{method:'POST',body:{expected_version:job.version,...returnInput}})).status,401)
  assert.equal((await f.json(`/api/plinth/jobs/${job.id}${milestonePath}/return-receipt`,{method:'POST',cookie:f.owner,headers:{origin:'https://foreign.example'},body:{expected_version:job.version,...returnInput}})).status,403)
  const raceVersion=job.version
  const returns=await Promise.all([1,2].map(()=>attempt(`${milestonePath}/return-receipt`,{...returnInput,expected_version:raceVersion})))
  assert.deepEqual(returns.map(r=>r.status).sort(),[200,409],'Concurrent returns append only one reversal')
  job=(await api(`/jobs/${job.id}`)).value.job
  const reversed=job.invoices[0].receipts.at(-1)
  assert.deepEqual(job.invoices[0].receipts.at(-2),originalReceipt,'The positive original remains immutable')
  assert.equal(reversed.reversal_of,originalReceipt.id);assert.equal(reversed.amount_cents,-10000);assert.equal(reversed.method,'check')
  assert.equal(reversed.recorded_by.id,job.created_by.id);assert.match(reversed.label,/Return recorded by staff/)
  const returnApproval=job.approvals.at(-1)
  assert.equal(returnApproval.kind,'invoice.receipt_return');assert.equal(returnApproval.snapshot.reason,returnInput.reason)
  assert.equal(returnApproval.snapshot.receipt.id,originalReceipt.id);assert.equal(returnApproval.snapshot.reversal.id,reversed.id)
  assert.ok(returnApproval.approved_by.at)
  assert.equal((await report()).received_cents,0);assert.equal((await report()).due_cents,34200000)
  await unchanged(`${milestonePath}/return-receipt`,returnInput,409)
  await unchanged(`${milestonePath}/return-receipt`,{...returnInput,receipt_id:reversed.id},409)
  assert.deepEqual(job.invoices.slice(0,3).map(i=>i.issued),originals)
  assert.equal(await (await f.request(`/api/plinth/jobs/${job.id}${milestonePath}/document.html`,{cookie:f.owner})).text(),beforeReturnHtml)

  // Return an unallocated deposit receipt without spending the liability already applied to a draw.
  await act(`${depositPath}/receipt`,{amount_cents:4000,received_on:'2026-11-06',reference:'Deposit bank posting DP-1',method:'bank',confirm:true})
  const retainedDepositReceipt=job.invoices.find(i=>i.id===deposit.id).receipts.at(-1)
  await act(`${depositPath}/receipt`,{amount_cents:6000,received_on:'2026-11-06',reference:'Deposit bank posting DP-2',method:'bank',confirm:true})
  const freeDepositReceipt=structuredClone(job.invoices.find(i=>i.id===deposit.id).receipts.at(-1))
  await act(`${milestonePath}/apply-deposit`,{deposit_invoice_id:deposit.id,amount_cents:4000})
  const depositApplications=structuredClone(job.invoices[0].deposit_applications),depositIssue=structuredClone(job.invoices.find(i=>i.id===deposit.id).issued)
  await act(`${depositPath}/return-receipt`,{...returnInput,receipt_id:freeDepositReceipt.id,amount_cents:2500,reference:'Bank partially returned deposit DP-2A'})
  assert.equal(job.invoice_deposit_liability_cents,3500)
  assert.equal(job.invoices.find(i=>i.id===deposit.id).balance.received_cents,7500)
  assert.deepEqual(job.invoices[0].deposit_applications,depositApplications)
  await unchanged(`${depositPath}/return-receipt`,{...returnInput,receipt_id:freeDepositReceipt.id,amount_cents:3501,reference:'Over remaining deposit return'},409)
  await unchanged(`${depositPath}/return-receipt`,{...returnInput,receipt_id:retainedDepositReceipt.id,amount_cents:3501,reference:'Return would spend allocated deposit'},409)
  await unchanged(`${depositPath}/return-receipt`,{...returnInput,receipt_id:freeDepositReceipt.id,amount_cents:2500,reference:'bank partially returned deposit dp-2a'},409)
  await act(`${depositPath}/return-receipt`,{...returnInput,receipt_id:freeDepositReceipt.id,reference:'Bank returned deposit DP-2'})
  assert.equal(job.invoice_deposit_liability_cents,0)
  assert.equal(job.invoices.find(i=>i.id===deposit.id).balance.received_cents,4000)
  assert.equal(job.invoices.find(i=>i.id===deposit.id).balance.due_cents,6000)
  assert.deepEqual(job.invoices[0].deposit_applications,depositApplications)
  assert.deepEqual(job.invoices.find(i=>i.id===deposit.id).issued,depositIssue)
  await unchanged(`${depositPath}/return-receipt`,{...returnInput,receipt_id:retainedDepositReceipt.id,reference:'Bank returned allocated deposit DP-1'},409)
  await unchanged(`${depositPath}/return-receipt`,{...returnInput,receipt_id:freeDepositReceipt.id},409)
  assert.equal((await report()).due_cents,34196000,'A deposit return never undoes a funded draw allocation')
  for(const path of [`/jobs/${job.id}`,'/jobs']){
   const value=(await api(path,undefined,client)).value,shown=value.job??value.jobs.find(j=>j.id===job.id)
   assert.equal(JSON.stringify(shown).includes(returnInput.reason),false,'Private return reason remains outside client projections')
   assert.equal(shown.invoices.find(i=>i.id===ids[0]).receipts.at(-1).amount_cents,-10000)
  }
  // Partial returns use unique bank evidence and append against the original, never an earlier reversal.
  const partialPath=`/invoices/${ids[2]}`,beforePartial=await report()
  await act(`${partialPath}/receipt`,{amount_cents:10000,received_on:'2026-11-08',reference:'Single-invoice ACH partial-return source',method:'bank',confirm:true})
  const partialOriginal=structuredClone(job.invoices[2].receipts.at(-1)),partialInput={receipt_id:partialOriginal.id,amount_cents:3000,returned_on:'2026-11-09',reference:'Bank partial return 1',reason:'Private bank partial-return evidence',confirm:true}
  for(const [amount,status] of [[-1,400],[0,400],[1.5,400],[10001,409],[Number.MAX_SAFE_INTEGER,400]])await unchanged(`${partialPath}/return-receipt`,{...partialInput,amount_cents:amount},status)
  for(const auth of [{cookie:client},{cookie:other},{cookie:undefined,token:agent}])assert.equal((await attempt(`${partialPath}/return-receipt`,partialInput,auth.cookie,auth.token)).status,auth.cookie===other?404:403)
  await act(`${partialPath}/return-receipt`,partialInput)
  assert.equal((await report()).received_cents,beforePartial.received_cents+7000)
  assert.equal((await report()).due_cents,beforePartial.due_cents-7000)
  assert.equal(job.invoices[2].receipts.at(-1).amount_cents,-3000)
  assert.equal(job.invoices[2].receipts.at(-1).reversal_of,partialOriginal.id)
  await unchanged(`${partialPath}/return-receipt`,partialInput,409)
  await unchanged(`${partialPath}/return-receipt`,{...partialInput,reference:partialInput.reference.toUpperCase()},409)
  await unchanged(`${partialPath}/return-receipt`,{...partialInput,amount_cents:7001,reference:'Too much after partial return'},409)
  await unchanged(`${partialPath}/return-receipt`,{...partialInput,receipt_id:job.invoices[2].receipts.at(-1).id,reference:'Cannot return a reversal'},409)
  await unchanged(`${partialPath}/return-receipt`,{...partialInput,reference:input.reference},409)
  const partialVersion=job.version,secondPartial={...partialInput,amount_cents:5000,reference:'Bank partial return 2',expected_version:partialVersion}
  const partialRace=await Promise.all([1,2].map(()=>attempt(`${partialPath}/return-receipt`,secondPartial)))
  assert.deepEqual(partialRace.map(r=>r.status).sort(),[200,409])
  job=(await api(`/jobs/${job.id}`)).value.job
  assert.equal((await report()).received_cents,beforePartial.received_cents+2000)
  assert.equal((await report()).due_cents,beforePartial.due_cents-2000)
  await unchanged(`${partialPath}/return-receipt`,{...secondPartial,expected_version:job.version},409)
  await act(`${partialPath}/return-receipt`,{...partialInput,amount_cents:undefined,reference:'Bank final remaining return'})
  assert.equal(job.invoices[2].receipts.at(-1).amount_cents,-2000,'Omitting amount returns only the unreversed remainder')
  assert.deepEqual(job.invoices[2].receipts.find(r=>r.id===partialOriginal.id),partialOriginal)
  assert.equal((await report()).received_cents,beforePartial.received_cents)
  assert.equal((await report()).due_cents,beforePartial.due_cents)
  assert.deepEqual(job.invoices.slice(0,3).map(i=>i.issued),originals)
  await unchanged(`${partialPath}/return-receipt`,{...partialInput,reference:'Already exhausted original'},409)
  const partialClient=(await api(`/jobs/${job.id}`,undefined,client)).value.job
  assert.equal(JSON.stringify(partialClient).includes(partialInput.reason),false)
  assert.deepEqual(partialClient.invoices.find(i=>i.id===ids[2]).receipts.slice(-3).map(r=>r.amount_cents),[-3000,-5000,-2000])
  assert.equal(f.messages.filter(m=>m.subject?.includes('Receipt')).length,0,'Recording or returning funds never sends a receipt or contacts the client')
 } finally {await f.close()}
})

test('BILL-004 — approved actuals bill once with reviewed tax, fee categories, caps and immutable linked credits and late time',async()=>{
 const f=await createFixture();try{
  const {costFixture,original}=await import('./cost-support.mjs'),c=await costFixture(f)
  const client=await f.invite('synthetic-plinth-client@example.com'),agent=await f.agent()
  const source=async(kind,reference,extra={})=>{const r=await c.ok('/costs/sources',{kind,reference,dated_on:'2026-10-24',period:'2026-10',cost_code:'01-100',employee_reference:'synthetic-plinth-worker-1',equipment_reference:'synthetic-plinth-lift-1',minutes:60,hour_cents:3000,burden_bps:2000,...extra});await c.ok(`/costs/sources/${r.record.id}/approve`);return r.record}
  await source('time','synthetic-plinth-bill-time-1');await source('equipment','synthetic-plinth-bill-equipment-1');await source('expense','synthetic-plinth-bill-expense-1',{amount_cents:500,document:original})
  const b=await c.ok('/costs/bills',c.bill());await c.ok(`/costs/bills/${b.record.id}/review`,{reason:'Reviewed receipt coding discrepancy against original'});await c.ok(`/costs/bills/${b.record.id}/post`)
  const unapproved=await c.ok('/costs/sources',{kind:'time',reference:'synthetic-plinth-unapproved-time',dated_on:'2026-10-24',period:'2026-10',cost_code:'01-100',employee_reference:'synthetic-plinth-worker-1',minutes:60,hour_cents:3000})
  const entries=(await c.ledger()).rows.flatMap(r=>r.sources.actual).filter(e=>e.id&&e.source_kind),excluded=entries.find(e=>e.source_kind==='expense')
  const config={contract_reference:'synthetic-plinth-signed-cost-plus-contract-1',fee_bps:1000,cap_cents:60000,entry_ids:entries.filter(e=>e.id!==excluded.id).map(e=>e.id),excluded_entry_ids:[excluded.id]}
  const input={kind:'cost_plus',description:'Approved actual costs and contractual fee',recipient_email:'synthetic-plinth-client@example.com',due_on:'2026-11-23',terms:'Reviewed zero sales tax; fee and cap per signed cost-plus contract',cost_billing:config}
  const unchanged=async(path,body,status)=>{const before=await c.read(),r=await c.act(path,body);assert.equal(r.status,status,JSON.stringify(r.value));assert.deepEqual(await c.read(),before)}
  await unchanged('/invoices',{...input,cost_billing:{...config,entry_ids:[unapproved.record.id]}},404)
  await unchanged('/invoices',{...input,cost_billing:{...config,entry_ids:[...config.entry_ids,config.entry_ids[0]]}},400)
  for(const [cookie,token] of [[client,undefined],[undefined,agent]])assert.equal((await c.act('/invoices',input,cookie,token)).status,403)
  const invoice=(await c.ok('/invoices',input)).record
  assert.ok(invoice.sources.cost_billing.supporting_sources.some(s=>s.document_checksum));assert.ok(invoice.sources.cost_billing.supporting_sources.some(s=>s.detail?.minutes===60));assert.equal(invoice.sources.cost_billing.cost_cents,50200);assert.equal(invoice.amount_cents,55220);assert.equal(invoice.sources.cost_billing.fee_cents,5020)
  const competing=(await c.ok('/invoices',{...input,description:'Competing draft must not reserve the same costs twice'})).record
  await c.ok(`/invoices/${invoice.id}/issue`);await unchanged(`/invoices/${competing.id}/issue`,{},409);await unchanged(`/invoices/${invoice.id}/issue`,{},409)
  const first=(await c.read()).invoices.find(i=>i.id===invoice.id),frozen=structuredClone(first.issued)
  assert.equal(frozen.gross_cents,55220);assert.equal(frozen.earned_revenue_cents,55220)
  const originalResponse=await f.request(`/api/plinth/jobs/${c.job.id}/invoices/${invoice.id}/document.html`,{cookie:f.owner}),html=await originalResponse.text();assert.equal(originalResponse.status,200)
  await unchanged('/invoices',input,409)
  await unchanged('/invoices',{...input,cost_billing:{...config,entry_ids:[excluded.id],excluded_entry_ids:[]}},409)
  const creditInput={...c.bill('synthetic-plinth-credit-1'),kind:'credit',credit_of:b.record.id,lines:[{cost_code:'06-100',description:'Returned material credit',subtotal_cents:1000,taxable:true,matches:[{order_id:c.order.id,receipt_id:c.receipts[0].id,cost_code:'06-100',amount_cents:1000}]}]}
  const credit=(await c.ok('/costs/bills',creditInput)).record;await c.ok(`/costs/bills/${credit.id}/post`)
  const late=await source('time','synthetic-plinth-late-time-1',{minutes:180})
  const newEntries=(await c.ledger()).rows.flatMap(r=>r.sources.actual).filter(e=>e.source_id===late.id||e.source_id===credit.id)
  const nextConfig={...config,entry_ids:newEntries.map(e=>e.id)}
  await unchanged('/invoices',{...input,cost_billing:{...nextConfig,fee_bps:2000}},409)
  const next=(await c.ok('/invoices',{...input,description:'Late time less vendor credit; linked adjustment',cost_billing:nextConfig})).record
  assert.deepEqual(next.sources.cost_billing.prior_invoice_ids,[invoice.id]);assert.equal(next.sources.cost_billing.cost_cents,9700)
  assert.equal(next.sources.cost_billing.fee_cents,970);assert.equal(next.sources.cost_billing.cap_reduction_cents,5890);assert.equal(next.amount_cents,4780)
  const version=c.job.version,races=await Promise.all([1,2].map(()=>c.act(`/invoices/${next.id}/issue`,{expected_version:version})))
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);await c.read()
  assert.deepEqual(c.job.invoices.find(i=>i.id===next.id).issued.adjusts_invoice_numbers,[frozen.number]);assert.deepEqual(c.job.invoices.find(i=>i.id===invoice.id).issued,frozen)
  assert.equal(await (await f.request(`/api/plinth/jobs/${c.job.id}/invoices/${invoice.id}/document.html`,{cookie:f.owner})).text(),html)
  assert.equal(c.job.invoices.filter(i=>i.issued).reduce((n,i)=>n+i.issued.gross_cents,0),60000)
  const shown=(await c.api(`/jobs/${c.job.id}`,undefined,client)).value.job
  assert.equal(JSON.stringify(shown).includes('cost_billing'),false);assert.equal(JSON.stringify(shown).includes('hour_cents'),false)
  assert.equal((await c.api(`/jobs/${c.job.id}/costs/sources`,undefined,client)).status,403)
  const manager=await f.invite('synthetic-plinth-billing-manager@example.com','Assigned manager','admin')
  const team=(await c.api('/team')).value.team,person=team.find(p=>p.email==='synthetic-plinth-billing-manager@example.com')
  const assigned=await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'project_manager',job_ids:[c.job.id],po_limit_cents:0}});assert.equal(assigned.status,200)
  assert.equal((await c.act('/invoices',{...input,cost_billing:nextConfig},manager)).status,403)
  for(const path of [`/jobs/${c.job.id}`,`/jobs/${c.job.id}/invoices/${invoice.id}/document.json`]){const response=await c.api(path,undefined,manager);assert.equal(response.status,200);assert.equal(JSON.stringify(response.value).includes('hour_cents'),false,'Actual pay rates cannot escape through serialized approval fingerprints');assert.equal(JSON.stringify(response.value).includes('cost_billing'),false)}
  const actual=(await c.ledger()).totals.posted_actual_cents;assert.equal(actual,60400,'Billing consumes no actual cost and never changes the source ledger')
 }finally{await f.close()}
 const taxable=await createFixture();try{
  const {costFixture}=await import('./cost-support.mjs'),c=await costFixture(taxable,{taxPercent:'10'})
  const bill=(await c.ok('/costs/bills',c.bill())).record;await c.ok(`/costs/bills/${bill.id}/review`,{reason:'Reviewed source matches'});await c.ok(`/costs/bills/${bill.id}/post`)
  const entries=(await c.ledger()).rows.flatMap(r=>r.sources.actual).filter(e=>e.source_kind)
  const config={contract_reference:'synthetic-plinth-taxable-agreement',fee_bps:0,fee_categories:[{name:'Material handling',cost_codes:['06-100'],fee_bps:2000},{name:'Labor administration',cost_codes:['01-100'],fee_bps:500}],cap_cents:57000,entry_ids:entries.map(e=>e.id),excluded_entry_ids:[]}
  const input={kind:'cost_plus',description:'Taxable actuals under reviewed agreement',recipient_email:'synthetic-plinth-client@example.com',due_on:'2026-11-23',terms:'Human-reviewed tax and fee categories',cost_billing:config}
  const available=await c.api(`/jobs/${c.job.id}/invoices/cost-sources`);assert.equal(available.status,200);assert.equal(available.value.entries.length,2);assert.ok(available.value.entries.every(e=>e.reference&&e.document_checksum));assert.equal(JSON.stringify(available.value).includes('base64'),false)
  const forbidden=await taxable.invite('synthetic-plinth-client@example.com');assert.equal((await c.api(`/jobs/${c.job.id}/invoices/cost-sources`,undefined,forbidden)).status,403);assert.equal((await c.act('/invoices/preview',{cost_billing:config},forbidden)).status,403)
  const before=await c.read(),preview=await c.ok('/invoices/preview',{cost_billing:config});assert.deepEqual(await c.read(),before,'Preview has no persistence effects')
  assert.equal(preview.preview.cost_cents,43000);assert.equal(preview.preview.fee_cents,7100);assert.equal(preview.preview.tax_cents,5010);assert.equal(preview.preview.total_cents,55110)
  assert.equal(preview.preview.tax.rate.reference,'synthetic-plinth-rate-1');assert.equal(preview.preview.tax.rate.percent,'10')
  assert.equal((await c.act('/invoices',{...input,cost_billing_review:'outdated preview'})).status,409)
  const first=(await c.ok('/invoices',{...input,cost_billing_review:JSON.stringify(preview.preview)})).record;assert.deepEqual(first.lines,preview.lines)
  const office=await taxable.invite('synthetic-plinth-reviewer@example.com','Billing reviewer','admin'),person=(await c.api('/team')).value.team.find(p=>p.email==='synthetic-plinth-reviewer@example.com')
  assert.equal((await taxable.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:taxable.owner,body:{expected_version:0,role:'project_manager',job_ids:[c.job.id],po_limit_cents:0}})).status,200)
  assert.equal((await c.act(`/invoices/${first.id}/issue`,{},office)).status,403,'Issue rechecks current cost authority after reassignment')
  await c.ok(`/invoices/${first.id}/issue`)
  const frozen=structuredClone((await c.read()).invoices.find(i=>i.id===first.id).issued),actualBefore=(await c.ledger()).totals.posted_actual_cents
  const credit=(await c.ok('/costs/bills',{...c.bill('synthetic-plinth-taxable-credit'),kind:'credit',credit_of:bill.id,lines:[{cost_code:'06-100',description:'Returned taxable material',subtotal_cents:1000,taxable:true,matches:[{order_id:c.order.id,receipt_id:c.receipts[0].id,cost_code:'06-100',amount_cents:1000}]}]})).record
  await c.ok(`/costs/bills/${credit.id}/post`)
  const creditEntries=(await c.ledger()).rows.flatMap(r=>r.sources.actual).filter(e=>e.source_id===credit.id),creditConfig={...config,entry_ids:creditEntries.map(e=>e.id)}
  const changed=await c.act('/invoices',{...input,cost_billing:{...creditConfig,fee_categories:[{name:'Changed fee',cost_codes:['06-100','01-100'],fee_bps:1}]}});assert.equal(changed.status,409)
  const adjustment=(await c.ok('/invoices',{...input,description:'Standalone linked vendor credit',cost_billing:creditConfig})).record
  assert.equal(adjustment.amount_cents,-1452);assert.equal(adjustment.sources.cost_billing.tax_cents,-132);assert.equal(adjustment.sources.cost_billing.supporting_sources[0].detail.credit_of,bill.id)
  await c.ok(`/invoices/${adjustment.id}/issue`)
  assert.deepEqual((await c.read()).invoices.find(i=>i.id===adjustment.id).issued.adjusts_invoice_numbers,[frozen.number])
  assert.equal((await c.act('/invoices',{...input,cost_billing:creditConfig})).status,409,'Credit sources cannot issue twice')
  const negativeOriginal=structuredClone(c.job.invoices.find(i=>i.id===adjustment.id).issued),negativeLine=negativeOriginal.lines.find(l=>l.gross_cents<0)
  const correction={operation_id:'synthetic-plinth-negative-debit',confirm:true,reason:'Reviewed partial reversal of credited material',description:'Partial debit reversing original vendor credit',lines:[{invoice_line_id:negativeLine.id,amount_cents:501}]}
  assert.equal((await c.act(`/invoices/${adjustment.id}/credit`,correction)).status,409,'A negative source cannot be credited beyond its reviewed amount')
  await c.ok(`/invoices/${adjustment.id}/debit`,correction)
  let corrected=c.job.invoices.find(i=>i.id===adjustment.id)
  assert.equal(corrected.balance.due_cents,-951);assert.equal(corrected.corrections[0].document.tax_cents,46)
  assert.equal((await c.act(`/invoices/${adjustment.id}/debit`,{...correction,operation_id:'synthetic-plinth-negative-excess',lines:[{invoice_line_id:negativeLine.id,amount_cents:1000}]})).status,409)
  await c.ok(`/invoices/${adjustment.id}/credit`,{...correction,operation_id:'synthetic-plinth-negative-recredit',lines:[{invoice_line_id:negativeLine.id,amount_cents:501}]})
  corrected=c.job.invoices.find(i=>i.id===adjustment.id)
  assert.equal(corrected.balance.due_cents,-1452);assert.equal(corrected.corrections.reduce((n,c)=>n+c.document.tax_cents,0),0);assert.deepEqual(corrected.issued,negativeOriginal)
  assert.equal((await c.act(`/invoices/${adjustment.id}/credit`,{...correction,operation_id:'synthetic-plinth-negative-credit-excess'})).status,409)
  for(const document of corrected.corrections.map(c=>c.document)){assert.equal(document.original_invoice_number,negativeOriginal.number);assert.equal(document.accounting_entries.reduce((n,e)=>n+e.debit_cents-e.credit_cents,0),0)}
  assert.equal((await c.ledger()).totals.posted_actual_cents,actualBefore-1100,'Invoice corrections never change actual costs')
  const late=(await c.ok('/costs/sources',{kind:'time',reference:'synthetic-plinth-taxable-late-time',dated_on:'2026-10-24',period:'2026-10',cost_code:'01-100',employee_reference:'synthetic-plinth-worker',minutes:60,hour_cents:3000,burden_bps:2000})).record;await c.ok(`/costs/sources/${late.id}/approve`)
  const lateEntries=(await c.ledger()).rows.flatMap(r=>r.sources.actual).filter(e=>e.source_id===late.id),next=(await c.ok('/invoices',{...input,cost_billing:{...config,entry_ids:lateEntries.map(e=>e.id)}})).record
  assert.equal(next.amount_cents,3342);assert.equal(next.sources.cost_billing.cap_reduction_cents,816);assert.equal(next.lines.reduce((n,l)=>n+l.tax_cents,0),304)
  await c.ok(`/invoices/${next.id}/issue`);await c.read()
  assert.equal(c.job.invoices.filter(i=>i.issued).reduce((n,i)=>n+i.issued.gross_cents,0),57000)
  assert.equal((await c.act(`/invoices/${adjustment.id}/debit`,{...correction,operation_id:'synthetic-plinth-cap-debit'})).status,409,'A correction cannot exceed the fixed contractual cap after later billing consumes reopened capacity')
  assert.deepEqual(c.job.invoices.find(i=>i.id===first.id).issued,frozen)
  assert.equal((await c.ledger()).totals.posted_actual_cents,actualBefore-1100+3600,'Credits and late time alone change actual costs')

 }finally{await taxable.close()}

})
