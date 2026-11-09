import assert from 'node:assert/strict'
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
const root=resolve(process.argv[2]),load=path=>import(pathToFileURL(join(root,path)))
const {createFixture}=await load('tests/plinth/helpers.mjs'),{collectionFixture}=await load('tests/plinth/collection-support.mjs')
const {fileRecords}=await load('node_modules/@runeditrun/rer/modules/portability/files.mjs')
const folder=await mkdtemp(join(tmpdir(),'synthetic-plinth-collection-recovery-')),source=join(folder,'source'),destination=join(folder,'destination'),erased=join(folder,'erased')
const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',RER_SERVER_JOURNEY:'1'};delete env.RER_LOCAL_OPERATION
const rer=join(root,'node_modules/@runeditrun/rer/global/rer.mjs')
async function checkout(target){
 for(const file of ['package.json','pnpm-lock.yaml','.node-version','OPERATIONS.json','rer-setup.json','wrangler.jsonc','vite.config.ts','deploy.json','deploy-site.json','scripts','src','public','migrations','README.md','ACCEPTANCE.md','RUN-LOCALLY.md','OPERATIONS.md','SEED-COMMAND-CONTRACT.md','CONTRACT.md','seed.json'])await cp(join(root,file),join(target,file),{recursive:true})
 await symlink(join(root,'node_modules'),join(target,'node_modules'),'dir')
}
function command(target,verb,...args){
 const result=spawnSync(process.execPath,[rer,verb,'--cwd',target,'--json','--no-queue',...args],{env,encoding:'utf8',timeout:180_000})
 assert.equal(result.status,0,result.stderr+'\n'+result.stdout)
 console.log('CLI '+verb+' exit=0')
}
async function signIn(f){
 const response=await f.request('/auth/magic-link',{method:'POST',body:{email:['builder','example.com'].join(String.fromCharCode(64))}});assert.equal(response.status,202)
 const link=new URL(f.messages.at(-1).text.match(/https?:\/\/[^\s<>]+/g).find(value=>new URL(value).pathname==='/auth/confirm'))
 const signed=await f.request('/auth/confirm',{method:'POST',body:{token:link.searchParams.get('token')}});assert.equal(signed.status,303)
 return signed.headers.get('set-cookie').split(';')[0]
}
let f
try{
 await checkout(source);await checkout(destination);await checkout(erased)
 execFileSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','DB','--local','--persist-to',join(source,'.wrangler/state'),'--config',join(source,'wrangler.jsonc')],{env,stdio:'pipe'})
 f=await createFixture({persistTo:source,now:Date.parse('2026-10-27T15:00:00Z')})
 const c=await collectionFixture(f),j=c.j,rootPath='/api/plinth'+c.root
 await c.receipt(10000,'synthetic-plinth-recovery-partial');await c.saveReview()
 await c.receipt(35000,'synthetic-plinth-recovery-covered');await c.saveReview()
 const original=j.job.invoices.find(i=>i.id===c.ids[0]).receipts.at(-1)
 await j.act('/invoices/'+c.ids[0]+'/return-receipt',{receipt_id:original.id,amount_cents:7500,returned_on:'2026-10-30',reference:'synthetic-plinth-recovery-return',reason:'Staff recorded partial native return',confirm:true})
 const beforeSave=await c.readReviews(),captured={expected_version:beforeSave.version,source_digest:beforeSave.source_digest,review_generation:beforeSave.review_generation,owner_version:beforeSave.owner_version,confirm:true}
 const review=await c.saveReview(),history=(await c.readReviews()).reviews.map(({stale,revoked,authority_current,...r})=>r)
 const financial=structuredClone({invoices:j.job.invoices,remittances:j.job.remittances,retainage:j.job.retainage}),cookie=f.owner
 await f.close();f=undefined
 const archive=join(folder,'collection.rer');command(source,'export','--output',archive);command(destination,'import','--input',archive,'--yes')
 const parts=[];for await(const part of fileRecords(archive))parts.push(part)
 const table=parts.flatMap(p=>p.tables??[]).find(t=>t.name==='pl_jobs');assert.ok(table,'Native jobs are present in the real archive')
 f=await createFixture({persistTo:destination,ownerCookie:cookie,now:Date.parse('2026-10-27T15:00:00Z')})
 const owner=await signIn(f),json=(path,body)=>f.json(path,{cookie:owner,...(body?{method:'POST',body}:{})})
 const restored=(await json(rootPath)).value
 assert.deepEqual(restored.reviews.map(({stale,revoked,authority_current,...r})=>r),history)
 assert.ok(restored.reviews.every(r=>!r.authority_current),'No restored review has standing authority')
 assert.equal((await json(rootPath+'/'+review.id+'/preview?as_of=2026-10-30T15:00:00Z')).value.error,'collection_authority')
 assert.equal((await json(rootPath,captured)).value.error,'collection_authority','Captured old consent cannot activate another review')
 const fresh=await json(rootPath,{expected_version:restored.version,source_digest:restored.source_digest,review_generation:restored.review_generation,owner_version:restored.owner_version,confirm:true});assert.equal(fresh.status,200)
 assert.notEqual(fresh.value.record.id,review.id)
 const preview=await json(rootPath+'/'+fresh.value.record.id+'/preview?as_of=2026-10-30T15:00:00Z');assert.equal(preview.status,200)
 assert.equal(preview.value.invoices.find(i=>i.invoice_id===c.ids[0]).collectible_cents,7500);assert.equal(preview.value.invoices.find(i=>i.invoice_id===c.ids[1]).collectible_cents,45000)
 assert.equal(preview.value.held_retainage_cents,10000);assert.equal(preview.value.unapplied_remittance_cents,2000);assert.equal(preview.value.case_status,'unresolved')
 assert.ok(preview.value.invoices.flatMap(i=>i.actions).every(a=>a.status==='withheld'),'Restored rules remain inert until independently reconfigured')
 const recovered=(await json('/api/plinth/jobs/'+j.job.id)).value.job
 assert.deepEqual({invoices:recovered.invoices,remittances:recovered.remittances,retainage:recovered.retainage},financial)
 assert.equal(f.messages.length,1,'Only the explicit receiving owner sign-in sends mail')
 const revoked=await json(rootPath+'/'+fresh.value.record.id+'/revoke',{expected_version:fresh.value.version,source_digest:restored.source_digest,review_generation:restored.review_generation,owner_version:restored.owner_version,confirm:true,reason:'Destination owner withdrew prospective use'});assert.equal(revoked.status,200)
 assert.equal((await json(rootPath+'/'+fresh.value.record.id+'/preview?as_of=2026-10-30T15:00:00Z')).value.error,'collection_revoked')
 const erasedResponse=await f.json('/api/plinth/jobs/'+j.job.id,{method:'DELETE',cookie:owner,body:{expected_version:revoked.value.version}});assert.equal(erasedResponse.status,200)
 assert.equal((await json(rootPath,captured)).status,404)
 await f.close();f=undefined
 const journal=join(folder,'later-erasure.rer');command(destination,'export','--output',journal);command(erased,'import','--input',archive,'--journal',journal,'--yes')
 f=await createFixture({persistTo:erased,ownerCookie:cookie,now:Date.parse('2026-10-27T15:00:00Z')})
 const receivingOwner=await signIn(f)
 assert.equal((await f.json(rootPath,{cookie:receivingOwner})).status,404)
 assert.equal((await f.json(rootPath,{method:'POST',cookie:receivingOwner,body:captured})).status,404)
 assert.equal(f.messages.length,1)
 console.log('AUTO-004 recovery PASS: real CLI export and import, exact immutable reviews and sources, independent 7500 and 45000 residuals, retainage and unapplied separation, restored authority and capture refusal, explicit new review, inert restored sequences, revocation and later erasure journal fence, zero incidental provider calls')
}finally{await f?.close();await rm(folder,{recursive:true,force:true})}
