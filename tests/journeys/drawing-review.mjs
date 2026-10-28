import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { chromium,expect } from '@playwright/test'
import { nativeSignIn } from '../../scripts/verify/native-signin.mjs'
const base=process.env.PLINTH_URL,state=process.env.PLINTH_STATE,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&state&&shots,'Use the disposable installed application')
await mkdir(shots,{recursive:true})
const original=await readFile(new URL('../fixtures/drawing-scanned.pdf',import.meta.url)),revised=await readFile(new URL('../fixtures/drawing-scanned-revised.pdf',import.meta.url))
const large=await readFile(new URL('../fixtures/drawing-scanned-large.pdf',import.meta.url))
const browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
try{
 const owner=await browser.newContext({storageState:state,viewport:{width:1440,height:1000}}),manager=await browser.newContext({viewport:{width:1440,height:1000}}),page=await owner.newPage(),mp=await manager.newPage()
 const post=async(path,data,method='POST')=>{const r=await owner.request.fetch(base+path,{method,headers:{origin:base},data});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 const read=async()=> (await(await owner.request.get(base+root)).json()).plans
 const email=['synthetic-plinth-drawing-manager','dev.localhost'].join('@')
 const {job}=await post('/api/plinth/jobs',{name:'Scanned drawing office review',client_email:['synthetic-plinth-drawing-client','dev.localhost'].join('@'),address:'148 Maple Street'})
 const root=`/api/plinth/jobs/${job.id}/plans`
 await post('/auth/invite',{email,displayName:'Synthetic drawing reviewer',role:'admin',returnTo:'/app'})
 await nativeSignIn(mp,email)
 const people=await(await owner.request.get(base+'/api/plinth/team')).json(),person=people.team.find(p=>p.email===email)
 let assignment=await post('/api/plinth/team/'+person.id,{expected_version:0,role:'project_manager',job_ids:[job.id],po_limit_cents:0},'PUT')
 await page.goto(base+`/app?job=${job.id}&tab=Plans`)
 const panel=page.getByRole('region',{name:'Versioned plans'}),drawing=page.getByRole('article',{name:'Selected drawing'}),reviewPanel=page.getByRole('region',{name:'Office drawing review'})
 async function upload(title,revision,bytes,sheets){
  if(!await panel.getByLabel('Plan set title',{exact:true}).isVisible())await panel.getByText('Upload a plan set',{exact:true}).click()
  const form=panel.locator('form').last()
  await form.getByLabel('Plan set title',{exact:true}).fill(title);await form.getByLabel('Issue date',{exact:true}).fill(revision==='A'?'2026-10-01':'2026-10-10')
  await form.getByLabel('Original plan PDFs',{exact:true}).setInputFiles(sheets.map((_,i)=>({name:`synthetic-plinth-scan-${i+1}.pdf`,mimeType:'application/pdf',buffer:bytes})))
  for(const [i,number,pdfPage] of sheets){await form.getByLabel('Sheet number '+i,{exact:true}).fill(number);await form.getByLabel('Revision number '+i,{exact:true}).fill(revision);await form.getByLabel('PDF page '+i,{exact:true}).fill(String(pdfPage))}
  await form.getByRole('button',{name:'Upload plan set',exact:true}).click();await expect(panel.getByRole('heading',{name:title,exact:true})).toBeVisible()
  const record=panel.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})})
  await record.getByRole('checkbox',{name:'I approve these exact sheets and notify the selected recipients in their plan inbox.',exact:true}).check();await record.getByRole('button',{name:'Approve and notify recipients',exact:true}).click()
  await expect(record.getByText(/Approved by Synthetic Plinth builder/)).toBeVisible()
 }
 await upload('Scanned permit set','A',original,[[1,'A1',1],[2,'A2',2]])
 const first=(await read()).sets[0],[one,two]=first.sheets
 const capture=async label=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`${shots}/DOC-002-${label}-${width}.png`,fullPage:true,animations:'disabled'})}await page.setViewportSize({width:1440,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Reviewed drawing fits the viewport')}
 const unexpected=[];page.on('request',request=>{const url=new URL(request.url());if(url.protocol.startsWith('http')&&url.origin!==base)unexpected.push(url.origin)})
 async function recognize(sheet,number,name,misread=false,sourceSet=first){
  await page.getByLabel('Drawing revision',{exact:true}).selectOption(sheet.id)
  await reviewPanel.getByRole('button',{name:'Recognize this source page',exact:true}).click()
  await Promise.race([
   reviewPanel.getByLabel('Proposed sheet number',{exact:true}).waitFor({state:'visible',timeout:120000}),
   reviewPanel.getByRole('alert').waitFor({state:'visible',timeout:120000}).then(async()=>{throw new Error(await reviewPanel.getByRole('alert').textContent())}),
  ])
  await expect(reviewPanel.getByLabel('Proposed sheet number',{exact:true})).toBeVisible({timeout:120000})
  const draft=reviewPanel.locator('pre');await expect(draft).toContainText(name.toUpperCase());const text=await draft.textContent();assert.ok(text.length>20)
  // Seed a familiar uncertain digit in the unreviewed proposal; the generated source text remains intact.
  await reviewPanel.getByLabel('Proposed sheet number',{exact:true}).fill(misread?'AI':number)
  await reviewPanel.getByRole('button',{name:'Save recognition proposal',exact:true}).click()
  const proposal=page.getByRole('article',{name:'Recognition proposal'});await expect(proposal).toBeVisible()
  const saved=(await read()).sets.find(s=>s.id===sourceSet.id).drawing_review.proposals.at(-1)
  assert.equal(saved.text,text.trim());assert.ok(saved.regions.length);assert.equal(saved.page,sheet.page);assert.equal(saved.checksum,sheet.document.checksum);assert.ok(saved.regions.every(r=>r.x>=0&&r.y>=0&&r.confidence>=0&&r.confidence<=100))
  if(misread){assert.equal(saved.number,'AI');await capture('uncertain-source-proposal')}
  await proposal.getByLabel('Reviewed sheet number',{exact:true}).fill(number);await proposal.getByLabel('Reviewed sheet name',{exact:true}).fill(name)
  await expect(proposal.getByLabel('Reviewed drawing text',{exact:true})).toHaveValue(text.trim())
  await proposal.getByRole('checkbox').check();await proposal.getByRole('button',{name:'Adopt reviewed recognition',exact:true}).click()
  await expect(page.getByRole('article',{name:'Reviewed drawing text'}).getByRole('heading',{name:`Reviewed ${number} · ${name}`,exact:true})).toBeVisible()
  return text
 }
 await recognize(two,'A2','Laundry detail')
 const text=await recognize(one,'A1','Kitchen plan',true);assert.match(text,/SEE\s+A2\s+DETAIL\s+1/i)
 assert.deepEqual(unexpected,[],'Actual PDF pixels and local OCR resources never leave this installation')
 const checked=(await read()).sets[0];assert.equal(checked.sheets[0].number,'A1');assert.equal(checked.drawing_review.proposals.at(-1).number,'AI');assert.equal(checked.drawing_review.reviews.at(-1).number,'A1')
 await drawing.getByLabel('Annotation X',{exact:true}).fill('90');await drawing.getByLabel('Annotation Y',{exact:true}).fill('160');await drawing.getByLabel('Revision annotation',{exact:true}).fill('Reviewed waterproofing markup tied to permit revision A');await drawing.getByRole('button',{name:'Save source annotation',exact:true}).click()
 await reviewPanel.getByText('Review a detail link',{exact:true}).click()
 const linkForm=reviewPanel.locator('form').filter({has:page.getByRole('button',{name:'Approve exact detail link',exact:true})})
 await linkForm.getByLabel('Reviewed link target',{exact:true}).selectOption(two.id);await linkForm.getByLabel('Detail link label',{exact:true}).fill('Open A2 detail')
 const reference=checked.drawing_review.proposals.at(-1).regions.find(r=>/SEE.*A2/i.test(r.text));assert.ok(reference)
 for(const key of ['x','y','width','height'])await linkForm.getByLabel('Detail area '+key,{exact:true}).fill(String(reference[key]))
 await linkForm.getByRole('checkbox').check();await linkForm.getByRole('button',{name:'Approve exact detail link',exact:true}).click()
 await expect(reviewPanel.getByRole('button',{name:'Open A2 detail',exact:true})).toBeVisible()
 await expect(drawing.locator('svg a').filter({hasText:'Open A2 detail'})).toBeVisible()
 await capture('reviewed-detail-hotspot')
 await drawing.locator('svg a').filter({hasText:'Open A2 detail'}).click()
 await expect(drawing.getByRole('heading',{name:'A2 · revision A',exact:true})).toBeVisible();await expect(page.getByRole('article',{name:'Reviewed drawing text'})).toContainText('WATERPROOFING DETAIL')
 await page.getByLabel('Drawing revision',{exact:true}).selectOption(one.id)
 await reviewPanel.getByLabel('Reviewed text or annotation',{exact:true}).fill('waterproofing markup');await reviewPanel.getByRole('button',{name:'Search reviewed drawings',exact:true}).click()
 const results=reviewPanel.getByLabel('Reviewed drawing search results',{exact:true});await expect(results.getByRole('link',{name:'A1 · Kitchen plan · revision A',exact:true})).toBeVisible();await expect(results).toContainText('Reviewed waterproofing markup')
 await capture('reviewed-search')
 await reviewPanel.getByLabel('Reviewed text or annotation',{exact:true}).fill('WATERPROOFING DETAIL');await reviewPanel.getByRole('button',{name:'Search reviewed drawings',exact:true}).click();await expect(results.getByRole('link',{name:'A2 · Laundry detail · revision A',exact:true})).toBeVisible()
 await upload('Scanned construction revision','B',revised,[[1,'A1',1]])
 const second=(await read()).sets[1],newSheet=second.sheets[0];await page.getByLabel('Drawing revision',{exact:true}).selectOption(newSheet.id)
 await reviewPanel.getByLabel('Compare exact revision',{exact:true}).selectOption(one.id)
 const overlay=reviewPanel.getByRole('region',{name:'Exact revision comparison'}),pixels=overlay.getByLabel('Rendered revision overlay and change area',{exact:true})
 await expect(overlay).toContainText('changed rendered pixels.',{timeout:30000});assert.ok(Number(await pixels.getAttribute('data-changed-pixels'))>500)
 const area=await overlay.getByRole('status').textContent();assert.match(area,/Change area in source PDF coordinates/)
 const colors=await pixels.evaluate(canvas=>{const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let red=0;for(let i=0;i<d.length;i+=4)if(d[i]===210&&d[i+1]===40&&d[i+2]===65)red++;return red});assert.ok(colors>500&&colors<800*800/5,'The overlay marks a bounded change rather than the whole page');const sample=await pixels.evaluate(canvas=>{const ctx=canvas.getContext('2d');return {changed:[...ctx.getImageData(715,400,1,1).data],unchanged:[...ctx.getImageData(100,400,1,1).data]}});assert.deepEqual(sample.changed,[210,40,65,255],'The moved wall is marked as changed');assert.deepEqual(sample.unchanged,[0,0,0,255],'The unchanged shared wall remains original black')
 await capture('rendered-revision-comparison')
 for(const [set,sheet,bytes] of [[first,one,original],[first,two,original],[second,newSheet,revised]]){const download=await owner.request.get(base+root+'/'+set.id+'/files/'+sheet.id);assert.equal(download.status(),200);assert.deepEqual(await download.body(),bytes)}
 const live=(await read()).sets[0],link=live.drawing_review.links[0]
 await mp.goto(base+one.href);await expect(mp.getByRole('region',{name:'Office drawing review'})).toBeVisible()
 const before=(await read()).version
 const stale=await owner.request.post(base+root+'/'+first.id+'/recognition-review',{headers:{origin:base},data:{expected_version:before-1,proposal_id:live.drawing_review.proposals.at(-1).id,number:'wrong',name:'wrong',text:'wrong',confirm:true}});assert.equal(stale.status(),409)
 const {job:other}=await post('/api/plinth/jobs',{name:'Unrelated review job',client_email:['synthetic-plinth-review-other','dev.localhost'].join('@'),address:'2 Synthetic Lane'})
 assert.equal((await manager.request.get(base+`/api/plinth/jobs/${other.id}/plans/${first.id}/links/${link.id}`)).status(),404)
 assignment=await post('/api/plinth/team/'+person.id,{expected_version:assignment.member.version,role:'project_manager',job_ids:[],po_limit_cents:0},'PUT')
 assert.equal((await manager.request.get(base+root+'/'+first.id+'/links/'+link.id)).status(),404)
 assert.equal((await manager.request.get(base+root+'/review-search?q=Kitchen')).status(),404)
 assert.equal((await manager.request.post(base+root+'/'+first.id+'/recognition-review',{headers:{origin:base},data:{expected_version:(await read()).version,proposal_id:live.drawing_review.proposals.at(-1).id,number:'wrong',name:'wrong',text:'wrong',confirm:true}})).status(),404)
 await mp.reload();await expect(mp.getByRole('region',{name:'Office drawing review'})).toHaveCount(0)
 // An ordinary 24 by 36 inch architectural scan must fit the bounded OCR canvas.
 await upload('Architectural scanned permit set','C',large,[[1,'A1',1]])
 const architectural=(await read()).sets.at(-1),largeSheet=architectural.sheets[0]
 assert.equal(largeSheet.width,1728);assert.equal(largeSheet.height,2592)
 await recognize(largeSheet,'A1','Kitchen plan',false,architectural)
 const reviewedLarge=(await read()).sets.at(-1),largeProposal=reviewedLarge.drawing_review.proposals.at(-1)
 const detail=largeProposal.regions.find(r=>/SEE.*A2/i.test(r.text));assert.ok(detail,'Recognition preserves the scanned detail reference')
 // The image starts 432 PDF points below the top and maps each scan pixel to 2.16 points.
 for(const [key,expected] of Object.entries({x:119,y:693,width:497,height:43}))assert.ok(Math.abs(detail[key]-expected)<12,`${key} remains in source PDF coordinates: ${detail[key]}`)
 assert.equal(reviewedLarge.sheets[0].number,'A1');assert.equal(reviewedLarge.drawing_review.reviews.at(-1).number,'A1')
 const largeDownload=await owner.request.get(base+root+'/'+architectural.id+'/files/'+largeSheet.id)
 assert.equal(largeDownload.status(),200);assert.deepEqual(await largeDownload.body(),large)
 await capture('architectural-scan-reviewed')
 await owner.close();await manager.close()
 console.log('DOC-002 PASS: real two-page scanned PDF, local OCR coordinates and uncertainty, explicit number correction and adoption, reviewed detail hotspot, searchable markup, rendered exact-source revision changes, identical originals, stale and cross-job and revoked refusals; browser proof at 1440 and 390')
}finally{await browser.close()}
