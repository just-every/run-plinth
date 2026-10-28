import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {nativeSignIn} from '../../scripts/verify/native-signin.mjs'
import {bidFollowUpFixture} from '../plinth/bid-follow-up-support.mjs'

const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&shots&&process.env.PLINTH_STATE)
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
try {
 const owner=await browser.newContext({storageState:process.env.PLINTH_STATE,viewport:{width:1440,height:1000}}),page=await owner.newPage(),contexts=new Map([['owner',owner]]),people=[]
 const json=async(path,{method='GET',body,cookie='owner'}={})=>{const r=await contexts.get(cookie).request.fetch(base+path,{method,headers:{origin:base},...(body?{data:body}:{})});return {status:r.status(),value:await r.json()}}
 for(let n=1;n<=4;n++) {
  const email=[`synthetic-plinth-${n}`,'example.invalid'].join('@'),cookie=`person-${n}`,name=n===4?'Synthetic estimator':`Synthetic window bidder ${n}`
  assert.equal((await json('/auth/invite',{method:'POST',body:{email,displayName:name,role:n===4?'admin':'member',returnTo:'/app'}})).status,202)
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=await context.newPage();await nativeSignIn(p,email);contexts.set(cookie,context);people.push({email,cookie,page:p,context})
 }
 const subs=people.slice(0,3),estimator=people[3],c=await bidFollowUpFixture({owner:'owner',json},{subs,estimator,clientEmail:['synthetic-plinth-5','example.invalid'].join('@'),due:'2026-10-26'})
 const url=base+`/app?job=${c.job.id}&tab=Bids`
 await page.goto(url)
 const record=page.locator('article[data-bid-id="'+c.id+'"]'),panel=record.getByRole('region',{name:'Procurement follow-up'})
 await record.getByText('Procurement settings',{exact:true}).click()
 await panel.getByLabel('Linked draft task',{exact:true}).selectOption('new')
 await panel.getByLabel('New draft task name',{exact:true}).fill('Install long-lead windows')
 await panel.getByLabel('New draft task date (UTC)',{exact:true}).fill('2026-11-26')
 await panel.getByLabel('Required on site (UTC)',{exact:true}).fill('2026-11-26')
 await panel.getByLabel('Material lead time (calendar days)',{exact:true}).fill('30')
 await panel.getByLabel('First acknowledgment reminder (UTC)',{exact:true}).fill('2026-10-25')
 await panel.getByLabel('Assigned estimator',{exact:true}).selectOption(c.person.id)
 await panel.getByRole('checkbox').check()
 await panel.getByRole('button',{name:'Approve procurement follow-up',exact:true}).click()
 await expect(panel.getByText('Required on site 2026-11-26 · 30 calendar days lead time · Order by 2026-10-27',{exact:true})).toBeVisible()
 await panel.getByRole('button',{name:'Check due bid reminders',exact:true}).click()
 await expect(panel.getByText('3 unresolved invitations',{exact:false})).toBeVisible()
 const inbox=async p=>{await p.goto(base+'/app');await p.locator('button.signout').waitFor({state:'attached'});await p.getByRole('button',{name:'Bid inbox',exact:true}).click();await expect(p.getByRole('heading',{name:'Bid inbox',exact:true})).toBeVisible()}
 await inbox(subs[0].page)
 const own=subs[0].page.locator('article[data-bid-id="'+c.id+'"]')
 await expect(own.getByText('Bid reminder: Submit the missing price',{exact:false})).toBeVisible()
 await own.getByRole('button',{name:'Acknowledge plan revision 1',exact:true}).click()
 await own.getByLabel('Bid price 08-100 (USD)',{exact:true}).fill('4500.00')
 await own.getByRole('button',{name:'Submit private priced response',exact:true}).click()
 await expect(own.getByText('Resolved — no further chase',{exact:false})).toHaveCount(2)
 await inbox(subs[2].page);const declining=subs[2].page.locator('article[data-bid-id="'+c.id+'"]')
 await declining.getByText('Decline this bid invitation',{exact:true}).click();await declining.getByLabel('Decline reason',{exact:true}).fill('Synthetic unavailable capacity');await declining.getByRole('button',{name:'Decline bid',exact:true}).click();await expect(declining.getByText('Declined: Synthetic unavailable capacity',{exact:false})).toBeVisible()
 await page.reload();await panel.getByRole('button',{name:'Check due bid reminders',exact:true}).click();await expect(panel.getByText('1 unresolved invitations',{exact:false})).toBeVisible()
 await c.refresh();const task=c.source.bids[0].follow_up.task_id,original=structuredClone(c.source.bids[0].invitations[0].reminders)
 let job=(await c.api(`/jobs/${c.job.id}`)).value.job
 assert.equal((await c.api(`/jobs/${c.job.id}/schedules/${task}/approve`,{expected_version:job.version})).value.error,'schedule_hold')
 await estimator.page.goto(url)
 const estimatorPanel=estimator.page.getByRole('region',{name:'Procurement follow-up'})
 await expect(estimatorPanel.getByText('1 unresolved invitations',{exact:false})).toBeVisible()
 await estimatorPanel.getByLabel('Procurement decision and remaining risk',{exact:true}).fill('Compared the received price; keep the remaining supplier on a private follow-up before ordering')
 await estimatorPanel.getByRole('button',{name:'Record procurement review',exact:true}).click()
 await expect(estimatorPanel.getByText('Reviewed by Synthetic estimator:',{exact:false})).toBeVisible()
 await c.refresh();assert.deepEqual(c.source.bids[0].invitations[0].reminders,original)
 job=(await c.api(`/jobs/${c.job.id}`)).value.job
 assert.equal((await c.api(`/jobs/${c.job.id}/schedules/${task}/approve`,{expected_version:job.version})).status,200)
 await page.reload()
 const capture=async(p,name)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});await p.evaluate(()=>scrollTo(0,0));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits');if(width===390){const menu=p.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')}await p.screenshot({path:`${shots}/BID-003-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 await capture(page,'owner-procurement');await capture(subs[0].page,'answered-bidder');await capture(estimator.page,'estimator-review')
 for(const context of contexts.values())await context.close()
 console.log('BID-003 PASS: approved long-lead window task, private deduplicated reminders, response and decline stop, remaining estimator escalation and reviewed start; 1440 and 390 proof')
} finally {await browser.close()}
