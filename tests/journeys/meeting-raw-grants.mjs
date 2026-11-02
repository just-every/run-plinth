import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {nativeSignIn} from '../../scripts/verify/native-signin.mjs'

const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&shots&&process.env.PLINTH_STATE)
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
await mkdir(shots,{recursive:true})
try {
 const owner=await browser.newContext({storageState:process.env.PLINTH_STATE,viewport:{width:1440,height:1000}}),page=await owner.newPage()
 const get=async(ctx,path)=>{const r=await ctx.request.get(base+'/api/plinth'+path);assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 const post=async(ctx,path,data,method='post')=>{const r=await ctx.request[method](base+'/api/plinth'+path,{headers:{origin:base},data});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 const people={}
 for(const [key,role,name] of [['field','admin','Jordan site superintendent'],['office','admin','Morgan office bookkeeper'],['client','member','Taylor kitchen client'],['custom','admin','Copied project manager']]){
  const email=['synthetic-plinth-raw-'+key+'-'+crypto.randomUUID().slice(0,8),'dev.localhost'].join('@')
  assert.equal((await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:name,role,returnTo:'/app'}})).status(),202)
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=await context.newPage();await nativeSignIn(p,email)
  people[key]={email,context,page:p,person:(await get(owner,'/team')).team.find(p=>p.email===email),version:0}
 }
 let {job}=await post(owner,'/jobs',{name:'Alder kitchen coordination',client_email:people.client.email,address:'148 Alder Street, Portland'})
 const read=async()=>job=(await get(owner,'/jobs/'+job.id)).job
 const act=async(path,data={})=>{await read();const r=await post(owner,`/jobs/${job.id}`+path,{expected_version:job.version,...data});await read();return r.record}
 const team=async(key,role,ids,role_id)=>{const d=people[key],r=await post(owner,'/team/'+d.person.id,{expected_version:d.version,role,job_ids:ids,po_limit_cents:0,...(role_id?{role_id}:{})},'put');d.version=r.member.version}
 await team('field','superintendent',[job.id]);await team('office','bookkeeper',[job.id])
 const copied=await post(owner,'/roles',{copy_of:'project_manager',name:'Copied meeting observer'});await team('custom','custom',[job.id],copied.role.id)
 const ownerEmail=(await get(owner,'/team')).team.find(p=>p.role==='owner').email
 await act('/quotes',{lines:[{description:'Kitchen cabinetry and appliance coordination',quantity:1,unit_cents:1480000}]});await act('/quotes/'+job.quotes[0].id+'/accept',{method:'signed',evidence:'Client returned the signed kitchen scope',schedule_choice:{kind:'none',reason:'Coordinate the site task separately'}})
 const task=await act('/schedules',{trade:'Cabinetry',description:'Install reviewed cabinet layout',start:'2026-11-06T08:00:00Z',end:'2026-11-06T10:00:00Z'})
 const meeting=await act('/meetings',{title:'Kitchen clearance review',held_on:'2026-11-02',agenda:'Review appliance and cabinet clearances',minutes:'Allow 42 inches at the island. Confirm the revised refrigerator opening before cabinetry.',decisions:'Use the reviewed island layout and retain the appliance clearance.',attendees:['Builder','Jordan','Morgan'],tags:['kitchen'],sheet:'A-201',cost_code:'06-400',actions:[{title:'Check refrigerator opening on site',owner_email:ownerEmail,due_on:'2026-11-05'}]})
 await act(`/meetings/${meeting.id}/complete`,{action_id:meeting.actions[0].id,answer:'The refrigerator opening matches the reviewed layout.',links:[{kind:'schedule',id:task.id}]})
 const hidden=await act('/meetings',{title:'Private supplier negotiation',held_on:'2026-11-02',agenda:'Office review',minutes:'Separate supplier economics stay private',decisions:'Office only',attendees:['Builder'],actions:[],tags:[],sheet:'',cost_code:''})
 const open=async(p)=>p.goto(base+`/app?job=${job.id}&tab=Meetings`)
 const capture=async(p,name)=>{for(const width of [1440,390]){
  await p.setViewportSize({width,height:1000});await p.waitForTimeout(200)
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
  assert.deepEqual(await p.locator('.main-col').evaluate(el=>[...el.querySelectorAll('h2,h3,h4,p,label,button,a,li,summary')].filter(n=>n.getClientRects().length&&parseFloat(getComputedStyle(n).fontSize)<13).map(n=>n.tagName)),[],'Meeting text is at least 13px')
  for(const control of await p.locator('.main-col button.icon-button:visible').all())if(!(await control.innerText()).trim()){
   assert.ok(await control.getAttribute('data-tip'),'Icon control has a tooltip');await control.hover();await p.waitForTimeout(350);await expect.poll(()=>control.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible');await control.focus();await expect.poll(()=>control.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible')
  }
  await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.screenshot({path:`${shots}/DOC-010-raw-${name}-${width}.png`,fullPage:true})
 }await p.setViewportSize({width:1440,height:1000})}
 const mail=async()=>Number((await(await owner.request.get(process.env.PLINTH_PROVIDER_EDGE_URL+'/observations')).json()).mail)
 const before=await mail()
 await open(page)
 const row=page.locator('li.row').filter({has:page.getByRole('heading',{name:meeting.title,exact:true})}).first()
 await row.getByText('Raw meeting access',{exact:true}).click()
 const grant=row.locator('form').filter({has:page.getByRole('button',{name:'Grant raw meeting access',exact:true})})
 await grant.getByLabel('Named internal recipient email',{exact:true}).fill(people.field.email);await grant.getByLabel('Raw meeting sharing reason',{exact:true}).fill('Jordan needs the exact clearance decisions for site work');await grant.getByRole('checkbox').check();await capture(page,'review-grant');await grant.getByRole('button',{name:'Grant raw meeting access',exact:true}).click()
 await expect(row.getByText('Jordan needs the exact clearance decisions for site work',{exact:true})).toBeVisible()
 await act(`/meetings/${meeting.id}/raw-grant`,{email:people.office.email,reason:'Morgan coordinates this assigned job',confirm:true,operation_id:crypto.randomUUID()})
 for(const key of ['field','office']){
  const d=people[key];await open(d.page);await expect(d.page.getByRole('heading',{name:meeting.title,exact:true})).toBeVisible();await expect(d.page.getByText(meeting.minutes,{exact:false})).toBeVisible();await expect(d.page.getByText(meeting.decisions,{exact:false})).toBeVisible();await expect(d.page.getByText(meeting.actions[0].title,{exact:false})).toBeVisible();await expect(d.page.getByText('The refrigerator opening matches the reviewed layout.',{exact:true})).toBeVisible();await expect(d.page.getByRole('heading',{name:hidden.title,exact:true})).toHaveCount(0)
  await d.page.getByLabel('Shared meeting search',{exact:true}).fill('42 inches');await d.page.getByRole('button',{name:'Search shared meetings',exact:true}).click();await expect(d.page.getByText('1 shared meeting matches',{exact:true})).toBeVisible()
  const exported=await get(d.context,`/jobs/${job.id}/meetings/${meeting.id}/export.json`);assert.equal(exported.minutes,meeting.minutes);assert.equal(exported.raw_grants,undefined);assert.deepEqual(exported.actions[0].completion.links,[])
  assert.equal((await d.context.request.get(base+`/api/plinth/jobs/${job.id}/meetings/${hidden.id}`)).status(),404)
  assert.equal((await d.context.request.get(base+`/api/plinth/jobs/${job.id}/meetings/${meeting.id}/links/${meeting.actions[0].id}/0`)).status(),403)
  await capture(d.page,key+'-read')
 }
 for(const key of ['client','custom']){
  await open(people[key].page);await expect(people[key].page.getByRole('heading',{name:meeting.title,exact:true})).toHaveCount(0)
  assert.equal((await people[key].context.request.get(base+`/api/plinth/jobs/${job.id}/meetings/${meeting.id}/export.json`)).status(),403)
 }
 const other=(await post(owner,'/jobs',{name:'Separate site coordination',client_email:people.client.email,address:'Other site'})).job
 assert.equal((await people.field.context.request.get(base+`/api/plinth/jobs/${other.id}/meetings/${meeting.id}/export.json`)).status(),404)
 await page.reload();await row.getByText('Raw meeting access',{exact:true}).click()
 const revoke=row.locator('section.side-section').filter({has:page.getByRole('heading',{name:people.field.email,exact:true})})
 await revoke.getByLabel('Raw access revocation reason',{exact:true}).fill('Site review is complete');await revoke.getByRole('checkbox').check();await revoke.getByRole('button',{name:'Revoke raw access',exact:true}).click();await expect(row.getByText('Revoked by Synthetic Plinth builder',{exact:false})).toBeVisible();await capture(page,'revoked-history')
 await open(people.field.page);await expect(people.field.page.getByText('No current raw meeting grants.',{exact:true})).toBeVisible();await expect(people.field.page.getByRole('heading',{name:meeting.title,exact:true})).toHaveCount(0);assert.equal((await people.field.context.request.get(base+`/api/plinth/jobs/${job.id}/meetings/${meeting.id}/export.json`)).status(),403);assert.equal((await people.field.context.request.get(base+`/api/plinth/jobs/${job.id}/decision-search?source=meetings:${meeting.id}`)).status(),403);assert.equal((await get(people.field.context,'/meeting-inbox')).jobs.flatMap(j=>j.raw_meetings).length,0);await capture(people.field.page,'revoked-reader')
 await team('office','bookkeeper',[]);await people.office.page.goto(base+'/app?view=meetings');await expect(people.office.page.getByRole('heading',{name:meeting.title,exact:true})).toHaveCount(0);assert.equal((await people.office.context.request.get(base+`/api/plinth/jobs/${job.id}/meetings/${meeting.id}/export.json`)).status(),404);await capture(people.office.page,'lost-assignment')
 await team('office','bookkeeper',[job.id]);await open(people.office.page);await expect(people.office.page.getByText('No current raw meeting grants.',{exact:true})).toBeVisible()
 assert.equal(await mail(),before,'Raw grants and reads never send mail')
 console.log('DOC-010 raw grants PASS: named field and office page, direct API, search, counts and private export; linked snapshots excluded; client, copied role, cross-job, revoked and lost-assignment reads refused; 1440 and 390. Native archive recovery is covered by the portable CLI journey.')
} catch(error){for(const [i,ctx] of browser.contexts().entries())for(const p of ctx.pages())if(p.url().startsWith(base+'/app')){await p.screenshot({path:`${shots}/DOC-010-raw-failure-${i}.png`,fullPage:true});await writeFile(`${shots}/DOC-010-raw-failure-${i}.txt`,await p.locator('body').innerText());break}throw error} finally {await browser.close()}
