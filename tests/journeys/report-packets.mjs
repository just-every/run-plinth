import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {nativeSignIn} from '../../scripts/verify/native-signin.mjs'
import {packetFixture} from '../plinth/report-schedule-support.mjs'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&shots&&process.env.PLINTH_STATE&&process.env.PLINTH_PROVIDER_EDGE_URL)
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
try{
 const owner=await browser.newContext({storageState:process.env.PLINTH_STATE,viewport:{width:1440,height:1000}}),page=await owner.newPage()
 const call=async(path,{method='GET',body}={})=>{const r=await owner.request.fetch(base+path,{method,headers:{origin:base},...(body?{data:body}:{})});return {status:r.status(),value:await r.json()}}
 const {c}=await packetFixture({owner:'owner',json:call})
 const contexts=[]
 for(const [email,role] of [['synthetic-plinth-manager@example.com','admin'],['synthetic-plinth-lender@example.com','member'],['synthetic-plinth-client@example.com','member']]){
  const response=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:'Synthetic report recipient',role,returnTo:'/app'}});assert.equal(response.status(),202)
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=await context.newPage();await nativeSignIn(p,email);contexts.push({context,page:p,email})
 }
 const [manager,lender,client]=contexts,person=(await call('/api/plinth/team')).value.team.find(p=>p.email===manager.email)
 assert.equal((await call('/api/plinth/team/'+person.id,{method:'PUT',body:{expected_version:0,role:'project_manager',job_ids:[c.job.id],po_limit_cents:0}})).status,200)
 await page.goto(base+'/app');await page.getByRole('button',{name:'People & access',exact:true}).click();await page.locator('summary',{hasText:'Scheduled report settings'}).click()
 const settings=page.locator('section.card').filter({has:page.locator('summary',{hasText:'Scheduled report settings'})})
 for(const [audience,cadence,recipient] of [['manager','weekly',manager.email],['lender','monthly',lender.email],['client','monthly',client.email]]){
  await settings.getByLabel('Report job',{exact:true}).selectOption(c.job.id);await settings.getByLabel('Report audience',{exact:true}).selectOption(audience);await settings.getByLabel('Repeat',{exact:true}).selectOption(cadence)
  await settings.getByLabel('First report date (UTC)',{exact:true}).fill('2026-10-27');await settings.getByLabel('Report recipient email',{exact:true}).fill(recipient);await settings.getByRole('checkbox').check()
  await settings.getByRole('button',{name:'Schedule report',exact:true}).click();await expect(settings.getByRole('heading',{name:c.job.name+' · '+audience+' · '+cadence,exact:true})).toBeVisible()
 }
 assert.equal((await owner.request.post(process.env.PLINTH_PROVIDER_EDGE_URL+'/mail/refuse-next',{data:{}})).status(),200)
 await settings.getByRole('button',{name:'Generate due reports now',exact:true}).click();await expect(settings.getByText('The provider refused this message; no automatic resend',{exact:true})).toHaveCount(1)
 await expect(settings.getByRole('link',{name:'Download draw packet',exact:true})).toHaveCount(2)
 const schedules=(await call('/api/plinth/report-schedules')).value.schedules,packetSchedule=schedules.find(r=>r.schedule.audience==='lender').schedule
 const downloadPath='/api/plinth/report-schedules/'+packetSchedule.id+'/downloads/'+packetSchedule.deliveries[0].id
 assert.equal((await manager.context.request.get(base+downloadPath)).status(),404)
 for(const who of [manager,lender,client]){
  await who.page.goto(base+'/app');await who.page.locator('summary',{hasText:'Scheduled report downloads'}).click()
  const link=who.page.getByRole('link',{name:who===manager?'Download manager digest':'Download draw packet',exact:true});await expect(link).toHaveCount(1)
  const response=await who.context.request.get(base+await link.getAttribute('href'));assert.equal(response.status(),200);const packet=await response.json();assert.equal(packet.job_id,c.job.id)
  if(who!==manager){assert.equal(packet.sov.lines.length,2);assert.equal(packet.invoices[0].gross_cents,150000);assert.equal(packet.photos.length,1);assert.equal(packet.inspections.length,1);assert.equal(packet.waivers[0].status,'accepted');for(const text of ['synthetic-plinth-private-bid','98765','hour_cents','cost_unit_cents'])assert.ok(!JSON.stringify(packet).includes(text))}
 }
 const capture=async(p,who)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow');if(width===390){const menu=p.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')}await p.screenshot({path:shots+'/RPT-003-'+who+'-'+width+'.png',fullPage:true,animations:'disabled'})}}
 await capture(page,'owner');await capture(manager.page,'manager');await capture(lender.page,'lender');await capture(client.page,'client')
 assert.equal((await call('/api/plinth/report-schedules/'+packetSchedule.id,{method:'DELETE',body:{}})).status,200);assert.equal((await lender.context.request.get(base+downloadPath)).status(),404)
 for(const c of contexts)await c.context.close();await owner.close()
 console.log('RPT-003 PASS: owner weekly and monthly schedules, failed send, manager and external downloads, packet evidence and redaction, revoked download, keyboard tooltips at 1440 and 390')
}finally{await browser.close()}
