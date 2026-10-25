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
 const owner=await browser.newContext(),clientContext=await browser.newContext(),page=await owner.newPage(),clientPage=await clientContext.newPage()
 const email=`synthetic-plinth-mail-${Date.now()}@dev.localhost`
 await page.goto(ownerOpen.href);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 const invite=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:'Alex Mason',role:'member',returnTo:'/app'}});assert.equal(invite.status(),202)
 const entry=new URL(ownerOpen),hash=new URLSearchParams(fragment);hash.set('as',email);hash.set('next',`/auth/dev/enter?as=${encodeURIComponent(email)}&returnTo=/app`);entry.hash=hash.toString()
 await clientPage.goto(entry.href);await clientPage.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 const post=async(path,data)=>{const r=await owner.request.post(base+'/api/plinth'+path,{headers:{origin:base},data});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 let {job}=await post('/jobs',{name:'Mason kitchen remodel',client_email:email,address:'4518 Alder Avenue, Portland, OR 97211'})
 const act=async(path,body={})=>{const result=await post(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});job=(await (await owner.request.get(base+'/api/plinth/jobs/'+job.id)).json()).job;return result.record}
 await act('/quotes',{lines:[{description:'Agreed residential scope',quantity:1,unit_cents:48000000}]});await act(`/quotes/${job.quotes[0].id}/accept`,{method:'email',evidence:'Synthetic client accepted exact proposal',schedule_choice:{kind:'none',reason:'Schedule planned later'}})
 const selection=await act('/selections',{room:'Kitchen',category:'Tile finish',allowance_cents:750000,cost_code:'09-300',decision_on:'2026-11-04',lead_days:14,options:[{name:'Warm white porcelain',supplier:'Synthetic tile supply',specifications:'Matte, 12 by 24 inch',price_cents:640000}]})
 await act(`/selections/${selection.id}/present`,{revision_id:selection.revisions[0].id})
 const capture=async(p,name,check)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});if(check)await check();await p.evaluate(()=>scrollTo(0,0));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width);await p.screenshot({path:`${shots}/INT-007-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 // The office sends a required selection request, an optional update and a private note from the job's Messages tab.
 await page.goto(base+`/app?job=${job.id}&tab=Messages`)
 await expect(page.getByText('No messages yet.')).toBeVisible()
 await page.getByLabel('Kind').selectOption('selection_request');await page.getByRole('button',{name:'Send message',exact:true}).click()
 await expect(page.getByText('Selection needed',{exact:false}).or(page.getByText('Your decision is needed',{exact:false})).first()).toBeVisible()
 await expect(page.getByText('required message',{exact:false})).toBeVisible()
 await page.getByLabel('Kind').selectOption('update');await page.getByLabel('Subject').fill('Tile delivery timing');await page.getByLabel('Message',{exact:true}).fill('The tile is expected on site next Friday.');await page.getByRole('button',{name:'Send message',exact:true}).click()
 await expect(page.getByText('optional notice',{exact:false})).toBeVisible()
 await page.getByLabel('Kind').selectOption('note');await page.getByLabel('Note').fill('Client prefers the porcelain; confirm lead time with the supplier.');await page.getByRole('button',{name:'Save note',exact:true}).click()
 await expect(page.getByText('Private note: office only, never emailed')).toBeVisible()
 await capture(page,'office-thread',async()=>{await expect(page.getByText('Client prefers the porcelain',{exact:false})).toBeVisible()})
 // The client sees only the messages addressed to them, never the private note.
 await clientPage.goto(base+`/app?job=${job.id}&tab=Messages`)
 await expect(clientPage.getByRole('heading',{name:'Messages'})).toBeVisible()
 await expect(clientPage.getByText('Tile delivery timing')).toBeVisible();await expect(clientPage.getByText('Client prefers the porcelain',{exact:false})).toHaveCount(0);await expect(clientPage.getByRole('heading',{name:'Send a message'})).toHaveCount(0)
 await capture(clientPage,'client-thread',async()=>{await expect(clientPage.getByText('Tile delivery timing')).toBeVisible()})
 const contract=parseContract(await readFile(new URL('../../CONTRACT.md',import.meta.url),'utf8')),site=process.env.PLINTH_SITE;assert.ok(site)
 const publicContext=await browser.newContext(),publicPage=await publicContext.newPage();await publicPage.goto(site+'/contract')
 for(const width of [1440,390]){await publicPage.setViewportSize({width,height:1000});const row=publicPage.locator('tr.clause[data-id="INT-007"]');await expect(row).toHaveAttribute('data-status',contract.clauses.find(c=>c.id==='INT-007').status);assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Contract fits '+width);await row.screenshot({path:`${shots}/INT-007-contract-evidence-${width}.png`,animations:'disabled'})}
 await publicContext.close();await owner.close();await clientContext.close()
 console.log('INT-007 PASS: required and optional messages, private note, client-only thread; 1440/390')
}finally{await browser.close()}
