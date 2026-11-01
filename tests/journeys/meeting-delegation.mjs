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
 const people=(await get(owner,'/team')).team,ownerEmail=people.find(p=>p.role==='owner').email
 const delegates={}
 for(const [key,role,name] of [['field','admin','Synthetic superintendent'],['client','member','Synthetic action client'],['manager','admin','Synthetic other manager']]){
  const email=['synthetic-plinth-delegation-'+key+'-'+crypto.randomUUID().slice(0,8),'dev.localhost'].join('@')
  assert.equal((await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:name,role,returnTo:'/app'}})).status(),202)
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=await context.newPage();await nativeSignIn(p,email)
  delegates[key]={email,context,page:p,person:(await get(owner,'/team')).team.find(p=>p.email===email),version:0}
 }
 let {job}=await post(owner,'/jobs',{name:'Synthetic delegated site coordination',client_email:delegates.client.email,address:'Synthetic Plinth site'})
 const read=async()=>job=(await get(owner,'/jobs/'+job.id)).job
 const act=async(path,data={})=>{await read();const r=await post(owner,`/jobs/${job.id}`+path,{expected_version:job.version,...data});await read();return r.record}
 const team=async(key,role,ids)=>{const d=delegates[key],r=await post(owner,'/team/'+d.person.id,{expected_version:d.version,role,job_ids:ids,po_limit_cents:0},'put');d.version=r.member.version}
 await team('field','superintendent',[job.id]);await team('manager','project_manager',[job.id])
 await act('/quotes',{lines:[{description:'Synthetic accepted coordination work',quantity:1,unit_cents:1000000}]});await act('/quotes/'+job.quotes[0].id+'/accept',{method:'signed',evidence:'Synthetic owner-reviewed acceptance',schedule_choice:{kind:'none',reason:'Native schedule prepared separately'}})
 const schedule=await act('/schedules',{trade:'Synthetic plumbing',description:'Synthetic field clearance task',start:'2026-11-06T08:00:00Z',end:'2026-11-06T09:00:00Z'})
 const selection=await act('/selections',{room:'Kitchen',category:'Synthetic selection',allowance_cents:10000,cost_code:'06-400',decision_on:'2026-11-06',lead_days:1,options:[{name:'Synthetic oak',supplier:'Synthetic supply',specifications:'Synthetic finish',price_cents:10000}]})
 const mail=async()=>{const r=await owner.request.get(process.env.PLINTH_PROVIDER_EDGE_URL+'/observations');return (await r.json()).mail}
 const initialMail=await mail()
 const open=async(p)=>{await p.goto(base+`/app?job=${job.id}&tab=Meetings`)}
 // Assertions run at 1440; the same changed states are captured at both landing widths.
 const capture=async(p,name)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});await p.waitForTimeout(200);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width);for(const button of await p.locator('.main-col button.icon-button:visible').all()){if(!(await button.innerText()).trim()){assert.ok(await button.getAttribute('data-tip'),'Icon control has a tooltip');await button.hover();await p.waitForTimeout(350);await expect.poll(()=>button.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible');await button.focus();await expect.poll(()=>button.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible')}}await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await p.screenshot({path:`${shots}/DOC-005-delegation-${name}-${width}.png`,fullPage:true})}await p.setViewportSize({width:1440,height:1000})}
 await open(page)
 const record=page.locator('form').filter({has:page.getByRole('button',{name:'Record meeting',exact:true})})
 for(const [label,value] of [['Meeting title','Synthetic private site meeting'],['Meeting date','2026-10-26'],['Attendees, separated by commas','Builder, Superintendent, Client'],['Agenda','Review field clearance'],['Minutes','Synthetic private office minutes'],['Decisions','Synthetic private office decision'],['Tags, separated by commas','coordination'],['Sheet','A1'],['Cost code','06-400'],['Assigned action','Confirm field clearance'],['Action owner email',delegates.field.email],['Due date','2026-11-06']])await record.getByLabel(label,{exact:true}).fill(value)
 await record.locator('select[name=owner_kind]').selectOption('office');await record.getByRole('checkbox').check();await capture(page,'assignment-confirmation');await record.getByRole('button',{name:'Record meeting',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Synthetic private site meeting',exact:true})).toBeVisible()
 let meetings=(await get(owner,`/jobs/${job.id}/meetings`)).meetings,meeting=meetings.find(m=>m.title==='Synthetic private site meeting'),field=meeting.actions[0]
 await page.getByText('Assign another action',{exact:true}).click();const add=page.locator('details').filter({has:page.getByRole('button',{name:'Assign action',exact:true})})
 await add.getByLabel('Action',{exact:true}).fill('Confirm client fixture');await add.getByLabel('Action owner email',{exact:true}).fill(delegates.client.email);await add.getByLabel('Due date',{exact:true}).fill('2026-11-06');await add.locator('select[name=owner_kind]').selectOption('client');await add.getByRole('checkbox').check();await add.getByRole('button',{name:'Assign action',exact:true}).click()
 await expect(page.getByText('Confirm client fixture',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Synthetic private office minutes',{exact:false})).toBeVisible()
 meeting=(await get(owner,`/jobs/${job.id}/meetings`)).meetings.find(m=>m.id===meeting.id);const clientAction=meeting.actions.find(a=>a.title==='Confirm client fixture')
 for(const [key,title,other] of [['field',field.title,clientAction.title],['client',clientAction.title,field.title]]){
  const d=delegates[key];await open(d.page);await expect(d.page.getByRole('heading',{name:'My meeting actions',exact:true})).toBeVisible();await expect(d.page.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(d.page.getByText(other,{exact:true})).toHaveCount(0)
  for(const hidden of ['Synthetic private office minutes','Synthetic private office decision','Synthetic private site meeting'])await expect(d.page.getByText(hidden,{exact:false})).toHaveCount(0)
  const own=await get(d.context,'/meeting-inbox/'+job.id);assert.equal(own.actions.length,1);assert.equal(own.actions[0].title,title)
  assert.equal((await d.context.request.get(base+`/api/plinth/jobs/${job.id}/meetings`)).status(),403)
  const search=await d.context.request.get(base+`/api/plinth/jobs/${job.id}/decision-search?`+new URLSearchParams({source:'meetings:'+meeting.id}));assert.ok(search.status()===403||search.status()===200&&(await search.json()).count===0)
 }
 await capture(delegates.field.page,'own-action')
 await read();const beforeRefusal=structuredClone(job)
 const refuse=async(ctx,action)=>{const r=await ctx.request.post(base+`/api/plinth/meeting-inbox/${job.id}/actions/${action.id}/complete`,{headers:{origin:base},data:{expected_version:job.version,answer:'Synthetic refused answer',links:[]}});assert.equal(r.status(),404)}
 await refuse(delegates.manager.context,field);await refuse(delegates.field.context,clientAction);assert.deepEqual(await read(),beforeRefusal)
 await delegates.field.page.getByLabel('Resolved answer',{exact:true}).fill('Field clearance checked against the task');await delegates.field.page.locator('select[name=work]').selectOption('schedule:'+schedule.id);await delegates.field.page.getByRole('button',{name:'Complete my action',exact:true}).click();await expect(delegates.field.page.getByText('Completed',{exact:true})).toBeVisible()
 await delegates.client.page.reload();await delegates.client.page.getByLabel('Resolved answer',{exact:true}).fill('Client fixture confirmed');await delegates.client.page.getByRole('button',{name:'Complete my action',exact:true}).click();await expect(delegates.client.page.getByText('Completed',{exact:true})).toBeVisible()
 await open(page);await expect(page.getByText('Client fixture confirmed',{exact:true})).toBeVisible();await expect(page.getByText('Completed by Synthetic superintendent',{exact:true})).toBeVisible();await expect(page.getByText('Completed by Synthetic action client',{exact:true})).toBeVisible()
 const row=page.locator('li.row').filter({has:page.getByText(clientAction.title,{exact:true})}).last();await row.getByText('Append work links',{exact:true}).click();await row.locator('select[name=append_work]').selectOption('selection:'+selection.id);await row.getByRole('button',{name:'Append work link',exact:true}).click();await expect(row.getByRole('link',{name:'Appended selection work source',exact:true})).toBeVisible();await capture(page,'appended-link')
 const outstanding=await act(`/meetings/${meeting.id}/add-action`,{title:'Outstanding field follow-up',owner_kind:'office',owner_email:delegates.field.email,confirm_title:true,due_on:'2026-11-07'})
 await team('field','superintendent',[]);await read();await refuse(delegates.field.context,outstanding)
 await open(page);const orphan=page.locator('li.row').filter({has:page.getByText(outstanding.title,{exact:true})}).last();await expect(orphan.getByText('Open',{exact:true})).toBeVisible();await capture(page,'revoked-outstanding')
 await orphan.getByText('Reassign outstanding action',{exact:true}).click();await orphan.getByLabel('New action owner email',{exact:true}).fill(ownerEmail);await orphan.getByLabel('Reassignment reason',{exact:true}).fill('The field assignment ended; the builder takes this action');await orphan.getByRole('button',{name:'Confirm action reassignment',exact:true}).click();await expect(orphan.getByText('Reassigned from '+delegates.field.email,{exact:false})).toBeVisible()
 await team('field','superintendent',[job.id]);await read();await refuse(delegates.field.context,outstanding)
 const final=job.meetings.find(m=>m.id===meeting.id),history=final.actions.find(a=>a.id===outstanding.id).assignment_history[0];assert.equal(history.previous_owner_kind,'office');assert.equal(history.owner_kind,'manager');assert.equal(history.reason,'The field assignment ended; the builder takes this action');assert.ok(history.by.at)
 assert.equal(final.actions.find(a=>a.id===field.id).completion.links[0].id,schedule.id);assert.equal(final.actions.find(a=>a.id===clientAction.id).appended_links[0].by.name,'Synthetic Plinth builder');assert.equal(await mail(),initialMail,'No meeting operation sends provider mail')
 await delegates.client.page.goto(base+'/app?view=meetings');await expect(delegates.client.page.getByRole('heading',{name:'Confirm client fixture',exact:true})).toBeVisible()
 console.log('DOC-005 delegation PASS: native assignment confirmation, isolated own actions, attributed completion and appended links, wrong-owner refusal, current revocation, cross-kind reassignment and no provider messages; assertions at 1440, landing screens at 1440 and 390')
} catch(error) { for(const [index,context] of browser.contexts().entries())for(const p of context.pages())if(p.url().startsWith(base+'/app')){await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await p.screenshot({path:`${shots}/DOC-005-delegation-failure-${index}.png`,fullPage:true});await writeFile(`${shots}/DOC-005-delegation-failure-${index}.txt`,await p.locator('body').innerText());break}throw error } finally {await browser.close()}
