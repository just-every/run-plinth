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
 const context=await browser.newContext(),page=await context.newPage()
 await page.goto(ownerOpen.href);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 const post=async(path,data)=>{const r=await context.request.post(base+'/api/plinth'+path,{headers:{origin:base},data});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 let job=(await post('/jobs',{name:'Audit Street kitchen',client_email:`synthetic-plinth-audit-${Date.now()}@dev.localhost`,address:'12 Audit Street, Burlington, VT 05401'})).job
 const act=async(path,body={})=>{const r=await post(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});job=(await (await context.request.get(base+'/api/plinth/jobs/'+job.id)).json()).job;return r}
 await act('/quotes',{lines:[{description:'Agreed kitchen scope',quantity:1,unit_cents:2400000}]});await act(`/quotes/${job.quotes[0].id}/accept`,{method:'email',evidence:'Synthetic client accepted the exact proposal',schedule_choice:{kind:'none',reason:'Planned later'}})
 const capture=async(name,check)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(check)await check();await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width);await page.screenshot({path:`${shots}/ROLE-005-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 page.on('dialog',dialog=>dialog.accept())
 // The owner places a legal hold, meets it on an erasure request, and releases it.
 await page.goto(base+`/app?job=${job.id}&tab=History`)
 await page.getByLabel('Reason',{exact:true}).fill('Dispute notice received from the client’s lawyer');await page.getByRole('checkbox',{name:'This stops erasure of the job and only I can release it.'}).check();await page.getByRole('button',{name:'Place hold',exact:true}).click()
 await expect(page.getByText('Legal hold · in force',{exact:false})).toBeVisible()
 await page.getByText('Erase this job',{exact:true}).click();await page.getByRole('button',{name:'Erase job permanently',exact:true}).click()
 await expect(page.getByText('Erasure is blocked: legal hold placed by',{exact:false})).toBeVisible();await expect(page.getByText('Dispute notice received',{exact:false}).first()).toBeVisible()
 await capture('hold-blocks-erasure',async()=>{await expect(page.getByText('Erasure is blocked',{exact:false})).toBeVisible()})
 await page.getByLabel('Reason for releasing').fill('Dispute settled in writing');await page.getByRole('button',{name:'Release this hold',exact:true}).click();await expect(page.getByText('released',{exact:false}).first()).toBeVisible()
 // The audit history shows the events and exports them.
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/app');await page.getByRole('button',{name:'Audit history'}).first().click()
 await capture('audit-history',async()=>{await expect(page.getByText('quotes.accept',{exact:true}).first()).toBeVisible();await expect(page.getByText('jobs.erase_refused',{exact:true}).first()).toBeVisible();await expect(page.getByText('holds.legal_hold',{exact:true}).first()).toBeVisible()})
 await page.getByLabel('Search',{exact:true}).fill('quotes');await page.getByLabel('Kind').selectOption('financial');await page.getByRole('button',{name:'Search history',exact:true}).click()
 await expect(page.getByText('jobs.erase_refused',{exact:true})).toHaveCount(0);await expect(page.getByText('quotes.accept',{exact:true}).first()).toBeVisible()
 const csv=await context.request.get(base+(await page.getByRole('link',{name:'Export matching events as CSV'}).getAttribute('href')));assert.equal(csv.status(),200);const text=await csv.text();assert.ok(text.includes('quotes.accept')&&!text.includes('Audit Street kitchen')&&!text.includes('synthetic-plinth-audit'),'The export carries references, never job content')
 await capture('audit-search')
 const contract=parseContract(await readFile(new URL('../../CONTRACT.md',import.meta.url),'utf8')),site=process.env.PLINTH_SITE;assert.ok(site)
 const publicContext=await browser.newContext(),publicPage=await publicContext.newPage();await publicPage.goto(site+'/contract')
 for(const width of [1440,390]){await publicPage.setViewportSize({width,height:1000});const row=publicPage.locator('tr.clause[data-id="ROLE-005"]');await expect(row).toHaveAttribute('data-status',contract.clauses.find(c=>c.id==='ROLE-005').status);assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Contract fits '+width);await row.screenshot({path:`${shots}/ROLE-005-contract-evidence-${width}.png`,animations:'disabled'})}
 await publicContext.close();await context.close()
 console.log('ROLE-005 PASS: hold, reasoned erasure refusal, release, searchable and exportable audit history; 1440/390')
}finally{await browser.close()}
