// BILL-003 installed Billing controls: two draws, substantial and final evidence-bound releases.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
const base=process.env.PLINTH_URL,state=process.env.PLINTH_STATE,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&state&&shots,'Set PLINTH_URL, PLINTH_STATE and PLINTH_SCREENSHOTS outside the repository')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
try {
 const context=await browser.newContext({storageState:state}),page=await context.newPage()
 const request=async(path,body)=>{const r=await context.request.fetch(base+'/api/plinth'+path,{method:body===undefined?'GET':'POST',headers:{origin:base,'content-type':'application/json'},...(body===undefined?{}:{data:body})});const value=await r.json();assert.ok(r.ok(),`${path}: ${r.status()} ${JSON.stringify(value)}`);return value}
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1100})
  let job=(await request('/jobs',{name:`Maple Street whole-home renovation · retainage ${width} · ${Date.now()}`,client_email:'client@dev.localhost',address:'2480 Maple Street, Burlington, VT 05401'})).job
  const act=async(path,body={})=>{const result=await request(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});if(result.job)job=result.job;return result}
  const read=async()=>job=(await request(`/jobs/${job.id}`)).job
  const names=['Framing materials and installation','Whole-home remodeling labor']
  await act('/quotes',{lines:names.map((description,i)=>({id:i?'labor':'framing',description,cost_code:i?'01-100':'06-100',phase:'Remodel',category:i?'labor':'material',quantity:'1',unit:'job',unit_cents:i?30000000:18000000,cost_unit_cents:i?21000000:12000000}))})
  const rate=(await request('/pricing-rates',{jurisdiction:'Reviewed Vermont remodel exemption',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'Builder-reviewed contract tax schedule',human_reviewed:true})).rate
  const pricing={basis:'sell',as_of:'2026-10-20',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['framing','labor']}}
  const preview=await act('/pricing/preview',pricing);await read();await act('/pricing/apply',{...pricing,digest:preview.preview.digest})
  await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Client returned signed Maple Street agreement, recorded externally',schedule_choice:{kind:'none',reason:'Superintendent will approve construction dates separately'}})
  await act('/sov',{})
  await act('/orders',{supplier:'Maple Lumber and Millwork',description:'Framing package for Maple Street renovation',amount_cents:6000000})
  const order=job.orders.at(-1);await act(`/orders/${order.id}/issue`);await act(`/orders/${order.id}/receive`,{amount_cents:3000000,reference:'Delivery ticket ML-204, original at site office'})
  const supplier=(await request('/vendors',{kind:'subcontractor',name:`Champlain Framing ${width}`,trades:['Framing'],contacts:[]})).vendor
  await request(`/vendors/${supplier.id}/qualifications`,{expected_version:supplier.version,trade:'Framing',status:'qualified',evidence:'Builder reviewed framing qualifications and prior projects'})
  const scope=(await act('/subcontracts',{vendor_id:supplier.id,trade:'Framing',scope:'Framing labor and final closeout',contact_ids:[],awarded_on:'2026-10-20',amount_cents:8000000})).record
  await act(`/subcontracts/${scope.id}/release`);await act(`/subcontracts/${scope.id}/lien`,{state:'VT'})
  const supplierPath=`/subcontracts/${scope.id}/retainage`
  await act(supplierPath,{contract_reference:'Signed Champlain Framing subcontract section 12',rate_bps:500,milestones:[{id:'substantial',name:'Substantial completion',completion_requirements:['Framing completion inspection'],waiver_requirements:[]},{id:'final',name:'Final completion',final:true,completion_requirements:['Final framing inspection'],waiver_requirements:['Signed framing final waiver']}]})
  const supplierDraw=(await act(`/subcontracts/${scope.id}/draws`,{through_date:'2026-10-20',amount_cents:3200000})).record
  await page.goto(base+`/app?job=${job.id}&tab=Billing`);await page.getByRole('heading',{name:'Pay applications',exact:true}).waitFor()
  const open=async text=>{const summary=page.locator('summary').filter({hasText:new RegExp('^'+text+'$')});if(!await summary.evaluate(s=>s.parentElement.open))await summary.click()}
  const shot=async(label,locator)=>{await locator.scrollIntoViewIfNeeded();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`BILL-003 ${width} page fits`);await page.screenshot({path:`${shots}/BILL-003-${label}-${width}.png`,animations:'disabled'})}
  await open('Client retainage')
  await page.getByLabel('Signed contract retainage reference',{exact:true}).fill('Signed Maple Street agreement section 9, 20 October 2026')
  for(let i=0;i<2;i++){await page.getByLabel('Work retainage percent: '+names[i],{exact:true}).fill(i?'10':'5');await page.getByLabel('Stored retainage percent: '+names[i],{exact:true}).fill(i?'0':'10')}
  await page.getByLabel('Substantial completion requirements (one per line)',{exact:true}).fill('Architect substantial-completion record')
  await page.getByLabel('Final completion requirements (one per line)',{exact:true}).fill('Final inspection certificate')
  await page.getByLabel('Final waiver requirements (one per line)',{exact:true}).fill('Signed final waiver packet')
  await shot('terms',page.getByRole('button',{name:'Approve retainage terms',exact:true}))
  await page.getByRole('button',{name:'Approve retainage terms',exact:true}).click();await expect(page.getByText(/terms revision 1/)).toBeVisible();await read()
  const draw=async(label,completed,stored)=>{
   await page.getByLabel('Application description',{exact:true}).fill(label)
   for(let i=0;i<2;i++){await page.getByLabel('Completed to date: '+names[i],{exact:true}).fill(String(completed[i]));await page.getByLabel('Stored materials: '+names[i],{exact:true}).fill(String(stored[i]));await page.getByLabel('Progress evidence: '+names[i],{exact:true}).fill('Superintendent reviewed progress and delivery ticket ML-204')}
   const selectors=page.locator('select[name$="-orders"]');await selectors.nth(0).selectOption(stored[0]?order.id:'');await selectors.nth(1).selectOption('')
   await page.getByRole('button',{name:'Prepare SOV application',exact:true}).click()
   const article=page.locator('article.record').filter({has:page.getByRole('heading',{name:label,exact:true})})
   await article.getByRole('button',{name:'Approve pay app',exact:true}).click();await article.getByRole('button',{name:'Issue payment application',exact:true}).click();await article.getByRole('link',{name:'Open printable application',exact:true}).waitFor();await read();return article
  }
  let article=await draw('Draw 1 · demolition and rough framing',[60000,40000],[20000,0])
  assert.equal(job.retainage_balance.held_cents,900000);await shot('first-draw',article.getByText('Client retainage remaining',{exact:true}))
  article=await draw('Draw 2 · substantial completion',[120000,150000],[10000,0]);assert.equal(job.retainage_balance.held_cents,2200000)
  await open('Client retainage');await open('Substantial completion release')
  const partial=page.getByRole('button',{name:'Approve substantial completion release',exact:true}).locator('..')
  await partial.getByLabel('Release USD: '+names[0],{exact:true}).fill('2000');await partial.getByLabel('Release USD: '+names[1],{exact:true}).fill('8000')
  await partial.getByLabel('Completion evidence reference',{exact:true}).fill('Architect signed substantial-completion record SC-204')
  await partial.getByLabel('Completion: Architect substantial-completion record',{exact:true}).fill('SC-204 signed original retained by builder')
  await partial.getByRole('button',{name:'Approve substantial completion release',exact:true}).click();await expect(page.getByRole('heading',{name:'Substantial completion release',exact:true})).toBeVisible();await read()
  assert.equal(job.retainage_balance.cumulative_released_cents,1000000);assert.equal(job.retainage_balance.held_cents,1200000)
  await shot('partial-release',page.getByRole('heading',{name:'Substantial completion release',exact:true}))
  await act(supplierPath+'/release',{draw_id:supplierDraw.id,milestone_id:'substantial',lines:[{draw_id:supplierDraw.id,amount_cents:80000}],completion_references:[{requirement:'Framing completion inspection',reference:'Signed framing completion inspection F-204'}],waiver_references:[]})
  assert.equal(job.subcontracts[0].retainage_balance.held_cents,80000);assert.equal(job.retainage_balance.held_cents,1200000)
  await page.reload();await open('Client retainage')
  await shot('supplier-partial',page.getByRole('heading',{name:'Supplier retainage · '+supplier.name,exact:true}))

  await page.reload();await open('Client retainage');await expect(page.getByRole('heading',{name:'Substantial completion release',exact:true})).toBeVisible()
  article=await draw('Draw 3 · final construction completion',[180000,300000],[0,0]);await open('Client retainage');await open('Final completion release')
  const final=page.getByRole('button',{name:'Approve final completion release',exact:true}).locator('..')
  await final.getByLabel('Release USD: '+names[0],{exact:true}).fill('7000');await final.getByLabel('Release USD: '+names[1],{exact:true}).fill('22000')
  await final.getByLabel('Completion evidence reference',{exact:true}).fill('Architect final inspection FI-228')
  await final.getByLabel('Final waiver evidence reference',{exact:true}).fill('Reviewed signed final waiver packet WP-228')
  await final.getByLabel('Completion: Final inspection certificate',{exact:true}).fill('FI-228 signed original retained by builder')
  await final.getByLabel('Waiver: Signed final waiver packet',{exact:true}).fill('WP-228 signed originals retained in company custody')
  await final.getByRole('button',{name:'Approve final completion release',exact:true}).click();await expect(page.getByRole('heading',{name:'Final completion release',exact:true})).toBeVisible();await read()
  assert.equal(job.retainage_balance.held_cents,0);assert.equal(job.retainage_balance.cumulative_net_cents,48000000);assert.equal(job.orders[0].amount_cents,6000000)
  const supplierFinal=(await act(`/subcontracts/${scope.id}/draws`,{through_date:'2026-11-20',amount_cents:4800000,final:true})).record
  await act(supplierPath+'/release',{draw_id:supplierFinal.id,milestone_id:'final',lines:[{draw_id:supplierDraw.id,amount_cents:80000},{draw_id:supplierFinal.id,amount_cents:240000}],completion_references:[{requirement:'Final framing inspection',reference:'Signed final framing inspection F-228'}],waiver_references:[{requirement:'Signed framing final waiver',reference:'Reviewed signed final framing waiver FW-228'}]})
  assert.equal(job.subcontracts[0].retainage_balance.held_cents,0);assert.equal(job.retainage_balance.held_cents,0)
  await page.reload();await open('Client retainage');await shot('final-balance',page.getByText('Client retainage remaining',{exact:true}).last());await shot('final-evidence',page.getByRole('heading',{name:'Final completion release',exact:true}));await shot('supplier-final',page.getByRole('heading',{name:'Supplier retainage · '+supplier.name,exact:true}))
  const first=job.claims.find(c=>c.description.startsWith('Draw 1'))
  const printable=await context.newPage();await printable.goto(base+`/api/plinth/jobs/${job.id}/claims/${first.id}/application.html`);await printable.setViewportSize({width,height:1100});await expect(printable.getByRole('heading',{name:'Client retainage',exact:true})).toBeVisible();assert.equal((await request(`/jobs/${job.id}/claims/${first.id}/application.json`)).application.retainage.held_cents,900000);await printable.getByRole('heading',{name:'Client retainage',exact:true}).scrollIntoViewIfNeeded();await printable.screenshot({path:`${shots}/BILL-003-fixed-issued-${width}.png`,animations:'disabled'});await printable.close()
 }
 const site=process.env.PLINTH_SITE;assert.ok(site,'BILL-003 public site must be available')
 const publicPage=await context.newPage()
 for(const [path,label] of [['/contract','contract'],['/docs/agent-commands','commands']]){
  await publicPage.goto(site+path)
  for(const width of [1440,390]){await publicPage.setViewportSize({width,height:1100});const target=label==='contract'?publicPage.getByText('BILL-003',{exact:true}).first():publicPage.getByRole('heading',{name:'Client retainage (BILL-003)',exact:true});await target.scrollIntoViewIfNeeded();await publicPage.screenshot({path:`${shots}/BILL-003-${label}-${width}.png`,animations:'disabled'})}
 }
 await publicPage.close()
 await context.close();console.log('BILL-003 installed Billing terms, two draws, partial/final releases, persisted balances and fixed issued artifacts passed at 1440 and 390')
} finally {await browser.close()}
