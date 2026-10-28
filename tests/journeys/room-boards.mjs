import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { roomFiles } from '../fixtures/room-board.mjs'
const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&process.env.PLINTH_STATE&&process.env.PLINTH_CLIENT_STATE&&shots,'Installed owner and client states are required')
await mkdir(shots,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:process.env.PLINTH_STATE,viewport:{width:1440,height:1000}}),page=await owner.newPage()
 const request=(path,body)=>owner.request.post(base+'/api/plinth'+path,{headers:{origin:base},data:body})
 const post=async(path,body)=>{const r=await request(path,body);assert.ok([200,201].includes(r.status()),path+' '+r.status()+' '+await r.text());return r.json()}
 let job=(await post('/jobs',{name:'Synthetic measured kitchen',client_email:['client','dev.localhost'].join('@'),address:'Synthetic construction site'})).job
 const root='/jobs/'+job.id
 const read=async()=>(await (await owner.request.get(base+'/api/plinth'+root)).json()).job
 const act=async(path,body)=>{job=await read();const r=await post(root+path,{expected_version:job.version,...body});job=await read();return r.record}
 await act('/quotes',{lines:[{description:'Kitchen construction scope',quantity:'1',unit_cents:15000}]})
 await act(`/quotes/${job.quotes[0].id}/accept`,{method:'signed',evidence:'Exact construction specification reviewed',schedule_choice:{kind:'none',reason:'Schedule follows room review'}})
 const product={name:'Oak cabinet finish',sku:'synthetic-plinth-1',supplier:'Synthetic supply',source_url:'https://example.com/synthetic-plinth',dimensions:'24 mm matte oak panel',cost_quote_cents:12000,lead_days:7,captured_on:'2026-10-01',valid_until:'2099-01-01',discontinued:false,evidence:'Reviewed supplier original',image:{name:'synthetic-plinth.png',base64:roomFiles()[1].bytes.toString('base64')}}
 const captured=await act('/products',product),pid=captured.id,pr=captured.revisions[0].id
 await act(`/products/${pid}/review`,{revision_id:pr,confirm:true})
 const selection=await act('/selections',{room:'Kitchen',category:'Cabinet finish',allowance_cents:15000,cost_code:'06-400',decision_on:'2026-11-01',lead_days:7,options:[{name:'Approved oak',specifications:'24 mm matte oak',supplier:'Synthetic supply',price_cents:15000,product_id:pid,product_revision_id:pr}]})
 const sr=selection.revisions[0]
 await act(`/selections/${selection.id}/present`,{revision_id:sr.id})
 const client=await browser.newContext({storageState:process.env.PLINTH_CLIENT_STATE})
 const sign=await client.request.post(base+'/api/plinth'+root+`/selections/${selection.id}/sign`,{headers:{origin:base},data:{expected_version:job.version,revision_id:sr.id,option_id:sr.options[0].id,statement:'I approve the exact oak specification and price',confirm:true}});assert.equal(sign.status(),200)
 job=await read();const signed=structuredClone(job.selections[0].revisions[0].signature),quotes=structuredClone(job.quotes)
 await page.goto(base+`/app?job=${job.id}&tab=Room+boards`)
 const panel=page.getByRole('region',{name:'Room boards',exact:true})
 await panel.getByText('Create a room board',{exact:true}).click()
 const create=panel.locator('form').filter({has:page.getByRole('button',{name:'Create room board',exact:true})})
 await create.getByLabel('Room name',{exact:true}).fill('Kitchen finish board')
 for(const [label,value] of [['Room length','4'],['Room width','3'],['Room height','2.7']])await create.getByLabel(label,{exact:true}).fill(value)
 await create.getByLabel('Measurement unit',{exact:true}).selectOption('m')
 await create.getByLabel('Reviewed product revision',{exact:true}).selectOption(pid+':'+pr)
 await create.getByLabel('Exact selection revision',{exact:true}).selectOption(selection.id+':'+sr.id)
 await create.getByLabel('Room originals',{exact:true}).setInputFiles(roomFiles().map(({name,bytes})=>({name,mimeType:name.endsWith('.pdf')?'application/pdf':name.endsWith('.png')?'image/png':name.endsWith('.jpg')?'image/jpeg':'application/octet-stream',buffer:bytes})))
 await create.getByRole('button',{name:'Create room board',exact:true}).click()
 const board=panel.getByRole('article',{name:'Kitchen finish board',exact:true})
 await expect(board.getByText('Measurements: 4 × 3 × 2.7 m',{exact:true})).toBeVisible()
 await expect(board.getByText('Signed specification: Approved oak · 24 mm matte oak · client price $150.00 · Synthetic Plinth client',{exact:true})).toBeVisible()
 await expect(board.getByText('Cost code 06-400 · signed',{exact:true})).toBeVisible()
 const first=(await read()).room_boards[0].revisions[0]
 await board.getByText('Annotate a finish',{exact:true}).click()
 const annotate=board.locator('form').filter({has:page.getByRole('button',{name:'Save finish revision',exact:true})})
 await annotate.getByLabel('Finish original',{exact:true}).selectOption(first.files.find(f=>f.format==='pdf').id)
 await annotate.getByLabel('Finish annotation',{exact:true}).fill('Matte oak matches the signed cabinet specification')
 await annotate.getByRole('button',{name:'Save finish revision',exact:true}).click()
 await expect(board.getByText('Matte oak matches the signed cabinet specification',{exact:false})).toBeVisible()
 const capture=async label=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await board.scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/EST-008-${label}-${width}.png`,fullPage:true,animations:'disabled'})}await page.setViewportSize({width:1440,height:1000})}
 for(const [format,name] of [['pdf','synthetic-plinth-plan.pdf'],['png','synthetic-plinth-finish.png'],['jpeg','synthetic-plinth-finish.jpg'],['glb','synthetic-plinth-room.glb'],['obj','synthetic-plinth-room.obj']]){
  await board.getByRole('button',{name:'Open '+name,exact:true}).click()
  if(format==='glb'||format==='obj'){
   const model=board.getByRole('region',{name:'Model viewer '+name,exact:true});await expect(model.getByRole('img',{name:'Geometry of '+name,exact:true})).toBeVisible();await expect(model.getByRole('status')).toHaveText('4 vertices · 2 triangles · Static geometry');await expect(model.locator('polygon')).toHaveCount(2)
   const old=await model.locator('polygon').first().getAttribute('points');await model.getByLabel('Rotate model',{exact:true}).fill('70');await expect.poll(()=>model.locator('polygon').first().getAttribute('points')).not.toBe(old)
   if(format==='obj')await expect(model.getByText('OBJ materials and external textures are not rendered',{exact:true})).toBeVisible()
  }else{await expect(board.getByRole('status').filter({hasText:'Original opened: '+name})).toBeVisible();if(format==='pdf'){await expect(board.getByLabel('Finish marker 1',{exact:true})).toBeVisible();await board.getByLabel('PDF page',{exact:true}).fill('2');await expect(board.getByRole('status').filter({hasText:'page 2 of 2'})).toBeVisible();await board.getByLabel('PDF page',{exact:true}).fill('1');await expect(board.getByLabel('Finish marker 1',{exact:true})).toBeVisible()}}
  await capture(format)
 }
 await board.getByText('Revise this room board',{exact:true}).click()
 const revision=board.locator('form').filter({has:page.getByRole('button',{name:'Save room revision',exact:true})})
 await revision.getByLabel('Room length',{exact:true}).fill('4.5');await revision.getByLabel('Additional room originals',{exact:true}).setInputFiles({name:'synthetic-plinth-plan-revised.pdf',mimeType:'application/pdf',buffer:(await import('../fixtures/takeoff-plan.mjs')).takeoffPlan(true)})
 await revision.getByRole('button',{name:'Save room revision',exact:true}).click()
 await expect(board.getByText('Measurements: 4.5 × 3 × 2.7 m',{exact:true})).toBeVisible()
 await act(`/products/${pid}/revise`,{...product,cost_quote_cents:18000})
 job=await read();const current=job.room_boards[0].revisions.at(-1),rootUrl=base+'/api/plinth'+root
 assert.deepEqual(job.room_boards[0].revisions[0],first);assert.equal(current.products[0].cost_quote_cents,12000);assert.deepEqual(job.selections[0].revisions[0].signature,signed);assert.deepEqual(job.quotes,quotes)
 const stale=await request(root+'/room-boards/'+job.room_boards[0].id+'/revise',{expected_version:job.version-1,base_revision_id:current.id,title:'Lost change'});assert.equal(stale.status(),409);assert.deepEqual(await read(),job)
 const other=(await post('/jobs',{name:'Other private room',client_email:['client','dev.localhost'].join('@')})).job
 for(const original of roomFiles()){
  const metadata=first.files.find(f=>f.name===original.name),url=rootUrl+'/room-boards/files/'+metadata.id
  const downloaded=await owner.request.get(url+'?download=1');assert.equal(downloaded.status(),200);assert.deepEqual(await downloaded.body(),original.bytes)
  assert.equal((await client.request.get(url)).status(),403)
  assert.equal((await owner.request.get(base+'/api/plinth/jobs/'+other.id+'/room-boards/files/'+metadata.id)).status(),404)
 }
 assert.equal((await (await client.request.get(rootUrl)).json()).job.room_boards,undefined)
 await board.getByLabel('Board revision',{exact:true}).selectOption(first.id);await expect(board.getByText('Measurements: 4 × 3 × 2.7 m',{exact:true})).toBeVisible()
 await board.getByRole('button',{name:'Open synthetic-plinth-plan.pdf',exact:true}).click();await expect(board.getByRole('status').filter({hasText:'Original opened:'})).toBeVisible()
 await capture('retained-revision')
 // The revision link is an authenticated owner entry, usable in the phone viewport.
 await page.setViewportSize({width:390,height:1000});await page.goto(base+`/app?job=${job.id}&tab=Room+boards&board=${job.room_boards[0].id}&revision=${first.id}`)
 await expect(page.getByRole('article',{name:'Kitchen finish board',exact:true}).getByText('Measurements: 4 × 3 × 2.7 m',{exact:true})).toBeVisible()
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Room board fits the phone viewport')
 const menu=page.getByRole('button',{name:'Open menu',exact:true});await menu.hover();await expect.poll(()=>menu.evaluate(e=>getComputedStyle(e,'::after').visibility)).toBe('visible');await menu.focus();assert.equal(await menu.evaluate(e=>getComputedStyle(e,'::after').visibility),'visible')
 await owner.close();await client.close()
 console.log('EST-008 PASS: original PDF, PNG and JPEG opening, real GLB and OBJ geometry, immutable finish and room revisions, pinned signed sources, exact downloads, stale refusal and private access; screens at 1440 and 390')
}finally{await browser.close()}
