// SCH-002: use the real installed workspace; fixture records enter through authenticated HTTP.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
const base = process.env.PLINTH_URL, state = process.env.PLINTH_STATE, clientState = process.env.PLINTH_CLIENT_STATE, shots = process.env.PLINTH_SCREENSHOTS
assert.ok(base && state && clientState && shots, 'Set installation URL, private owner/client storage states and an external screenshot directory')
await mkdir(shots, {recursive:true})
const browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
try {
 const context = await browser.newContext({storageState:state,viewport:{width:1440,height:1100}}), clientContext = await browser.newContext({storageState:clientState,viewport:{width:390,height:1100}})
 const page = await context.newPage(), clientPage = await clientContext.newPage()
 const clientSession = await (await clientContext.request.get(base+'/auth/session')).json(), email = clientSession.operator.email
 const capture=async(phase,p=page) => {
  for(const width of [1440,390]) {await p.setViewportSize({width,height:1100});await p.waitForTimeout(250);await p.evaluate(()=>scrollTo(0,0));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.screenshot({path:`${shots}/SCH-002-${phase}-${width}.png`,fullPage:true,animations:'disabled'})}
 }
 const post = async(path,body) => {const response=await context.request.post(base+'/api/plinth'+path,{headers:{origin:base},data:body});assert.ok(response.ok(),path+' '+await response.text());return response.json()}
 const active = async(name) => {
  let {job} = await post('/jobs',{name,client_email:email,address:'2480 Maple Street, Burlington, VT 05401'})
  let result = await post(`/jobs/${job.id}/quotes`,{expected_version:job.version,lines:[{description:'Fixed-price whole-home remodel',quantity:1,unit_cents:48_000_000}]});job=result.job
  result = await post(`/jobs/${job.id}/quotes/${job.quotes[0].id}/accept`,{expected_version:job.version,method:'signed',evidence:'Signed remodel agreement returned by the household'});return result.job
 }
 const stamp=Date.now(), source=await active('SCH-002 template source '+stamp)
 const calendar={weekdays:[1,2,3,4,5],start_hour:8,end_hour:17,holidays:[]}
 const tasks=[{id:crypto.randomUUID(),description:'Framing after lumber delivery',trade:'Maple framing / '+stamp,owner:'Alex Rivera',start:'2026-11-02T08:00:00Z',duration_minutes:540},{id:crypto.randomUUID(),description:'Final inspection and client handover',trade:'City inspector / '+stamp,owner:'Alex Rivera',start:'2026-11-02T08:00:00Z',duration_minutes:60}]
 tasks[1].predecessors=[{id:tasks[0].id,lag_minutes:0}]
 let result=await post(`/jobs/${source.id}/schedule/preview`,{expected_version:source.version,calendar,tasks})
 await post(`/jobs/${source.id}/schedule/publish`,{expected_version:source.version,calendar,tasks:result.preview.tasks,digest:result.preview.digest})
 await page.goto(`${base}/app?job=${source.id}&tab=Schedule`)
 await page.getByText('Save this job’s published schedule as a template',{exact:true}).click()
 const templateName='Residential remodel '+stamp
 await page.getByLabel('New template name',{exact:true}).fill(templateName)
 await page.getByLabel('Template purpose',{exact:true}).fill('Approved framing-to-inspection sequence reused when a remodel sells')
 await capture('template-editor')
 await page.getByRole('button',{name:'Save schedule template',exact:true}).click()
 await expect(page.getByLabel('Schedule template',{exact:true})).toContainText(templateName)
 const template = (await (await context.request.get(base+'/api/plinth/schedule-templates')).json()).templates.find(template => template.name === templateName)
 // A second accepted job adopts the template; the published source remains unchanged.
 const job=await active('Alvarez household remodel — original promise and lumber-delay recovery '+stamp)
 await page.goto(`${base}/app?job=${job.id}&tab=Schedule`)
 const templateSelect=page.getByLabel('Schedule template',{exact:true})
 await expect(templateSelect).toContainText(templateName)
 await templateSelect.selectOption({label:templateName+' · v1'})
 await page.getByLabel('Template start (UTC)',{exact:true}).fill('2026-11-09T08:00')
 await page.getByRole('button',{name:'Preview template dates',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Review schedule before publishing'})).toBeVisible()
 await page.getByRole('button',{name:'Publish reviewed schedule',exact:true}).click()
 await expect(page.getByText(/2 tasks · Published dates/)).toBeVisible()
 await page.getByText('Approve a named schedule baseline',{exact:true}).click()
 await page.getByLabel('Baseline name',{exact:true}).fill('Original client promise')
 await page.getByLabel('Baseline reason',{exact:true}).fill('Dates agreed with the client when the signed remodel sold')
 await capture('baseline-editor')
 await page.getByRole('button',{name:'Approve schedule baseline',exact:true}).click()
 await expect(page.getByLabel('Compare with baseline',{exact:true})).toContainText('Original client promise')
 await page.getByLabel('Actual work task',{exact:true}).selectOption({label:'Framing after lumber delivery'})
 await page.getByLabel('Actual start (UTC)',{exact:true}).fill('2026-11-10T08:00')
 await page.getByLabel('Actual finish (UTC)',{exact:true}).fill('2026-11-12T10:00')
 const privateEvidence='Office-only receipt and site photograph reference '+stamp
 await page.getByLabel('Evidence',{exact:true}).fill(privateEvidence)
 await page.getByRole('button',{name:'Record actual work',exact:true}).click()
 await expect(page.getByRole('list',{name:'Schedule baseline and actual variance'})).toContainText('1440 elapsed minutes later')
 await clientPage.goto(`${base}/app?job=${job.id}&tab=Schedule`)
 await expect(clientPage.getByRole('heading',{name:'Baselines, forecasts and actual work',exact:true})).toBeVisible()
 await expect(clientPage.getByRole('list',{name:'Schedule baseline and actual variance'})).not.toContainText('1440 elapsed minutes later')
 await expect(clientPage.locator('body')).not.toContainText(privateEvidence)
 await page.getByRole('button',{name:'Preview schedule',exact:true}).click()
 await expect(page.getByRole('list',{name:'Schedule baseline and actual variance'})).toContainText('3000 elapsed minutes later')
 await page.getByLabel('Schedule revision name',{exact:true}).fill('Lumber delay recovery')
 await page.getByLabel('Schedule revision reason',{exact:true}).fill('Framing completed after delayed lumber; inspection now follows the recorded completion')
 await capture('actual-forecast-review')
 await page.getByRole('button',{name:'Publish reviewed schedule',exact:true}).click()
 await expect(page.getByText(/2 tasks · Published dates/)).toBeVisible()
 await page.getByText('Named schedule revisions',{exact:true}).click()
 const revisions=page.getByText('Named schedule revisions',{exact:true}).locator('..')
 await expect(revisions).toContainText('Lumber delay recovery')
 await revisions.getByText('Authorizing decision',{exact:true}).click()
 await expect(revisions).toContainText('Alex Rivera')
 const decision = JSON.parse(await revisions.locator('pre').innerText())
 assert.equal(decision.before.tasks.find(task => task.description === 'Final inspection and client handover').end, '2026-11-10T09:00:00.000Z')
 assert.equal(decision.after.tasks.find(task => task.description === 'Final inspection and client handover').end, '2026-11-12T11:00:00.000Z')
 await page.getByText('Approved baseline history',{exact:true}).click()
 await expect(page.getByText('Approved baseline history',{exact:true}).locator('..')).toContainText('Original client promise')
 await capture('published-history')
 await clientPage.reload()
 await expect(clientPage.getByRole('list',{name:'Schedule baseline and actual variance'})).toContainText('1440 elapsed minutes later')
 await expect(clientPage.locator('body')).not.toContainText(privateEvidence)
 await expect(clientPage.getByRole('button',{name:'Record actual work',exact:true})).toHaveCount(0)
 await capture('client-approved-times',clientPage)
 await page.reload()
 await expect(page.getByRole('list',{name:'Schedule baseline and actual variance'})).toContainText('Original client promise')
 await page.getByLabel('Schedule template',{exact:true}).selectOption({label:templateName+' · v1'})
 await page.getByText('Revise template from this job’s published tasks',{exact:true}).click()
 await page.getByLabel('Template revision name',{exact:true}).fill('Reviewed after lumber delivery')
 await page.getByLabel('Template revision reason',{exact:true}).fill('Carry the superintendent’s revised sequence into future sales')
 await capture('template-revision-editor')
 await page.getByRole('button',{name:'Save template revision',exact:true}).click()
 await expect(page.getByLabel('Schedule template',{exact:true})).toContainText(templateName+' · v2')
 const revised = await (await context.request.get(base+'/api/plinth/schedule-templates/'+template.id)).json()
 assert.deepEqual(revised.template.tasks.map(task=>task.id),template.tasks.map(task=>task.id),'Revising a template from its applied job preserves original local task identities')
 await page.locator('summary').filter({hasText:/^Archive template$/}).click()
 await page.getByLabel('Archive revision name',{exact:true}).fill('Retired after process review')
 await page.getByLabel('Archive reason',{exact:true}).fill('Use a future approved remodel sequence for new sales')
 await capture('archive-editor')
 await page.getByRole('button',{name:'Archive template',exact:true}).click()
 await expect(page.getByLabel('Schedule template',{exact:true})).toContainText('Archived')
 await capture('archived-template')
 console.log('SCH-002 browser journey passed at 1440 and 390: template reuse on sale, original baseline, actual evidence, forecast review, named publication and private client projection')
 await context.close();await clientContext.close()
} finally {await browser.close()}
