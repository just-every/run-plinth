import { costFixture } from './cost-support.mjs'
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
  const compliance=r.value.source.submissions.find(s=>s.kind==='compliance');let metadata=(await api(`/vendors/${grants[0].vendor.id}`)).value.vendor
  assert.equal(metadata.compliance[0].review,undefined);assert.equal(metadata.compliance[0].id,compliance.compliance_id)
  const reviewDoor=await f.request(`/api/plinth/vendors/${metadata.id}/compliance/${compliance.compliance_id}`,{cookie:f.owner});assert.equal(reviewDoor.status,200);assert.deepEqual(Buffer.from(await reviewDoor.arrayBuffer()),exact,'Existing designated-reviewer door receives the same original')
  assert.equal(compliance.review_status,'pending')
  r=await api(`/vendors/${metadata.id}/compliance/${compliance.compliance_id}/review`,{expected_version:metadata.version,decision:'verified',note:'Private reviewer note remains in office custody'});assert.equal(r.status,200);metadata=r.value.vendor
  const reviewed=(await api(base,undefined,subs[0])).value.source.submissions.find(s=>s.kind==='compliance');assert.equal(reviewed.review_status,'verified');assert.ok(!JSON.stringify(reviewed).includes('Private reviewer note'),'The company sees the current decision, not internal review notes')
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
  r=await api(`/vendors/${metadata.id}`,{expected_version:metadata.version,contacts:[{id:'synthetic-plinth-1',name:'Current client overlap',email:'synthetic-plinth-3@example.com'}]});assert.equal(r.status,200)
  for(const path of ownPaths)assert.equal((await api(path,undefined,client)).status,404,'Client authority takes precedence over an overlapping company contact on the same job')

  for(const path of ownPaths)assert.equal((await api(path,undefined,subs[0])).status,404,'Directory removal revokes every read, search, export and file door')
  assert.deepEqual((await api('/subcontractor-portal',undefined,subs[0])).value.sources,[])
  assert.equal((await submit('bills',{reference:'synthetic-plinth-3',amount_cents:1})).status,404)
  assert.equal((await api(`/jobs/${other.id}`,undefined,subs[0])).status,404)
 }finally{await f.close()}
})

test('ROLE-002 — estimator, superintendent and crew work assigned jobs; margin, pay, money and approval routes stay closed and unassigned jobs write nothing', async () => {
 const { takeoffPlan } = await import('../fixtures/takeoff-plan.mjs')
 const f = await createFixture()
 try {
  const people = {}
  for (const [key, name] of [['estimator', 'Erin Estimator'], ['superintendent', 'Sam Superintendent'], ['crew', 'Casey Crew']]) people[key] = { cookie: await f.invite(`${key}@example.com`, name, 'admin'), email: `${key}@example.com` }
  const api = (path, { method = 'GET', body, cookie = f.owner, token } = {}) => f.json('/api/plinth' + path, { method, cookie, token, ...(body ? { body } : {}) })
  const team = (await api('/team')).value.team
  for (const key of Object.keys(people)) people[key].id = team.find(m => m.email === people[key].email).id
  // The lead is a job still being quoted; the site is an active job; the other job is assigned to nobody.
  let r = await api('/jobs', { method: 'POST', body: { name: 'Shelburne kitchen lead', client_email: 'lead@example.com', address: '9 Lake Road' } }); assert.equal(r.status, 201); let lead = r.value.job
  const site = await createActiveJob(f, 'Charlotte addition', 'site@example.com'), other = await createActiveJob(f, 'Hinesburg garage', 'garage@example.com')
  const assign = async (key, job_ids, expected_version = 0, role = key) => api(`/team/${people[key].id}`, { method: 'PUT', body: { expected_version, role, job_ids, po_limit_cents: 0 } })
  assert.equal((await assign('estimator', [lead.id], 0)).status, 200); assert.equal((await assign('superintendent', [site.id], 0)).status, 200); assert.equal((await assign('crew', [site.id], 0)).status, 200)
  assert.equal((await api(`/team/${people.crew.id}`, { method: 'PUT', cookie: people.superintendent.cookie, body: { expected_version: 1, role: 'admin' } })).status, 403, 'Only the owner changes a role')
  const version = async id => (await api(`/jobs/${id}`)).value.job.version
  const closed = async (cookie, method, path, body) => { const result = await api(path, { method, cookie, body }); assert.ok([401, 403, 404].includes(result.status), `${method} ${path} must be closed: ${result.status}`); return result }

  // Estimator: lead, proposal, takeoff, rates, bid package; no acceptance, money or award.
  const est = people.estimator.cookie
  r = await api('/jobs', { cookie: est }); assert.deepEqual(r.value.jobs.map(j => j.id), [lead.id]); assert.equal(r.value.role, 'estimator'); assert.equal(r.value.currency_totals, undefined)
  for (const job of [site, other]) { assert.equal((await api(`/jobs/${job.id}`, { cookie: est })).status, 404); const held = await version(job.id); assert.equal((await api(`/jobs/${job.id}/quotes`, { method: 'POST', cookie: est, body: { expected_version: held, lines: [{ description: 'Unassigned', quantity: 1, unit_cents: 100 }] } })).status, 404); assert.equal(await version(job.id), held, 'An unassigned job is not written') }
  const act = async (path, body = {}, cookie = est) => { const result = await api(`/jobs/${lead.id}${path}`, { method: 'POST', cookie, body: { expected_version: lead.version, ...body } }); if (result.status === 200) lead = (await api(`/jobs/${lead.id}`)).value.job; return result }
  const codes = ['06-100', '06-200']
  r = await act('/quotes', { lines: codes.map((code, n) => ({ id: `synthetic-plinth-${n + 1}`, description: `Synthetic estimate scope ${n + 1}`, quantity: '1', unit: 'job', unit_cents: 100000, cost_code: code, phase: 'Structure', category: 'labor' })) }); assert.equal(r.status, 200, JSON.stringify(r.value)); assert.equal(r.value.record.prepared_by.role, 'estimator')
  const drawing = { name: 'synthetic-plinth-plan.pdf', mime: 'application/pdf', base64: takeoffPlan().toString('base64') }
  r = await act('/takeoff', { name: 'A1 Kitchen', page: 1, width: 400, height: 400, document: drawing }); assert.equal(r.status, 200, JSON.stringify(r.value))
  assert.equal((await f.request(`/api/plinth/jobs/${lead.id}/takeoff-files/${lead.takeoff[0].revisions[0].document.id}`, { cookie: est })).status, 200)
  assert.equal((await api(`/jobs/${lead.id}/quotes/${lead.quotes[0].id}/cost-codes.json`, { cookie: est })).status, 200)
  assert.equal((await api('/pricing-rates', { cookie: est })).status, 200); assert.equal((await api('/estimate-catalog', { cookie: est })).status, 200)
  assert.equal((await api('/pricing-rates', { method: 'POST', cookie: est, body: { jurisdiction: 'VT' } })).status, 403, 'Rates are maintained by owners and administrators')
  assert.equal((await api('/estimate-catalog', { method: 'POST', cookie: est, body: { kind: 'rate' } })).status, 403)
  const bid = { title: 'Synthetic framing package', trade: 'Framing', scope: 'Estimator draft', mode: 'priced', lines: codes.map((cost_code, n) => ({ cost_code, description: `Scope ${n + 1}`, budget_cents: 100000 })), note: 'Initial plans', due_on: '2099-12-31', plans: [{ name: 'synthetic-plinth-1.pdf', base64: Buffer.from('%PDF-1.7\nsynthetic-plinth-1 plan\n%%EOF').toString('base64') }] }
  r = await api(`/bids/${lead.id}`, { method: 'POST', cookie: est, body: { expected_version: lead.version, ...bid } }); assert.equal(r.status, 201, JSON.stringify(r.value)); const package_id = r.value.record_id
  assert.equal((await api(`/bids/${lead.id}/${package_id}/publish`, { method: 'POST', cookie: est, body: { expected_version: (await version(lead.id)), confirm: true } })).status, 403, 'Publishing a bid package to subcontractors stays with owners and administrators')
  lead = (await api(`/jobs/${lead.id}`)).value.job
  const held = lead.version, quote = lead.quotes[0]
  for (const [path, body] of [[`/quotes/${quote.id}/accept`, { method: 'email', evidence: 'x', schedule_choice: { kind: 'none', reason: 'x' } }], ['/variations', { description: 'x', amount_cents: 1 }], ['/orders', { supplier: 'x', description: 'x', amount_cents: 1 }], ['/invoices', {}], ['/remittances', {}], ['/claims', {}], ['/selections', {}], ['/subcontracts', {}], ['/budget', {}]]) assert.equal((await act(path, body)).status, 403, path + ' is refused')
  assert.equal(await version(lead.id), held, 'Refused routes write nothing')
  for (const path of ['/vendors', '/company', '/team', '/reports/records', `/jobs/${lead.id}/invoices/x/document.json`, `/jobs/${lead.id}/orders/x`]) await closed(est, 'GET', path)
  const view = (await api(`/jobs/${lead.id}`, { cookie: est })).value.job
  for (const key of ['approvals', 'invoices', 'orders', 'claims', 'variations', 'diary', 'schedules']) assert.deepEqual(view[key] ?? [], [], `${key} is hidden from the estimator`)
  assert.equal(view.remittances, undefined); assert.equal(view.budgets, undefined)

  // Superintendent and crew: assigned plans, tasks, logs, issues and their own checklist items; no client pricing, margins, pay or approvals.
  const sup = people.superintendent.cookie, crew = people.crew.cookie
  let job = site
  const owner = async (path, body = {}) => { const result = await api(`/jobs/${job.id}${path}`, { method: 'POST', body: { expected_version: job.version, ...body } }); assert.equal(result.status, result.status < 300 ? result.status : 200, JSON.stringify(result.value)); job = (await api(`/jobs/${job.id}`)).value.job; return result.value }
  await owner('/takeoff', { name: 'S1 Addition', page: 1, width: 400, height: 400, document: drawing })
  await owner('/schedules', { trade: 'Framing', description: 'Frame addition walls', start: '2026-11-06T08:00:00Z', end: '2026-11-06T16:00:00Z' })
  const todo = (await owner('/todos', { title: 'Wall layout walk', due_at: '2026-11-05T17:00', items: [{ title: 'Superintendent layout check', assignee: { kind: 'office', email: people.superintendent.email } }, { title: 'Crew stud check', assignee: { kind: 'office', email: people.crew.email } }] })).todo
  for (const [name, cookie] of [['superintendent', sup], ['crew', crew]]) {
   r = await api('/jobs', { cookie }); assert.deepEqual(r.value.jobs.map(j => j.id), [site.id], name + ' lists only the assigned job'); assert.equal(r.value.currency_totals, undefined)
   const show = r.value.jobs[0]
   assert.equal(show.schedules[0].description, 'Frame addition walls'); assert.equal(show.takeoff[0].name, 'S1 Addition')
   for (const key of ['quotes', 'variations', 'orders', 'claims', 'approvals']) assert.deepEqual(show[key], [], `${key} client pricing is hidden from ${name}`)
   for (const key of ['invoices', 'remittances', 'budgets', 'subcontracts', 'retainage', 'bids', 'todos']) assert.equal(show[key], undefined, `${key} is hidden from ${name}`)
   assert.equal(show.client_email, '')
   assert.equal((await f.request(`/api/plinth/jobs/${site.id}/takeoff-files/${job.takeoff[0].revisions[0].document.id}`, { cookie })).status, 200, 'Assigned plans download')
   assert.equal((await api(`/jobs/${other.id}`, { cookie })).status, 404, 'The unassigned job is absent'); assert.equal((await api(`/jobs/${other.id}/punch`, { cookie })).status, 404)
   const held = await version(other.id); assert.equal((await api(`/jobs/${other.id}/diary`, { method: 'POST', cookie, body: { expected_version: held, note: 'Unassigned' } })).status, name === 'crew' ? 403 : 404); assert.equal(await version(other.id), held)
   for (const [method, path] of [['GET', `/jobs/${site.id}/quotes/${job.quotes[0].id}/cost-codes.json`], ['GET', `/jobs/${site.id}/invoices/x/document.json`], ['GET', '/vendors'], ['GET', '/company'], ['GET', '/team'], ['GET', '/reports/records'], ['GET', `/jobs/${site.id}/time`], ['GET', '/payroll'], ['GET', `/jobs/${site.id}/labor-rates`], ['GET', '/pricing-rates'], ['GET', '/estimate-catalog'], ['GET', `/bids/${site.id}`], ['POST', '/agent-credentials'], ['DELETE', `/jobs/${site.id}`]]) await closed(cookie, method, path, method === 'GET' ? undefined : {})
   const before = await version(site.id)
   for (const path of ['/orders', '/quotes', '/variations', '/schedules', '/invoices', '/selections', `/quotes/${site.id}/accept`]) assert.equal((await api(`/jobs/${site.id}${path}`, { method: 'POST', cookie, body: { expected_version: before } })).status, 403, `${name} ${path}`)
   assert.equal(await version(site.id), before, 'Refused routes write nothing')
  }
  // Daily work: the superintendent saves a log draft with a photo and captures an observation; the office publishes; crew read.
  const photo = { name: 'synthetic-plinth-photo.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=' }
  const field = async (cookie, path, body = {}) => api(`/jobs/${site.id}${path}`, { method: 'POST', cookie, body: { expected_version: (await version(site.id)), ...body } })
  assert.equal((await field(crew, '/diary', { note: 'Crew log', attachments: [photo] })).status, 403, 'Crew read logs; they do not write them')
  r = await field(sup, '/diary', { note: 'Walls framed to the second plate', attachments: [photo] }); assert.equal(r.status, 200, JSON.stringify(r.value)); const diary = r.value.record
  assert.equal(diary.status, 'draft'); assert.equal(diary.prepared_by.role, 'superintendent')
  assert.equal((await field(sup, `/diary/${diary.id}/approve`)).status, 403, 'Publishing to the client is an office approval')
  const shown = cookie => api(`/jobs/${site.id}`, { cookie }).then(x => x.value.job.diary.map(d => d.id))
  assert.deepEqual(await shown(sup), [diary.id]); assert.deepEqual(await shown(crew), [], 'Crew see published logs only')
  const photoPath = `/api/plinth/jobs/${site.id}/diary/${diary.id}/attachments/${diary.attachments[0].id}`
  assert.equal((await f.request(photoPath, { cookie: sup })).status, 200); assert.equal((await f.request(photoPath, { cookie: crew })).status, 404)
  job = (await api(`/jobs/${site.id}`)).value.job; await owner(`/diary/${diary.id}/approve`)
  assert.deepEqual(await shown(crew), [diary.id]); assert.equal((await f.request(photoPath, { cookie: crew })).status, 200)
  const observation = { title: 'Stud out of plumb', description: 'North wall stud 7 is 1/2 inch out of plumb', kind: 'quality', severity: 'normal', due_on: '2026-11-04', location: 'North wall', photo, annotation: { x: .4, y: .6, note: 'Stud 7' } }
  assert.equal((await api(`/jobs/${site.id}/punch/issues`, { method: 'POST', cookie: crew, body: { expected_version: await version(site.id), ...observation } })).status, 403)
  r = await api(`/jobs/${site.id}/punch/issues`, { method: 'POST', cookie: sup, body: { expected_version: await version(site.id), ...observation } }); assert.equal(r.status, 200, JSON.stringify(r.value)); const issue = r.value.record
  assert.equal((await api(`/jobs/${site.id}/punch`, { cookie: crew })).value.issues[0].id, issue.id, 'Crew see the observation')
  for (const action of ['assign', 'review', 'release']) assert.equal((await api(`/jobs/${site.id}/punch/issues/${issue.id}/${action}`, { method: 'POST', cookie: sup, body: { expected_version: await version(site.id) } })).status, 403, `Punch ${action} stays with the office`)
  // Checklist items are each person's own.
  const path = `/jobs/${site.id}/todos/${todo.id}`, item = i => todo.items[i].id, revision = async () => (await api(path)).value.todo.revision
  for (const [cookie, mine, theirs] of [[sup, 0, 1], [crew, 1, 0]]) {
   const seen = (await api('/todos', { cookie })).value.todos; assert.deepEqual(seen.flatMap(t => t.items.map(i => i.id)), [item(mine)], 'Each person sees their own item')
   assert.equal((await api(`${path}/complete`, { method: 'POST', cookie, body: { expected_revision: await revision(), operation_id: crypto.randomUUID(), item_id: item(theirs) } })).status, 404)
   assert.equal((await api(`${path}/complete`, { method: 'POST', cookie, body: { expected_revision: await revision(), operation_id: crypto.randomUUID(), item_id: item(mine) } })).status, 200)
   assert.equal((await api(`${path}/edit`, { method: 'POST', cookie, body: { expected_revision: await revision(), operation_id: crypto.randomUUID(), title: 'x' } })).status, 403)
  }
  // The owner narrows a preset; the next request applies it and each change is audited.
  assert.equal((await assign('superintendent', [site.id], 1, 'crew')).status, 200)
  assert.equal((await field(sup, '/diary', { note: 'After narrowing' })).status, 403); assert.equal((await api('/jobs', { cookie: sup })).value.role, 'crew')
  assert.equal((await assign('superintendent', [], 2, 'admin')).status, 200); assert.equal((await api('/jobs', { cookie: sup })).value.role, 'admin')
  const audited = await f.db.prepare("SELECT value FROM oa_auth_audit WHERE action='plinth.role' AND value LIKE ? ORDER BY created_at").bind(people.superintendent.id + ':%').all()
  assert.deepEqual(audited.results.map(a => a.value), [`${people.superintendent.id}:superintendent:1`, `${people.superintendent.id}:crew:2`, `${people.superintendent.id}:admin`])
 } finally { await f.close() }
})

test('ROLE-006 — custom roles copied from presets resolve one permission on every route, view, export and approval limit on the next request; nobody grants a permission they lack', async () => {
 const f = await createFixture()
 try {
  const people = {}
  for (const [key, name] of [['lead', 'Lee Carpenter'], ['office', 'Olive Manager'], ['junior', 'Jun Admin']]) people[key] = { cookie: await f.invite(`${key}@example.com`, name, 'admin'), email: `${key}@example.com` }
  const api = (path, { method = 'GET', body, cookie = f.owner } = {}) => f.json('/api/plinth' + path, { method, cookie, ...(body ? { body } : {}) })
  for (const key of Object.keys(people)) people[key].id = (await api('/team')).value.team.find(m => m.email === people[key].email).id
  let job = (await api('/jobs', { method: 'POST', body: { name: 'Roles Street build', client_email: 'roles-client@example.com', address: '5 Roles Street' } })).value.job
  const act = async (path, body = {}, cookie = f.owner) => { const r = await api(`/jobs/${job.id}${path}`, { method: 'POST', cookie, body: { expected_version: job.version, ...body } }); if (r.status === 200) job = (await api(`/jobs/${job.id}`)).value.job; return r }
  assert.equal((await act('/quotes', { lines: [{ id: 'framing', description: 'Private framing estimate', cost_code: '06-100', phase: 'Framing', category: 'labor', quantity: '1', unit: 'job', unit_cents: 1000000, cost_unit_cents: 600000 }] })).status, 200)
  assert.equal((await act(`/quotes/${job.quotes[0].id}/accept`, { method: 'signed', evidence: 'Signed contract', schedule_choice: { kind: 'none', reason: 'Planned later' } })).status, 200)
  assert.ok(job.budgets?.length, 'The accepted estimate froze a budget')
  const assign = (key, body, expected_version = 0) => api(`/team/${people[key].id}`, { method: 'PUT', body: { expected_version, ...body } })

  // The owner copies two presets; the owner role and the presets themselves stay fixed.
  let r = await api('/roles'); assert.ok(r.value.presets.find(p => p.id === 'owner').locked)
  r = await api('/roles', { method: 'POST', body: { copy_of: 'superintendent', name: 'Lead Carpenter – no financials', permissions: { budgets: { view: false } }, financial_visible: false } }); assert.equal(r.status, 201, JSON.stringify(r.value)); let carpenter = r.value.role
  assert.equal(carpenter.permissions.logs.create, true, 'The copy keeps the superintendent defaults'); assert.equal(carpenter.permissions.budgets.view, false)
  r = await api('/roles', { method: 'POST', body: { copy_of: 'project_manager', name: 'Office Manager', permissions: { orders: { approve: true } }, po_limit_cents: 500_000 } }); assert.equal(r.status, 201, JSON.stringify(r.value)); let manager = r.value.role
  r = await api('/roles', { method: 'POST', body: { copy_of: 'administrator', name: 'Junior Admin', permissions: { invoices: { approve: false } } } }); assert.equal(r.status, 201); const junior = r.value.role
  assert.equal((await api('/roles', { method: 'POST', body: { copy_of: 'crew', name: 'Lead Carpenter – no financials' } })).status, 409, 'Role names are unique')
  for (const id of ['owner', 'superintendent']) { assert.equal((await api(`/roles/${id}`, { method: 'PUT', body: { expected_version: 1, name: 'x' } })).status, 403); assert.equal((await api(`/roles/${id}`, { method: 'DELETE', body: { expected_version: 1 } })).status, 403) }
  assert.equal((await assign('lead', { role: 'custom', role_id: carpenter.id, job_ids: [job.id] })).status, 200)
  // A ROLE-001 project manager moved to a custom role uses its permissions on the next request.
  assert.equal((await assign('office', { role: 'project_manager', job_ids: [job.id], po_limit_cents: 100_000 })).status, 200)
  const probe = (await act('/orders', { supplier: 'Champlain Lumber', description: 'PO probe', amount_cents: 400_000 }, people.office.cookie)).value.record.id
  assert.equal((await act(`/orders/${probe}/issue`, {}, people.office.cookie)).status, 403, 'As a project manager the $1,000 limit refuses a $4,000 PO')
  assert.equal((await assign('office', { role: 'custom', role_id: manager.id, job_ids: [job.id] }, 1)).status, 200)
  assert.equal((await act(`/orders/${probe}/issue`, {}, people.office.cookie)).status, 200, 'The next request uses the custom role limit')
  assert.equal((await assign('junior', { role: 'custom', role_id: junior.id })).status, 200)
  assert.equal((await api('/roles', { method: 'POST', cookie: people.lead.cookie, body: { copy_of: 'crew', name: 'Nope' } })).status, 403)
  assert.equal((await api('/team')).value.team.find(m => m.email === 'lead@example.com').role_name, 'Lead Carpenter – no financials')

  // Lead Carpenter: budgets, cost and margins are absent from the job and every export; field routes follow the switches.
  const lead = people.lead.cookie, view = async cookie => (await api(`/jobs/${job.id}`, { cookie })).value.job
  let seen = await view(lead); assert.equal(seen.budgets, undefined); assert.deepEqual(seen.quotes, []); assert.deepEqual(seen.approvals, []); assert.equal(seen.client_email, ''); assert.equal((await api('/jobs', { cookie: lead })).value.currency_totals, undefined)
  assert.ok(!JSON.stringify(seen).includes('cost_unit_cents') && !JSON.stringify(seen).includes('600000'), 'No cost or margin anywhere in the job')
  assert.equal((await f.request(`/api/plinth/jobs/${job.id}/quotes/${job.quotes[0].id}/cost-codes.csv`, { cookie: lead })).status, 403, 'Cost exports are refused')
  assert.equal((await api(`/jobs/${job.id}/orders`, { method: 'POST', cookie: lead, body: { expected_version: job.version, supplier: 'x', description: 'x', amount_cents: 100 } })).status, 403)
  assert.equal((await api(`/jobs/${job.id}/schedules`, { method: 'POST', cookie: lead, body: { expected_version: job.version, trade: 'Framing', description: 'x', start: '2026-11-06T08:00:00Z', end: '2026-11-06T16:00:00Z' } })).status, 403)
  assert.equal((await api(`/jobs/${job.id}/diary`, { method: 'POST', cookie: lead, body: { expected_version: job.version, note: 'Framing started' } })).value.record.status, 'draft')
  job = await view(f.owner)

  // Office Manager: sees budgets and cost; a $4,000 PO approves, a $6,000 PO is refused without a write.
  const office = people.office.cookie; seen = await view(office); assert.ok(seen.budgets.length); assert.equal(seen.quotes[0].lines[0].cost_unit_cents, 600000)
  assert.equal((await f.request(`/api/plinth/jobs/${job.id}/quotes/${job.quotes[0].id}/cost-codes.csv`, { cookie: office })).status, 200)
  const order = async amount => (await act('/orders', { supplier: 'Champlain Lumber', vendor_email: people.junior.email, description: `PO ${amount}`, amount_cents: amount }, office)).value.record.id
  const small = await order(400_000), large = await order(600_000)
  assert.equal((await act(`/orders/${small}/issue`, {}, office)).status, 200, 'A $4,000 PO is within the $5,000 limit')
  const held = job.version; r = await act(`/orders/${large}/issue`, {}, office); assert.equal(r.status, 403); assert.equal(r.value.error, 'over_limit'); assert.equal(job.version, held, 'The over-limit PO writes nothing')
  assert.equal(job.orders.find(o => o.id === small).issued_by.role, 'project_manager')

  // Native cost doors apply the bill and budget switches immediately, including originals and forecasts.
  const costs = (path, cookie = office) => api(`/jobs/${job.id}/costs${path}`, { cookie })
  for (const path of ['/bills', '/forecasts', '/ledger', '/cash?start_period=2026-10&months=3&opening_cash_cents=0']) {
   assert.equal((await costs(path, lead)).status, 403, path + ' hidden from the carpenter')
   assert.equal((await costs(path)).status, 200, path + ' available to the assigned office manager')
  }
  const updateManager = async body => { const result = await api(`/roles/${manager.id}`, { method: 'PUT', body: { expected_version: manager.version, ...body } }); assert.equal(result.status, 200); manager = result.value.role }
  await updateManager({ permissions: { budgets: { view: false }, bills: { view: false } } })
  for (const path of ['/bills', '/forecasts', '/ledger', '/bills/missing/original']) assert.equal((await costs(path)).status, 403, 'Revocation applies before reading ' + path)
  assert.equal((await view(office)).budgets, undefined)
  await updateManager({ permissions: { budgets: { view: true }, bills: { view: true } } })
  await updateManager({ financial_visible: false })
  for (const path of ['/bills', '/forecasts', '/ledger']) assert.equal((await costs(path)).status, 403, 'Financial visibility fences ' + path)
  await updateManager({ financial_visible: true })
  assert.equal((await costs('/forecasts')).status, 200)

  // Search applies the same projection before matching, so private text cannot influence its results.
  const other = await createActiveJob(f, 'Unassigned private renovation', 'synthetic-plinth-private@example.com')
  assert.deepEqual((await api('/search?q=Unassigned', { cookie: office })).value.results, [])
  assert.deepEqual((await api('/search?q=Private%20framing%20estimate', { cookie: lead })).value.results, [])
  assert.deepEqual((await api('/search?q=Private%20framing%20estimate', { cookie: office })).value.results.map(result => result.id), [job.id])
  assert.deepEqual((await api('/search?q=600000', { cookie: lead })).value.results, [])
  assert.deepEqual((await api('/search?q=Roles', { cookie: lead })).value.results.map(result => result.id), [job.id])

  // Saved reports, filters, direct values and both export formats re-evaluate current permissions.
  const reportSpec = { expected_version: 0, name: 'Role scoped contract', sharing: 'shared', scope: { record_scope: 'job', record_ids: [job.id] }, filters: [], selected_columns: ['native.contract'] }
  r = await api('/reports/views', { method: 'POST', body: reportSpec }); assert.equal(r.status, 201); const financialView = r.value.view
  r = await api('/reports/views', { method: 'POST', body: { ...reportSpec, name: 'Role scoped status', selected_columns: ['native.stage'] } }); assert.equal(r.status, 201); const statusView = r.value.view
  const field = async (name, type, version) => { const result = await api('/reports/fields', { method: 'POST', body: { expected_version: version, record_scope: 'job', name, type, required_at_stages: [] } }); assert.equal(result.status, 201); return result.value.fields.at(-1).id }
  const moneyField = await field('Private margin', 'money', 0), noteField = await field('Permit note', 'text', 1)
  assert.equal((await api(`/reports/values/job/${job.id}`, { method: 'PUT', body: { expected_version: 0, values: { [moneyField]: { amount_cents: 271828, currency: 'USD' }, [noteField]: 'Reviewed permit' } } })).status, 200)
  await updateManager({ permissions: { budgets: { view: false }, reports: { edit: true } }, financial_visible: false })
  for (const ending of ['', '/export.csv', '/export.pdf']) assert.equal((await f.request(`/api/plinth/reports/views/${financialView.id}${ending}`, { cookie: office })).status, 404)
  assert.ok(!(await api('/reports/views', { cookie: office })).value.views.some(row => row.view.id === financialView.id))
  r = await api('/reports/records?record_scope=job', { cookie: office }); assert.equal(r.status, 200)
  assert.ok(r.value.records.every(record => !('native.contract' in record.values) && !(moneyField in record.values)))
  assert.ok(!r.value.records.some(record => record.id === other.id)); assert.ok(!r.value.columns.some(column => column.id === 'native.contract'))
  assert.equal((await api('/reports/query', { method: 'POST', cookie: office, body: { ...reportSpec, selected_columns: ['native.stage'], filters: [{ column_id: moneyField, operator: 'is_set' }] } })).status, 400)
  r = await api(`/reports/values/job/${job.id}`, { method: 'PUT', cookie: office, body: { expected_version: 1, values: { [noteField]: 'Updated permit' } } }); assert.equal(r.status, 200); assert.equal(r.value.record.values[moneyField], undefined)
  assert.equal((await api(`/reports/values/job/${job.id}`, { method: 'PUT', cookie: office, body: { expected_version: 2, values: { [moneyField]: null } } })).status, 403)
  assert.equal((await api(`/reports/values/job/${job.id}`)).value.record.values[moneyField].amount_cents, 271828, 'A permitted edit preserves private values')
  for (const format of ['csv', 'pdf']) {
   const download = await f.request(`/api/plinth/reports/views/${statusView.id}/export.${format}`, { cookie: office }); assert.equal(download.status, 200)
   let text
   if (format === 'pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs'), task = getDocument({ data: new Uint8Array(await download.arrayBuffer()), useSystemFonts: true }), pdf = await task.promise
    try { text = (await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => (await (await pdf.getPage(index + 1)).getTextContent()).items.map(item => item.str).join(' ')))).join(' ').replace(/\s+/g, ' '); assert.match(text, /Role scoped status/); assert.match(text, /Record scope: job/); assert.match(text, /Matched records: 1/); assert.match(text, /Roles Street build/); assert.match(text, /Job status/); assert.match(text, /active/) } finally { await task.destroy() }
   } else text = await download.text()
   assert.ok(!text.includes('271828') && !text.includes(other.name) && !text.includes('native.contract')); assert.match(download.headers.get('content-type'), format === 'pdf' ? /application\/pdf/ : /text\/csv/)
  }
  await updateManager({ permissions: { budgets: { view: true } }, financial_visible: true })
  assert.equal((await f.request(`/api/plinth/reports/views/${financialView.id}/export.pdf`, { cookie: office })).status, 200)
  assert.equal((await f.request(`/api/plinth/reports/views/${statusView.id}/export.pdf`, { cookie: lead })).status, 403)

  // Turning budget view on, and financial visibility, applies on the next request; the audit history names each change.
  assert.equal((await api(`/roles/${carpenter.id}`, { method: 'PUT', body: { expected_version: carpenter.version, permissions: { budgets: { view: true } }, financial_visible: true } })).status, 200)
  seen = await view(lead); assert.ok(seen.budgets.length, 'The next request shows the budget')
  assert.equal((await api(`/roles/${carpenter.id}`, { method: 'PUT', body: { expected_version: carpenter.version, name: 'stale' } })).status, 409)
  assert.equal((await api(`/roles/${manager.id}`, { method: 'PUT', body: { expected_version: manager.version, permissions: { orders: { approve: false } } } })).status, 200)
  const gone = job.version; r = await act(`/orders/${large}/issue`, {}, f.owner); assert.equal(r.status, 200, 'The owner still approves above the limit'); assert.equal((await act('/orders', { supplier: 'x', description: 'x', amount_cents: 100 }, office)).status, 200, 'Creating is still allowed')
  r = await act(`/orders/${(await order(100))}/issue`, {}, office); assert.equal(r.status, 403, 'With approve switched off the Office Manager no longer issues POs'); assert.ok(job.version > gone)
  const permissionEvents = (await api('/audit?kind=permission')).value.events.map(e => e.action)
  for (const action of ['roles.create', 'roles.update', 'team.update']) assert.ok(permissionEvents.includes(action), action + ' is audited')

  const narrowed = await api('/roles/' + junior.id, { method: 'PUT', body: { expected_version: junior.version, permissions: { budgets: { view: false }, bills: { approve: false } } } }); assert.equal(narrowed.status, 200)
  const costJob = await costFixture(f), entered = await costJob.act('/costs/bills', costJob.bill('synthetic-plinth-limited-bill'), people.junior.cookie); assert.equal(entered.status, 200); assert.equal(entered.value.ledger, undefined, 'Bill entry never bypasses hidden budgets'); await costJob.read()
  assert.equal((await costJob.act('/costs/bills/' + entered.value.record.id + '/post', {}, people.junior.cookie)).status, 403, 'Posting is approval, never data entry')

  // An administrator cannot grant what they lack, and cannot do what their role switches off.
  const jr = people.junior.cookie
  r = await api('/roles', { method: 'POST', cookie: jr, body: { copy_of: 'project_manager', name: 'Sneaky Manager' } }); assert.equal(r.status, 403); assert.equal(r.value.error, 'escalation'); assert.match(r.value.message, /You cannot grant/)
  assert.equal((await api('/roles', { method: 'POST', cookie: jr, body: { copy_of: 'administrator', name: 'Another Junior Admin', permissions: { invoices: { approve: false }, budgets: { view: false }, bills: { approve: false } } } })).status, 201, 'Narrower copies are allowed')
  assert.equal((await api(`/jobs/${job.id}/invoices/none/issue`, { method: 'POST', cookie: jr, body: { expected_version: job.version } })).status, 403, 'The Junior Admin cannot approve invoices')
  // Both the sending person's approval and the recipient's current financial grant fence email delivery.
  let noticeJob = (await api('/jobs', { method: 'POST', body: { name: 'Recipient permission renovation', client_email: people.junior.email, address: '44 Pine Street' } })).value.job
  const notify = async (path, input = {}, cookie = f.owner) => { const result = await api(`/jobs/${noticeJob.id}${path}`, { method: 'POST', cookie, body: { expected_version: noticeJob.version, ...input } }); noticeJob = (await api(`/jobs/${noticeJob.id}`)).value.job; return result }
  assert.equal((await notify('/quotes', { lines: [{ id: 'work', description: 'Reviewed work', cost_code: '06-100', phase: 'Framing', category: 'labor', quantity: '1', unit: 'job', unit_cents: 100000, cost_unit_cents: 60000 }] })).status, 200)
  const rate = (await api('/pricing-rates')).value.rates[0], pricing = { basis: 'sell', as_of: '2026-10-23', rules: [], tax: { rate_id: rate.id, taxable_line_ids: ['work'] } }
  r = await notify('/pricing/preview', pricing); assert.equal(r.status, 200); assert.equal((await notify('/pricing/apply', { ...pricing, digest: r.value.preview.digest })).status, 200)
  assert.equal((await notify(`/quotes/${noticeJob.quotes.at(-1).id}/accept`, { method: 'signed', evidence: 'Synthetic accepted exact priced scope', schedule_choice: { kind: 'none', reason: 'Separately planned' } })).status, 200)
  assert.equal((await notify('/sov')).status, 200)
  r = await notify('/invoices', { kind: 'deposit', description: 'Private deposit request', amount_cents: 10000, recipient_email: people.junior.email, due_on: '2026-11-01', terms: 'Recorded terms' }); assert.equal(r.status, 200, JSON.stringify(r.value)); const noticeInvoice = r.value.record.id
  assert.equal((await notify(`/invoices/${noticeInvoice}/issue`)).status, 200)
  let messageCount = f.messages.length
  assert.equal((await notify(`/invoices/${noticeInvoice}/send`, { confirm: true }, jr)).status, 403); assert.equal(f.messages.length, messageCount)
  let juniorRole = (await api('/roles')).value.roles.find(role => role.id === junior.id)
  r = await api(`/roles/${junior.id}`, { method: 'PUT', body: { expected_version: juniorRole.version, financial_visible: false } }); assert.equal(r.status, 200); juniorRole = r.value.role
  for (const path of [`/jobs/${noticeJob.id}/invoices/${noticeInvoice}/document.json`, `/jobs/${job.id}/orders/${small}/document`]) assert.equal((await api(path, { cookie: jr })).status, 403, 'Direct pricing artifacts obey financial revocation')
  assert.equal((await notify(`/invoices/${noticeInvoice}/send`, { confirm: true })).status, 403); assert.equal(f.messages.length, messageCount); assert.equal(noticeJob.invoices[0].delivery, undefined)
  assert.deepEqual((await api(`/jobs/${job.id}`, { cookie: jr })).value.job.orders, [], 'A role without financial visibility receives no PO pricing')
  r = await api(`/roles/${junior.id}`, { method: 'PUT', body: { expected_version: juniorRole.version, financial_visible: true, permissions: { invoices: { view: false } } } }); assert.equal(r.status, 200); juniorRole = r.value.role
  assert.equal((await notify(`/invoices/${noticeInvoice}/send`, { confirm: true })).status, 403); assert.equal(f.messages.length, messageCount)
  assert.equal((await api(`/roles/${junior.id}`, { method: 'PUT', body: { expected_version: juniorRole.version, permissions: { invoices: { view: true } } } })).status, 200)
  assert.equal((await notify(`/invoices/${noticeInvoice}/send`, { confirm: true })).status, 200); assert.equal(f.messages.length, messageCount + 1); assert.equal(f.messages.at(-1).to[0], people.junior.email)
  juniorRole = (await api('/roles')).value.roles.find(role => role.id === junior.id)
  r = await api(`/roles/${junior.id}`, { method: 'PUT', body: { expected_version: juniorRole.version, financial_visible: false } }); assert.equal(r.status, 200); juniorRole = r.value.role
  messageCount = f.messages.length
  assert.equal((await act(`/orders/${small}/send`)).status, 403, 'A financial restriction also holds purchase-order mail'); assert.equal(f.messages.length, messageCount)
  r = await api(`/roles/${junior.id}`, { method: 'PUT', body: { expected_version: juniorRole.version, financial_visible: true, permissions: { orders: { view: false } } } }); assert.equal(r.status, 200); juniorRole = r.value.role
  assert.equal((await act(`/orders/${small}/send`)).status, 403); assert.equal(f.messages.length, messageCount)
  assert.equal((await api(`/roles/${junior.id}`, { method: 'PUT', body: { expected_version: juniorRole.version, permissions: { orders: { view: true } } } })).status, 200)
  assert.equal((await act(`/orders/${small}/send`, {}, office)).status, 403, 'A sender whose approval was revoked cannot send the order'); assert.equal(f.messages.length, messageCount)
  assert.equal((await act(`/orders/${small}/send`)).status, 200); assert.equal(f.messages.length, messageCount + 1); assert.equal(f.messages.at(-1).to[0], people.junior.email)
  assert.equal((await api(`/jobs/${job.id}/orders`, { method: 'POST', cookie: jr, body: { expected_version: job.version, supplier: 'x', description: 'x', amount_cents: 100 } })).status, 200, 'The same role still creates POs')
  assert.equal((await api(`/roles/${carpenter.id}`, { method: 'DELETE', body: { expected_version: carpenter.version + 1 } })).status, 409, 'A role in use is not deleted')
 } finally { await f.close() }
})


test('ROLE-004 — assigned bookkeeper enters and recodes a bill for a separate manager; lender reads only draw evidence and revocation applies immediately', async () => {
 const f = await createFixture()
 try {
  const c = await costFixture(f), clerk = await f.invite('synthetic-plinth-bookkeeper@example.com', 'Bookkeeper', 'admin'), lender = await f.invite('synthetic-plinth-reader@example.com', 'Lender', 'admin'), manager = await f.invite('synthetic-plinth-reviewer@example.com', 'Designated manager', 'admin')
  const api = (path, { method = 'GET', body, cookie = f.owner } = {}) => f.json('/api/plinth' + path, { method, cookie, ...(body ? { body } : {}) })
  const people = (await api('/team')).value.team, person = name => people.find(p => p.name === name)
  const assign = (name, role, job_ids = [c.job.id], expected_version = 0) => api('/team/' + person(name).id, { method: 'PUT', body: { expected_version, role, job_ids } })
  assert.equal((await assign('Bookkeeper', 'bookkeeper')).status, 200); assert.equal((await assign('Lender', 'reader')).status, 200)
  for (const preset of ['bookkeeper', 'reader']) assert.equal((await api('/roles', { method: 'POST', body: { copy_of: preset, name: 'Scoped ' + preset } })).status, 201)
  await c.ok('/costs/policy', { budget_limit_cents: 0, commitment_limit_cents: 0, bill_limit_cents: 1000000, separate_approval: true, owner_id: c.job.created_by.id, due_on: '2026-11-01' })
  let r = await c.act('/costs/bills', { ...c.bill(), reviewer_id: person('Designated manager').id }, clerk); assert.equal(r.status, 200, JSON.stringify(r.value)); const bill = r.value.record; await c.read()
  assert.equal((await c.act(`/costs/bills/${bill.id}/recode`, { line_id: bill.lines[0].id, cost_code: '01-100', reason: 'Reviewed original coding' }, lender)).status, 403)
  assert.equal((await c.act(`/costs/bills/${bill.id}/recode`, { line_id: bill.lines[0].id, cost_code: '01-100', reason: 'Reviewed original coding' }, clerk)).status, 200); await c.read()
  assert.equal((await c.act(`/costs/bills/${bill.id}/review`, { reason: 'Checked the receipt and original coding discrepancy' }, clerk)).status, 200); await c.read()
  const before = c.job.version
  for (const cookie of [clerk, lender, f.owner]) assert.equal((await c.act(`/costs/bills/${bill.id}/post`, {}, cookie)).status, 403)
  assert.equal((await c.read()).version, before, 'Unauthorized approvals write nothing')
  assert.equal((await c.act(`/costs/bills/${bill.id}/post`, {}, manager)).status, 200); await c.read()
  assert.equal((await c.ledger()).totals.posted_actual_cents, 43000)
  assert.equal((await c.act('/costs/reconcile', { period: '2026-10', balances: [{ cost_code: '01-100', amount_cents: 43000 }], reference: 'Bookkeeper reviewed the external ledger extract' }, clerk)).status, 200); await c.read()
  for (const cookie of [clerk, lender]) for (const path of ['/costs/periods', '/costs/sources/missing/reimburse', '/subcontracts/missing/draws/missing/payment']) assert.equal((await c.act(path, {}, cookie)).status, 403, 'No payment or period authority: ' + path)
  await c.ok('/sov'); await c.read()
  r = await c.ok('/claims', { description: 'October lender draw', lines: c.job.sov.at(-1).lines.map((l, i) => ({ line_id: l.id, completed_cents: i ? 0 : 15000, stored_cents: 0, evidence: 'Reviewed installed work' })) }); await c.ok(`/claims/${r.record.id}/approve`)
  const packet = await api(`/jobs/${c.job.id}/costs/draw-packet`, { cookie: lender }); assert.equal(packet.status, 200); assert.equal(packet.value.applications[0].current_cents, 15000); assert.equal(packet.value.applications[0].lines[0].evidence, 'Reviewed installed work')
  assert.ok(!/cost_unit_cents|margin|supplier|Synthetic Lumber|base64|client_email|source_digest/.test(JSON.stringify(packet.value)), 'Draw evidence excludes internal costs, contacts and originals')
  for (const path of ['/costs/bills', `/costs/bills/${bill.id}/original`, '/costs/ledger', '/costs/forecasts']) assert.equal((await api(`/jobs/${c.job.id}${path}`, { cookie: lender })).status, 403)
  const other = (await api('/jobs', { method: 'POST', body: { name: 'Unassigned job', client_email: 'synthetic-plinth-other@example.com', address: 'Other site' } })).value.job
  for (const cookie of [clerk, lender]) { assert.equal((await api(`/jobs/${other.id}/costs/draw-packet`, { cookie })).status, cookie === lender ? 404 : 403); const jobs = (await api('/jobs', { cookie })).value.jobs; assert.deepEqual(jobs.map(j => j.id), [c.job.id]); assert.equal(jobs[0].client_email, ''); assert.deepEqual(jobs[0].approvals, []) }
  assert.equal((await assign('Lender', 'reader', [], 1)).status, 200); assert.equal((await api(`/jobs/${c.job.id}/costs/draw-packet`, { cookie: lender })).status, 404)
  assert.equal((await assign('Bookkeeper', 'bookkeeper', [], 1)).status, 200); assert.equal((await api(`/jobs/${c.job.id}/costs/bills`, { cookie: clerk })).status, 404)
 } finally { await f.close() }
})
