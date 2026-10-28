import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { followupFixture } from '../plinth/followup-support.mjs'
import { nativeSignIn } from '../../scripts/verify/native-signin.mjs'
const base=process.env.PLINTH_URL,state=process.env.PLINTH_STATE,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&state&&shots,'Use the disposable installed application')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:state,viewport:{width:1440,height:1000}}),contexts=new Map([['owner',owner]]),page=await owner.newPage()
 const json=async(path,{method='GET',cookie='owner',body}={})=>{const r=await contexts.get(cookie).request.fetch(base+path,{method,headers:{origin:base},...(body===undefined?{}:{data:body})});return {status:r.status(),value:await r.json()}}
 const invite=async(email,displayName,role='member')=>{
  const r=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName,role,returnTo:'/app'}});assert.equal(r.status(),202)
  const context=await browser.newContext(),p=await context.newPage();await nativeSignIn(p,email);await p.close();contexts.set(email,context);return email
 }
 const c=await followupFixture({json,invite,owner:'owner'})
 await page.goto(base+'/app');await page.getByRole('button',{name:'People & access',exact:true}).click()
 await page.locator('summary').filter({hasText:/^Settings$/}).click()
 const rules=page.getByRole('region',{name:'Follow-up rules',exact:true})
 async function choose(job){
  await rules.getByLabel('Rule job',{exact:true}).selectOption(job.job.id)
  await expect(rules.getByRole('checkbox',{name:'Synthetic follow-up client',exact:true})).toBeVisible()
 }
 async function configure(job,kind,trigger='event'){
  await choose(job)
  await rules.getByLabel('Sequence',{exact:true}).selectOption(kind)
  await rules.getByLabel('Trigger',{exact:true}).selectOption(trigger)
  await rules.getByLabel('Sequence starts',{exact:true}).fill(trigger==='scheduled'?'2026-10-29':'2026-10-27')
  await rules.getByLabel('Sequence stops',{exact:true}).fill('2026-12-31')
  await rules.getByRole('checkbox',{name:'Synthetic Plinth builder',exact:true}).uncheck()
  await rules.getByRole('checkbox',{name:'Synthetic follow-up client',exact:true}).check()
  await rules.getByLabel('Owner review limit (cents)',{exact:true}).fill('100000')
  await rules.getByLabel('Steps',{exact:true}).fill('0,reminder,First follow-up\n2,escalate,Owner review')
  await rules.getByRole('checkbox',{name:'I confirm these preview settings; this authorizes no delivery or financial approval.',exact:true}).check()
  await rules.getByRole('button',{name:'Save preview rule',exact:true}).click()
  await expect(rules.getByRole('heading',{name:kind[0].toUpperCase()+kind.slice(1)+' sequence · revision 1',exact:true})).toBeVisible()
 }
 await configure(c.estimate,'estimate');await configure(c.active,'selection');await configure(c.active,'collection','scheduled')
 const preview=async(asOf='2026-11-04T15:00:00Z')=>{
  await rules.getByLabel('Preview instant',{exact:true}).fill(asOf)
  await rules.getByRole('button',{name:'Preview dated actions',exact:true}).click()
  const p=rules.getByRole('region',{name:'Dated follow-up preview',exact:true})
  await expect(p.getByRole('heading',{name:'Preview at '+new Date(asOf).toISOString(),exact:true})).toBeVisible()
  return p
 }
 let p=await preview()
 await expect(p.getByText('Eligible preview · Prospective action only; nothing sent',{exact:true})).toHaveCount(4)
 const before=await c.active.read(),wire=await c.preview(c.active,'2026-11-04T15:00:00Z')
 assert.equal(new Set(wire.actions.map(a=>a.key)).size,4)
 await preview();assert.deepEqual(await c.active.read(),before,'Dated UI previews never write a job or financial record')
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000})
  if(width===390){
   const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Follow-up settings fit '+width)
  await page.screenshot({path:shots+'/AUTO-001-settings-preview-'+width+'.png',fullPage:true,animations:'disabled'})
 }
 await page.setViewportSize({width:1440,height:1000})
 await rules.getByRole('button',{name:'Edit collection rule',exact:true}).click()
 await rules.getByRole('checkbox',{name:'Pause this sequence',exact:true}).check()
 await rules.getByRole('checkbox',{name:'I confirm these preview settings; this authorizes no delivery or financial approval.',exact:true}).check()
 await rules.getByLabel('Revision reason',{exact:true}).fill('Owner paused collection sequence')
 await rules.getByRole('button',{name:'Save rule revision',exact:true}).click()
 await expect(rules.getByRole('heading',{name:'Collection sequence · revision 2',exact:true})).toBeVisible()
 p=await preview()
 await expect(p.getByText('Withheld · Rule paused',{exact:true})).toHaveCount(2)
 const stored=await c.api('/jobs/'+c.active.job.id+'/followup-rules')
 assert.equal(stored.value.rules.find(r=>r.kind==='collection').revisions[0].paused,false)
 assert.equal(stored.value.rules.find(r=>r.kind==='collection').revisions[1].paused,true)
 // Recipient changes only their own consent through the installed job Settings.
 const clientPage=await contexts.get(c.client).newPage()
 await clientPage.goto(base+'/app?job='+c.active.job.id)
 await clientPage.locator('summary').filter({hasText:/^Follow-up preview Settings$/}).click()
 await clientPage.getByRole('checkbox',{name:'Allow selection follow-up previews for me',exact:true}).uncheck()
 await clientPage.getByRole('button',{name:'Save selection preference',exact:true}).click()
 await expect(clientPage.getByRole('status').filter({hasText:'Saved.'})).toBeVisible()
 p=await preview()
 await expect(p.getByText('Withheld · Recipient opted out; sequence stopped',{exact:true})).toHaveCount(2)
 await c.active.read();await c.active.act('/selections/'+c.choice.id+'/sign',{revision_id:c.choice.revisions[0].id,option_id:c.choice.revisions[0].options[0].id,statement:'I approve this exact option',confirm:true},c.client)
 p=await preview()
 await expect(p.getByText('Withheld · Source resolved or held',{exact:true})).toHaveCount(2)
 await choose(c.estimate)
 p=await preview('2026-10-27T15:00:00Z')
 await expect(p.getByText('Eligible preview · Prospective action only; nothing sent',{exact:true})).toHaveCount(1)
 await expect(p.getByText('Withheld · Step not due',{exact:true})).toHaveCount(1)
 assert.equal((await json('/api/plinth/jobs/'+c.active.job.id+'/followup-rules',{cookie:c.client})).status,403)
 for(const context of contexts.values())await context.close()
 console.log('AUTO-001 PASS: owner saves separate event and scheduled sequences, current recipients and consent, dated deduplicated previews, retained pause revisions, client opt-out and resolution; no preview writes; settings screens at 1440 and 390')
}finally{await browser.close()}
