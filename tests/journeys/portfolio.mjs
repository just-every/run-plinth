import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {costFixture} from '../plinth/cost-support.mjs'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS,entrance=process.env.PLINTH_OWNER_OPEN
assert.ok(base&&shots&&entrance,'Use the disposable installed application')
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
try{
 const owner=await browser.newContext(),manager=await browser.newContext(),page=await owner.newPage(),mp=await manager.newPage()
 await page.goto(entrance);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 if(new URL(page.url()).pathname==='/setup'){
  await page.getByLabel('Your name',{exact:true}).fill('Synthetic Plinth builder')
  await page.getByRole('checkbox',{name:'I confirm this owner account is ready to use.'}).check()
  await page.getByRole('button',{name:'Finish setup',exact:true}).click();await page.waitForURL('**/app')
 }
 const call=async(path,{method='GET',body}={},context=owner)=>{const response=await context.request.fetch(base+path,{method,headers:{origin:base},...(body?{data:body}:{})});return {status:response.status(),value:await response.json()}}
 let count=0
 const f={owner:'owner',json:(path,options={})=>call(path,options.method==='POST'&&path==='/api/plinth/jobs'?{...options,body:{...options.body,name:['Maple remodel','Cedar porch','Birch addition'][count++]}}:options)}
 const jobs=[]
 for(let i=0;i<3;i++){
  const c=await costFixture(f),time=await c.ok('/costs/sources',{kind:'time',reference:'synthetic-plinth-portfolio-'+i,dated_on:'2026-10-24',period:'2026-10',cost_code:'01-100',minutes:(i+1)*60,hour_cents:2000,burden_bps:1000,employee_reference:'synthetic-plinth-worker-'+i})
  await c.ok(`/costs/sources/${time.record.id}/approve`);jobs.push(c.job)
 }
 const email='synthetic-plinth-portfolio-manager@dev.localhost'
 assert.equal((await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:'Synthetic assigned manager',role:'admin',returnTo:'/app'}})).status(),202)
 const url=new URL(entrance),hash=new URLSearchParams(url.hash.slice(1));hash.set('as',email);hash.set('next',`/auth/dev/enter?as=${encodeURIComponent(email)}&returnTo=/app`);url.hash=hash.toString()
 await mp.goto(url.href);await mp.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 const person=(await call('/api/plinth/team')).value.team.find(p=>p.email===email)
 assert.equal((await call('/api/plinth/team/'+person.id,{method:'PUT',body:{expected_version:0,role:'project_manager',job_ids:[jobs[0].id],po_limit_cents:0}})).status,200)
 await page.goto(base+'/app');await page.locator('summary',{hasText:'Custom fields and saved views'}).click()
 await page.getByLabel('View name',{exact:true}).fill('Current portfolio proof')
 await page.locator('select[name="sharing"]').selectOption('shared')
 for(const box of await page.locator('input[name="columns"]').all())await box.uncheck()
 for(const id of ['native.contract','portfolio.original_budget','portfolio.actual','portfolio.forecast','portfolio.as_of'])await page.locator(`input[name="columns"][value="${id}"]`).check()
 await page.getByRole('button',{name:'Save view',exact:true}).click()
 await expect(page.getByRole('region',{name:'Saved view results'})).toBeVisible()
 const capture=async(p,who,matched,total)=>{
  for(const width of [1440,390]){
   await p.setViewportSize({width,height:1000})
   await expect(p.getByText(`${matched} matched of ${total} authorized jobs.`,{exact:false})).toBeVisible()
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow at '+width)
   const region=p.getByRole('region',{name:'Saved view results'});await expect(region.getByRole('link',{name:'Source records',exact:true})).toHaveCount(matched)
   await region.focus();assert.equal(await region.evaluate(e=>e===document.activeElement),true)
   for(const format of ['CSV','XLSX']){
    const link=p.getByRole('link',{name:'Download scoped '+format,exact:true}),href=await link.getAttribute('href'),response=await p.context().request.get(base+href)
    assert.equal(response.status(),200);if(who==='manager')assert.ok(!(await response.body()).includes(Buffer.from(jobs[1].id)))
   }
   for(const link of await region.getByRole('link',{name:'Source records',exact:true}).all()){
    const response=await p.context().request.get(base+await link.getAttribute('href'));assert.equal(response.status(),200)
    const source=await response.json();assert.equal(source.rows.reduce((n,r)=>n+r.posted_actual_cents,0),who==='manager'?2200:[2200,4400,6600][jobs.findIndex(j=>j.id===source.job_id)])
   }
   if(width===390){const menu=p.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await p.keyboard.press('Tab');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')}
   await p.screenshot({path:`${shots}/RPT-001-${who}-${width}.png`,fullPage:true,animations:'disabled'})
  }
 }
 await capture(page,'owner',3,3)
 await mp.goto(base+'/app');await mp.locator('summary',{hasText:'Custom fields and saved views'}).click();await mp.getByRole('button',{name:'Current portfolio proof · shared',exact:true}).click()
 await capture(mp,'manager',1,1)
 await expect(mp.getByRole('region',{name:'Saved view results'}).getByText('Cedar porch',{exact:true})).toHaveCount(0)
 await owner.close();await manager.close()
 console.log('RPT-001 PASS: current owner and manager portfolio, source reconciliation, CSV and XLSX, keyboard access and icon tooltip at 1440 and 390')
}finally{await browser.close()}
