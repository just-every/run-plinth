import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { nativeSignIn } from '../../scripts/verify/native-signin.mjs'
import { timelineFixture, proveTimeline, timelinePhoto } from '../plinth/client-timeline-support.mjs'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&shots&&process.env.PLINTH_STATE&&process.env.PLINTH_PROVIDER_EDGE_URL,'Use the disposable installed application')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:process.env.PLINTH_STATE}),contexts=new Map([['owner',owner]])
 const page=await owner.newPage()
 const json=async(path,{method='GET',cookie='owner',token,body}={})=>{
  const context=contexts.get(cookie)??owner
  const r=await context.request.fetch(base+path,{method,headers:{origin:base,...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{data:body})})
  return {status:r.status(),value:await r.json()}
 }
 const invite=async(email,displayName,role='member')=>{
  const r=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName,role,returnTo:'/app'}});assert.equal(r.status(),202)
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=await context.newPage();await nativeSignIn(p,email);await p.close();contexts.set(email,context);return email
 }
 const agent=async()=>{
  const r=await owner.request.post(base+'/auth/step-up',{headers:{origin:base},data:{action:'credentials:mint',returnTo:'/app'}});assert.equal(r.status(),202)
  await nativeSignIn(page,['builder','example.com'].join(String.fromCharCode(64)))
  const mint=await owner.request.post(base+'/api/plinth/agent-credentials',{headers:{origin:base},data:{expires_in_seconds:3600}});assert.equal(mint.status(),201)
  return (await mint.json()).credential.token
 }
 const fieldPerson=async(jobId)=>{
  const email=['synthetic-plinth-foreman','example.invalid'].join(String.fromCharCode(64))
  await invite(email,'Timeline foreman','admin')
  const people=await json('/api/plinth/team'),id=people.value.team.find(person=>person.email===email).id
  const assigned=await json('/api/plinth/team/'+id,{method:'PUT',body:{expected_version:0,role:'superintendent',job_ids:[jobId],po_limit_cents:0}});assert.equal(assigned.status,200)
  return email
 }
 const c=await timelineFixture({json,invite,agent,fieldPerson,agentDeniedStatus:401,owner:'owner'})
 const {all}=await proveTimeline(c)
 const cp=await contexts.get(c.first).newPage(),jp=await contexts.get(c.second).newPage()
 const region=cp.getByRole('region',{name:'Client timeline',exact:true})
 const activity=async()=>{const r=await owner.request.get(process.env.PLINTH_PROVIDER_EDGE_URL+'/activity');assert.equal(r.status(),200);return r.json()}
 const beforeCalls=await activity(),before=await c.read()
 await cp.goto(base+'/app?job='+c.job().id)
 await expect(region.getByRole('heading',{name:'Job timeline',exact:true})).toBeVisible()
 await expect(region.getByRole('status')).toHaveText('21 records found')
 await expect(region.getByRole('heading',{name:'Alex oak discussion',exact:true})).toBeVisible()
 await expect(region.getByText('Jordan oak discussion',{exact:false})).toHaveCount(0)
 await expect(region.getByText('Private bid margin sentinel',{exact:false})).toHaveCount(0)
 await region.getByRole('button',{name:'Next records',exact:true}).click()
 await expect(region.getByRole('heading',{name:'Daily log · 2026-10-01',exact:true})).toBeVisible()
 const original=await region.getByRole('link',{name:'synthetic-plinth-photo.png',exact:true}).getAttribute('href')
 const download=await contexts.get(c.first).request.get(base+original);assert.equal(download.status(),200);assert.deepEqual(await download.body(),timelinePhoto)
 await region.getByLabel('Search timeline',{exact:true}).fill('oak')
 await region.getByRole('button',{name:'Search timeline',exact:true}).click()
 await expect(region.getByRole('status')).toHaveText('20 records found')
 await region.getByRole('link',{name:'Published oak installation',exact:true}).click()
 await expect(region.getByRole('status')).toHaveText('1 record found')
 await expect(region.locator('time')).toHaveText('2026-11-02T09:00:00.000Z')
 await cp.reload();await expect(region.getByRole('heading',{name:'Published oak installation',exact:true})).toBeVisible()
 await region.getByRole('button',{name:'Show all records',exact:true}).click()
 await region.getByLabel('Search timeline',{exact:true}).fill('Private bid margin sentinel')
 await region.getByRole('button',{name:'Search timeline',exact:true}).click()
 await expect(region.getByRole('status')).toHaveText('0 records found')
 await region.getByRole('button',{name:'Show all records',exact:true}).click()
 await expect(region.getByRole('status')).toHaveText('21 records found')
 await jp.goto(base+'/app?job='+c.job().id+'&tab=Timeline')
 const jordan=jp.getByRole('region',{name:'Client timeline',exact:true})
 await expect(jordan.getByRole('heading',{name:'Jordan oak discussion',exact:true})).toBeVisible()
 await expect(jordan.getByRole('heading',{name:'Alex oak discussion',exact:true})).toHaveCount(0)
 await expect(jordan.getByRole('status')).toHaveText('22 records found')
 const invoice=all.find(i=>i.kind==='invoice')
 const invoiceOriginal=await contexts.get(c.first).request.get(base+invoice.files[0].href);assert.equal(invoiceOriginal.status(),200);assert.match(await invoiceOriginal.text(),/Oak construction deposit/)
 assert.deepEqual(await activity(),beforeCalls,'Timeline browsing and original downloads cause no delivery or payment call')
 assert.deepEqual(await c.read(),before,'Timeline UI has no financial or job effect')
 // Assertions run at the desktop width. The same populated changed screens are
 // inspected once at the phone width as release proof.
 for(const width of [1440,390]){
  for(const [p,name] of [[cp,'alex'],[jp,'jordan']]){
   await p.setViewportSize({width,height:1000})
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Timeline fits '+width)
   if(width===390){const menu=p.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')}
   const small=await p.locator('.timeline-records').evaluate(el=>[el,...el.querySelectorAll('*')].filter(e=>e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<13).length);assert.equal(small,0,'Timeline text is at least 13 pixels')
   await p.screenshot({path:shots+'/CLIENT-001-'+name+'-'+width+'.png',fullPage:true,animations:'disabled'})
  }
 }
 await cp.setViewportSize({width:1440,height:1000})
 await c.restrict(['schedule','photos','changes','selections','billing'])
 await region.getByRole('button',{name:'Search timeline',exact:true}).click()
 await expect(region.getByRole('status')).toHaveText('1 record found')
 await expect(region.getByRole('heading',{name:'Published oak installation',exact:true})).toHaveCount(0)
 assert.equal((await contexts.get(c.second).request.get(base+original)).status(),404)
 await c.restrict([]);await c.revoke()
 await jordan.getByRole('button',{name:'Search timeline',exact:true}).click()
 await expect(jordan.getByRole('alert')).toContainText('Job not found')
 await expect(jordan.getByRole('heading',{name:'Jordan oak discussion',exact:true})).toHaveCount(0)
 await jp.reload();await expect(jp.getByRole('heading',{name:c.job().name,exact:true})).toHaveCount(0)
 assert.equal((await contexts.get(c.second).request.get(base+original)).status(),404)
 console.log('CLIENT-001 PASS: installed recipient-specific read-only timeline, source dates and links, search and pagination, private and cross-job exclusion, disabled features, original downloads and current contact revocation; screens at 1440 and 390')
}finally{await browser.close()}
