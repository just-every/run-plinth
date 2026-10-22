import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {parseContract} from '../../src/base/seed-contract.mjs'
import {chromium,expect} from '@playwright/test'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&shots&&process.env.PLINTH_OWNER_OPEN,'Use the disposable installation and its own private native entrance')
const ownerOpen=new URL(process.env.PLINTH_OWNER_OPEN),fragment=new URLSearchParams(ownerOpen.hash.slice(1))
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)&&ownerOpen.origin===base&&fragment.has('rer-dev'))
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
await mkdir(shots,{recursive:true})
try{
 const contexts=await Promise.all(Array.from({length:5},()=>browser.newContext())),pages=await Promise.all(contexts.map(c=>c.newPage())),[owner,c1,c2,s1,s2]=contexts,[page,cp1,cp2,sp1,sp2]=pages
 const stamp=Date.now(),emails=Array.from({length:4},(_,n)=>`synthetic-plinth-${stamp+n}@dev.localhost`)
 await page.goto(ownerOpen.href);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 for(let n=0;n<4;n++){
  const r=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email:emails[n],displayName:['Alex Mason','Jordan Park','Sam Rivera','Riley Chen'][n],role:'member',returnTo:'/app'}});assert.equal(r.status(),202)
  const url=new URL(ownerOpen),hash=new URLSearchParams(fragment);hash.set('as',emails[n]);hash.set('next',`/auth/dev/enter?as=${encodeURIComponent(emails[n])}&returnTo=/app`);url.hash=hash.toString()
  await pages[n+1].goto(url.href);await pages[n+1].waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 }
 const post=async(path,data,context=owner)=>{const r=await context.request.post(base+'/api/plinth'+path,{headers:{origin:base},data});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 const read=async(id)=>{const r=await owner.request.get(base+'/api/plinth/jobs/'+id);assert.ok(r.ok());return (await r.json()).job}
 const jobs=[],vendors=[],scopes=[]
 for(let n=0;n<2;n++){
  let {job}=await post('/jobs',{name:n?'Park porch renewal':'Mason kitchen remodel',client_email:emails[n],address:n?'17 Pine Street, Portland, OR 97211':'4518 Alder Avenue, Portland, OR 97211'})
  const act=async(path,body={})=>{const result=await post(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});job=await read(job.id);return result.record}
  await act('/quotes',{lines:[{description:'Agreed residential scope',quantity:1,unit_cents:48000000}]});await act(`/quotes/${job.quotes[0].id}/accept`,{method:'email',evidence:'Synthetic client accepted exact proposal',schedule_choice:{kind:'none',reason:'Schedule planned after portal setup'}})
  const vendor=(await post('/vendors',{kind:'subcontractor',name:n?'Pine Street Tile':'Rivera Tile and Stone',trades:['Tile'],contacts:[{id:`synthetic-plinth-${n+1}`,name:n?'Riley Chen':'Sam Rivera',email:emails[n+2]}]})).vendor
  await post(`/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Tile',status:'qualified',evidence:'Human-reviewed synthetic qualification'})
  const scope=await act('/subcontracts',{vendor_id:vendor.id,trade:'Tile',scope:n?'Porch tiling':'Kitchen splashback',contact_ids:[`synthetic-plinth-${n+1}`],awarded_on:'2026-10-22'});await act(`/subcontracts/${scope.id}/release`)
  const selection=await act('/selections',{room:n?'Porch':'Kitchen',category:'Tile finish',allowance_cents:750000,cost_code:'09-300',decision_on:'2026-11-04',lead_days:14,options:[{name:n?'Slate tile':'Warm white porcelain',supplier:'Synthetic tile supply',specifications:'Exact matte finish and size shown to this client',price_cents:750000}]});await act(`/selections/${selection.id}/present`,{revision_id:selection.revisions[0].id})
  jobs.push(job);vendors.push(vendor);scopes.push(scope)
 }
 const capture=async(p,name,check)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});if(check)await check();await p.evaluate(()=>scrollTo(0,0));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width);await p.screenshot({path:`${shots}/ROLE-003-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 await cp1.goto(base+`/app?job=${jobs[0].id}&tab=Selections`)
 let form=cp1.getByRole('button',{name:'Record choice: Warm white porcelain',exact:true}).locator('xpath=ancestor::form')
 await expect(form).toBeVisible();await form.getByLabel('Your acceptance statement',{exact:true}).fill('I approve this exact porcelain finish and price');await form.getByRole('checkbox').check()
 await capture(cp1,'first-client-selection',async()=>{await expect(form).toBeVisible();await expect(cp1.getByText('Slate tile',{exact:false})).toHaveCount(0)})
 await form.getByRole('button',{name:'Record choice: Warm white porcelain',exact:true}).click()
 await capture(cp1,'first-client-recorded-choice',async()=>expect(cp1.getByText('Recorded client choice: Warm white porcelain',{exact:false})).toBeVisible())
 await cp2.goto(base+`/app?job=${jobs[1].id}&tab=Selections`)
 await capture(cp2,'second-client-own-job',async()=>{await expect(cp2.getByRole('button',{name:'Record choice: Slate tile',exact:true})).toBeVisible();await expect(cp2.getByText('Warm white porcelain',{exact:false})).toHaveCount(0)})
 for(const [context,index] of [[c1,1],[c2,0]])assert.equal((await context.request.get(base+'/api/plinth/jobs/'+jobs[index].id)).status(),404)
 jobs[0]=await read(jobs[0].id)
 const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64'),file={name:'synthetic-plinth-1.png',mime:'image/png',base64:photo.toString('base64')}
 let result=await post(`/jobs/${jobs[0].id}/punch/issues`,{expected_version:jobs[0].version,title:'Kitchen splashback grout repair',description:'Fill the open grout joint before closeout',kind:'quality',severity:'normal',due_on:'2026-11-05',location:'Kitchen east wall',photo:file,annotation:{x:.4,y:.5,note:'Open grout joint'}});jobs[0]=await read(jobs[0].id);const issue=result.record
 await post(`/jobs/${jobs[0].id}/punch/issues/${issue.id}/assign`,{expected_version:jobs[0].version,subcontract_id:scopes[0].id,email:emails[2]})
 const inbox=async(p)=>{await p.goto(base+'/app');await p.locator('button.signout').waitFor({state:'attached'});const menu=p.getByRole('button',{name:'Open menu',exact:true});if(await menu.isVisible())await menu.click();await p.getByRole('button',{name:'Punch inbox',exact:true}).click();await expect(p.getByRole('heading',{name:'Punch inbox',exact:true})).toBeVisible()}
 await inbox(sp1)
 form=sp1.getByRole('button',{name:'Submit repair evidence',exact:true}).locator('xpath=ancestor::form')
 await form.getByLabel('Repair details',{exact:true}).fill('Repacked the grout joint and attached the exact inspection photo');await form.getByLabel('Repair or inspection originals (PDF, PNG or JPEG)',{exact:true}).setInputFiles({name:'synthetic-plinth-2.png',mimeType:'image/png',buffer:photo})
 await capture(sp1,'first-subcontractor-private-upload',async()=>expect(form).toBeVisible());await form.getByRole('button',{name:'Submit repair evidence',exact:true}).click()
 await capture(sp1,'first-subcontractor-received-evidence',async()=>expect(sp1.getByText('Awaiting inspection',{exact:false})).toBeVisible())
 jobs[0]=await read(jobs[0].id);const repair=jobs[0].punch.issues[0].attempts[0],original=`/api/plinth/punch/${jobs[0].id}/files/${repair.attachments[0].id}`
 const receipt=await s1.request.get(base+original);assert.equal(receipt.status(),200);assert.deepEqual(await receipt.body(),photo)
 for(const context of [c2,s2])for(const path of [original,`/api/plinth/punch/${jobs[0].id}/export.json`,`/api/plinth/punch/${jobs[0].id}?q=grout`])assert.equal((await context.request.get(base+path)).status(),404)
 await inbox(sp2);await capture(sp2,'second-subcontractor-isolated',async()=>expect(sp2.getByText('Kitchen splashback grout repair',{exact:false})).toHaveCount(0))
 const records=async(p)=>{await p.goto(base+'/app');await p.locator('button.signout').waitFor({state:'attached'});const menu=p.getByRole('button',{name:'Open menu',exact:true});if(await menu.isVisible())await menu.click();await p.getByRole('button',{name:'Subcontractor records',exact:true}).click();await expect(p.getByRole('heading',{name:'Subcontractor records',exact:true})).toBeVisible()}
 await records(sp1);await sp1.getByText('Submit a bill or compliance evidence',{exact:true}).click()
 form=sp1.getByRole('button',{name:'Submit bill original',exact:true}).locator('xpath=ancestor::form')
 await form.getByLabel('Your awarded company scope',{exact:true}).selectOption(scopes[0].id);await form.getByLabel('Submission reference',{exact:true}).fill('synthetic-plinth-1');await form.getByLabel('Submission note',{exact:true}).fill('Kitchen splashback bill');await form.getByLabel('Bill amount (USD)',{exact:true}).fill('1234.00');await form.getByLabel('Submission originals (PDF, PNG or JPEG; up to five, one for compliance)',{exact:true}).setInputFiles({name:'synthetic-plinth-1.png',mimeType:'image/png',buffer:photo})
 await capture(sp1,'subcontractor-bill-upload',async()=>expect(form).toBeVisible());await form.getByRole('button',{name:'Submit bill original',exact:true}).click()
 await capture(sp1,'subcontractor-bill-received',async()=>expect(sp1.getByRole('heading',{name:'Bill · synthetic-plinth-1',exact:true})).toBeVisible())
 jobs[0]=await read(jobs[0].id);const bill=jobs[0].portal_submissions.find(s=>s.kind==='bill')
 await sp1.getByLabel('Submission type',{exact:true}).selectOption('compliance');form=sp1.getByRole('button',{name:'Submit unverified compliance evidence',exact:true}).locator('xpath=ancestor::form')
 await form.getByLabel('Your awarded company scope',{exact:true}).selectOption(scopes[0].id);await form.getByLabel('Submission reference',{exact:true}).fill('synthetic-plinth-2');await form.getByLabel('Submission note',{exact:true}).fill('Replacement tile contractor license');await form.getByLabel('Evidence kind',{exact:true}).selectOption('license');await form.getByLabel('Carrier or licensing authority',{exact:true}).fill('Synthetic state licensing authority');await form.getByLabel('Evidence effective date',{exact:true}).fill('2026-01-01');await form.getByLabel('Evidence expiry date',{exact:true}).fill('2099-12-31');await form.getByLabel('Submission originals (PDF, PNG or JPEG; up to five, one for compliance)',{exact:true}).setInputFiles({name:'synthetic-plinth-2.png',mimeType:'image/png',buffer:photo})
 await capture(sp1,'subcontractor-unverified-compliance-upload',async()=>expect(form).toBeVisible());await form.getByRole('button',{name:'Submit unverified compliance evidence',exact:true}).click()
 await capture(sp1,'subcontractor-unverified-compliance-received',async()=>expect(sp1.getByRole('heading',{name:'Compliance evidence · synthetic-plinth-2',exact:true})).toBeVisible())
 jobs[0]=await read(jobs[0].id);const compliance=jobs[0].portal_submissions.find(s=>s.kind==='compliance'),vendorRecord=await (await owner.request.get(base+'/api/plinth/vendors/'+vendors[0].id)).json()
 await post(`/vendors/${vendors[0].id}/compliance/${compliance.compliance_id}/review`,{expected_version:vendorRecord.vendor.version,decision:'verified',note:'Private office reviewer finding'})
 await records(sp1);await capture(sp1,'subcontractor-current-compliance-decision',async()=>{await expect(sp1.getByText('Verified by the designated reviewer',{exact:true})).toBeVisible();await expect(sp1.getByText('Private office reviewer finding',{exact:false})).toHaveCount(0)})
 await sp1.getByLabel('Search submitted records',{exact:true}).fill('splashback');await capture(sp1,'subcontractor-searched-records',async()=>{await expect(sp1.getByRole('heading',{name:'Bill · synthetic-plinth-1',exact:true})).toBeVisible();await expect(sp1.getByRole('heading',{name:'Compliance evidence · synthetic-plinth-2',exact:true})).toHaveCount(0)})
 await records(sp2);await capture(sp2,'second-subcontractor-records-isolated',async()=>{await expect(sp2.getByText('Kitchen splashback bill',{exact:true})).toHaveCount(0);await expect(sp2.getByRole('heading',{name:jobs[1].name,exact:true})).toBeVisible()})
 jobs[0]=await read(jobs[0].id)
 for(const path of [`/subcontractor-portal/${jobs[0].id}/export.json?q=splashback`,`/subcontractor-portal/${jobs[0].id}/files/${bill.attachments[0].id}`]){const own=await s1.request.get(base+'/api/plinth'+path);assert.equal(own.status(),200);assert.equal((await s2.request.get(base+'/api/plinth'+path)).status(),404)}
 await page.goto(base+`/app?job=${jobs[0].id}&tab=Purchasing`);await capture(page,'owner-subcontractor-records',async()=>expect(page.getByRole('heading',{name:'Bill · synthetic-plinth-1',exact:true})).toBeVisible())
 await page.goto(base+`/app?job=${jobs[0].id}&tab=History`);form=page.getByRole('button',{name:'Save external portal restrictions',exact:true}).locator('xpath=ancestor::form')
 await form.getByRole('checkbox',{name:'Hide client selections',exact:true}).check();await form.getByRole('checkbox',{name:'Hide subcontractor punch',exact:true}).check();await form.getByRole('checkbox',{name:'Hide subcontractor bills',exact:true}).check();await form.getByLabel('Access change reason',{exact:true}).fill('Owner temporarily restricts these external features')
 await capture(page,'owner-feature-restrictions',async()=>expect(form).toBeVisible());const saved=page.waitForResponse(r=>r.url().endsWith('/portal-policy')&&r.request().method()==='POST');await form.getByRole('button',{name:'Save external portal restrictions',exact:true}).click();assert.ok((await saved).ok());jobs[0]=await read(jobs[0].id)
 await cp1.reload();await capture(cp1,'client-feature-revoked',async()=>{await expect(cp1.getByText('This feature is not available for your access.',{exact:true})).toBeVisible();await expect(cp1.getByRole('button',{name:'Selections',exact:true})).toHaveCount(0);await expect(cp1.getByText('Warm white porcelain',{exact:false})).toHaveCount(0)})
 await inbox(sp1);await capture(sp1,'subcontractor-feature-revoked',async()=>expect(sp1.getByText('Kitchen splashback grout repair',{exact:false})).toHaveCount(0))
 assert.equal((await s1.request.get(base+original)).status(),404)
 assert.equal((await s1.request.get(base+`/api/plinth/subcontractor-portal/${jobs[0].id}/files/${bill.attachments[0].id}`)).status(),404)
 const held=await s1.request.post(base+`/api/plinth/punch/${jobs[0].id}/issues/${issue.id}/submit`,{headers:{origin:base},data:{expected_version:jobs[0].version,note:'Revoked queued upload',attachments:[file]}});assert.equal(held.status(),404)
 await page.goto(base+`/app?job=${jobs[0].id}&tab=Punch`);await capture(page,'owner-retained-submission',async()=>expect(page.getByText('Awaiting inspection',{exact:false})).toBeVisible())
 const contract=parseContract(await readFile(new URL('../../CONTRACT.md',import.meta.url),'utf8'))
 const site=process.env.PLINTH_SITE;assert.ok(site,'The same rer dev session supplies the public run site preview')
 const publicContext=await browser.newContext(),publicPage=await publicContext.newPage();await publicPage.goto(site+'/contract')
 for(const width of [1440,390]){
  await publicPage.setViewportSize({width,height:1000});await publicPage.evaluate(()=>scrollTo(0,0));for(const status of ['done','partial','missing'])await expect(publicPage.locator('#progress')).toHaveAttribute('data-'+status,String(contract.counts[status]))
  assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Contract fits '+width)
  await publicPage.screenshot({path:`${shots}/ROLE-003-contract-progress-${width}.png`,animations:'disabled'})
  for(const id of ['BID-001','ROLE-003','ROLE-006']){const row=publicPage.locator(`tr.clause[data-id="${id}"]`);await expect(row).toHaveAttribute('data-status',contract.clauses.find(c=>c.id===id).status);await row.screenshot({path:`${shots}/${id}-contract-evidence-${width}.png`,animations:'disabled'})}
 }
 await publicPage.goto(site+'/docs/agent-commands');const portalDoc=publicPage.getByRole('heading',{name:'External portal grants and records',exact:true})
 for(const width of [1440,390]){await publicPage.setViewportSize({width,height:1000});await portalDoc.scrollIntoViewIfNeeded();await expect(portalDoc).toBeVisible();assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Portal documentation fits '+width);await publicPage.screenshot({path:`${shots}/ROLE-003-portal-docs-${width}.png`,animations:'disabled'})}
 await publicContext.close()
 console.log('ROLE-003 PASS: two client and two subcontractor identities, exact selection and upload, cross-job file/search/export refusal and next-request feature revocation; 1440/390')
 for(const context of contexts)await context.close()
}finally{await browser.close()}
