import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {parseContract} from '../../src/base/seed-contract.mjs'
import {takeoffPlan} from '../fixtures/takeoff-plan.mjs'
import {chromium,expect} from '@playwright/test'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&shots&&process.env.PLINTH_OWNER_OPEN,'Use the disposable installation and its own private native entrance')
const ownerOpen=new URL(process.env.PLINTH_OWNER_OPEN),fragment=new URLSearchParams(ownerOpen.hash.slice(1))
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)&&ownerOpen.origin===base&&fragment.has('rer-dev'))
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
await mkdir(shots,{recursive:true})
try{
 const names=[['estimator','Erin Estimator'],['superintendent','Sam Superintendent'],['crew','Casey Crew']],stamp=Date.now()
 const contexts=await Promise.all(Array.from({length:4},()=>browser.newContext())),pages=await Promise.all(contexts.map(c=>c.newPage())),[owner]=contexts,[page,...people]=pages
 await page.goto(ownerOpen.href);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 const emails=names.map(([key])=>`synthetic-plinth-${key}-${stamp}@dev.localhost`)
 for(const [n,[key,name]] of names.entries()){
  const r=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email:emails[n],displayName:name,role:'admin',returnTo:'/app'}});assert.equal(r.status(),202)
  const url=new URL(ownerOpen),hash=new URLSearchParams(fragment);hash.set('as',emails[n]);hash.set('next',`/auth/dev/enter?as=${encodeURIComponent(emails[n])}&returnTo=/app`);url.hash=hash.toString()
  await people[n].goto(url.href);await people[n].waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 }
 const post=async(path,data,method='post')=>{const r=await owner.request[method](base+'/api/plinth'+path,{headers:{origin:base},data});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 const read=async id=>(await (await owner.request.get(base+'/api/plinth/jobs/'+id)).json()).job
 let lead=(await post('/jobs',{name:'Shelburne kitchen lead',client_email:`synthetic-plinth-lead-${stamp}@dev.localhost`,address:'9 Lake Road, Shelburne, VT 05482'})).job
 let site=(await post('/jobs',{name:'Charlotte addition',client_email:`synthetic-plinth-site-${stamp}@dev.localhost`,address:'12 Orchard Lane, Charlotte, VT 05445'})).job
 const other=(await post('/jobs',{name:'Hinesburg garage',client_email:`synthetic-plinth-other-${stamp}@dev.localhost`,address:'4 Mill Road, Hinesburg, VT 05461'})).job
 const act=async(job,path,body={})=>{const r=await post(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});return [await read(job.id),r.record]}
 ;[lead]=await act(lead,'/quotes',{lines:[{description:'Kitchen remodel proposal',quantity:1,unit_cents:4800000}]})
 ;[site]=await act(site,'/quotes',{lines:[{description:'Addition agreed scope',quantity:1,unit_cents:9600000}]});[site]=await act(site,`/quotes/${site.quotes[0].id}/accept`,{method:'email',evidence:'Synthetic client accepted exact proposal',schedule_choice:{kind:'none',reason:'Schedule set below'}})
 ;[site]=await act(site,'/takeoff',{name:'S1 Addition framing',page:1,width:400,height:400,document:{name:'synthetic-plinth-plan.pdf',mime:'application/pdf',base64:takeoffPlan().toString('base64')}})
 ;[site]=await act(site,'/schedules',{trade:'Framing',description:'Frame addition walls',start:new Date(Date.now()+86_400_000).toISOString().slice(0,10)+'T08:00:00Z',end:new Date(Date.now()+86_400_000).toISOString().slice(0,10)+'T16:00:00Z'})
 const team=(await (await owner.request.get(base+'/api/plinth/team')).json()).team,id=n=>team.find(m=>m.email===emails[n]).id
 await post(`/team/${id(0)}`,{expected_version:0,role:'estimator',job_ids:[lead.id],po_limit_cents:0},'put')
 await post(`/team/${id(1)}`,{expected_version:0,role:'superintendent',job_ids:[site.id],po_limit_cents:0},'put')
 await post(`/team/${id(2)}`,{expected_version:0,role:'crew',job_ids:[site.id],po_limit_cents:0},'put')
 await post(`/jobs/${site.id}/todos`,{expected_version:site.version,title:'Wall layout walk',due_at:'2026-12-05T17:00',items:[{title:'Check stud layout',assignee:{kind:'office',email:emails[1]}},{title:'Stack lumber by wall',assignee:{kind:'office',email:emails[2]}}]});site=await read(site.id)
 const capture=async(p,name,check)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});if(check)await check();await p.evaluate(()=>scrollTo(0,0));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width);await p.screenshot({path:`${shots}/ROLE-002-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 const tabs=async(p,labels)=>{const nav=p.getByRole('navigation',{name:'Job sections'});await expect(nav.getByRole('button')).toHaveText(labels)}
 await page.goto(base+'/app');await page.getByRole('button',{name:'People & access'}).first().click()
 await capture(page,'owner-roles',async()=>{await expect(page.getByText('Estimator · 1 job(s)',{exact:true})).toBeVisible();await expect(page.getByText('Superintendent · 1 job(s)',{exact:true})).toBeVisible();await expect(page.getByText('Crew · 1 job(s)',{exact:true})).toBeVisible()})
 // Estimator: the lead and its proposal tools; no acceptance, billing or the other jobs.
 const [est,sup,crew]=people
 await est.goto(base+`/app?job=${lead.id}`)
 await capture(est,'estimator-lead',async()=>{await tabs(est,['Quote','Bids','To-dos']);await expect(est.getByRole('heading',{name:'Prepare a quote',exact:true})).toBeVisible();await expect(est.getByText('Record acceptance',{exact:false})).toHaveCount(0);await expect(est.getByText('Contract $',{exact:false})).toHaveCount(0)})
 await est.goto(base+`/app?job=${site.id}`);await expect(est.getByRole('alert')).toContainText('Job not found')
 // Superintendent: the day's work, a draft log for the office, no money.
 await sup.goto(base+`/app?job=${site.id}`)
 await capture(sup,'superintendent-today',async()=>{await tabs(sup,['Schedule','Daily logs','Punch','Today','To-dos']);await expect(sup.getByRole('heading',{name:'My job day',exact:true})).toBeVisible();await expect(sup.getByText('Check stud layout',{exact:false})).toBeVisible();await expect(sup.getByText('Stack lumber by wall',{exact:false})).toHaveCount(0);await expect(sup.getByText('Contract $',{exact:false})).toHaveCount(0)})
 await sup.getByRole('button',{name:'Daily logs',exact:true}).click();await sup.getByLabel('Work, conditions and decisions').fill('Walls framed to the second plate; weather dry.');await sup.getByRole('button',{name:'Save daily log draft',exact:true}).click()
 await expect(sup.getByText('Walls framed to the second plate',{exact:false})).toBeVisible();await expect(sup.getByRole('button',{name:'Publish daily log',exact:true})).toHaveCount(0)
 await capture(sup,'superintendent-log-draft',async()=>{await expect(sup.getByText('draft',{exact:true}).first()).toBeVisible()})
 // Crew: assigned work and published logs only.
 await crew.goto(base+`/app?job=${site.id}&tab=Daily%20logs`)
 await capture(crew,'crew-logs',async()=>{await tabs(crew,['Schedule','Daily logs','Punch','Today','To-dos']);await expect(crew.getByText('Walls framed to the second plate',{exact:false})).toHaveCount(0);await expect(crew.getByRole('heading',{name:'Write a daily log',exact:true})).toHaveCount(0)})
 await crew.goto(base+`/app?job=${site.id}&tab=Today`);await expect(crew.getByText('Stack lumber by wall',{exact:false})).toBeVisible();await expect(crew.getByText('Check stud layout',{exact:false})).toHaveCount(0)
 await capture(crew,'crew-today')
 await crew.goto(base+`/app?job=${other.id}`);await expect(crew.getByRole('alert')).toContainText('Job not found')
 // Owner UI rule: icon-only controls show a tip after about 300 ms of hover and at once on keyboard focus.
 await crew.setViewportSize({width:390,height:900});await crew.goto(base+'/app')
 const menu=crew.getByRole('button',{name:'Open menu',exact:true}),tip=()=>menu.evaluate(el=>getComputedStyle(el,'::after').opacity)
 assert.equal(await menu.getAttribute('data-tip'),'Open menu');assert.equal(await tip(),'0')
 await menu.hover();assert.equal(await tip(),'0','The tip waits for the hover delay');await crew.waitForTimeout(450);assert.equal(await tip(),'1','The tip shows after the hover delay')
 await crew.mouse.move(200,500);await crew.keyboard.press('Tab');await crew.evaluate(()=>document.activeElement.blur());await menu.focus({});await crew.keyboard.press('Shift+Tab');await crew.keyboard.press('Tab');assert.equal(await tip(),'1','Keyboard focus shows the tip at once')
 await menu.click();const close=crew.getByRole('button',{name:'Close menu',exact:true});await close.focus();await crew.keyboard.press('Shift+Tab');await crew.keyboard.press('Tab');assert.equal(await close.getAttribute('data-tip'),'Close menu');assert.equal(await close.evaluate(el=>getComputedStyle(el,'::after').opacity),'1')
 await crew.screenshot({path:`${shots}/ROLE-002-icon-tooltips-390.png`,animations:'disabled'})
 // The public contract page shows the clause status.
 const contract=parseContract(await readFile(new URL('../../CONTRACT.md',import.meta.url),'utf8'))
 const site2=process.env.PLINTH_SITE;assert.ok(site2,'The same rer dev session supplies the public run site preview')
 const publicContext=await browser.newContext(),publicPage=await publicContext.newPage();await publicPage.goto(site2+'/contract')
 for(const width of [1440,390]){
  await publicPage.setViewportSize({width,height:1000});await publicPage.evaluate(()=>scrollTo(0,0));for(const status of ['done','partial','missing'])await expect(publicPage.locator('#progress')).toHaveAttribute('data-'+status,String(contract.counts[status]))
  assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Contract fits '+width)
  const row=publicPage.locator('tr.clause[data-id="ROLE-002"]');await expect(row).toHaveAttribute('data-status',contract.clauses.find(c=>c.id==='ROLE-002').status);await row.screenshot({path:`${shots}/ROLE-002-contract-evidence-${width}.png`,animations:'disabled'})
 }
 await publicContext.close()
 console.log('ROLE-002 PASS: estimator, superintendent and crew on assigned and unassigned jobs, draft log, own checklist items, hidden contract money, icon tips; 1440/390')
 for(const context of contexts)await context.close()
}finally{await browser.close()}
