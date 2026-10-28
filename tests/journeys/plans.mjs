import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { takeoffPlan } from '../fixtures/takeoff-plan.mjs'
import { nativeSignIn } from '../../scripts/verify/native-signin.mjs'
const base=process.env.PLINTH_URL,state=process.env.PLINTH_STATE,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&state&&shots,'Use the disposable installed application')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:state,viewport:{width:1440,height:1000}}),field=await browser.newContext({viewport:{width:1440,height:1000}}),page=await owner.newPage(),fp=await field.newPage()
 const post=async(path,body,method='POST')=>{const r=await owner.request.fetch(base+path,{method,headers:{origin:base},data:body});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 const email=['synthetic-plinth-plan-crew','dev.localhost'].join('@')
 const {job}=await post('/api/plinth/jobs',{name:'Maple house drawing review',client_email:['synthetic-plinth-plan-client','dev.localhost'].join('@'),address:'148 Maple Street'})
 const invite=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:'Synthetic plan crew',role:'admin',returnTo:'/app'}});assert.equal(invite.status(),202)
 const people=await (await owner.request.get(base+'/api/plinth/team')).json(),person=people.team.find(p=>p.email===email)
 await post('/api/plinth/team/'+person.id,{expected_version:0,role:'crew',job_ids:[job.id],po_limit_cents:0},'PUT')
 await nativeSignIn(fp,email)
 await page.goto(base+`/app?job=${job.id}&tab=Plans`)
 await page.getByText('Upload a plan set',{exact:true}).click()
 async function upload(title,revision,changed=false){
  const panel=page.getByRole('region',{name:'Versioned plans'}),form=panel.locator('form').last()
  await form.getByLabel('Plan set title',{exact:true}).fill(title)
  await form.getByLabel('Issue date',{exact:true}).fill(changed?'2026-10-10':'2026-10-01')
  await form.getByLabel('Original plan PDFs',{exact:true}).setInputFiles([{name:'synthetic-plinth-plan.pdf',mimeType:'application/pdf',buffer:takeoffPlan(changed)},{name:'synthetic-plinth-spec.pdf',mimeType:'application/pdf',buffer:takeoffPlan()},{name:'synthetic-plinth-addendum.pdf',mimeType:'application/pdf',buffer:takeoffPlan()}])
  for(const [i,number,kind] of [[1,'A1','plan'],[2,'S1','specification'],[3,'AD1','addendum']]){
   await form.getByLabel('Sheet number '+i,{exact:true}).fill(number);await form.getByLabel('Revision number '+i,{exact:true}).fill(revision);await form.getByLabel('Document kind '+i,{exact:true}).selectOption(kind)
  }
  await form.getByRole('button',{name:'Upload plan set',exact:true}).click()
  await expect(panel.getByRole('heading',{name:title,exact:true})).toBeVisible()
 }
 async function approve(title){
  const record=page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})})
  await record.getByRole('checkbox',{name:'Synthetic plan crew',exact:true}).check()
  await record.getByRole('checkbox',{name:'I approve these exact sheets and notify the selected recipients in their plan inbox.',exact:true}).check()
  await record.getByRole('button',{name:'Approve and notify recipients',exact:true}).click()
  await expect(record.getByText('Plan inbox notice for Synthetic plan crew: Awaiting acknowledgment',{exact:true})).toBeVisible()
 }
 await upload('Permit set','A');await approve('Permit set')
 const first=(await (await owner.request.get(base+`/api/plinth/jobs/${job.id}/plans`)).json()).plans.sets[0],old=first.sheets[0]
 await fp.goto(base+old.href)
 await expect(fp.getByText('PDF ready.',{exact:true})).toBeVisible()
 await fp.getByLabel('Revision annotation',{exact:true}).fill('Keep the original framing note attached to revision A')
 await fp.getByRole('button',{name:'Save source annotation',exact:true}).click()
 await expect(fp.getByText('Keep the original framing note attached to revision A · A1 · source revision A · Synthetic plan crew',{exact:true})).toBeVisible()
 await upload('Construction set','B',true)
 await fp.reload();await expect(fp.getByRole('article',{name:'Selected drawing'}).getByText('Latest approved',{exact:true})).toBeVisible()
 await approve('Construction set')
 const sets=(await (await owner.request.get(base+`/api/plinth/jobs/${job.id}/plans`)).json()).plans.sets,newSheet=sets[1].sheets[0]
 await fp.goto(base+`/app?view=plans&plan_job=${job.id}`)
 const drawing=fp.getByRole('article',{name:'Selected drawing'})
 await expect(drawing.getByRole('heading',{name:'A1 · revision B',exact:true})).toBeVisible()
 await expect(drawing.getByText('Latest approved',{exact:true})).toBeVisible()
 await expect(drawing.getByText('PDF ready.',{exact:true})).toBeVisible()
 await expect(drawing.getByText('Keep the original framing note attached to revision A',{exact:false})).toHaveCount(0)
 const notice=fp.locator('article').filter({has:fp.getByRole('heading',{name:'Construction set',exact:true})})
 await notice.getByRole('button',{name:'Acknowledge Construction set',exact:true}).click()
 await expect(notice.getByText('Plan inbox notice for Synthetic plan crew: Acknowledged by Synthetic plan crew',{exact:true})).toBeVisible()
 const capture=async(label)=>{for(const width of [1440,390]){
  await fp.setViewportSize({width,height:1000});await expect(drawing.getByText('PDF ready.',{exact:true})).toBeVisible()
  if(width===390){
   assert.ok(await fp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Phone drawing fits the viewport')
   if(label==='current')await expect(drawing.getByRole('heading',{name:'A1 · revision B',exact:true})).toBeVisible()
   const menu=fp.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')
  }
  await fp.screenshot({path:`${shots}/DOC-001-${label}-${width}.png`,fullPage:true,animations:'disabled'})
 }}
 await capture('current')
 const currentFile=await field.request.get(base+`/api/plinth/jobs/${job.id}/plans/${sets[1].id}/files/${newSheet.id}`);assert.deepEqual(await currentFile.body(),takeoffPlan(true))
 await fp.setViewportSize({width:1440,height:1000});await fp.goto(base+old.href)
 await expect(drawing.getByRole('heading',{name:'A1 · revision A',exact:true})).toBeVisible()
 await expect(drawing.getByText('Superseded history',{exact:true})).toBeVisible()
 await expect(drawing.getByText('Superseded by revision B. This link retains the original source.',{exact:true})).toBeVisible()
 await expect(drawing.getByText('Keep the original framing note attached to revision A · A1 · source revision A · Synthetic plan crew',{exact:true})).toBeVisible()
 await expect(drawing.getByRole('link',{name:'Pinned link to this exact sheet',exact:true})).toHaveAttribute('href',old.href)
 const original=await field.request.get(base+`/api/plinth/jobs/${job.id}/plans/${first.id}/files/${old.id}`);assert.deepEqual(await original.body(),takeoffPlan())
 await capture('pinned-history')
 await owner.close();await field.close()
 console.log('DOC-001 PASS: two uploaded sets, explicit approval and native notices, acknowledgment, pinned history, source annotations and current phone drawing; browser proof at 1440 and 390')
}finally{await browser.close()}
