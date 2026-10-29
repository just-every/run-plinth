import assert from 'node:assert/strict'
import { mkdtemp, cp, symlink, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { createFixture } from '../plinth/helpers.mjs'
import { costFixture, original } from '../plinth/cost-support.mjs'
import { installedWorker } from '../../scripts/verify/installed-worker.mjs'

const root=resolve('.'),scratch=await mkdtemp(join(tmpdir(),'synthetic-plinth-recovery-')),source=join(scratch,'source'),destination=join(scratch,'destination'),shots=resolve(process.env.PLINTH_SCREENSHOTS??process.env.PLINTH_SCREENSHOTS_ROOT??'artifacts/installed/recovery-reconciliation')
const commandEnv={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',RER_SERVER_JOURNEY:'1'};delete commandEnv.RER_LOCAL_OPERATION
const rer=join(root,'node_modules/@runeditrun/rer/global/rer.mjs'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64')
const command=(cwd,verb,...args)=>{const r=spawnSync(process.execPath,[rer,verb,'--cwd',cwd,'--json','--no-queue',...args],{env:commandEnv,encoding:'utf8',timeout:180_000});assert.equal(r.status,0,'Native CLI '+verb+' completes: '+r.stderr+'\n'+r.stdout)}
async function checkout(target){
 for(const file of ['package.json','pnpm-lock.yaml','.node-version','OPERATIONS.json','rer-setup.json','wrangler.jsonc','vite.config.ts','deploy.json','deploy-site.json','scripts','src','public','migrations','README.md','ACCEPTANCE.md','RUN-LOCALLY.md','OPERATIONS.md','SEED-COMMAND-CONTRACT.md','CONTRACT.md','seed.json'])await cp(join(root,file),join(target,file),{recursive:true})
 await symlink(join(root,'node_modules'),join(target,'node_modules'),'dir')
}
let f,worker,browser
try{
 await mkdir(shots,{recursive:true});await checkout(source);await checkout(destination)
 execFileSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','DB','--local','--persist-to',join(source,'.wrangler/state'),'--config',join(source,'wrangler.jsonc')],{env:commandEnv,stdio:'pipe'})
 f=await createFixture({persistTo:source});const c=await costFixture(f)
 let r=await c.ok('/costs/bills',c.bill());await c.ok(`/costs/bills/${r.record.id}/review`,{reason:'Reviewed source and receipt discrepancy'});await c.ok(`/costs/bills/${r.record.id}/post`)
 const invoice=await c.ok('/invoices',{kind:'deposit',description:'Synthetic recovery deposit',recipient_email:['synthetic-plinth-client','example.com'].join('@'),amount_cents:10000,due_on:'2026-11-01',terms:'Reviewed recovery terms'})
 await c.ok(`/invoices/${invoice.record.id}/issue`)
 await c.ok(`/invoices/${invoice.record.id}/receipt`,{amount_cents:2500,received_on:'2026-10-23',reference:'synthetic-plinth-receipt-1',method:'bank',confirm:true})
 await c.ok('/diary',{date:'2026-10-23',note:'Synthetic original recovery photo',attachments:[{name:'synthetic-plinth.png',mime:'image/png',base64:png.toString('base64')}]})
 const job=await c.read(),attachment=job.diary[0].attachments[0],manifestResponse=await f.request('/api/plinth/recovery/manifest.json',{cookie:f.owner});assert.equal(manifestResponse.status,200)
 const manifest=await manifestResponse.json(),controls=manifest.controls.find(row=>row.currency==='USD')
 assert.equal(controls.issued_invoices,1);assert.equal(controls.issued_gross_cents,10000);assert.equal(controls.receipts_cents,2500);assert.equal(controls.posted_cost_cents,43000)
 const checksum=bytes=>createHash('sha256').update(bytes).digest('hex')
 assert.ok(manifest.files.some(file=>file.sha256===checksum(png)&&file.size===png.length))
 assert.ok(manifest.files.some(file=>file.sha256===checksum(Buffer.from(original.base64,'base64'))))
 await f.close();f=undefined
 const archive=join(scratch,'native.rer');command(source,'export','--output',archive);command(destination,'import','--input',archive,'--yes')
 const messages=[]
 worker=await installedWorker(async request=>{assert.equal(request.url,'https://api.resend.com/emails','No financial or connector provider operation occurs');messages.push(await request.json());return Response.json({id:crypto.randomUUID()})},{persistTo:destination})
 browser=await chromium.launch({headless:true,executablePath:process.env.PLINTH_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic',...(process.env.PLINTH_CHROMIUM_PATH?['--no-sandbox']:[])]})
 const owner=await browser.newContext({viewport:{width:1440,height:1000}}),page=await owner.newPage(),base=worker.origin
 const post=(path,data)=>owner.request.post(base+path,{headers:{origin:base},data,maxRedirects:0})
 assert.equal((await post('/auth/magic-link',{email:worker.bindings.OWNER_EMAIL,returnTo:'/app'})).status(),202)
 const link=messages.at(-1).text.match(/https?:\/\/[^\s<>]+/g).map(value=>new URL(value)).find(value=>value.pathname==='/auth/confirm')
 assert.ok(link)
 // The fixture owns this one-time native confirmation; never print the link.
 assert.equal((await post('/auth/confirm',{token:link.searchParams.get('token')})).status(),303)
 await page.goto(base+'/app')
 if(new URL(page.url()).pathname==='/setup'){
  await page.getByLabel('Your name',{exact:true}).fill('Synthetic recovery owner');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Finish setup',exact:true}).click();await page.waitForURL('**/app')
 }
 const beforeMessages=messages.length
 const destinationManifest=await (await owner.request.get(base+'/api/plinth/recovery/manifest.json')).json()
 assert.deepEqual(destinationManifest.controls,manifest.controls);assert.deepEqual(destinationManifest.files,manifest.files)
 const clean=await post('/api/plinth/recovery/reconcile',{manifest});assert.equal(clean.status(),200);assert.equal((await clean.json()).matches,true)
 const originalDownload=await owner.request.get(base+`/api/plinth/jobs/${job.id}/diary/${job.diary[0].id}/attachments/${attachment.id}`);assert.equal(originalDownload.status(),200);assert.deepEqual(await originalDownload.body(),png)
 await page.getByRole('button',{name:'People & access',exact:true}).click()
 await page.getByText('Settings',{exact:true}).click()
 const panel=page.getByRole('region',{name:'Recovery reconciliation',exact:true})
 await panel.getByText('Backup recovery comparison',{exact:true}).click()
 const downloadWait=page.waitForEvent('download');await panel.getByRole('link',{name:'Download recovery manifest',exact:true}).click();assert.equal((await downloadWait).suggestedFilename(),'plinth-recovery-manifest.json')
 await panel.getByLabel('Source recovery manifest',{exact:true}).setInputFiles({name:'synthetic-plinth-source.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))})
 await panel.getByRole('button',{name:'Compare recovery manifest',exact:true}).click()
 await expect(panel.getByRole('heading',{name:'Inventory matches',exact:true})).toBeVisible()
 await expect(panel.getByText('Control totals match',{exact:false})).toBeVisible()
 await page.screenshot({path:join(shots,'native-recovery-matched-1440.png'),fullPage:true})
 const changed=structuredClone(manifest),item=changed.records.find(row=>row.kind==='pl_jobs');item.sha256='0'.repeat(64);changed.records.push({identity:'synthetic-plinth-missing',kind:'pl_jobs',sha256:'1'.repeat(64)});changed.records.splice(changed.records.findIndex(row=>row.kind==='revision-reference'),1);changed.files[0].sha256='0'.repeat(64);changed.controls[0].receipts_cents++
 await panel.getByLabel('Source recovery manifest',{exact:true}).setInputFiles({name:'synthetic-plinth-altered.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(changed))})
 await panel.getByRole('button',{name:'Compare recovery manifest',exact:true}).click()
 await expect(panel.getByRole('heading',{name:'Inventory differences found',exact:true})).toBeVisible()
 const diff=await (await post('/api/plinth/recovery/reconcile',{manifest:changed})).json()
 assert.deepEqual(diff.records.missing,['synthetic-plinth-missing']);assert.equal(diff.records.extra.length,1);assert.ok(diff.records.mismatched.includes(item.identity));assert.equal(diff.files.mismatched.length,1);assert.equal(diff.control_totals.match,false)
 await page.screenshot({path:join(shots,'native-recovery-differences-1440.png'),fullPage:true})
 await page.setViewportSize({width:390,height:900});await page.screenshot({path:join(shots,'native-recovery-differences-390.png'),fullPage:true})
 assert.equal(messages.length,beforeMessages,'Reconciliation and original downloads cause no sending or provider effect')
 const after=await (await owner.request.get(base+'/api/plinth/recovery/manifest.json')).json();assert.deepEqual(after,destinationManifest,'Comparison and manifest download change no native record or authority')
 console.log('Recovery reconciliation PASS: native CLI round trip, source controls, original bytes, owner Settings comparison and both screen widths')
}finally{await browser?.close();await worker?.close();await f?.close();await rm(scratch,{recursive:true,force:true})}
