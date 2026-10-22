import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture } from './helpers.mjs'

test('ROLE-001 — owner, administrator and assignment-scoped project manager with a PO limit; refusals write nothing and a role change applies on the next request', async () => {
 const f = await createFixture()
 try {
  const admin = await f.invite('office@example.com', 'Office Admin', 'admin'), pm = await f.invite('pm@example.com', 'Pat Manager', 'admin')
  const api = (path, { method = 'GET', body, cookie = f.owner } = {}) => f.json('/api/plinth' + path, { method, cookie, ...(body ? { body } : {}) })
  const assigned = await createActiveJob(f, 'Burlington porch rebuild', 'porch@example.com'), other = await createActiveJob(f, 'Winooski basement finish', 'basement@example.com')
  const version = async id => (await api(`/jobs/${id}`)).value.job.version
  let r = await api('/team'); const person = r.value.team.find(m => m.email === 'pm@example.com')
  assert.equal(person.role, 'admin')
  const grant = { expected_version: 0, role: 'project_manager', job_ids: [assigned.id], po_limit_cents: 500_000 }
  assert.equal((await api(`/team/${person.id}`, { method: 'PUT', body: grant, cookie: admin })).status, 403, 'Only the owner changes access')
  assert.equal((await api(`/team/${person.id}`, { method: 'PUT', body: grant, cookie: pm })).status, 403)
  r = await api(`/team/${person.id}`, { method: 'PUT', body: grant }); assert.equal(r.status, 200, JSON.stringify(r.value))

  // Job routes: the project manager sees and works only the assigned job.
  r = await api('/jobs', { cookie: pm }); assert.equal(r.value.role, 'project_manager'); assert.deepEqual(r.value.jobs.map(j => j.id), [assigned.id])
  assert.equal((await api(`/jobs/${other.id}`, { cookie: pm })).status, 404)
  const before = await version(other.id)
  assert.equal((await api(`/jobs/${other.id}/orders`, { method: 'POST', cookie: pm, body: { expected_version: before, supplier: 'Lumber yard', description: 'Joists', amount_cents: 10_000 } })).status, 404)
  assert.equal(await version(other.id), before, 'An unassigned action writes nothing')
  assert.equal((await api('/jobs', { method: 'POST', cookie: pm, body: { name: 'New job', client_email: 'x@example.com' } })).status, 403, 'Project managers do not create jobs')
  r = await api('/jobs', { cookie: admin }); assert.equal(r.value.role, 'admin'); assert.equal(r.value.jobs.length, 2, 'Administrators manage every job')

  // PO routes: issue within the owner-set limit; over the limit fails without a write; administrators have no limit.
  let job = assigned
  const act = async (path, body = {}, cookie = pm) => { const result = await api(`/jobs/${job.id}${path}`, { method: 'POST', cookie, body: { expected_version: job.version, ...body } }); if (result.status === 200) job = result.value.job; return result }
  r = await act('/orders', { supplier: 'Champlain Lumber', description: 'Porch framing lumber', amount_cents: 500_000 }); assert.equal(r.status, 200)
  r = await act(`/orders/${r.value.record.id}/issue`); assert.equal(r.status, 200, 'A PO at the limit is within it'); assert.equal(r.value.record.issued_by.role, 'project_manager')
  r = await act('/orders', { supplier: 'Champlain Lumber', description: 'Composite decking', amount_cents: 500_001 }); const big = r.value.record.id
  const held = job.version
  r = await act(`/orders/${big}/issue`); assert.equal(r.status, 403); assert.equal(r.value.error, 'over_limit')
  assert.equal(await version(job.id), held, 'An over-limit PO writes nothing')
  r = await act(`/orders/${big}/issue`, {}, admin); assert.equal(r.status, 200, 'Administrators issue above the project manager limit')

  // Connector route: the project manager's calendar feed for the assigned job is rechecked on every fetch.
  r = await api(`/jobs/${job.id}/calendar`, { method: 'POST', cookie: pm, body: { expected_version: job.version, action: 'rotate' } }); assert.equal(r.status, 200, JSON.stringify(r.value))
  const feed = r.value.urlPath; assert.equal((await f.request(feed)).status, 200)
  assert.equal((await api(`/jobs/${other.id}/calendar`, { method: 'POST', cookie: pm, body: { expected_version: await version(other.id), action: 'rotate' } })).status, 404)
  // Company records, installation secrets, connectors and erasure.
  for (const [cookie, who] of [[pm, 'project manager'], [admin, 'administrator']]) {
   assert.equal((await api('/agent-credentials', { method: 'POST', cookie, body: {} })).status, 403, `No ${who} mints installation credentials`)
   assert.equal((await api('/agent-credentials', { cookie })).status, 403)
   assert.equal((await api(`/jobs/${job.id}`, { method: 'DELETE', cookie, body: { expected_version: job.version } })).status, 403, `No ${who} erases a job`)
   assert.equal((await api('/lien-waiver-templates', { method: 'PUT', cookie, body: { expected_version: 0, templates: [] } })).status, 403)
  }
  assert.equal((await api('/vendors', { cookie: pm })).status, 403, 'Project managers do not manage company records')
  assert.equal((await api('/company', { method: 'PUT', cookie: pm, body: { expected_version: 0 } })).status, 403)
  assert.equal((await api('/team', { cookie: pm })).status, 403)
  assert.equal((await f.request('/auth/invite', { method: 'POST', cookie: pm, body: { email: 'new-client@example.com', displayName: 'New Client', role: 'member', returnTo: '/app' } })).status, 403, 'Project managers cannot invite or change people')
  assert.equal((await f.request('/auth/operators', { cookie: pm })).status, 403)
  assert.equal((await api('/vendors', { cookie: admin })).status, 200, 'Administrators manage company records')
  assert.equal(await version(job.id), job.version)

  // Reassignment applies on the next request: administrator, then a project manager with no jobs.
  r = await api(`/team/${person.id}`, { method: 'PUT', body: { expected_version: 1, role: 'admin' } }); assert.equal(r.status, 200)
  assert.equal((await api(`/jobs/${other.id}`, { cookie: pm })).status, 200)
  assert.equal((await api('/jobs', { cookie: pm })).value.role, 'admin')
  r = await api(`/team/${person.id}`, { method: 'PUT', body: { expected_version: 0, role: 'project_manager', job_ids: [], po_limit_cents: 0 } }); assert.equal(r.status, 200)
  assert.equal((await api(`/jobs/${assigned.id}`, { cookie: pm })).status, 404, 'Removing the assignment removes the job on the next request')
  assert.equal((await f.request(feed)).status, 404, 'The calendar feed stops with the assignment')
  const audited = await f.db.prepare("SELECT count(*) AS n FROM oa_auth_audit WHERE action='plinth.role' AND value LIKE ?").bind(person.id + ':%').first()
  assert.equal(audited.n, 3, 'Each role change is audited')
  assert.equal((await api(`/jobs/${job.id}`, { method: 'DELETE', body: { expected_version: job.version } })).status, 200, 'The owner erases')
 } finally { await f.close() }
})

test('ROLE-003 — two client jobs keep selections, published records, direct files and calendar under the same owner-controlled feature preset', async()=>{
 const f=await createFixture()
 try{
  const client=await f.invite('synthetic-plinth-1@example.com','First client'),other=await f.invite('synthetic-plinth-2@example.com','Second client'),admin=await f.invite('synthetic-plinth-3@example.com','Office','admin'),agent=await f.agent()
  const api=(path,body,cookie=f.owner)=>f.json('/api/plinth'+path,{cookie,...(body===undefined?{}:{method:'POST',body})})
  let job=await createActiveJob(f,'synthetic-plinth-1','synthetic-plinth-1@example.com'),foreign=await createActiveJob(f,'synthetic-plinth-2','synthetic-plinth-2@example.com')
  const act=async(path,body={},cookie=f.owner)=>{const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie);job=(await api(`/jobs/${job.id}`)).value.job;return r}
  const photo={name:'synthetic-plinth-1.png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='}
  let r=await act('/diary',{note:'Published client photo',attachments:[photo]});assert.equal(r.status,200);const diary=r.value.record
  r=await act('/selections',{room:'Kitchen',category:'Faucet',allowance_cents:30000,cost_code:'22-400',decision_on:'2026-11-04',lead_days:10,options:[{name:'Brass faucet',supplier:'Synthetic supplier',specifications:'Exact single-hole brass finish',price_cents:30000}]});assert.equal(r.status,200);const selection=r.value.record,rev=selection.revisions[0]
  assert.equal((await act(`/selections/${selection.id}/present`,{revision_id:rev.id})).status,200)
  const sign={revision_id:rev.id,option_id:rev.options[0].id,confirm:true,statement:'I approve this exact brass faucet and price'}
  const held=job.version
  assert.equal((await act(`/selections/${selection.id}/sign`,sign,other)).status,404);assert.equal(job.version,held)
  assert.equal((await act(`/selections/${selection.id}/sign`,sign,client)).status,200)
  assert.equal(job.selections[0].revisions[0].signature.by.name,'First client')
  const path=`/jobs/${job.id}/diary/${diary.id}/attachments/${diary.attachments[0].id}`
  const download=await f.request('/api/plinth'+path,{cookie:client});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from(photo.base64,'base64'))
  for(const p of [`/jobs/${job.id}`,path,`/jobs/${job.id}/selections/${selection.id}/sign`]){const r=await api(p,p.endsWith('/sign')?{expected_version:job.version,...sign}:undefined,other);assert.equal(r.status,404)}
  assert.deepEqual((await api('/jobs',undefined,client)).value.jobs.map(j=>j.id),[job.id]);assert.deepEqual((await api('/jobs',undefined,other)).value.jobs.map(j=>j.id),[foreign.id])
  r=await act('/calendar',{action:'rotate'},client);assert.equal(r.status,200);const feed=r.value.urlPath;assert.equal((await f.request(feed)).status,200)
  const disabled={client:['contracts','selections','changes','schedule','photos','billing','todos','handover','punch','rfis'],subcontractor:[]},change={disabled,reason:'Owner restricts this job client preset'}
  assert.equal((await act('/portal-policy',change,admin)).status,403)
  assert.equal((await act('/portal-policy',change,client)).status,403)
  assert.equal((await f.json(`/api/plinth/jobs/${job.id}/portal-policy`,{method:'POST',token:agent,body:{expected_version:job.version,...change}})).status,403)
  assert.equal((await act('/portal-policy',{...change,disabled:{...disabled,client:['installation-secrets']}})).status,400)
  assert.equal((await act('/portal-policy',change)).status,200)
  const show=(await api(`/jobs/${job.id}`,undefined,client)).value.job
  for(const field of ['quotes','selections','variations','schedules','diary','invoices','claims','approvals'])assert.deepEqual(show[field],[],field+' is absent from the generic job door')
  assert.equal(show.portal_policy,undefined);assert.equal(show.portal_submissions,undefined)
  assert.equal((await f.request(feed)).status,404,'A previously minted calendar URL obeys the current preset')
  for(const p of [path,`/jobs/${job.id}/quotes/synthetic-plinth-1/cost-codes.json`,`/jobs/${job.id}/selections/${selection.id}/sign`,`/jobs/${job.id}/decision-files/synthetic-plinth-1`,`/jobs/${job.id}/invoices/synthetic-plinth-1/document.html`,`/jobs/${job.id}/punch`,`/jobs/${job.id}/punch/export.json`,`/jobs/${job.id}/punch/files/${diary.attachments[0].id}`,`/jobs/${job.id}/handover`,`/jobs/${job.id}/handover/files/${diary.attachments[0].id}`])assert.equal((await api(p,p.endsWith('/sign')?{expected_version:job.version,...sign}:undefined,client)).status,404,p)
  assert.equal((await api(`/jobs/${job.id}/calendar`,{expected_version:job.version,action:'rotate'},client)).status,404)
  const restrictedVersion=job.version
  assert.equal((await api(`/jobs/${job.id}/portal-policy`,{expected_version:held,disabled:{client:[],subcontractor:[]},reason:'Stale reset'})).status,409);assert.equal((await api(`/jobs/${job.id}`)).value.job.version,restrictedVersion)
  assert.equal((await api(`/jobs/${foreign.id}`,undefined,other)).status,200,'Another job preset is unchanged')
  assert.equal((await act('/portal-policy',{disabled:{client:[],subcontractor:[]},reason:'Restore reviewed client features'})).status,200)
  assert.equal((await f.request('/api/plinth'+path,{cookie:client})).status,200);assert.equal((await f.request(feed)).status,200)
  assert.equal(job.approvals.filter(a=>a.kind==='portal.policy').length,2,'Each actual feature change is an attributed immutable approval')
 }finally{await f.close()}
})

test('ROLE-003 — two subcontractor companies keep bills and unverified compliance originals isolated across job, search, export, downloads and revocation', async()=>{
 const f=await createFixture()
 try{
  const subs=await Promise.all([1,2].map(n=>f.invite(`synthetic-plinth-${n}@example.com`,`Trade ${n}`))),client=await f.invite('synthetic-plinth-3@example.com','Client'),agent=await f.agent()
  const api=(path,body,cookie=f.owner)=>f.json('/api/plinth'+path,{cookie,...(body===undefined?{}:{method:'POST',body})})
  let job=await createActiveJob(f,'synthetic-plinth-1','synthetic-plinth-3@example.com'),other=await createActiveJob(f,'synthetic-plinth-2','synthetic-plinth-3@example.com')
  const grants=[]
  for(let n=0;n<2;n++){
   let r=await api('/vendors',{kind:'subcontractor',name:`synthetic-plinth-company-${n+1}`,trades:['Framing'],contacts:[{id:`synthetic-plinth-${n+1}`,name:`Trade ${n+1}`,email:`synthetic-plinth-${n+1}@example.com`}]});assert.equal(r.status,201);const vendor=r.value.vendor
   r=await api(`/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Framing',status:'qualified',evidence:'Human-reviewed synthetic qualification'});assert.equal(r.status,200)
   const target=n===0?job:other;r=await api(`/jobs/${target.id}/subcontracts`,{expected_version:target.version,vendor_id:vendor.id,trade:'Framing',scope:`Awarded scope ${n+1}`,contact_ids:[`synthetic-plinth-${n+1}`],awarded_on:'2026-10-22'});assert.equal(r.status,200)
   const scope=r.value.record;r=await api(`/jobs/${target.id}/subcontracts/${scope.id}/release`,{expected_version:r.value.job.version});assert.equal(r.status,200);if(n===0)job=r.value.job;else other=r.value.job
   grants.push({vendor,scope,job:n===0?job:other})
  }
  // A second company on the first job still receives no first-company documents.
  let r=await api(`/jobs/${job.id}/subcontracts`,{expected_version:job.version,vendor_id:grants[1].vendor.id,trade:'Framing',scope:'Separate same-job company scope',contact_ids:['synthetic-plinth-2'],awarded_on:'2026-10-22'});assert.equal(r.status,200);job=r.value.job
  const exact=Buffer.from('%PDF-1.7\nsynthetic-plinth-1 original bill\n%%EOF'),file={name:'synthetic-plinth-1.pdf',base64:exact.toString('base64')},base=`/subcontractor-portal/${job.id}`
  const submit=async(kind,body,cookie=subs[0])=>{const r=await api(base+'/'+kind,{expected_version:job.version,subcontract_id:grants[0].scope.id,reference:'synthetic-plinth-1',note:'Synthetic original evidence',attachments:[file],...body},cookie);job=(await api(`/jobs/${job.id}`)).value.job;return r}
  assert.equal((await api(base,undefined,client)).status,404)
  assert.equal((await f.json('/api/plinth'+base,{token:agent})).status,403)
  assert.equal((await f.request('/api/plinth'+base)).status,401)
  const held=job.version
  assert.equal((await submit('bills',{amount_cents:123400,subcontract_id:grants[1].scope.id})).status,404);assert.equal(job.version,held)
  assert.equal((await submit('bills',{amount_cents:1.1})).status,400);assert.equal(job.version,held)
  r=await submit('bills',{amount_cents:123400});assert.equal(r.status,200,JSON.stringify(r.value));assert.equal(r.value.label,'Bill received, not approved or paid');const bill=r.value.source.submissions[0]
  assert.equal((await submit('bills',{amount_cents:123400})).status,409,'Bill reference cannot be received twice')
  r=await submit('compliance',{kind:'license',issuer:'Synthetic licensing authority',effective_on:'2026-01-01',expires_on:'2099-12-31',verified:true});assert.equal(r.status,400,'Subcontractor cannot verify their own evidence')
  r=await submit('compliance',{kind:'license',issuer:'Synthetic licensing authority',effective_on:'2026-01-01',expires_on:'2099-12-31'});assert.equal(r.status,200,JSON.stringify(r.value));assert.equal(r.value.label,'Evidence received, not verified')
  const compliance=r.value.source.submissions.find(s=>s.kind==='compliance'),metadata=(await api(`/vendors/${grants[0].vendor.id}`)).value.vendor
  assert.equal(metadata.compliance[0].review,undefined);assert.equal(metadata.compliance[0].id,compliance.compliance_id)
  const reviewDoor=await f.request(`/api/plinth/vendors/${metadata.id}/compliance/${compliance.compliance_id}`,{cookie:f.owner});assert.equal(reviewDoor.status,200);assert.deepEqual(Buffer.from(await reviewDoor.arrayBuffer()),exact,'Existing designated-reviewer door receives the same original')
  const ownPaths=[base,base+'?q=synthetic-plinth-1',base+'/export.json',base+'/export.json?q=synthetic-plinth-1',base+'/files/'+bill.attachments[0].id,base+'/files/'+compliance.attachments[0].id]
  for(const path of ownPaths){const response=await f.request('/api/plinth'+path,{cookie:subs[0]});assert.equal(response.status,200,path);if(path.includes('/files/'))assert.deepEqual(Buffer.from(await response.arrayBuffer()),exact);else{const text=await response.text();assert.ok(text.includes(bill.id));assert.ok(!text.includes(grants[1].vendor.id));for(const field of ['"rates":','"contacts":','"tax":','"quotes":','"client_email":'])assert.ok(!text.includes(field),field+' stays private')}}
  for(const cookie of [subs[1],client])for(const fileId of [bill.attachments[0].id,compliance.attachments[0].id])assert.equal((await f.request('/api/plinth'+base+'/files/'+fileId,{cookie})).status,404)
  for(const path of [base,base+'?q=synthetic-plinth-1',base+'/export.json']){r=await api(path,undefined,subs[1]);assert.equal(r.status,200,'Own second company scope may see the job label');assert.deepEqual((r.value.source??r.value).submissions,[],'Same-job company cannot search or export a rival bill')}
  for(const path of [`/jobs/${job.id}`,`/jobs/${job.id}/subcontractor-portal`, `/subcontractor-portal/${other.id}`])assert.equal((await api(path,undefined,subs[0])).status,404,path)
  r=await api('/subcontractor-portal',undefined,subs[0]);assert.deepEqual(r.value.sources.map(s=>s.id),[job.id])
  const clientJob=(await api(`/jobs/${job.id}`,undefined,client)).value.job;assert.equal(clientJob.portal_submissions,undefined);assert.equal(clientJob.subcontracts,undefined)
  assert.equal((await f.json(`/api/plinth/jobs/${job.id}`,{token:agent})).value.job.portal_submissions,undefined)
  const policy={disabled:{client:[],subcontractor:['bills','compliance']},reason:'Disable this job subcontractor intake'}
  r=await api(`/jobs/${job.id}/portal-policy`,{expected_version:job.version,...policy});assert.equal(r.status,200);job=r.value.job
  for(const path of [base,base+'?q=synthetic-plinth-1',base+'/export.json'])assert.deepEqual(((await api(path,undefined,subs[0])).value.source??(await api(path,undefined,subs[0])).value).submissions,[])
  for(const id of [bill.attachments[0].id,compliance.attachments[0].id])assert.equal((await f.request('/api/plinth'+base+'/files/'+id,{cookie:subs[0]})).status,404)
  assert.equal((await submit('bills',{reference:'synthetic-plinth-2',amount_cents:1})).status,404)
  assert.equal((await submit('compliance',{kind:'license',issuer:'Synthetic',effective_on:'2026-01-01',expires_on:'2099-12-31'})).status,404)
  r=await api(`/jobs/${job.id}/portal-policy`,{expected_version:job.version,disabled:{client:[],subcontractor:[]},reason:'Restore reviewed intake'});assert.equal(r.status,200);job=r.value.job
  r=await api(`/vendors/${metadata.id}`,{expected_version:metadata.version,contacts:[]});assert.equal(r.status,200)
  for(const path of ownPaths)assert.equal((await api(path,undefined,subs[0])).status,404,'Directory removal revokes every read, search, export and file door')
  assert.deepEqual((await api('/subcontractor-portal',undefined,subs[0])).value.sources,[])
  assert.equal((await submit('bills',{reference:'synthetic-plinth-3',amount_cents:1})).status,404)
  assert.equal((await api(`/jobs/${other.id}`,undefined,subs[0])).status,404)
 }finally{await f.close()}
})
