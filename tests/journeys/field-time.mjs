import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {costFixture} from '../plinth/cost-support.mjs'
const base=process.env.PLINTH_URL,entrance=process.env.PLINTH_OWNER_OPEN,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&entrance&&shots&&new URL(entrance).origin===base,'Use the disposable installed runtime and its own native entrance')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
try{
 const owner=await browser.newContext(),worker=await browser.newContext(),page=await owner.newPage(),workerPage=await worker.newPage()
 await page.goto(entrance);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 if(new URL(page.url()).pathname==='/setup'){await page.getByLabel('Your name',{exact:true}).fill('Synthetic builder');await page.getByRole('checkbox',{name:'I confirm this owner account is ready to use.'}).check();await page.getByRole('button',{name:'Finish setup',exact:true}).click();await page.waitForURL('**/app')}
 const f={owner:'owner',json:async(path,{method='GET',body}={})=>{const r=await owner.request.fetch(base+path,{method,headers:{origin:base,'content-type':'application/json'},...(body===undefined?{}:{data:body})});return {status:r.status(),value:await r.json()}}}
 const c=await costFixture(f),email=`synthetic-plinth-time-${Date.now()}@dev.localhost`
 let r=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:'Synthetic carpenter',role:'admin',returnTo:'/app'}});assert.equal(r.status(),202)
 const open=new URL(entrance),hash=new URLSearchParams(open.hash.slice(1));hash.set('as',email);hash.set('next',`/auth/dev/enter?as=${encodeURIComponent(email)}&returnTo=/app`);open.hash=hash.toString()
 await workerPage.goto(open.href);await workerPage.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 const team=(await (await owner.request.get(base+'/api/plinth/team')).json()).team,person=team.find(p=>p.email===email)
 r=await owner.request.put(base+'/api/plinth/team/'+person.id,{headers:{origin:base},data:{expected_version:0,role:'crew',job_ids:[c.job.id],po_limit_cents:0}});assert.equal(r.status(),200)
 const time=async(path,body,context=owner)=>{const job=(await (await owner.request.get(base+'/api/plinth/jobs/'+c.job.id)).json()).job;const r=await context.request.post(base+`/api/plinth/jobs/${c.job.id}/time`+path,{headers:{origin:base},data:{expected_version:job.version,...body}});assert.equal(r.status(),200,path+' '+await r.text());return r.json()}
 await time('/rates',{employee_id:person.id,hour_cents:3000,burden_bps:2000,overtime_bps:15000,human_reviewed:true,reference:'synthetic-plinth-reviewed-rate'})
 const entry={dated_on:'2026-10-23',cost_code:'01-100',activity:'Synthetic framing work',minutes:300,break_minutes:30,classification:'regular',reason:'Worker recorded the shift'}
 const recorded=await time('',entry,worker);await time(`/${recorded.record.id}/correct`,{...entry,minutes:270,reason:'Corrected end time after review'},worker)
 const approved=await time(`/${recorded.record.id}/approve`,{});assert.equal(approved.record.approval.amount_cents,14400)
 const payroll=await owner.request.get(base+`/api/plinth/jobs/${c.job.id}/time/payroll.csv`);assert.equal(payroll.status(),200);assert.ok((await payroll.text()).includes('"12000","2400"'))
 assert.equal((await worker.request.get(base+`/api/plinth/jobs/${c.job.id}/time/payroll.csv`)).status(),403)
 await time('/site',{label:'Synthetic site',latitude:44,longitude:-73,radius_meters:100});await time('/consent',{consent:true},worker)
 assert.equal((await time('/location',{latitude:44.0001,longitude:-73.0001},worker)).record.reminder.kind,'clock_in')
 assert.equal((await time('/location',{latitude:44.1,longitude:-73.1},worker)).record.reminder.kind,'clock_out')
 const own=await (await worker.request.get(base+`/api/plinth/jobs/${c.job.id}/time`)).json();assert.equal(own.entries.length,1);assert.ok(!JSON.stringify(own).includes('hour_cents'))
 await page.goto(base+`/app?job=${c.job.id}&tab=History`);await expect(page.getByRole('heading',{name:'Approval history',exact:true})).toBeVisible();await expect(page.getByText('time.approve',{exact:false}).first()).toBeVisible()
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'History fits '+width);await page.screenshot({path:`${shots}/FIELD-002-history-${width}.png`,fullPage:true,animations:'disabled'})}
 const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();assert.equal(await menu.evaluate(el=>getComputedStyle(el,'::after').opacity),'0');await page.waitForTimeout(450);assert.equal(await menu.evaluate(el=>getComputedStyle(el,'::after').opacity),'1');await page.mouse.move(250,500);await menu.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');assert.equal(await menu.evaluate(el=>getComputedStyle(el,'::after').opacity),'1')
 await page.screenshot({path:`${shots}/FIELD-002-history-tooltip-390.png`,animations:'disabled'})
 await worker.close();await owner.close()
 console.log('FIELD-002 native installed HTTP and existing History PASS at 1440 and 390; payroll privacy and tooltip hover and focus PASS. Employee entry and location-reminder screens remain pending.')
}finally{await browser.close()}
