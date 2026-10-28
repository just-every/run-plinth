import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { seedRoomLayout, layoutPng, layoutEmail } from '../plinth/room-layout-support.mjs'
import { createActiveJob } from '../plinth/helpers.mjs'
import { takeoffPlan } from '../fixtures/takeoff-plan.mjs'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS,state=process.env.PLINTH_STATE,clientState=process.env.PLINTH_CLIENT_STATE
assert.ok(base&&shots&&state&&clientState,'Use the disposable installed Worker with native owner sign-in')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:state,viewport:{width:1440,height:1100}}),client=await browser.newContext({storageState:clientState}),page=await owner.newPage()
 const json=async(path,{method='GET',body,cookie}={})=>{const r=await (cookie==='client'?client:owner).request.fetch(base+path,{method,headers:{origin:base},...(body===undefined?{}:{data:body})});return {status:r.status(),value:await r.json()}}
 const clientEmail=['client','dev.localhost'].join(String.fromCharCode(64)),f={owner:'owner',json},c=await seedRoomLayout(f,await createActiveJob(f,'Kitchen design review',clientEmail,100000),{client:'client',tag:'installed-layout'})
 const economics=structuredClone(c.job)
 await page.goto(base+'/app?job='+c.job.id+'&tab=Plans')
 const workspace=page.locator('.room-layouts');await expect(workspace.getByRole('heading',{name:'Measured room layouts',exact:true})).toBeVisible()
 await workspace.getByText('Create a measured room',{exact:true}).click();await workspace.getByLabel('Measured room name',{exact:true}).fill('Kitchen field design');await workspace.getByRole('button',{name:'Create room layout',exact:true}).click()
 const panel=workspace.getByRole('article',{name:'Room layout: Kitchen field design',exact:true});await expect(panel).toBeVisible();await expect(panel).toContainText('Floor area 12 m²')
 await panel.getByText('Import a historical underlay',{exact:true}).click();const upload=panel.getByText('Import a historical underlay',{exact:true}).locator('..')
 await upload.getByLabel('Original drawing',{exact:true}).setInputFiles({name:'synthetic-plinth-underlay.pdf',mimeType:'application/pdf',buffer:takeoffPlan()});await upload.getByRole('button',{name:'Retain historical underlay',exact:true}).click()
 await panel.getByText('Historical drawing underlays · 1',{exact:true}).click();await expect(panel.getByText('PDF ready.',{exact:true})).toBeVisible()
 // An original image is retained too; uploading it never creates editable geometry.
 await panel.getByText('Import a historical underlay',{exact:true}).click();await upload.getByLabel('Original drawing',{exact:true}).setInputFiles({name:'synthetic-plinth-underlay.png',mimeType:'image/png',buffer:layoutPng});await upload.getByRole('button',{name:'Retain historical underlay',exact:true}).click()
 const opening=async(id,kind,wall,offset,width,height)=>{await panel.getByLabel('Opening label',{exact:true}).fill(id);await panel.getByLabel('Opening kind',{exact:true}).selectOption(kind);await panel.getByLabel('Opening wall',{exact:true}).selectOption(String(wall));for(const [label,value] of [['Opening offset (m)',offset],['Opening width (m)',width],['Opening height (m)',height]])await panel.getByLabel(label,{exact:true}).fill(String(value));await panel.getByRole('button',{name:'Add wall opening',exact:true}).click();await expect(panel.getByText(id+': '+kind+' on W'+(wall+1),{exact:false})).toBeVisible()}
 await opening('Kitchen entry','door',0,0.4,0.9,2.1);await opening('Kitchen window','window',2,0.5,1.2,1.1)
 for(const [i,s] of c.sources.entries()){
  await panel.getByLabel('Reviewed product capture',{exact:true}).selectOption(s.product_id+':'+s.product_revision_id)
  if(!i)await panel.getByLabel('Linked selection option',{exact:true}).selectOption([c.selection.id,c.selection.revisions[0].id,c.selection.revisions[0].options[0].id].join(':'))
  await panel.getByLabel('Placement label',{exact:true}).fill('fixture-'+i);await panel.getByLabel('Fixture name',{exact:true}).fill(s.name)
  for(const [label,value] of [['Fixture X (m)',i?2:0.2],['Fixture Y (m)',0.2],['Fixture width (m)',i?0.6:0.9],['Fixture depth (m)',i?0.65:0.6]])await panel.getByLabel(label,{exact:true}).fill(String(value))
  await panel.getByRole('button',{name:'Add sourced placement',exact:true}).click();await expect(panel.getByText(s.name+' at ',{exact:false})).toBeVisible()
 }
 const save=async reason=>{await panel.getByLabel('Layout revision reason',{exact:true}).fill(reason);await panel.getByRole('checkbox',{name:'I manually reconstructed this geometry and checked the site dimensions.',exact:true}).check();await panel.getByRole('button',{name:'Save measured revision',exact:true}).click();await expect(panel.getByRole('button',{name:'Save measured revision',exact:true})).toBeHidden()}
 await save('Measured site kitchen with sourced cabinet and appliance')
 let list=(await json(c.root+'/room-layouts',{cookie:'owner'})).value,layout=list.layouts.find(l=>l.name==='Kitchen field design'),first=structuredClone(layout.revisions[0]);assert.equal(layout.underlays.length,2);assert.equal(first.placements.length,2)
 await panel.getByText('Edit measured geometry',{exact:true}).click();await panel.getByLabel('Corner 2 X (m)',{exact:true}).fill('5');await panel.getByLabel('Corner 3 X (m)',{exact:true}).fill('5');await expect(panel).toContainText('Floor area 15 m² · Wall perimeter 16 m')
 await save('East wall moved one metre after site review');await panel.getByRole('button',{name:'Compare measurements and draft changes',exact:true}).click()
 const review=panel.getByRole('region',{name:'Layout change review'});await expect(review).toContainText('Floor area: 12 → 15 m²');await expect(review).toContainText('W1: 4 → 5 m');await expect(review).toContainText('Separate draft selection; original signature and specification retained')
 await panel.getByText('Preview dimensioned PDF',{exact:true}).click();const preview=panel.getByText('Preview dimensioned PDF',{exact:true}).locator('..');await expect(preview.getByText('PDF ready.',{exact:true})).toBeVisible()
 const canvas=preview.locator('canvas');assert.ok(await canvas.evaluate(c=>{const ctx=c.getContext('2d'),pixels=ctx.getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<220&&pixels[i+1]<220&&pixels[i+2]<220)ink++;return c.width>200&&ink>500}),'Dimensioned PDF renders real labels and geometry')
 const portableResponse=await owner.request.get(base+await panel.getByRole('link',{name:'Export portable geometry JSON',exact:true}).getAttribute('href'));assert.equal(portableResponse.status(),200);const portable=await portableResponse.json();assert.equal(portable.measures.area_m2,15);assert.equal(portable.measures.perimeter_m,16);assert.deepEqual(portable.measures.walls.map(w=>w.length_m),[5,3,5,3])
 for(const width of [1440,390]){await page.setViewportSize({width,height:1100});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Layout fits '+width);if(width===390){const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')}await panel.scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/DESIGN-001-measured-review-${width}.png`,fullPage:true,animations:'disabled'})}
 await page.setViewportSize({width:1440,height:1100});await review.getByRole('button',{name:'Approve reviewed layout drafts',exact:true}).click();await expect(panel).toContainText('Adopted revision 2 · reviewed takeoff draft and 1 selection drafts retained.')
 await c.read();assert.deepEqual(c.job.quotes,economics.quotes);assert.deepEqual(c.job.budgets,economics.budgets);assert.deepEqual(c.job.selections[0],economics.selections[0]);assert.equal(c.job.selections.at(-1).revisions[0].status,'draft')
 const fresh=(await json(c.root+'/room-layouts',{cookie:'owner'})).value;layout=fresh.layouts.find(l=>l.name==='Kitchen field design');assert.deepEqual(layout.revisions[0],first);assert.equal(layout.revisions.length,2)
 const post=async(path,body,cookie='owner')=>json(c.root+path,{method:'POST',cookie,body:{expected_version:c.job.version,...body}})
 assert.equal((await post('/room-layouts/'+layout.id+'/revise',{...c.g,base_revision_id:first.id})).status,409)
 const modelPath=c.root+'/room-layouts/'+layout.id+'/'+layout.revisions[1].id+'/model.json';assert.equal((await json(modelPath,{cookie:'client'})).status,403);assert.equal((await post('/room-layouts/'+layout.id+'/revise',{...c.g,base_revision_id:layout.revisions[1].id},'client')).status,403)
 await panel.getByText('Restore portable geometry',{exact:true}).click();await panel.getByLabel('Portable geometry JSON',{exact:true}).setInputFiles({name:'synthetic-plinth-geometry.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(portable))});await panel.getByLabel('Geometry import reason',{exact:true}).fill('Reviewed geometry round trip');await panel.getByRole('checkbox',{name:'I reviewed the imported measurements and exact product sources.',exact:true}).check();await panel.getByRole('button',{name:'Import geometry as a new revision',exact:true}).click()
 await expect(panel).toContainText('Reviewed geometry round trip');const after=(await json(c.root+'/room-layouts',{cookie:'owner'})).value.layouts.find(l=>l.id===layout.id);assert.equal(after.revisions.length,3);assert.deepEqual(after.revisions[2].points,layout.revisions[1].points);assert.deepEqual(after.revisions[2].placements,layout.revisions[1].placements)
 await panel.getByLabel('Layout revision',{exact:true}).selectOption(first.id);await expect(panel).toContainText('Floor area 12 m² · Wall perimeter 14 m');await expect(panel.getByText('Edit measured geometry',{exact:true})).toBeHidden()
 const snapshot=JSON.stringify(await json(c.root,{cookie:'owner'}));assert.equal((await post('/room-layouts/'+layout.id+'/adopt',{revision_id:after.revisions[1].id,digest:'synthetic-plinth-stale',confirm:true})).status,409);assert.equal(JSON.stringify(await json(c.root,{cookie:'owner'})),snapshot)
 await client.close();await owner.close()
 console.log('Measured kitchen layout passed: native owner UI, sourced placements, wall move from 12 to 15 square metres, retained revisions, rendered PDF, portable round trip, draft adoption and refused stale or client edits; screens at 1440 and 390')
}finally{await browser.close()}
