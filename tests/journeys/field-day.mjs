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
 const stamp=Date.now(),email=`synthetic-plinth-super-${stamp}@dev.localhost`
 const contexts=await Promise.all(Array.from({length:2},()=>browser.newContext())),[owner]=contexts,[page,sup]=await Promise.all(contexts.map(c=>c.newPage()))
 await page.goto(ownerOpen.href);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 assert.equal((await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:'Sam Superintendent',role:'admin',returnTo:'/app'}})).status(),202)
 const url=new URL(ownerOpen),hash=new URLSearchParams(fragment);hash.set('as',email);hash.set('next',`/auth/dev/enter?as=${encodeURIComponent(email)}&returnTo=/app`);url.hash=hash.toString()
 await sup.goto(url.href);await sup.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 const call=async(method,path,data)=>{const r=await owner.request[method](base+'/api/plinth'+path,{headers:{origin:base},...(data?{data}:{})});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 const day=n=>new Date(Date.now()+n*86_400_000).toISOString().slice(0,10)
 let job=(await call('post','/jobs',{name:'Orchard addition framing',client_email:`synthetic-plinth-client-${stamp}@dev.localhost`,address:'12 Orchard Lane, Charlotte, VT 05445'})).job
 const act=async(path,body={})=>{const r=await call('post',`/jobs/${job.id}${path}`,{expected_version:job.version,...body});job=(await call('get','/jobs/'+job.id)).job;return r}
 await act('/quotes',{lines:[{description:'Agreed addition scope',quantity:1,unit_cents:9600000}]});await act(`/quotes/${job.quotes[0].id}/accept`,{method:'email',evidence:'Synthetic client accepted the exact proposal',schedule_choice:{kind:'none',reason:'Planned below'}})
 await act('/schedules',{trade:'Framing',description:'Frame addition walls',start:`${day(0)}T08:00:00Z`,end:`${day(0)}T12:00:00Z`});const frame=job.schedules[0].id
 const calendar={weekdays:[0,1,2,3,4,5,6],start_hour:8,end_hour:17,holidays:[]},tasks=[{...job.schedules[0],duration_minutes:240},{id:'drywall',trade:'Drywall',description:'Hang drywall',start:`${day(1)}T08:00:00Z`,duration_minutes:240,predecessors:[{id:frame,lag_minutes:0}]}]
 const preview=(await act('/schedule/preview',{calendar,tasks})).preview;await act('/schedule/publish',{calendar,tasks:preview.tasks,digest:preview.digest})
 await act('/schedule-constraints',{kind:'inspection',title:'Rough framing inspection',jurisdiction:'City of Burlington',accountable:'Sam Superintendent',task_ids:['drywall'],reason:'Inspection requested before drywall'})
 await act('/takeoff',{name:'S1 Framing plan',page:1,width:400,height:400,document:{name:'synthetic-plinth-plan.pdf',mime:'application/pdf',base64:takeoffPlan().toString('base64')}})
 const order=(await act('/orders',{supplier:'Champlain Lumber',description:'Framing lumber package',amount_cents:250000})).record.id;await act(`/orders/${order}/issue`);await act(`/orders/${order}/promise`,{promised_on:day(1),reason:'Promised in the vendor acknowledgment'})
 await act('/todos',{title:'Layout walk',due_at:`${day(-1)}T17:00`,items:[{title:'Check stud layout',assignee:{kind:'office',email}}]})
 const team=(await call('get','/team')).team;await call('put',`/team/${team.find(m=>m.email===email).id}`,{expected_version:0,role:'superintendent',job_ids:[job.id],po_limit_cents:0})
 const other=(await call('post','/jobs',{name:'Hinesburg garage',client_email:`synthetic-plinth-other-${stamp}@dev.localhost`,address:'4 Mill Road, Hinesburg, VT 05461'})).job
 const capture=async(p,name,check)=>{for(const width of [390,1440]){await p.setViewportSize({width,height:900});if(check)await check();await p.evaluate(()=>scrollTo(0,0));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width);await p.screenshot({path:`${shots}/SCH-005-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 // At 390 pixels: the daily plan, the current sheet, a checklist item, progress and tomorrow's dependencies with the office forecast.
 await sup.setViewportSize({width:390,height:900});await sup.goto(base+`/app?job=${job.id}`)
 await expect(sup.getByRole('heading',{name:'My job day',exact:true})).toBeVisible()
 await expect(sup.getByText('Site contacts',{exact:true})).toBeVisible();await expect(sup.getByRole('link',{name:/synthetic-plinth-super-/})).toBeVisible();await expect(sup.getByText('Builder · ',{exact:false})).toBeVisible()
 await expect(sup.getByText('S1 Framing plan · revision 1 · page 1',{exact:false})).toBeVisible();await expect(sup.getByRole('link',{name:'Download current original'})).toBeVisible()
 await expect(sup.getByText('Waiting on Frame addition walls (not started)',{exact:true}).first()).toBeVisible();await expect(sup.getByText('Inspection: Rough framing inspection (requested)',{exact:true}).first()).toBeVisible()
 await expect(sup.getByText('Champlain Lumber',{exact:true})).toBeVisible();await expect(sup.getByText(`Promised ${day(1)}`,{exact:true})).toBeVisible()
 await expect(sup.getByText('Office forecast: project finish',{exact:false})).toBeVisible()
 await capture(sup,'daily-plan')
 await sup.getByRole('button',{name:'Mark “Check stud layout” done'}).click();await expect(sup.getByText('No open checklist items assigned to you on this job.',{exact:true})).toBeVisible()
 await sup.getByText('Record progress on Frame addition walls',{exact:true}).click()
 await sup.getByLabel('Installed quantity so far').fill('40');await sup.getByLabel('Unit',{exact:true}).fill('studs');await sup.getByLabel('Evidence: what was done and seen').fill('North and east walls framed to the top plate')
 await sup.getByRole('button',{name:'Save progress',exact:true}).click()
 await sup.waitForTimeout(2500);console.log('PAGE',(await sup.locator('main').innerText()).slice(0,1500));await expect(sup.getByText('Started',{exact:true}).first()).toBeVisible();await expect(sup.getByText('Office forecast: project finish',{exact:false})).toBeVisible()
 await capture(sup,'progress-recorded')
 await sup.goto(base+`/app?job=${other.id}`);await expect(sup.getByRole('alert')).toContainText('Job not found')
 // The office sees the same actual work and quantity in the schedule.
 await page.setViewportSize({width:1440,height:900});await page.goto(base+`/app?job=${job.id}&tab=Schedule`)
 await capture(page,'office-actuals',async()=>{await expect(page.getByText('North and east walls framed to the top plate',{exact:false})).toBeVisible();await expect(page.getByText('40 studs',{exact:false})).toBeVisible()})
 const contract=parseContract(await readFile(new URL('../../CONTRACT.md',import.meta.url),'utf8')),site=process.env.PLINTH_SITE;assert.ok(site)
 const publicContext=await browser.newContext(),publicPage=await publicContext.newPage();await publicPage.goto(site+'/contract')
 for(const width of [1440,390]){await publicPage.setViewportSize({width,height:1000});const row=publicPage.locator('tr.clause[data-id="SCH-005"]');await expect(row).toHaveAttribute('data-status',contract.clauses.find(c=>c.id==='SCH-005').status);assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Contract fits '+width);await row.screenshot({path:`${shots}/SCH-005-contract-evidence-${width}.png`,animations:'disabled'})}
 await publicContext.close()
 console.log('SCH-005 PASS: superintendent daily plan, current sheet, checklist item, progress with installed quantity and office forecast at 390/1440; unassigned job hidden')
 for(const context of contexts)await context.close()
}finally{await browser.close()}
