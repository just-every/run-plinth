import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'

const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&shots&&process.env.PLINTH_OWNER_OPEN&&process.env.PLINTH_CLIENT_OPEN,'Private owner and client sign-in links are required')
const ownerOpen=new URL(process.env.PLINTH_OWNER_OPEN),devFragment=new URLSearchParams(ownerOpen.hash.slice(1))
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)&&ownerOpen.origin===new URL(base).origin&&devFragment.has('rer-dev'),'Use this synthetic installation’s native local dev entrance')
const devOpen=email=>{const url=new URL(ownerOpen),fragment=new URLSearchParams(devFragment);fragment.set('as',email);fragment.set('next',`/auth/dev/enter?as=${encodeURIComponent(email)}&returnTo=/app`);url.hash=fragment.toString();return url.href}
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
await mkdir(shots,{recursive:true})
try{
 const owner=await browser.newContext(),trade=await browser.newContext(),client=await browser.newContext()
 const page=await owner.newPage(),tp=await trade.newPage(),cp=await client.newPage()
 const signIn=async(p,context,open)=>{await p.goto(open);await p.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'));const r=await context.request.get(base+'/auth/session');assert.ok(r.ok());return (await r.json()).operator}
 const me=await signIn(page,owner,process.env.PLINTH_OWNER_OPEN),customer=await signIn(cp,client,process.env.PLINTH_CLIENT_OPEN)
 const subEmail=`synthetic-plinth-${Date.now()}@dev.localhost`
 const invite=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email:subEmail,displayName:'Sam Rivera, plumbing contractor',role:'member',returnTo:'/app'}})
 assert.equal(invite.status(),202,'Native owner invitation succeeds')
 const sub=await signIn(tp,trade,devOpen(subEmail))
 const post=async(path,body)=>{const r=await owner.request.post(base+'/api/plinth'+path,{headers:{origin:base},data:body});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 const calendar={weekdays:[1,2,3,4,5],start_hour:8,end_hour:17,holidays:[]}
 const {template:scheduleTemplate}=await post('/schedule-templates',{name:'Kitchen remodel through drywall',calendar,tasks:[{id:'drywall',trade:'Drywall',description:'Kitchen drywall installation',start:'2026-11-02T08:00:00Z',duration_minutes:480}]})
 let {job}=await post('/jobs',{name:'Alder Avenue kitchen remodel',client_email:customer.email,address:'4518 Alder Avenue, Portland, OR 97211'})
 const act=async(path,body={})=>{const r=await post(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});job=r.job;return r}
 await act('/quotes',{lines:[{description:'Kitchen remodel, framing and rough-in',quantity:1,unit_cents:48000000}]})
 await act(`/quotes/${job.quotes[0].id}/accept`,{method:'signed',evidence:'Client signed the reviewed remodel scope',schedule_choice:{kind:'none',reason:'Coordinate rough-in before scheduling drywall'}})
 const {vendor}=await post('/vendors',{kind:'subcontractor',name:'Rivera Plumbing',trades:['Plumbing'],contacts:[{id:'synthetic-plinth-1',name:sub.displayName,email:sub.email}]})
 await post(`/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Plumbing',status:'qualified',evidence:'Current plumbing qualification reviewed'})
 const awarded=await act('/subcontracts',{vendor_id:vendor.id,trade:'Plumbing',scope:'Kitchen plumbing rough-in and pressure testing',contact_ids:['synthetic-plinth-1'],awarded_on:'2026-10-22'})
 const scope=awarded.record;await act(`/subcontracts/${scope.id}/release`)
 const {template}=await post('/todos/templates',{name:'Pre-drywall walk checklist',specs:[{title:'Pre-drywall walk',notes:'Internal office notes about private crew sequence',due_offset_days:-1,due_time:'17:00',priority:'high',tags:['rough-in'],items:[{title:'Crew framing check',assignee:{kind:'office',email:me.email}},{title:'Plumbing rough-in check',assignee:{kind:'sub',email:sub.email,subcontract_id:scope.id}},{title:'Client wall-location check',assignee:{kind:'client',email:customer.email}}]}]})
 const jobsResponse=await owner.request.get(base+'/api/plinth/jobs'),allJobs=(await jobsResponse.json()).jobs
 const ends=allJobs.flatMap(j=>j.schedules.filter(s=>s.status==='booked'&&s.trade.toLowerCase()==='drywall').map(s=>Date.parse(s.end)))
 const startDay=new Date(Math.max(Date.parse('2026-11-08T17:00:00Z'),...ends)+86400000)
 startDay.setUTCHours(8,0,0,0);while([0,6].includes(startDay.getUTCDay()))startDay.setUTCDate(startDay.getUTCDate()+1)
 const start=startDay.toISOString().slice(0,16)
 const capture=async(p,name)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});await p.evaluate(()=>window.scrollTo(0,0));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width);await p.screenshot({path:`${shots}/TODO-001-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 await page.goto(base+`/app?job=${job.id}&tab=To-dos`)
 await page.locator('summary').filter({hasText:/^Job-template schedule and to-dos$/}).click()
 const configuration=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Job-template schedule and to-dos$/})})
 await configuration.getByLabel('Schedule template for to-dos',{exact:true}).selectOption(scheduleTemplate.id)
 const row=configuration.locator(`[data-todo-template-id="${template.id}"]`)
 await row.getByRole('checkbox',{name:'Include to-do template Pre-drywall walk checklist',exact:true}).check()
 await row.getByLabel('Date anchor for Pre-drywall walk checklist',{exact:true}).selectOption('drywall')
 await configuration.getByRole('button',{name:'Save job-template checklist binding',exact:true}).click()
 await expect(configuration.getByText('1 checklist template(s) bound to schedule revision 1.',{exact:true})).toBeVisible()
 await configuration.getByLabel(`Job-template start (${job.time_zone??'UTC'})`,{exact:true}).fill(start)
 await configuration.getByRole('button',{name:'Preview job template with to-dos',exact:true}).click()
 await expect(configuration.getByRole('heading',{name:'Reviewed job-template schedule',exact:true})).toBeVisible()
 await capture(page,'reviewed-job-template')
 await configuration.getByRole('checkbox',{name:'I reviewed this schedule and its bound checklist templates',exact:true}).check()
 await configuration.getByRole('button',{name:'Apply reviewed job template',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Pre-drywall walk',exact:true})).toBeVisible()
 const list=await owner.request.get(base+`/api/plinth/jobs/${job.id}/todos`),todos=(await list.json()).todos
 assert.equal(todos.length,1);let todo=todos[0],path=`/jobs/${job.id}/todos/${todo.id}`
 assert.equal(todo.items.length,3);assert.equal(todo.job_template.schedule_template_id,scheduleTemplate.id)
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='
 todo=(await post(path+'/attachments',{expected_revision:todo.revision,operation_id:crypto.randomUUID(),attachments:[{name:'rough-in-inspection.png',mime:'image/png',base64:png}]})).todo
 await page.goto(base+`/app?job=${job.id}&tab=Today`);await expect(page.getByRole('heading',{name:'My job day',exact:true})).toBeVisible();await expect(page.getByText('Crew framing check',{exact:true})).toBeVisible();await capture(page,'daily-assigned-items')
 await page.goto(base+`/app?job=${job.id}&tab=Schedule`);await expect(page.getByRole('heading',{name:'Linked to-dos',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Pre-drywall walk',exact:true})).toBeVisible();await capture(page,'schedule-reverse-link')
 await page.goto(base+`/app?job=${job.id}&tab=To-dos`);const card=page.locator('#todo-'+todo.id);await expect(card).toBeVisible();await capture(page,'office-checklist')
 await page.setViewportSize({width:390,height:1000});await owner.setOffline(true)
 await card.getByRole('button',{name:'Complete Crew framing check',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Checklist sync queue',exact:true})).toBeVisible();await capture(page,'offline-queued')
 await owner.setOffline(false)
 await expect(page.getByRole('heading',{name:'Checklist sync queue',exact:true})).toHaveCount(0)
 await expect(card.getByRole('button',{name:'Reopen Crew framing check',exact:true})).toBeVisible();await capture(page,'reconnected-once')
 const myTodos=async p=>{await p.goto(base+'/app');await p.locator('button.signout').waitFor({state:'attached'});const menu=p.getByRole('button',{name:'Open menu',exact:true});if(await menu.isVisible())await menu.click();await p.getByRole('button',{name:'My to-dos',exact:true}).click();await expect(p.getByRole('heading',{name:'My to-dos',exact:true})).toBeVisible()}
 await myTodos(tp);let external=tp.locator('#todo-'+todo.id)
 await expect(external.getByText('Client wall-location check',{exact:true})).toHaveCount(0)
 await expect(external.getByText('Internal office notes about private crew sequence',{exact:true})).toHaveCount(0)
 await external.getByRole('button',{name:'Complete Plumbing rough-in check',exact:true}).click()
 await expect(external.getByRole('button',{name:'Reopen Plumbing rough-in check',exact:true})).toBeVisible();await capture(tp,'sub-own-item')
 await myTodos(cp);external=cp.locator('#todo-'+todo.id)
 await expect(external.getByText('Crew framing check',{exact:true})).toHaveCount(0);await expect(external.getByText('Plumbing rough-in check',{exact:true})).toHaveCount(0)
 await capture(cp,'client-only-assignment')
 todo=(await (await owner.request.get(base+'/api/plinth'+path)).json()).todo
 await post(path+'/edit',{expected_revision:todo.revision,operation_id:crypto.randomUUID(),due_at:'2020-01-01T17:00:00Z'})
 await page.reload();await page.getByRole('button',{name:'Overdue to-dos',exact:true}).click();await expect(card).toBeVisible()
 assert.equal((await (await owner.request.get(base+'/api/plinth'+path)).json()).todo.items.filter(i=>!i.completed).length,1);await capture(page,'overdue-client-item')
 const {todo:companyTodo}=await post('/todos',{title:'Annual company insurance renewal',due_at:'2026-12-01T09:00:00Z',items:[{title:'Review company insurance',assignee:{kind:'office',email:me.email}}]})
 await myTodos(page);await expect(page.locator('#todo-'+companyTodo.id)).toBeVisible();await capture(page,'company-my-list')
 console.log('TODO-001 native web subset PASS: real schedule-template checklist binding/application, task/photo, queued web completion/reconnect, private sub/client items, overdue and company lists at 1440/390. Native apps/channels and Buildertrend export import remain unavailable.')
 for(const context of [owner,trade,client])await context.close()
}finally{await browser.close()}
