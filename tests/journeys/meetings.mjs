import { attachmentTranscription } from './attachment-transcription.mjs'
import { sharingJourney } from './meeting-sharing.mjs'
import { meetingCorrespondence } from './meeting-mail.mjs'
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {nativeSignIn} from '../../scripts/verify/native-signin.mjs'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&shots)
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))
const state=process.env.PLINTH_STATE,entrance=state?undefined:process.env.PLINTH_OWNER_OPEN??(await readFile('.rer/local/open-url','utf8')).trim()
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
await mkdir(shots,{recursive:true})
try {
 const owner=await browser.newContext(state?{storageState:state}:{}),client=await browser.newContext(),page=await owner.newPage(),clientPage=await client.newPage()
 await page.goto(state?base+'/app':entrance);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))
 if(new URL(page.url()).pathname==='/setup'){await page.getByLabel('Your name',{exact:true}).fill('Synthetic Plinth builder');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Finish setup',exact:true}).click();await page.waitForURL('**/app')}
 const team=await (await owner.request.get(base+'/api/plinth/team')).json(),ownerEmail=team.team.find(p=>p.role==='owner').email
 const email=`synthetic-plinth-meetings-${Date.now()}@dev.localhost`
 assert.equal((await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:'Alex Mason',role:'member',returnTo:'/app'}})).status(),202)
 if(state)await nativeSignIn(clientPage,email)
 else{const clientEntrance=new URL(entrance),hash=new URLSearchParams(clientEntrance.hash.slice(1));hash.set('as',email);hash.set('next',`/auth/dev/enter?as=${encodeURIComponent(email)}&returnTo=/app`);clientEntrance.hash=hash.toString();await clientPage.goto(clientEntrance.href);await clientPage.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'))}
 const post=async(path,data)=>{const r=await owner.request.post(base+'/api/plinth'+path,{headers:{origin:base},data});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 let {job}=await post('/jobs',{name:'Mason kitchen and mudroom remodel',client_email:email,address:'4518 Alder Avenue, Portland, OR 97211'})
 const act=async(path,data={})=>{const r=await post(`/jobs/${job.id}${path}`,{expected_version:job.version,...data});job=(await(await owner.request.get(base+'/api/plinth/jobs/'+job.id)).json()).job;return r.record}
 await act('/quotes',{lines:[{description:'Kitchen cabinetry, plumbing and residential remodel',quantity:1,unit_cents:48000000}]});await act(`/quotes/${job.quotes[0].id}/accept`,{method:'email',evidence:'Synthetic reviewed client acceptance',schedule_choice:{kind:'none',reason:'Schedule planned separately'}})
 const selection=await act('/selections',{room:'Kitchen',category:'Cabinet finish',allowance_cents:750000,cost_code:'06-400',decision_on:'2026-11-04',lead_days:14,options:[{name:'Natural oak',supplier:'Synthetic cabinet supply',specifications:'Matte clear finish',price_cents:640000}]})
 const capture=async(p,name)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});await p.waitForTimeout(400);await p.evaluate(()=>scrollTo(0,0));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width);for(const control of await p.locator('button:visible').all()){const label=(await control.innerText()).trim();if(!label){const tip=await control.getAttribute('data-tip');assert.ok(tip&&tip.split(' ').length>=2&&tip.split(' ').length<=4,'Icon control has a short tooltip');await control.hover();await p.waitForTimeout(350);await expect.poll(()=>control.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible');await p.keyboard.press('Tab');await control.focus();await expect.poll(()=>control.evaluate(el=>getComputedStyle(el,'::after').visibility)).toBe('visible')}}await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await p.screenshot({path:`${shots}/DOC-005-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 const searchTerm='synthetic-plinth-combined-9401'
 const {inbound,captured}=await meetingCorrespondence({base,page,owner,job,email,post,capture,searchTerm})
 await page.goto(base+`/app?job=${job.id}&tab=Meetings`)
 await page.getByLabel('Meeting title',{exact:true}).fill('Kitchen site meeting');await page.getByLabel('Meeting date',{exact:true}).fill('2026-10-26');await page.getByLabel('Attendees, separated by commas').fill('Alex Mason, Builder, Plumbing foreman');await page.getByLabel('Agenda',{exact:true}).fill('Cabinet finish and plumbing clearances');await page.getByLabel('Minutes',{exact:true}).fill('Reviewed the oak sample and service clearances on site.');await page.getByRole('textbox',{name:'Decisions',exact:true}).fill('Natural oak confirmed, subject to the final client drawing. '+searchTerm);await page.getByLabel('Tags, separated by commas').fill('cabinetry');await page.getByLabel('Sheet',{exact:true}).fill('A-201');await page.getByLabel('Cost code',{exact:true}).fill('06-400');await page.getByLabel('Assigned action',{exact:true}).fill('Record resolved cabinet finish');await page.getByLabel('Action owner email',{exact:true}).fill(ownerEmail);await page.getByLabel('Due date',{exact:true}).fill('2026-11-03');await page.getByRole('button',{name:'Record meeting',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Kitchen site meeting',exact:true})).toBeVisible();await capture(page,'meeting-open')
 await page.getByText('Complete assigned action',{exact:true}).click();await page.getByLabel('Resolved answer',{exact:true}).fill('Natural oak confirmed from the reviewed drawing.');await page.locator('select[name=work]').selectOption(`selection:${selection.id}`);await page.locator('select[name=message_id]').selectOption(inbound.id);await page.getByRole('button',{name:'Complete action',exact:true}).click();await expect(page.getByText('Natural oak confirmed from the reviewed drawing.',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Retained selection answer source'})).toBeVisible();await capture(page,'meeting-completed')
 await page.getByRole('button',{name:'Decision search',exact:true}).click();await page.getByLabel('Search text',{exact:true}).fill('Natural oak confirmed');await page.getByLabel('Tag',{exact:true}).fill('cabinetry');await page.getByLabel('Sheet',{exact:true}).fill('A-201');await page.getByLabel('Cost code',{exact:true}).fill('06-400');await page.getByRole('button',{name:'Search decisions',exact:true}).click();await expect(page.getByText('1 matching records',{exact:true})).toBeVisible();await capture(page,'decision-search')
 await page.getByLabel('Search text',{exact:true}).fill('service-clearance-2418');for(const label of ['Tag','Sheet','Cost code'])await page.getByLabel(label,{exact:true}).fill('');await page.getByRole('button',{name:'Search decisions',exact:true}).click();await expect(page.getByText('1 matching records',{exact:true})).toBeVisible();await expect(page.getByText('File text: complete',{exact:true})).toBeVisible()
 await page.getByText('Index metadata',{exact:true}).click();await page.getByLabel('Source tags, separated by commas',{exact:true}).fill('cabinetry');await page.getByLabel('Source sheet',{exact:true}).fill('A-201');await page.getByLabel('Source cost code',{exact:true}).fill('06-400');await page.getByRole('button',{name:'Save source metadata',exact:true}).click();await expect(page.getByText('Saved.',{exact:true})).toBeVisible()
 await page.getByLabel('Tag',{exact:true}).fill('cabinetry');await page.getByLabel('Sender',{exact:true}).fill(email);await page.getByLabel('Sheet',{exact:true}).fill('A-201');await page.getByLabel('Cost code',{exact:true}).fill('06-400');await page.getByRole('button',{name:'Search decisions',exact:true}).click();await expect(page.getByText('1 matching records',{exact:true})).toBeVisible();await capture(page,'attachment-content-and-metadata')
 for(const source of ['correspondence:'+captured.id,'files:'+captured.files[0].id]){const result=await owner.request.post(base+`/api/plinth/jobs/${job.id}/decision-search/metadata`,{headers:{origin:base},data:{source,tags:['cabinetry'],sheet:'A-201',cost_code:'06-400'}});assert.equal(result.status(),200)}
 await page.getByLabel('Search text',{exact:true}).fill('synthetic-plinth-private-bid-878');await page.getByLabel('Sender',{exact:true}).fill('synthetic-plinth-sub@example.com');await page.getByRole('button',{name:'Search decisions',exact:true}).click();await expect(page.getByText('1 matching records',{exact:true})).toBeVisible();await capture(page,'private-bid-content')
 await clientPage.goto(base+`/app?job=${job.id}&tab=Decision%20search`);await clientPage.getByLabel('Search text',{exact:true}).fill('synthetic-plinth-private-bid-878');await clientPage.getByRole('button',{name:'Search decisions',exact:true}).click();await expect(clientPage.getByText('0 matching records',{exact:true})).toBeVisible();await expect(clientPage.getByText('Private millwork subcontractor bid',{exact:false})).toHaveCount(0);for(const path of [`/correspondence/files/${captured.files[0].id}`,`/correspondence/${captured.id}/original`])assert.equal((await client.request.get(base+`/api/plinth/jobs/${job.id}`+path)).status(),404);await capture(clientPage,'client-private-search')
 await combinedSearch({base,page,owner,job,email,post,capture,inbound,selection,searchTerm})
 await attachmentTranscription({base,page,clientPage,owner,client,job,capture})
 await clientPage.goto(base+`/app?job=${job.id}&tab=Meetings`);await expect(clientPage.getByRole('heading',{name:'Shared meeting decisions',exact:true})).toBeVisible();assert.equal((await client.request.get(base+`/api/plinth/jobs/${job.id}/meetings`)).status(),403);await expect(clientPage.getByRole('heading',{name:'Kitchen site meeting',exact:true})).toHaveCount(0);await capture(clientPage,'meeting-permission-failure')
 const currentMeetings=(await(await owner.request.get(base+`/api/plinth/jobs/${job.id}/meetings`)).json()).meetings
 await sharingJourney({base,entrance,browser,page,clientPage,owner,client,job,meeting:currentMeetings[0],ownerEmail,email,selection,capture})
 await owner.close();await client.close();console.log('DOC-005 PASS: installed Worker inbound email and original PDF, private bid capture, metadata and full embedded-text search, assigned completion and retained work source, reviewed audience-safe sharing, recipient consent, owner email review, orphan recovery and client and field revocation; 1440 and 390')
} catch(error) { for(const context of browser.contexts())for(const failed of context.pages())if(new URL(failed.url()).origin===base&&new URL(failed.url()).pathname==='/app'){await failed.screenshot({path:`${shots}/DOC-005-failure-${context===browser.contexts()[0]?'owner':'recipient'}.png`,fullPage:true});await writeFile(`${shots}/DOC-005-failure.txt`,await failed.locator('body').innerText());break}throw error } finally {await browser.close()}

/** The installed search reconciles five populated source types under intersecting filters. */
async function combinedSearch({base,page,owner,job,email,post,capture,inbound,selection,searchTerm}) {
 const root='/jobs/'+job.id
 const current=async()=> (await(await owner.request.get(base+'/api/plinth'+root)).json()).job
 const act=async(path,input)=>{const source=await current();return post(root+path,{expected_version:source.version,...input})}
 let source=await current()
 const comment=(await act('/selections/'+selection.id+'/comment',{revision_id:source.selections[0].revisions[0].id,text:'Reviewed selection comment '+searchTerm})).record.comments.at(-1)
 await act('/rfi-access',{email,role:'designer',sheet_ids:[]})
 const rfi=(await act('/rfis',{title:'Cabinet service clearance',question:'Confirm the revised service clearance',assignee_email:email,recipient_emails:[],task_ids:[],due_on:'2026-11-04'})).record
 const response=(await act('/rfis/'+rfi.id+'/respond',{text:'Reviewed service clearance response '+searchTerm,cost_impact_cents:0,date_impact_days:0})).record.responses.at(-1)
 await act('/rfis/'+rfi.id+'/publish',{response_id:response.id,cost_impact_cents:0,date_impact_days:0,confirm:true})
 const meeting=(await current()).meetings[0]
 const expected=['meetings:'+meeting.id,'correspondence:'+inbound.id,'comments:'+comment.id,'rfi-responses:'+response.id,'files:'+inbound.files[0].id]
 for(const id of [expected[1],expected[2]])await post(root+'/decision-search/metadata',{source:id,tags:['cabinetry'],sheet:'A-201',cost_code:'06-400'})
 await post(root+'/decision-search/metadata',{source:expected[3],tags:['design'],sheet:'A-202',cost_code:'08-500'})
 const find=async filters=>{const r=await owner.request.get(base+'/api/plinth'+root+'/decision-search?'+new URLSearchParams({q:searchTerm,...filters}));assert.equal(r.status(),200);return r.json()}
 const all=await find({});assert.equal(all.count,5);assert.deepEqual(all.results.map(hit=>hit.source).sort(),[...expected].sort())
 for(const hit of all.results){const opened=await owner.request.get(base+hit.href);assert.equal(opened.status(),200);const exact=await opened.json();assert.equal(exact.count,1);assert.deepEqual(exact.results,[hit])}
 const file=all.results.find(hit=>hit.source===expected[4]);assert.equal(file.extraction.status,'complete');assert.ok(file.text.includes(searchTerm))
 await page.setViewportSize({width:1440,height:1000})
 await page.goto(base+'/app?job='+job.id+'&tab=Decision%20search')
 const search=async filters=>{for(const [name,key] of [['Search text','q'],['Tag','tag'],['Sender','sender'],['Sheet','sheet'],['Cost code','cost_code']])await page.getByLabel(name,{exact:true}).fill(key==='q'?searchTerm:filters[key]??'');await page.getByRole('button',{name:'Search decisions',exact:true}).click()}
 await search({});await expect(page.getByText('5 matching records',{exact:true})).toBeVisible()
 for(const hit of all.results)await expect(page.locator('a').filter({has:page.locator('strong')}).filter({hasText:hit.title})).toBeVisible()
 await capture(page,'combined-decision-search')
 await page.setViewportSize({width:1440,height:1000})
 const cases=[
  [{tag:'cabinetry'},[expected[0],expected[1],expected[2],expected[4]]],
  [{tag:'cabinetry',sender:email,sheet:'A-201',cost_code:'06-400'},[expected[1],expected[4]]],
  [{tag:'design',sheet:'A-202',cost_code:'08-500'},[expected[3]]],
  [{tag:'cabinetry',sheet:'A-202'},[]],
 ]
 for(const [filters,sources]of cases){const found=await find(filters);assert.equal(found.count,sources.length);assert.deepEqual(found.results.map(hit=>hit.source).sort(),[...sources].sort());await search(filters);await expect(page.getByText(sources.length+' matching records',{exact:true})).toBeVisible()}
 console.log('PROBE DOC-008 1 and 4: installed Decision search -> meeting, inbound email, selection comment, RFI response and original file text in one search; independent filter intersections and exact-source links; screens at 1440 and 390')
}
