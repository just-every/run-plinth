import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {parseContract} from '../../src/base/seed-contract.mjs'
import {chromium,expect} from '@playwright/test'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&shots&&process.env.PLINTH_OWNER_OPEN,'Use the disposable installation and its own private native entrance')
const ownerOpen=new URL(process.env.PLINTH_OWNER_OPEN),fragment=new URLSearchParams(ownerOpen.hash.slice(1))
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)&&ownerOpen.origin===base&&fragment.has('rer-dev'))
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
await mkdir(shots,{recursive:true})
try{
 const stamp=Date.now(),names=[['lead','Lee Carpenter'],['office','Olive Manager']],emails=names.map(([key])=>`synthetic-plinth-${key}-${stamp}@dev.localhost`)
 const contexts=await Promise.all(Array.from({length:3},()=>browser.newContext())),pages=await Promise.all(contexts.map(c=>c.newPage())),[owner]=contexts,[page,leadPage,officePage]=pages
 await page.goto(ownerOpen.href);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 for(const [n,[key,name]] of names.entries()){
  const r=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email:emails[n],displayName:name,role:'admin',returnTo:'/app'}});assert.equal(r.status(),202)
  const url=new URL(ownerOpen),hash=new URLSearchParams(fragment);hash.set('as',emails[n]);hash.set('next',`/auth/dev/enter?as=${encodeURIComponent(emails[n])}&returnTo=/app`);url.hash=hash.toString()
  await pages[n+1].goto(url.href);await pages[n+1].waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 }
 const call=async(method,path,data,context=owner)=>{const r=await context.request[method](base+'/api/plinth'+path,{headers:{origin:base},...(data?{data}:{})});return {status:r.status(),value:await r.json().catch(()=>({}))}}
 let job=(await call('post','/jobs',{name:'Charlotte addition',client_email:`synthetic-plinth-client-${stamp}@dev.localhost`,address:'12 Orchard Lane, Charlotte, VT 05445'})).value.job
 const act=async(path,body={},context=owner)=>{const r=await call('post',`/jobs/${job.id}${path}`,{expected_version:job.version,...body},context);job=(await call('get','/jobs/'+job.id)).value.job;return r}
 await act('/quotes',{lines:[{id:'framing',description:'Framing',cost_code:'06-100',phase:'Framing',category:'labor',quantity:'1',unit:'job',unit_cents:1000000,cost_unit_cents:600000}]});await act(`/quotes/${job.quotes[0].id}/accept`,{method:'email',evidence:'Synthetic client accepted',schedule_choice:{kind:'none',reason:'Later'}})
 const capture=async(p,name,check)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});if(check)await check();await p.evaluate(()=>scrollTo(0,0));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width);await p.screenshot({path:`${shots}/ROLE-006-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 // The owner copies two presets in the screen, adjusts one and assigns both.
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/app');await page.getByRole('button',{name:'People & access'}).first().click()
 const create=async(preset,name)=>{await page.getByLabel('Copy preset').selectOption({label:preset});await page.getByLabel('New role name').fill(name);await page.getByRole('button',{name:'Create role from preset',exact:true}).click();await expect(page.locator('summary',{hasText:name})).toBeVisible()}
 await create('Superintendent','Lead Carpenter – no financials');await create('Project manager','Office Manager')
 await page.getByText('Office Manager · copy of Project manager',{exact:false}).click()
 const office=page.locator('details',{hasText:'Office Manager · copy of Project manager'});await office.getByLabel('Purchase order approval limit',{exact:false}).fill('5000.00');await office.getByRole('button',{name:'Save role',exact:true}).click();await expect(page.getByText('Saved.',{exact:false}).first()).toBeVisible()
 await page.getByText('Lead Carpenter – no financials · copy of Superintendent',{exact:false}).click()
 const assign=async(person,role)=>{const form=page.locator('form',{has:page.locator('select[name="person"]')});await form.locator('select[name="person"]').selectOption({label:person});await form.locator('select[name="role"]').selectOption({label:role});await form.locator('select[name="jobs"]').selectOption({label:job.name});await form.getByRole('button',{name:'Save role',exact:true}).click()}
 await assign('Lee Carpenter','Lead Carpenter – no financials (custom)');await expect(page.getByText('Lead Carpenter – no financials · custom role · 1 job(s)',{exact:true})).toBeVisible()
 await assign('Olive Manager','Office Manager (custom)');await expect(page.getByText('Office Manager · custom role · 1 job(s)',{exact:true})).toBeVisible()
 await capture(page,'owner-custom-roles',async()=>{await expect(page.getByRole('heading',{name:'Custom roles',exact:true})).toBeVisible()})
 // Each holder sees their own role and its effect on the next request.
 await leadPage.goto(base+`/app?job=${job.id}`)
 await capture(leadPage,'lead-carpenter',async()=>{await expect(leadPage.getByText('Lead Carpenter – no financials',{exact:true}).first()).toBeVisible();await expect(leadPage.getByText('Contract $',{exact:false})).toHaveCount(0);await expect(leadPage.getByRole('navigation',{name:'Job sections'}).getByRole('button',{name:'Billing'})).toHaveCount(0)})
 const read=async()=>(await call('get','/jobs/'+job.id,undefined,contexts[1])).value.job
 assert.equal((await read()).budgets,undefined,'No budget before it is switched on')
 // Search uses the current projection, including the same feature restrictions as the open job.
 await leadPage.goto(base+'/app');await leadPage.getByRole('searchbox',{name:'Search jobs'}).fill('Framing')
 await expect(leadPage.getByRole('heading',{name:'No jobs match “Framing”'})).toBeVisible()
 await capture(leadPage,'hidden-search',async()=>{await expect(leadPage.getByRole('heading',{name:'No jobs match “Framing”'})).toBeVisible()})
 await officePage.goto(base+'/app');await officePage.getByRole('searchbox',{name:'Search jobs'}).fill('Framing')
 await expect(officePage.locator('.job-grid .job-name',{hasText:job.name})).toBeVisible()
 await capture(officePage,'authorized-search',async()=>{const clear=officePage.getByRole('button',{name:'Clear search',exact:true});await clear.hover();await expect.poll(()=>clear.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible');await officePage.keyboard.press('Tab');await clear.focus();assert.equal(await clear.evaluate(el=>getComputedStyle(el,'::after').visibility),'visible','Search tooltip appears on keyboard focus')})
 // Existing Reports controls open the exact scoped CSV and PDF, and revocation removes a financial saved view.
 const reportSpec={expected_version:0,name:'Assigned job contract',sharing:'shared',scope:{record_scope:'job',record_ids:[job.id]},filters:[],selected_columns:['native.stage','native.contract']}
 const saved=await call('post','/reports/views',reportSpec);assert.equal(saved.status,201)
 await officePage.reload();await officePage.locator('summary',{hasText:'Custom fields and saved views'}).click()
 await officePage.getByRole('button',{name:'Assigned job contract · shared',exact:true}).click();await expect(officePage.getByRole('link',{name:'Download scoped PDF'})).toBeVisible()
 for(const format of ['CSV','PDF']){const path=await officePage.getByRole('link',{name:'Download scoped '+format}).getAttribute('href'),download=await contexts[2].request.get(base+path);assert.equal(download.status(),200)}
 await capture(officePage,'scoped-report',async()=>{await expect(officePage.getByRole('region',{name:'Saved view results'})).toBeVisible()})
 await officePage.setViewportSize({width:390,height:1000});const menu=officePage.getByRole('button',{name:'Open menu',exact:true});await officePage.keyboard.press('Tab');await menu.focus();assert.equal(await menu.evaluate(el=>getComputedStyle(el,'::after').visibility),'visible','Icon tooltip appears on keyboard focus')
 await officePage.screenshot({path:`${shots}/ROLE-006-icon-tooltip-390.png`,fullPage:true,animations:'disabled'})
 const officeRole=(await call('get','/roles')).value.roles.find(r=>r.name==='Office Manager')
 const hidden=await call('put','/roles/'+officeRole.id,{expected_version:officeRole.version,financial_visible:false});assert.equal(hidden.status,200)
 await officePage.reload();await officePage.locator('summary',{hasText:'Custom fields and saved views'}).click();await expect(officePage.getByRole('button',{name:'Assigned job contract · shared',exact:true})).toHaveCount(0)
 await capture(officePage,'financial-report-revoked',async()=>{await expect(officePage.getByRole('button',{name:'Assigned job contract · shared',exact:true})).toHaveCount(0);await expect(officePage.locator('.job-grid').getByText('Contract',{exact:true})).toHaveCount(0)})
 await officePage.goto(base+`/app?job=${job.id}`);await capture(officePage,'financial-job-revoked',async()=>{await expect(officePage.getByText('Contract $',{exact:false})).toHaveCount(0);await expect(officePage.getByText('Active job',{exact:true})).toBeVisible()})
 assert.equal((await call('put','/roles/'+officeRole.id,{expected_version:hidden.value.role.version,financial_visible:true})).status,200)
 const roles=(await call('get','/roles')).value.roles,carpenter=roles.find(r=>r.name.startsWith('Lead Carpenter'))
 assert.equal((await call('put','/roles/'+carpenter.id,{expected_version:carpenter.version,permissions:{budgets:{view:true}},financial_visible:true})).status,200)
 assert.ok((await read()).budgets.length,'The next request shows the budget once it is switched on')
 await officePage.goto(base+`/app?job=${job.id}&tab=Purchasing`)
 const order=async amount=>(await act('/orders',{supplier:'Champlain Lumber',description:`PO ${amount}`,amount_cents:amount},contexts[2])).value.record.id
 const small=await order(400000),large=await order(600000)
 assert.equal((await act(`/orders/${small}/issue`,{},contexts[2])).status,200);assert.equal((await act(`/orders/${large}/issue`,{},contexts[2])).status,403)
 await officePage.goto(base+`/app?job=${job.id}&tab=Purchasing`)
 await capture(officePage,'office-manager-limit',async()=>{await expect(officePage.getByText('PO 400000',{exact:true})).toBeVisible()})
 const contract=parseContract(await readFile(new URL('../../CONTRACT.md',import.meta.url),'utf8')),site=process.env.PLINTH_SITE;assert.ok(site)
 const publicContext=await browser.newContext(),publicPage=await publicContext.newPage();await publicPage.goto(site+'/contract')
 for(const width of [1440,390]){await publicPage.setViewportSize({width,height:1000});const row=publicPage.locator('tr.clause[data-id="ROLE-006"]');await expect(row).toHaveAttribute('data-status',contract.clauses.find(c=>c.id==='ROLE-006').status);assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Contract fits '+width);await row.screenshot({path:`${shots}/ROLE-006-contract-evidence-${width}.png`,animations:'disabled'})}
 await publicContext.close()
 console.log('ROLE-006 PASS: two copied presets, assignment, next-request budget visibility and a $5,000 PO limit; 1440/390')
 for(const context of contexts)await context.close()
}finally{await browser.close()}
