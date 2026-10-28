import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {nativeSignIn} from '../../scripts/verify/native-signin.mjs'
import {surveyJob,surveyAddress,surveySettings} from '../plinth/satisfaction-support.mjs'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&shots&&process.env.PLINTH_STATE&&process.env.PLINTH_CLIENT_STATE&&process.env.PLINTH_PROVIDER_EDGE_URL)
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
try{
 const owner=await browser.newContext({storageState:process.env.PLINTH_STATE,viewport:{width:1440,height:1000}}),first=await browser.newContext({storageState:process.env.PLINTH_CLIENT_STATE,viewport:{width:1440,height:1000}}),second=await browser.newContext({viewport:{width:1440,height:1000}}),page=await owner.newPage(),high=await first.newPage(),low=await second.newPage()
 const contexts={owner,first,second},fixture={owner:'owner',json:async(path,{method='GET',body,cookie='owner'}={})=>{const r=await contexts[cookie].request.fetch(base+path,{method,headers:{origin:base},...(body===undefined?{}:{data:body})});return {status:r.status(),value:await r.json()}}}
 const invite=async(email,name,role)=>{const r=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:name,role,returnTo:'/app'}});assert.equal(r.status(),202)}
 await invite(surveyAddress(431),'Synthetic second client','member');await nativeSignIn(low,surveyAddress(431))
 const a=await surveyJob(fixture,'Synthetic kitchen closeout','client'+String.fromCharCode(64)+'dev.localhost','first'),b=await surveyJob(fixture,'Synthetic bath closeout',surveyAddress(431),'second')
 await invite(surveyAddress(432),'Synthetic project manager','admin');await invite(surveyAddress(433),'Synthetic crew','admin')
 for(const address of [surveyAddress(432),surveyAddress(433)]){const context=await browser.newContext(),p=await context.newPage();await nativeSignIn(p,address);await context.close()}
 const team=(await fixture.json('/api/plinth/team')).value.team,manager=team.find(p=>p.email===surveyAddress(432)),crew=team.find(p=>p.email===surveyAddress(433))
 for(const [person,role] of [[manager,'project_manager'],[crew,'crew']])assert.equal((await fixture.json('/api/plinth/team/'+person.id,{method:'PUT',body:{expected_version:0,role,job_ids:[a.job.id,b.job.id],po_limit_cents:0}})).status,200)
 for(const [j,n,trade] of [[a,434,'Plumbing'],[b,435,'Electrical']]){
  const v=await j.call('/vendors',{kind:'subcontractor',name:'Synthetic '+trade+' company',trades:[trade],contacts:[{id:'synthetic-plinth-contact',name:'Synthetic trade contact',email:surveyAddress(n)}]});assert.equal(v.status,201)
  assert.equal((await j.call('/vendors/'+v.value.vendor.id+'/qualifications',{expected_version:v.value.vendor.version,trade,status:'qualified',evidence:'Synthetic reviewed trade qualification'})).status,200)
  const scope=await j.ok('/subcontracts',{vendor_id:v.value.vendor.id,trade,scope:'Synthetic completed '+trade+' work',contact_ids:['synthetic-plinth-contact'],awarded_on:'2026-10-21'})
  await j.ok('/subcontracts/'+scope.id+'/release')
 }
 const section=p=>p.getByRole('region',{name:'Client satisfaction',exact:true})
 const capture=async(p,name)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Screen fits at '+width);if(width===390){const menu=p.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')}await p.screenshot({path:shots+'/CARE-004-'+name+'-'+width+'.png',fullPage:true,animations:'disabled'})}}
 for(const [j,p,who] of [[a,high,'first'],[b,low,'second']]){
  await p.goto(base+`/app?job=${j.job.id}&tab=Handover`);const s=section(p)
  await s.locator('summary',{hasText:'Survey settings'}).click();await s.getByRole('checkbox').check();await s.getByRole('button',{name:'Save survey email preference',exact:true}).click();await expect(s.getByRole('status')).toHaveText('Saved.')
  await page.goto(base+`/app?job=${j.job.id}&tab=Handover`);const os=section(page)
  await os.locator('summary',{hasText:'Survey settings'}).click();await os.getByLabel('Survey title',{exact:true}).fill(surveySettings.title);await os.getByLabel('Google Business Profile or Houzz review link',{exact:true}).fill(surveySettings.review_url);await os.getByRole('button',{name:'Save survey settings',exact:true}).click()
  await os.locator('summary',{hasText:'Send a satisfaction survey'}).click();await os.getByLabel('Completed handover or warranty visit',{exact:true}).selectOption('handover:'+j.source.source_id);await os.getByLabel('Consenting client',{exact:true}).selectOption(who==='first'?'client'+String.fromCharCode(64)+'dev.localhost':surveyAddress(431));await os.getByLabel('Low-score follow-up owner',{exact:true}).selectOption(manager.id);await os.getByRole('checkbox').check();if(who==='first'){await capture(page,'owner-new-survey');await page.setViewportSize({width:1440,height:1000})}await os.getByRole('button',{name:'Send survey',exact:true}).click()
  await expect(os.getByText('Accepted by the mail provider; delivery is not confirmed',{exact:true})).toBeVisible()
  await p.reload();if(who==='first'){await capture(p,'client-response-form');await p.setViewportSize({width:1440,height:1000})}await section(p).getByLabel('Satisfaction score (1 to 10)',{exact:true}).fill(who==='first'?'9':'3');await section(p).getByLabel('How was communication?',{exact:true}).fill(who==='first'?'Clear updates':'Updates arrived late');await section(p).getByLabel('How was the workmanship?',{exact:true}).fill(who==='first'?'Excellent finish':'Trim needs attention');await section(p).getByLabel('Survey comment',{exact:true}).fill(who==='first'?'Synthetic positive feedback':'Synthetic unresolved trim defect');await section(p).getByRole('button',{name:'Submit satisfaction response',exact:true}).click();await expect(section(p).getByText('Score: '+(who==='first'?9:3)+' of 10',{exact:true})).toBeVisible()
 }
 await low.reload();await expect(section(low).getByRole('link',{name:"Builder's public review site",exact:true})).toHaveAttribute('href',surveySettings.review_url)
 const permission=section(high).locator('form').filter({has:high.getByRole('button',{name:'Save public review permission',exact:true})});await permission.getByRole('checkbox').check();await permission.getByRole('button',{name:'Save public review permission',exact:true}).click();await expect(permission.getByRole('status')).toHaveText('Saved.')
 const sa=(await a.survey()).surveys[0],sb=(await b.survey()).surveys[0]
 assert.equal(sa.response.score,9);assert.equal(sb.response.score,3);assert.equal(sb.response.comment,'Synthetic unresolved trim defect');assert.equal(sb.follow_up.assignee_id,manager.id)
 await page.reload();await expect(section(page).getByText('Assigned follow-up:',{exact:false})).toContainText('Synthetic project manager')
 await section(page).getByRole('button',{name:'Send permitted review invitation',exact:true}).click();await expect(section(page).getByRole('alert')).toHaveText('This client has not permitted a review request')
 await page.goto(base+`/app?job=${a.job.id}&tab=Handover`);await section(page).getByRole('button',{name:'Send permitted review invitation',exact:true}).click();await expect.poll(async()=>(await a.survey()).surveys[0].review_request?.status).toBe('accepted')
 const latest=await owner.request.get(process.env.PLINTH_PROVIDER_EDGE_URL+'/mail/latest?email='+encodeURIComponent('client'+String.fromCharCode(64)+'dev.localhost'));const message=(await latest.json()).message;assert.ok(message.subject.startsWith('Public review invitation:'));assert.ok(message.text.includes(surveySettings.review_url))
 await page.goto(base+'/app');await page.locator('summary',{hasText:'Satisfaction by manager and trade'}).click();await expect(page.getByText('Synthetic project manager: 6.0 of 10 · 2 responses · 1 low scores',{exact:true})).toBeVisible();await expect(page.getByText('Synthetic Plumbing company · Plumbing: 9.0 of 10 · 1 responses · 0 low scores',{exact:true})).toBeVisible();await expect(page.getByText('Synthetic Electrical company · Electrical: 3.0 of 10 · 1 responses · 1 low scores',{exact:true})).toBeVisible()
 // Assertions run at 1440; the release proof records the same changed screens at both release widths.

 await capture(page,'report');await capture(high,'high-response-permission');await capture(low,'low-response-no-permission')
 await page.goto(base+`/app?job=${b.job.id}&tab=Handover`);await section(page).locator('summary',{hasText:'Survey settings'}).click();await capture(page,'owner-low-follow-up-settings')
 await owner.close();await first.close();await second.close()
 console.log('CARE-004 PASS: two closeouts, email consent, configurable surveys, high and low response, assigned follow-up, manager and trade report, separate review permission, changed screens at 1440 and 390')
}finally{await browser.close()}
