import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { nativeSignIn } from '../../scripts/verify/native-signin.mjs'
import { professionalClient, professionalFiles, professionalOriginal } from '../plinth/professional-support.mjs'

const base=process.env.PLINTH_URL,state=process.env.PLINTH_STATE,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&state&&shots,'Use the installed native application')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:state,viewport:{width:1440,height:1000}}),contexts=new Map([['owner',owner]]),page=await owner.newPage()
 const json=async(path,{method='GET',body,cookie='owner'}={})=>{const r=await (contexts.get(cookie)??owner).request.fetch(base+path,{method,headers:{origin:base},...(body===undefined?{}:{data:body})});return {status:r.status(),value:await r.json()}}
 const post=async(path,body,method='POST')=>{const r=await json(path,{method,body});assert.ok(r.status>=200&&r.status<300,JSON.stringify(r.value));return r.value}
 const invite=async(name,role='admin')=>{const email=[`synthetic-plinth-${name.toLowerCase().replaceAll(' ','-')}`,'dev.localhost'].join('@');await post('/auth/invite',{email,displayName:name,role,returnTo:'/app'});const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=await context.newPage();await nativeSignIn(p,email);contexts.set(email,context);return {email,context,page:p}}
 const reviewer=await invite('Professional office reviewer'),client=await invite('Professional client','member')
 let {job}=await post('/api/plinth/jobs',{name:'Maple house professional prerequisites',client_email:client.email,address:'148 Maple Street'})
 const f={owner:'owner',json},c=await professionalClient(f,job)
 await c.act('/quotes',{lines:[{description:'Reviewed construction scope',quantity:1,unit_cents:1200000}]})
 await c.act(`/quotes/${c.job.quotes[0].id}/accept`,{method:'signed',evidence:'Synthetic accepted construction scope',schedule_choice:{kind:'none',reason:'Separate professional review before work'}})
 const task=await c.act('/schedules',{trade:'Synthetic framing',start:'2026-11-02T08:00:00Z',end:'2026-11-02T09:00:00Z',description:'Enclose inspected framing'})
 const constraint=await c.act('/schedule-constraints',{kind:'inspection',title:'Framing inspection before enclosure',jurisdiction:'Synthetic jurisdiction',accountable:'Accountable inspector',task_ids:[task.id],reason:'Inspection required'})
 await c.act('/schedule-constraints/'+constraint.id,{action:'cleared',reason:'Original inspection result received',documents:[professionalFiles[0]]})
 await page.goto(base+`/app?job=${c.job.id}&tab=Schedule`)
 const panel=page.getByRole('region',{name:'Professional prerequisite register',exact:true})
 await panel.getByText('Register a prerequisite',{exact:true}).click()
 await panel.getByLabel('Prerequisite title',{exact:true}).fill('Framing professional review')
 await panel.getByLabel('Existing requirement',{exact:true}).selectOption({label:'inspection · Framing inspection before enclosure'})
 await panel.getByLabel('Decision deadline',{exact:true}).fill('2026-11-01')
 await panel.getByRole('checkbox',{name:'Enclose inspected framing',exact:true}).check()
 await panel.getByRole('button',{name:'Register prerequisite',exact:true}).click()
 const record=panel.getByRole('article',{name:'Framing professional review',exact:true})
 await expect(record.getByText('Held',{exact:true})).toBeVisible()
 await c.refresh();let row=(await c.read()).register[0]
 async function upload(signed){
  const version=row.evidence.length+1
  await record.getByText('Submit new evidence',{exact:true}).click()
  const form=record.locator('form').filter({has:page.getByRole('button',{name:'Submit prerequisite evidence',exact:true})})
  await form.getByLabel('Designated office reviewer',{exact:true}).selectOption({label:'Professional office reviewer'})
  await form.getByLabel('Accountable professional',{exact:true}).fill('Accountable framing inspector')
  await form.getByLabel('Recorded qualification evidence',{exact:true}).fill('Jurisdiction appointment and recorded professional qualification original')
  await form.getByLabel('Evidence effective date',{exact:true}).fill('2020-01-01')
  await form.getByLabel('Evidence expiry date',{exact:true}).fill('2099-12-31')
  await form.getByRole('checkbox').setChecked(signed)
  await form.getByLabel('Decision and qualification originals',{exact:true}).setInputFiles(professionalFiles.map(file=>({name:file.name,mimeType:file.mime,buffer:Buffer.from(file.base64,'base64')})))
  await form.getByRole('button',{name:'Submit prerequisite evidence',exact:true}).click()
  const versionPanel=record.getByRole('region',{name:`Evidence version ${version}`,exact:true})
  await expect(versionPanel).toBeVisible()
  await expect(versionPanel.getByText(signed?'Signed original recorded':'Unsigned evidence',{exact:false})).toBeVisible()
  await c.refresh();row=(await c.read()).register[0]
 }
 const move=()=>c.request(`/schedules/${task.id}/move`,{start:'2026-11-03T08:00:00Z',end:'2026-11-03T09:00:00Z'})
 const held=async(code='professional_hold')=>{const before=await c.read(),r=await move();assert.equal(r.status,409,JSON.stringify(r.value));assert.equal(r.value.error,code);assert.deepEqual(await c.read(),before)}
 const decide=async(extra={},cookie=reviewer.email)=>c.request(`/professional-prerequisites/${row.id}/review`,await c.review(row,extra),{cookie})
 await held();await upload(false);await held()
 let before=await c.read();assert.equal((await decide()).status,409);assert.deepEqual(await c.read(),before)
 // Expired evidence and an explicit rejection retain the hold and every prior version.
 row=await c.act(`/professional-prerequisites/${row.id}/evidence`,await c.evidence(row,{reviewer_id:(await c.read()).reviewers.find(p=>p.name==='Professional office reviewer').id,expires_on:'2026-10-26'}))
 assert.equal((await decide()).status,409);await held()
 row=await c.act(`/professional-prerequisites/${row.id}/evidence`,await c.evidence(row,{reviewer_id:(await c.read()).reviewers.find(p=>p.name==='Professional office reviewer').id}))
 assert.equal((await decide({disposition:'rejected',reason:'The submitted original does not approve enclosure'})).status,200)
 row=(await c.read()).register[0];const rejection=structuredClone(row.evidence.at(-1));await held()
 assert.equal((await decide()).status,409,'Rejection is immutable')
 await page.reload();await upload(true)
 before=await c.read()
 assert.equal((await decide({source_checksum:'synthetic-plinth-mismatch'})).status,409)
 assert.equal((await decide({},'owner')).status,403,'An undesignated owner cannot decide for the reviewer')
 assert.deepEqual(await c.read(),before)
 await reviewer.page.goto(base+`/app?job=${c.job.id}&tab=Schedule`)
 const reviewPanel=reviewer.page.getByRole('region',{name:'Professional prerequisite register',exact:true}),current=reviewPanel.getByRole('region',{name:`Evidence version ${row.evidence.length}`,exact:true})
 await current.getByText('Review exact evidence',{exact:true}).click()
 await current.getByLabel('Decision',{exact:true}).selectOption('approved')
 await current.getByLabel('Reasoned decision',{exact:true}).fill('Reviewed exact inspection and professional qualification originals for enclosure')
 await current.getByRole('checkbox').check()
 await current.getByRole('button',{name:'Record professional decision',exact:true}).click()
 await expect(current.getByText('Decision: approved',{exact:false})).toBeVisible()
 await c.refresh();row=(await c.read()).register[0]
 assert.deepEqual(row.evidence.at(-2),rejection);assert.equal((await move()).status,200)
 for(const file of row.evidence.at(-1).attachments){const response=await owner.request.get(base+c.register+'/files/'+file.id);assert.equal(response.status(),200);assert.deepEqual(await response.body(),professionalOriginal)}
 const source=await owner.request.get(base+row.evidence.at(-1).source.href);assert.equal(source.status(),200);assert.deepEqual(await source.body(),professionalOriginal)
 assert.equal((await json(c.register,{cookie:client.email})).status,403)
 assert.equal((await json(c.root,{cookie:client.email})).value.job.professional_prerequisites,undefined)
 const people=(await json('/auth/operators')).value,person=people.find(p=>p.email===reviewer.email),approved=structuredClone(row.evidence)
 await post('/auth/operator/status',{operatorId:person.id,status:'inactive'})
 assert.equal((await decide()).status,401);await held('professional_authority')
 assert.deepEqual((await c.read()).register[0].evidence,approved)
 // The owner must submit a fresh version and use their own explicit decision after revocation.
 row=await c.act(`/professional-prerequisites/${row.id}/evidence`,await c.evidence(row))
 assert.equal((await decide({},'owner')).status,200);assert.equal((await move()).status,200)
 // A coverage upload cannot authorize the linked subcontract until native verification and exact professional review both pass.
 let vendor=(await post('/api/plinth/vendors',{kind:'subcontractor',name:'Synthetic insured contractor',trades:['Framing'],contacts:[]})).vendor
 vendor=(await post(`/api/plinth/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Framing',status:'qualified',evidence:'Recorded office-reviewed qualification'})).vendor
 const coverage=await post(`/api/plinth/vendors/${vendor.id}/compliance`,{expected_version:vendor.version,kind:'general_liability',issuer:'Synthetic insurer',reference:'synthetic-plinth-coverage',effective_on:'2020-01-01',expires_on:'2099-12-31',document:professionalFiles[0]});vendor=coverage.vendor
 const sub=await c.act('/subcontracts',{vendor_id:vendor.id,trade:'Framing',scope:'Insured framing installation',amount_cents:100000,contact_ids:[],awarded_on:'2026-10-27'})
 let coverageRow=await c.act('/professional-prerequisites',{title:'Coverage professional review',source:{kind:'coverage',source_id:coverage.record.id,subcontract_id:sub.id},task_ids:[],due_on:'2026-11-01'})
 coverageRow=await c.act(`/professional-prerequisites/${coverageRow.id}/evidence`,await c.evidence(coverageRow))
 before=await c.read();assert.equal((await c.request(`/professional-prerequisites/${coverageRow.id}/review`,await c.review(coverageRow))).value.error,'professional_source');assert.deepEqual(await c.read(),before)
 assert.equal((await c.request(`/subcontracts/${sub.id}/release`)).value.error,'professional_hold')
 vendor=(await post(`/api/plinth/vendors/${vendor.id}/compliance/${coverage.record.id}/review`,{expected_version:vendor.version,decision:'verified',note:'Insurer evidence checked by the designated native reviewer'})).vendor
 coverageRow=await c.act(`/professional-prerequisites/${coverageRow.id}/evidence`,await c.evidence(coverageRow))
 await c.act(`/professional-prerequisites/${coverageRow.id}/review`,await c.review(coverageRow))
 assert.equal((await c.request(`/subcontracts/${sub.id}/release`)).status,200)
 // A waiver source is a separate native approval. Receiving a signature never substitutes for acceptance.
 await post('/api/plinth/lien-waiver-templates',{expected_version:0,templates:[{name:'Synthetic owner progress wording',state:'VT',form:'conditional_progress',wording:'Owner-provided synthetic waiver wording for this progress draw.'}]},'PUT')
 await c.act(`/subcontracts/${sub.id}/lien`,{state:'VT',lower_tiers:[]})
 const draw=await c.act(`/subcontracts/${sub.id}/draws`,{through_date:'2026-10-27',amount_cents:10000})
 const waiverPath=`/subcontracts/${sub.id}/draws/${draw.id}/waivers`,waiver=await c.act(waiverPath,{party_id:vendor.id,kind:'conditional'})
 let waiverRow=await c.act('/professional-prerequisites',{title:'Waiver professional review',source:{kind:'waiver',source_id:waiver.id,subcontract_id:sub.id},task_ids:[],due_on:'2026-11-01'})
 assert.equal((await c.request(`/professional-prerequisites/${waiverRow.id}/evidence`,await c.evidence(waiverRow))).value.error,'professional_source')
 await c.act(`${waiverPath}/${waiver.id}/release`,{signer_name:'Synthetic authorized contractor',amount_cents:10000,through_date:'2026-10-27',document:professionalFiles[0]})
 waiverRow=await c.act(`/professional-prerequisites/${waiverRow.id}/evidence`,await c.evidence(waiverRow))
 assert.equal((await c.request(`/professional-prerequisites/${waiverRow.id}/review`,await c.review(waiverRow))).value.error,'professional_source')
 await c.act(`${waiverPath}/${waiver.id}/accept`,{amount_cents:10000,through_date:'2026-10-27'})
 const payment=()=>c.request(`/subcontracts/${sub.id}/draws/${draw.id}/payment`,{paid_on:'2026-10-27',amount_cents:10000,reference:'Synthetic staff-recorded payment'})
 assert.equal((await payment()).value.error,'professional_hold')
 waiverRow=await c.act(`/professional-prerequisites/${waiverRow.id}/evidence`,await c.evidence(waiverRow))
 await c.act(`/professional-prerequisites/${waiverRow.id}/review`,await c.review(waiverRow))
 assert.equal((await payment()).status,200)
 const wholeSite=await c.act('/schedule-constraints',{kind:'inspection',title:'Whole-site release',jurisdiction:'Synthetic jurisdiction',accountable:'Synthetic inspector',task_ids:[],reason:'Require professional review before new work'})
 await c.act('/schedule-constraints/'+wholeSite.id,{action:'cleared',reason:'Original inspection received',documents:[professionalFiles[0]]})
 await c.act('/professional-prerequisites',{title:'Professional hold on all new work',source:{kind:'inspection',source_id:wholeSite.id},task_ids:[],due_on:'2026-11-01'})
 const heldSite=await c.read()
 assert.equal((await c.request('/schedules',{trade:'Synthetic new crew',description:'New unreviewed work',start:'2026-11-04T08:00:00Z',end:'2026-11-04T09:00:00Z'})).value.error,'professional_hold')
 assert.deepEqual(await c.read(),heldSite)
 await page.reload();await expect(panel.getByRole('heading',{name:'Coverage professional review',exact:true})).toBeVisible()
 for(const details of await panel.locator('details[open]').all())await details.locator('summary').click()
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await panel.scrollIntoViewIfNeeded()
  if(width===1440)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The register fits the viewport')
  if(width===390){const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await page.waitForTimeout(350);await page.mouse.move(250,500);await menu.focus()}
  await page.screenshot({path:`${shots}/BOUND-002-professional-register-${width}.png`,fullPage:true,animations:'disabled'})
 }
 for(const context of contexts.values())await context.close()
 console.log('BOUND-002 PASS: installed inspection, coverage and waiver prerequisites, unsigned, unverified, rejected, expired and mismatched evidence refusal, exact current designated decisions, immutable originals and revoked authority; screens at 1440 and 390')
}finally{await browser.close()}
