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
 const email=`synthetic-plinth-pay-${Date.now()}@dev.localhost`
 await page.goto(ownerOpen.href);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 const invite=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:'Alex Mason',role:'member',returnTo:'/app'}});assert.equal(invite.status(),202)
 const entry=new URL(ownerOpen),hash=new URLSearchParams(fragment);hash.set('as',email);hash.set('next',`/auth/dev/enter?as=${encodeURIComponent(email)}&returnTo=/app`);entry.hash=hash.toString()
 await clientPage.goto(entry.href);await clientPage.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 const post=async(path,data)=>{const r=await owner.request.post(base+'/api/plinth'+path,{headers:{origin:base},data});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 let {job}=await post('/jobs',{name:'Mason framing draws',client_email:email,address:'4518 Alder Avenue, Portland, OR 97211',time_zone:'America/Los_Angeles'})
 const act=async(path,body={})=>{const result=await post(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});job=(await (await owner.request.get(base+'/api/plinth/jobs/'+job.id)).json()).job;return result.record}
 await act('/quotes',{lines:[{id:'material',description:'Framing material',cost_code:'06-100',phase:'Framing',category:'material',quantity:'1',unit:'job',unit_cents:1000000,cost_unit_cents:750000},{id:'labor',description:'Framing labor',cost_code:'06-200',phase:'Framing',category:'labor',quantity:'1',unit:'job',unit_cents:1000000,cost_unit_cents:600000}]})
 const rate=(await post('/pricing-rates',{jurisdiction:'Human-reviewed synthetic jurisdiction',kind:'sales',percent:'10',effective_on:'2026-01-01',reference:'Reviewed synthetic taxable materials and labor exemption',human_reviewed:true})).rate
 const price={basis:'sell',as_of:'2026-10-21',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['material'],exemption_reference:'Reviewed labor exemption'}}
 const preview=await post(`/jobs/${job.id}/pricing/preview`,{expected_version:job.version,...price});await act('/pricing/apply',{...price,digest:preview.preview.digest})
 await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Externally signed contract with fixed draws',schedule_choice:{kind:'none',reason:'Schedule planned later'}});await act('/sov',{})
 const draft=await act('/invoices',{kind:'deposit',description:'Draw 1: framing',amount_cents:200000,recipient_email:email,due_on:'2026-11-15',terms:'Card or bank transfer through the hosted checkout'});await act(`/invoices/${draft.id}/issue`)
 const capture=async(p,name,check)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});if(check)await check();await p.evaluate(()=>scrollTo(0,0));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width);await p.screenshot({path:`${shots}/PAY-001-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 // The office sees the online-payments record; the client sees the authorization and the single confirm before leaving for Stripe.
 await page.goto(base+`/app?job=${job.id}&tab=Billing`)
 await expect(page.getByRole('heading',{name:'Online payments'})).toBeVisible();await expect(page.getByText('No online payment started yet.')).toBeVisible()
 await capture(page,'office-payments',async()=>{await expect(page.getByText('Stripe holds the funds and the card or bank details',{exact:false})).toBeVisible()})
 await clientPage.goto(base+`/app?job=${job.id}&tab=Billing`)
 await clientPage.locator('summary',{hasText:'Draw 1: framing'}).first().click()
 const form=clientPage.getByRole('region',{name:/Pay invoice/});await expect(form.getByRole('heading',{name:'Pay this invoice'})).toBeVisible()
 await expect(form.getByText('No processing fee is added to your payment',{exact:false})).toBeVisible()
 const confirm=form.getByRole('checkbox');await expect(confirm).toHaveAttribute('required','')
 await expect(form.getByText('never reach Plinth',{exact:false})).toBeVisible();await expect(form.getByRole('button',{name:/Pay \$2,000\.00 with card or bank/})).toBeVisible()
 await capture(clientPage,'client-pay',async()=>{await expect(form.getByRole('button',{name:/Pay \$2,000\.00/})).toBeVisible()})
 const contract=parseContract(await readFile(new URL('../../CONTRACT.md',import.meta.url),'utf8')),site=process.env.PLINTH_SITE;assert.ok(site)
 const publicContext=await browser.newContext(),publicPage=await publicContext.newPage();await publicPage.goto(site+'/contract')
 for(const width of [1440,390]){await publicPage.setViewportSize({width,height:1000});const row=publicPage.locator('tr.clause[data-id="PAY-001"]');await expect(row).toHaveAttribute('data-status',contract.clauses.find(c=>c.id==='PAY-001').status);assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Contract fits '+width);await row.screenshot({path:`${shots}/PAY-001-contract-evidence-${width}.png`,animations:'disabled'})}
 await publicContext.close();await owner.close();await clientContext.close()
 console.log('PAY-001 PASS: office payment record and the client authorization before Stripe; 1440/390')
}finally{await browser.close()}
