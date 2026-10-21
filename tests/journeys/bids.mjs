import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {takeoffPlan} from '../fixtures/takeoff-plan.mjs'

const base=process.env.PLINTH_URL,shots=process.env.PLINTH_SCREENSHOTS
assert.ok(base&&shots,'Use the real installed app and a private screenshot destination')
const keys=['OWNER','CLIENT']
for(const key of keys)assert.ok(process.env[`PLINTH_${key}_OPEN`],`Private native ${key} sign-in is required; no browser profile sessions are copied`)
const ownerOpen=new URL(process.env.PLINTH_OWNER_OPEN),devFragment=new URLSearchParams(ownerOpen.hash.slice(1))
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)&&ownerOpen.origin===new URL(base).origin&&devFragment.has('rer-dev'),'Use this synthetic installation’s native local dev entrance')
const devOpen=email=>{const url=new URL(ownerOpen),fragment=new URLSearchParams(devFragment);fragment.set('as',email);fragment.set('next',`/auth/dev/enter?as=${encodeURIComponent(email)}&returnTo=/app`);url.hash=fragment.toString();return url.href}
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
await mkdir(shots,{recursive:true})
try{
 const contexts=await Promise.all(Array.from({length:5},()=>browser.newContext())),pages=await Promise.all(contexts.map(c=>c.newPage()))
 const [owner,client,...bidders]=contexts,[page,cp,...bp]=pages,stamp=Date.now()
 const identities=[]
 const signIn=async(n,open)=>{await pages[n].goto(open);await pages[n].waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'));const session=await contexts[n].request.get(base+'/auth/session');assert.ok(session.ok());identities[n]=(await session.json()).operator}
 for(let n=0;n<2;n++)await signIn(n,process.env[`PLINTH_${keys[n]}_OPEN`])
 // The documented local key entrance accepts real invited accounts; no mail or profile transplant is involved.
 for(let n=0;n<3;n++){
  const email=`synthetic-plinth-${stamp+n+1}@dev.localhost`,invitation=await owner.request.post(base+'/auth/invite',{headers:{origin:base},data:{email,displayName:['Sam Rivera','Alex Chen','Jordan Lee'][n],role:'member',returnTo:'/app'}})
  assert.equal(invitation.status(),202,'Native owner invitation succeeds')
  await signIn(n+2,devOpen(email))
 }
 assert.equal(new Set(identities.map(i=>i.email)).size,5,'Use distinct owner, client and three bidder accounts')
 const capture=async(p,name,check)=>{for(const width of [1440,390]){await p.setViewportSize({width,height:1000});await p.evaluate(()=>scrollTo(0,0));if(check)await check();assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} fits ${width}`);await p.screenshot({path:`${shots}/BID-001-${name}-${width}.png`,fullPage:true,animations:'disabled'})}}
 const post=async(path,body)=>{const r=await owner.request.post(base+'/api/plinth'+path,{headers:{origin:base},data:body});assert.ok(r.ok(),path+' '+await r.text());return r.json()}
 const codes=['06-100','06-200','06-300'],descriptions=['Ground floor framing','Upper floor framing','Roof structure'],companies=['Cascade Framing','Rivera Carpentry','Alder Structural'],title='Mason residence — framing package'
 let {job}=await post('/jobs',{name:'Mason whole-home remodel',client_email:identities[1].email,address:'4518 Alder Avenue, Portland, OR 97211'})
 const jobAct=async(path,body={})=>{const result=await post(`/jobs/${job.id}${path}`,{expected_version:job.version,...body});job=result.job;return result.record}
 await jobAct('/quotes',{lines:codes.map((cost_code,n)=>({id:`synthetic-plinth-${n+1}`,cost_code,description:descriptions[n],phase:'Structure',category:'labor',unit:'job',quantity:'1',unit_cents:16000000}))})
 await jobAct(`/quotes/${job.quotes[0].id}/accept`,{method:'signed',evidence:'Synthetic client accepted exact estimate',schedule_choice:{kind:'none',reason:'Prepare bids first'}})
 const vendors=[],scopes=[]
 for(let n=0;n<3;n++){
  const vendor=(await post('/vendors',{kind:'subcontractor',name:companies[n],trades:['Framing'],contacts:[{id:`synthetic-plinth-${n+1}`,name:identities[n+2].displayName,email:identities[n+2].email}]})).vendor;vendors.push(vendor)
  await post(`/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Framing',status:'qualified',evidence:'Synthetic human-reviewed qualification'})
  const scope=await jobAct('/subcontracts',{vendor_id:vendor.id,trade:'Framing',scope:descriptions[n],contact_ids:[`synthetic-plinth-${n+1}`],awarded_on:'2026-10-21'});scopes.push(scope.id);await jobAct(`/subcontracts/${scope.id}/release`)
 }
 const url=base+`/app?job=${job.id}&tab=Bids`;await page.goto(url)
 const panel=page.getByRole('heading',{name:'Bid requests and responses',exact:true}).locator('..')
 const formFor=(p,label)=>p.locator('form').filter({has:p.getByRole('button',{name:label,exact:true})})
 let form=formFor(page,'Prepare bid package')
 await form.getByLabel('Bid package title',{exact:true}).fill(title);await form.getByLabel('Qualified trade',{exact:true}).fill('Framing');await form.getByLabel('Package scope',{exact:true}).fill('Whole-home framing and structural carpentry')
 await form.getByLabel('Package pricing',{exact:true}).selectOption('priced')
 for(let n=0;n<3;n++){await form.getByRole('checkbox',{name:`Package cost code ${codes[n]}`,exact:true}).check();await form.getByLabel(`Scope ${codes[n]}`,{exact:true}).fill(descriptions[n]);await form.getByLabel(`Package price ${codes[n]} (USD)`,{exact:true}).fill('15000.00')}
 await form.getByLabel('Plan revision / addendum note',{exact:true}).fill('Initial plans');await form.getByLabel('Bid due date (UTC)',{exact:true}).fill(new Date(Date.now()+86400000*7).toISOString().slice(0,10));await form.getByLabel('Exact plan originals (PDF, PNG or JPEG)',{exact:true}).setInputFiles({name:'synthetic-plinth-1.pdf',mimeType:'application/pdf',buffer:takeoffPlan()})
 await capture(page,'prepare-priced-package',async()=>expect(form.getByLabel('Bid package title',{exact:true})).toHaveValue(title));await form.getByRole('button',{name:'Prepare bid package',exact:true}).click()
 const record=panel.locator('article.record').filter({has:page.getByRole('heading',{name:title,exact:true})})
 form=formFor(record,'Publish exact bid package');await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Publish exact bid package',exact:true}).click();await expect(record.getByText('Framing · Priced package · Published in bid inbox',{exact:true})).toBeVisible()
 await record.locator('summary').filter({hasText:/^Invite one qualified subcontractor contact$/}).click()
 for(let n=0;n<3;n++){
  form=formFor(record,'Invite this bid contact');await form.getByLabel('Qualified company contact',{exact:true}).selectOption(`${vendors[n].id}|synthetic-plinth-${n+1}`);await form.getByLabel('Released company scope',{exact:true}).selectOption(scopes[n]);await form.getByRole('checkbox',{name:`Invite cost code ${codes[n]}`,exact:true}).check();await form.getByRole('checkbox',{name:'I invite only this exact contact to the selected bid scope.',exact:true}).check();await form.getByRole('button',{name:'Invite this bid contact',exact:true}).click();await expect(record.getByText(identities[n+2].email+' · Awaiting response',{exact:false})).toBeVisible()
 }
 await capture(page,'three-individual-invitations',async()=>expect(record.locator('[data-bid-invitation]')).toHaveCount(3))
 await record.locator('summary').filter({hasText:/^Issue a plan addendum$/}).click();form=formFor(record,'Issue exact plan addendum');await form.getByLabel('Plan revision / addendum note',{exact:true}).fill('Revised detail A');const past=new Date(Date.now()-86400000).toISOString().slice(0,10);await form.getByLabel('Bid due date (UTC)',{exact:true}).fill(past);await form.getByLabel('Exact plan originals (PDF, PNG or JPEG)',{exact:true}).setInputFiles({name:'synthetic-plinth-2.pdf',mimeType:'application/pdf',buffer:takeoffPlan(true)});await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Issue exact plan addendum',exact:true}).click()
 await capture(page,'issued-plan-addendum',async()=>{await expect(record.getByRole('heading',{name:'Plan revision 2',exact:true})).toBeVisible();await expect(record.getByText('Revision 2: Not acknowledged',{exact:true})).toHaveCount(3)})
 const inbox=async p=>{await p.goto(base+'/app');await p.locator('button.signout').waitFor({state:'attached'});const menu=p.getByRole('button',{name:'Open menu',exact:true});if(await menu.isVisible())await menu.click();await p.getByRole('button',{name:'Bid inbox',exact:true}).click();await expect(p.getByRole('heading',{name:'Bid inbox',exact:true})).toBeVisible()}
 const ownRecord=p=>p.locator('article.record').filter({has:p.getByRole('heading',{name:title,exact:true})})
 for(let n=0;n<3;n++){
  const p=bp[n];await inbox(p);const own=ownRecord(p)
  await capture(p,`bidder-${n+1}-private-scope`,async()=>{await expect(own.locator('[data-bid-invitation]')).toHaveCount(1);await expect(own.getByText(descriptions[(n+1)%3],{exact:false})).toHaveCount(0);await expect(own.getByText('Whole-home framing and structural carpentry',{exact:true})).toHaveCount(0);await expect(own.getByRole('heading',{name:'Plan revision 2',exact:true})).toBeVisible()})
  const original=await bidders[n].request.get(base+(await own.getByRole('link',{name:'synthetic-plinth-2.pdf · plan revision 2',exact:true}).getAttribute('href')));assert.ok(original.ok());assert.deepEqual(await original.body(),takeoffPlan(true))
  const inaccessible=await bidders[n].request.get(base+`/api/plinth/jobs/${job.id}`);assert.equal(inaccessible.status(),404)
  await own.getByRole('button',{name:'Acknowledge plan revision 2',exact:true}).click();await expect(own.getByText('Revision 2: Acknowledged by ',{exact:false})).toBeVisible()
  if(n<2){
   if(n===0){await own.locator('summary').filter({hasText:/^Ask a private bid question$/}).click();form=formFor(own,'Ask private question');await form.getByLabel('Private bid question',{exact:true}).fill('Does revised A2 require extra blocking at the shower wall?');await form.getByRole('button',{name:'Ask private question',exact:true}).click();await expect(own.getByText('Private question: Does revised A2 require extra blocking at the shower wall?',{exact:false})).toBeVisible()}
   form=formFor(own,'Submit private priced response');await form.getByLabel(`Bid price ${codes[n]} (USD)`,{exact:true}).fill(n===0?'12340.00':'15670.00');await form.getByLabel('Bid exclusions',{exact:true}).fill(`Owner-supplied hardware exclusion ${n+1}`);await form.getByLabel('Bid attachments (PDF, PNG or JPEG; up to five)',{exact:true}).setInputFiles({name:`synthetic-plinth-${n+3}.pdf`,mimeType:'application/pdf',buffer:takeoffPlan()});await form.getByRole('button',{name:'Submit private priced response',exact:true}).click()
   await capture(p,`bidder-${n+1}-received-response`,async()=>{await expect(own.getByRole('heading',{name:'Private response · plan revision 2',exact:true})).toBeVisible();await expect(own.getByText(`Exclusions: Owner-supplied hardware exclusion ${n+1}`,{exact:true})).toBeVisible();await expect(own.getByText('Owner-supplied hardware exclusion '+(n===0?2:1),{exact:false})).toHaveCount(0)})
  }else{await own.locator('summary').filter({hasText:/^Decline this bid invitation$/}).click();form=formFor(own,'Decline bid');await form.getByLabel('Decline reason',{exact:true}).fill('Crew unavailable for the requested start date');await form.getByRole('button',{name:'Decline bid',exact:true}).click();await capture(p,'bidder-3-declined',async()=>expect(own.getByText('Declined: Crew unavailable for the requested start date',{exact:false})).toBeVisible())}
 }
 await page.goto(url);form=formFor(record,'Answer privately');await form.getByLabel('Private answer',{exact:true}).fill('Include two rows of blocking at the shower wall, as revised detail A2 shows.');await form.getByRole('button',{name:'Answer privately',exact:true}).click()
 await capture(page,'estimator-receipts-and-acknowledgments',async()=>{await expect(record.getByRole('heading',{name:'Private response · plan revision 2',exact:true})).toHaveCount(2);await expect(record.getByText('Revision 2: Acknowledged by ',{exact:false})).toHaveCount(3);await expect(record.getByText('Declined: Crew unavailable for the requested start date',{exact:false})).toBeVisible();await expect(record.getByText('Past due date',{exact:false})).toHaveCount(3)})
 const state=await (await owner.request.get(base+`/api/plinth/bids/${job.id}`)).json(),bid=state.source.bids.find(b=>b.title===title),rival=bid.invitations[1].responses[0].attachments[0].id
 assert.equal((await bidders[0].request.get(base+`/api/plinth/bids/${job.id}/files/${rival}`)).status(),404)
 for(let n=0;n<3;n++){const response=await bidders[n].request.get(base+`/api/plinth/bids/${job.id}`),own=(await response.json()).source.bids[0];assert.equal(own.invitations.length,1);assert.deepEqual(own.lines.map(l=>l.cost_code),[codes[n]]);if(n!==0)assert.ok(!JSON.stringify(own).includes('Include two rows of blocking at the shower wall, as revised detail A2 shows.'))}
 await inbox(bp[0]);await capture(bp[0],'private-question-answered',async()=>expect(ownRecord(bp[0]).getByText('Private answer: Include two rows of blocking at the shower wall, as revised detail A2 shows.',{exact:false})).toBeVisible())
 await cp.goto(base+`/app?job=${job.id}&tab=Quote`);assert.equal((await client.request.get(base+`/api/plinth/bids/${job.id}`)).status(),404);const clientJob=await (await client.request.get(base+`/api/plinth/jobs/${job.id}`)).json();assert.equal(clientJob.job.bids,undefined);await capture(cp,'client-private-bids-absent',async()=>{await expect(cp.getByText(title,{exact:true})).toHaveCount(0);await expect(cp.getByRole('button',{name:'Bids',exact:true})).toHaveCount(0)})
 console.log('BID-001 PASS: three individual qualified released-scope invitations, exact revised originals, private scope/questions/two prices and decline, estimator acknowledgments/lateness; 1440/390')
 for(const context of contexts)await context.close()
}finally{await browser.close()}
