import {setPortalFeatures} from './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createFixture} from './helpers.mjs'

test('CRM-001 — shared household contacts and properties commission jobs with current client grants and preserved site history', async()=>{
 const f=await createFixture()
 try {
  const client=await f.invite('morgan@example.com','Morgan Chen'),partner=await f.invite('alex@example.com','Alex Chen'),stranger=await f.invite('other@example.com','Other client'),agent=await f.agent()
  const post=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{method:'POST',cookie,token,body})
  const data={name:'Chen household',kind:'household',external_id:'customer-chen',contacts:[{id:'morgan',name:'Morgan Chen',email:'morgan@example.com',phone:'+1 503 555 0101',preferences:'Email after 5 pm Pacific',external_id:'crm-morgan'},{id:'alex',name:'Alex Chen',email:'alex@example.com',phone:'+1 503 555 0102',preferences:'Call for site access',external_id:'crm-alex'}],owner_contact_ids:['morgan','alex'],billing_contact_ids:['morgan'],properties:[{id:'maple',label:'Primary residence',address:'148 Maple Street, Portland, OR 97205'},{id:'oak',label:'Rental property',address:'72 Oak Avenue, Portland, OR 97214'}]}
  assert.equal((await f.request('/api/plinth/customers')).status,401)
  assert.equal((await post('/customers',data,client)).status,403)
  assert.equal((await post('/customers',data,undefined,agent)).status,403)
  let r=await post('/customers',data);assert.equal(r.status,201);let customer=r.value.customer
  for(const kind of ['business','person'])assert.equal((await post('/customers',{name:kind==='business'?'North Electrical LLC':'Jamie Rivera',kind})).status,201)
  const make=async(name,property)=>{
   let r=await post('/jobs',{name,client_email:'morgan@example.com',address:'',customer_id:customer.id,property_id:property,client_contact_ids:['morgan','alex']});assert.equal(r.status,201);let job=r.value.job
   r=await post(`/jobs/${job.id}/quotes`,{expected_version:job.version,lines:[{description:'Remodel scope',quantity:1,unit_cents:48_000_000}]});assert.equal(r.status,200);job=r.value.job
   r=await post(`/jobs/${job.id}/quotes/${job.quotes[0].id}/accept`,{expected_version:job.version,method:'signed',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'},evidence:'Client signed current scope and USD price'});assert.equal(r.status,200);return r.value.job
  }
  let first=await make('Maple remodel','maple'),second=await make('Oak addition','oak')
  assert.equal(first.address,data.properties[0].address);assert.equal(second.address,data.properties[1].address)
  for(const cookie of [client,partner]){const jobs=await f.json('/api/plinth/jobs',{cookie});assert.deepEqual(jobs.value.jobs.map(j=>j.id).sort(),[first.id,second.id].sort())}
  assert.equal((await f.request(`/api/plinth/jobs/${first.id}`,{cookie:stranger})).status,404)
  assert.equal((await f.request(`/api/plinth/customers/${customer.id}`,{cookie:partner})).status,403)
  assert.equal((await f.request(`/api/plinth/jobs/${first.id}/customer`,{cookie:partner})).status,403)
  r=await post(`/customers/${customer.id}/contacts/morgan`,{expected_version:customer.version,phone:'+1 503 555 0199',preferences:'Email billing notices',external_id:'crm-morgan'});assert.equal(r.status,200);customer=r.value.customer
  r=await post(`/customers/${customer.id}`,{expected_version:customer.version,billing_contact_ids:['alex']});assert.equal(r.status,200);customer=r.value.customer
  r=await post(`/customers/${customer.id}/contacts/alex/notes`,{expected_version:customer.version,note:'Alex confirmed site access by phone; retain this conversation with both jobs.'});assert.equal(r.status,200);customer=r.value.customer;assert.ok(customer.history.some(h=>h.kind==='contact.note'&&h.after.note.includes('site access')))
  assert.deepEqual(customer.owner_contact_ids,['morgan','alex']);assert.deepEqual(customer.billing_contact_ids,['alex']);assert.equal(customer.contacts[0].external_id,'crm-morgan');assert.equal(customer.contacts[0].phone,'+1 503 555 0199')
  r=await post(`/customers/${customer.id}/properties/maple`,{expected_version:customer.version,address:'148 Maple Street, Unit A, Portland, OR 97205'});assert.equal(r.status,200);customer=r.value.customer
  for(const job of [first,second]){const linked=await f.json(`/api/plinth/jobs/${job.id}/customer`,{cookie:f.owner});assert.equal(linked.value.customer.id,customer.id);assert.deepEqual(linked.value.customer.billing_contact_ids,['alex']);assert.equal(linked.value.customer.contacts.length,2)}
  assert.equal((await f.json(`/api/plinth/jobs/${first.id}`,{cookie:f.owner})).value.job.address,data.properties[0].address)
  const changes=customer.history.find(h=>h.kind==='property.updated');assert.equal(changes.before.address,data.properties[0].address);assert.equal(changes.after.address,'148 Maple Street, Unit A, Portland, OR 97205');assert.ok(changes.actor.id)
  assert.equal((await post(`/customers/${customer.id}`,{expected_version:customer.version-1,name:'Stale overwrite'})).status,409)
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='
  r=await post(`/jobs/${first.id}/diary`,{expected_version:first.version,date:'2026-11-02',note:'Published rough-in inspection photos',attachments:[{name:'rough-in.png',mime:'image/png',base64:png}]});assert.equal(r.status,200);first=r.value.job
  const diary=r.value.record,photo=`/api/plinth/jobs/${first.id}/diary/${diary.id}/attachments/${diary.attachments[0].id}`
  assert.deepEqual(Buffer.from(await(await f.request(photo,{cookie:partner})).arrayBuffer()),Buffer.from(png,'base64'))
  r=await post(`/jobs/${first.id}/variations`,{expected_version:first.version,description:'Client-selected tile upgrade',amount_cents:75_000});assert.equal(r.status,200);first=r.value.job
  r=await post(`/jobs/${first.id}/variations/${r.value.record.id}/approve`,{expected_version:first.version},partner);assert.equal(r.status,200);first=r.value.job;assert.equal(first.variations[0].approved_by.name,'Alex Chen');assert.equal(first.orders.length,0)
  r=await post(`/jobs/${first.id}/calendar`,{expected_version:first.version,action:'rotate'},partner);assert.equal(r.status,200);const feed=r.value.urlPath;assert.equal((await f.request(feed)).status,200)
  assert.equal((await post(`/jobs/${first.id}/customer`,{expected_version:first.version,customer_id:customer.id,property_id:'maple',client_contact_ids:[]},undefined,agent)).status,403)
  r=await post(`/jobs/${first.id}/customer`,{expected_version:first.version,customer_id:customer.id,property_id:'maple',client_contact_ids:['morgan']});assert.equal(r.status,200);first=r.value.job
  assert.equal(first.address,data.properties[0].address)
  assert.equal((await f.request(`/api/plinth/jobs/${first.id}`,{cookie:partner})).status,404);assert.equal((await f.request(photo,{cookie:partner})).status,404);assert.equal((await f.request(feed)).status,404)
  assert.equal((await f.request(`/api/plinth/jobs/${second.id}`,{cookie:partner})).status,200)
  assert.deepEqual((await f.json('/api/plinth/jobs',{cookie:partner})).value.jobs.map(j=>j.id),[second.id])
  assert.equal((await f.request(`/api/plinth/jobs/${first.id}`,{cookie:client})).status,200)
  assert.ok(first.approvals.filter(a=>a.kind==='client.contacts').every(a=>a.approved_by.id&&a.approved_by.at&&a.snapshot.after))
  r=await post(`/customers/${customer.id}/contacts/alex`,{expected_version:customer.version,email:'alex.new@example.com'});assert.equal(r.status,200);customer=r.value.customer
  const renamed=await f.invite('alex.new@example.com','Alex Chen updated email')
  assert.equal((await f.request(`/api/plinth/jobs/${second.id}`,{cookie:partner})).status,404)
  assert.equal((await f.request(`/api/plinth/jobs/${second.id}`,{cookie:renamed})).status,200)
  assert.equal((await f.request(`/api/plinth/jobs/${first.id}`,{cookie:renamed})).status,404)
  const listing=await f.json('/api/plinth/customers',{cookie:f.owner});assert.deepEqual(listing.value.customers.map(c=>c.kind).sort(),['business','household','person'])
 }finally{await f.close()}
})

import {createActiveJob,createReleasedScope} from './helpers.mjs'

test('TODO-001 — granted job and company checklists, reviewed templates, deduplicated completions, private portals and approved email notices', async()=>{
 const f=await createFixture()
 try {
  const crew=await f.invite('synthetic-plinth-1@example.com','Synthetic crew lead','admin'),client=await f.invite('synthetic-plinth-2@example.com','Synthetic client'),sub=await f.invite('synthetic-plinth-3@example.com','Synthetic plumber'),other=await f.invite('synthetic-plinth-4@example.com','Synthetic other job sub')
  const post=(path,body,cookie=f.owner,token)=>f.json('/api/plinth'+path,{method:'POST',cookie,token,body}),get=(path,cookie=f.owner)=>f.json('/api/plinth'+path,{cookie})
  const calendar={weekdays:[1,2,3,4,5],start_hour:8,end_hour:17,holidays:[]}
  let r=await post('/schedule-templates',{name:'synthetic-plinth-1 construction template',calendar,tasks:[{id:'drywall',trade:'Drywall',description:'Synthetic drywall task',start:'2026-11-02T08:00:00Z',duration_minutes:480}]});assert.equal(r.status,201);const scheduleTemplate=r.value.template
  let job=await createActiveJob(f,'synthetic-plinth-1','synthetic-plinth-2@example.com');const second=await createActiveJob(f,'synthetic-plinth-2','synthetic-plinth-5@example.com')
  const released=await createReleasedScope(f,job,'synthetic-plinth-3@example.com','Plumbing');job=released.job
  await createReleasedScope(f,second,'synthetic-plinth-4@example.com','Plumbing')
  const team=await get('/team'),person=team.value.team.find(p=>p.email==='synthetic-plinth-1@example.com')
  r=await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'project_manager',job_ids:[job.id],po_limit_cents:0}});assert.equal(r.status,200)
  for(const cookie of [crew,client,sub,f.owner]){r=await post('/todos/preferences',{expected_revision:0,assignment:'email',comment:'email',reminder:'email'},cookie);assert.equal(r.status,200)}
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='
  const specs={title:'Pre-drywall walk',notes:'Internal inspection notes: do not share crew or office details',due_offset_days:-1,due_time:'17:00',priority:'high',tags:['synthetic-plinth-1'],items:[{title:'Crew framing check',assignee:{kind:'office',email:'synthetic-plinth-1@example.com'}},{title:'Plumbing rough-in check',assignee:{kind:'sub',email:'synthetic-plinth-3@example.com',subcontract_id:released.scope.id}},{title:'Client wall-location check',assignee:{kind:'client',email:'synthetic-plinth-2@example.com'}}]}
  assert.equal((await f.request('/api/plinth/todos')).status,401)
  const agent=await f.agent();assert.equal((await post('/todos',{},undefined,agent)).status,403)
  r=await post('/todos/templates',{name:'synthetic-plinth-1 job template',specs:[specs]});assert.equal(r.status,201);const template=r.value.template
  r=await post('/todos/job-templates/'+scheduleTemplate.id,{expected_version:0,schedule_template_revision:scheduleTemplate.version,templates:[{todo_template_id:template.id,task_id:'drywall'}]});assert.equal(r.status,200,JSON.stringify(r.value))
  assert.equal((await post('/todos/job-templates/'+scheduleTemplate.id,{expected_version:1,schedule_template_revision:scheduleTemplate.version,templates:[{todo_template_id:template.id,task_id:'foreign-task'}]})).status,400)
  const application={template_id:scheduleTemplate.id,start:'2026-11-09T08:00:00Z'}
  r=await post(`/jobs/${job.id}/schedule-template/preview`,{expected_version:job.version,...application});assert.equal(r.status,200);let preview=r.value.preview
  r=await post(`/jobs/${job.id}/schedule-template/apply`,{expected_version:job.version,...application,digest:preview.digest});assert.equal(r.status,200,JSON.stringify(r.value));job=r.value.job
  assert.equal(job.todos.length,1,'The actual schedule-template public door atomically creates its bound to-do')
  const task=job.schedules.find(t=>t.description==='Synthetic drywall task');let todo=job.todos[0];assert.equal(todo.due_at,'2026-11-08T17:00:00.000Z');assert.deepEqual(todo.links,[{kind:'schedule',id:task.id}]);assert.deepEqual(todo.items.map(i=>i.assignee.email),['synthetic-plinth-1@example.com','synthetic-plinth-3@example.com','synthetic-plinth-2@example.com']);const path=`/jobs/${job.id}/todos/${todo.id}`
  const update=async(action,body={},cookie=f.owner)=>{const response=await post(path+'/'+action,{expected_revision:todo.revision,operation_id:crypto.randomUUID(),...body},cookie);if(response.status===200)todo=(await get(path)).value.todo;return response}
  r=await update('attachments',{attachments:[{name:'synthetic-plinth-1.png',mime:'image/png',base64:png}]});assert.equal(r.status,200);const file=todo.attachments[0],filePath='/api/plinth'+path+'/files/'+file.id
  assert.deepEqual(Buffer.from(await(await f.request(filePath,{cookie:f.owner})).arrayBuffer()),Buffer.from(png,'base64'))
  for(const [cookie,index] of [[client,2],[sub,1]]){const visible=await get(path,cookie);assert.equal(visible.status,200);assert.deepEqual(visible.value.todo.items.map(i=>i.id),[todo.items[index].id]);for(const key of ['notes','notices','attachments','history','tags','links'])assert.equal(visible.value.todo[key],undefined);assert.equal((await f.request(filePath,{cookie})).status,404)}
  assert.equal((await get(path,other)).status,404);assert.deepEqual((await get('/todos?q=Pre-drywall',other)).value.todos,[]);assert.equal((await get(`/jobs/${job.id}/todos`,other)).status,404)
  assert.equal((await get(`/jobs/${job.id}`,client)).value.job.todos,undefined,'General client job projection must not leak internal to-dos')
  assert.equal((await get(`/jobs/${job.id}/todos?record_kind=schedule&record_id=${task.id}`)).value.todos[0].id,todo.id)
  assert.deepEqual((await get('/todos?tag=synthetic-plinth-1',client)).value.todos,[],'External searches cannot probe internal tags')
  // An offline completion is an ordinary native request with its captured revision and stable operation key.
  const captured=todo.revision,operation=crypto.randomUUID(),crewItem=todo.items[0].id,subItem=todo.items[1].id,clientItem=todo.items[2].id
  r=await post(path+'/complete',{expected_revision:captured,operation_id:operation,item_id:crewItem},crew);assert.equal(r.status,200);todo=(await get(path)).value.todo
  r=await post(path+'/complete',{expected_revision:captured,operation_id:operation,item_id:crewItem},crew);assert.equal(r.status,200);assert.equal(r.value.deduplicated,true);assert.equal(r.value.todo.items[0].history.filter(h=>h.operation_id===operation).length,1)
  r=await post(path+'/complete',{expected_revision:captured,operation_id:crypto.randomUUID(),item_id:subItem},sub);assert.equal(r.status,409,'A queued stale revision requires human review')
  r=await update('complete',{item_id:subItem},sub);assert.equal(r.status,200)
  r=await update('complete',{item_id:crewItem},client);assert.equal(r.status,404)
  r=await update('comment',{item_id:subItem,comment:'Synthetic pressure check complete'},sub);assert.equal(r.status,200);assert.equal((await get(path,client)).value.todo.items[0].history.length,0,'No other assignee comments escape')
  const assignmentNotices=todo.notices.filter(n=>n.event==='assignment');assert.equal(assignmentNotices.length,3)
  job=await setPortalFeatures(f,job.id,['todos'],['todos'])
  for(const cookie of [client,sub]){
   assert.deepEqual((await get('/todos',cookie)).value.todos,[])
   assert.equal((await get(path,cookie)).status,404)
   assert.equal((await update('complete',{item_id:cookie===sub?subItem:clientItem},cookie)).status,404)
  }
  const heldMail=f.messages.length
  for(const notice of assignmentNotices.filter(n=>n.email!=='synthetic-plinth-1@example.com'))assert.equal((await post(path+'/notices/'+notice.id+'/send',{channel:'email',email:notice.email,confirm:true})).status,409)
  assert.equal(f.messages.length,heldMail,'Disabled external preset refuses email without a provider call')
  job=await setPortalFeatures(f,job.id)
  const baseline=f.messages.length
  for(const n of assignmentNotices){r=await post(path+'/notices/'+n.id+'/send',{channel:'email',email:n.email,confirm:true});assert.equal(r.status,200,JSON.stringify(r.value));assert.equal(r.value.todo.notices.find(x=>x.id===n.id).status,'accepted');assert.equal((await post(path+'/notices/'+n.id+'/send',{channel:'email',email:n.email,confirm:true})).status,409)}
  const sent=f.messages.slice(baseline);assert.equal(sent.length,3);for(const m of sent){assert.ok(!m.text.includes(specs.notes));assert.ok(!m.text.includes('Client wall-location check')||m.to.includes('synthetic-plinth-2@example.com'));assert.ok(!m.text.includes('Plumbing rough-in check')||m.to.includes('synthetic-plinth-3@example.com'))}
  todo=(await get(path)).value.todo
  r=await update('edit',{due_at:'2020-01-01T17:00:00Z'});assert.equal(r.status,200)
  r=await update('prepare-reminders');assert.equal(r.status,200);r=await update('prepare-reminders');assert.equal(r.status,200);const reminders=todo.notices.filter(n=>n.event==='reminder');assert.equal(reminders.length,1);assert.equal(reminders[0].email,'synthetic-plinth-2@example.com')
  const commentNotice=todo.notices.find(n=>n.event==='comment');assert.ok(commentNotice)
  r=await post('/todos/preferences',{expected_revision:1,assignment:'email',comment:'off',reminder:'email'},sub);assert.equal(r.status,200)
  assert.equal((await post(path+'/notices/'+commentNotice.id+'/send',{channel:'email',email:commentNotice.email,confirm:true})).status,409,'An optional email preference of off prevents delivery')
  r=await post('/todos/preferences',{expected_revision:2,assignment:'email',comment:'email',reminder:'email',quiet:{start:'00:00',end:'00:00',time_zone:'UTC'}},sub);assert.equal(r.status,200)
  assert.equal((await post(path+'/notices/'+commentNotice.id+'/send',{channel:'email',email:commentNotice.email,confirm:true})).status,409,'Quiet hours hold delivery without reserving or silently dropping it')
  r=await post('/todos/preferences',{expected_revision:3,assignment:'email',comment:'email',reminder:'email'},sub);assert.equal(r.status,200)
  const due=await get('/todos?overdue=true&job_id='+job.id+'&assignee=synthetic-plinth-2%40example.com&tag=synthetic-plinth-1&priority=high');assert.equal(due.value.todos[0].id,todo.id);assert.deepEqual(due.value.todos[0].items.filter(i=>!i.completed).map(i=>i.id),[clientItem])
  r=await post(path+'/notices/'+reminders[0].id+'/send',{channel:'email',email:reminders[0].email,confirm:true});assert.equal(r.status,200);assert.equal(f.messages.filter(m=>m.subject==='Plinth: to-do reminder').length,1)
  todo=(await get(path)).value.todo;r=await update('reopen',{item_id:subItem},sub);assert.equal(r.status,200);r=await update('complete',{item_id:subItem},sub);assert.equal(r.status,200);const history=todo.items[1].history;assert.ok(history.some(h=>h.action==='reopen'&&h.by.name==='Synthetic plumber'&&h.by.at));assert.ok(history.some(h=>h.action==='complete'&&h.by.name==='Synthetic plumber'&&h.by.at))
  job=(await get('/jobs/'+job.id)).value.job
  r=await post(`/jobs/${job.id}/schedule-template/preview`,{expected_version:job.version,...application});assert.equal(r.status,200);preview=r.value.preview
  r=await post(`/jobs/${job.id}/schedule-template/apply`,{expected_version:job.version,...application,digest:preview.digest});assert.equal(r.status,200);job=r.value.job;assert.equal(job.todos.length,1);assert.equal(job.todos[0].id,todo.id);assert.deepEqual(job.todos[0].items,todo.items,'Reapplying the real source template preserves checklist completion and reopening history')
  // A new sale uses the same real template door; another job's subcontract grant cannot authorize its checklist.
  r=await post('/jobs',{name:'synthetic-plinth-3 template sale',client_email:'synthetic-plinth-2@example.com'});assert.equal(r.status,201);let sale=r.value.job
  r=await post(`/jobs/${sale.id}/quotes`,{expected_version:sale.version,lines:[{description:'Synthetic template sale scope',quantity:1,unit_cents:48_000_000}]});assert.equal(r.status,200);sale=r.value.job
  const saleApplication={template_id:scheduleTemplate.id,start:'2026-11-23T08:00:00Z'}
  r=await post(`/jobs/${sale.id}/quotes/${sale.quotes[0].id}/plan-preview`,{expected_version:sale.version,...saleApplication});assert.equal(r.status,200)
  const acceptance={expected_version:sale.version,method:'signed',evidence:'Client signed exact synthetic sale scope',schedule_choice:{kind:'template',input:{...saleApplication,digest:r.value.preview.digest}}}
  r=await post(`/jobs/${sale.id}/quotes/${sale.quotes[0].id}/accept`,acceptance);assert.equal(r.status,403,'A foreign job subcontract scope refuses the combined sale/schedule/checklist write')
  const heldSale=(await get('/jobs/'+sale.id)).value.job;assert.equal(heldSale.version,sale.version);assert.equal(heldSale.status,'quoting');assert.equal(heldSale.schedules.length,0);assert.equal(heldSale.todos,undefined)
  r=await post('/todos/templates',{name:'synthetic-plinth-2 sale checklist',specs:[{title:'Synthetic sale setup',due_offset_days:1,due_time:'09:00',items:[{title:'Confirm site setup',assignee:{kind:'office',email:'builder@example.com'}}]}]});assert.equal(r.status,201);const saleChecklist=r.value.template
  r=await post('/todos/job-templates/'+scheduleTemplate.id,{expected_version:1,schedule_template_revision:scheduleTemplate.version,templates:[{todo_template_id:saleChecklist.id}]});assert.equal(r.status,200)
  r=await post(`/jobs/${sale.id}/quotes/${sale.quotes[0].id}/plan-preview`,{expected_version:sale.version,...saleApplication});assert.equal(r.status,200);acceptance.schedule_choice.input.digest=r.value.preview.digest
  r=await post(`/jobs/${sale.id}/quotes/${sale.quotes[0].id}/accept`,acceptance);assert.equal(r.status,200,JSON.stringify(r.value));sale=r.value.job;assert.equal(sale.status,'active');assert.equal(sale.todos.length,1);assert.equal(sale.todos[0].title,'Synthetic sale setup');assert.equal(sale.todos[0].due_at,'2026-11-24T09:00:00.000Z','Job-relative dates start from the actual applied job template date')
  // Reassignment closes the former PM's queued write, not merely their menu.
  const queuedRevision=todo.revision
  r=await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:1,role:'project_manager',job_ids:[],po_limit_cents:0}});assert.equal(r.status,200)
  assert.equal((await post(path+'/complete',{expected_revision:queuedRevision,operation_id:crypto.randomUUID(),item_id:crewItem},crew)).status,404)
  assert.deepEqual((await get('/todos?mine=true',crew)).value.todos,[])
  r=await post('/todos',{title:'synthetic-plinth-3 company reminder',notes:'Company office item',due_at:'2026-12-01T09:00:00Z',items:[{title:'Review company insurance',assignee:{kind:'office',email:'builder@example.com'}}]});assert.equal(r.status,201);const companyTodo=r.value.todo
  assert.ok((await get('/todos?mine=true')).value.todos.some(t=>t.id===companyTodo.id));assert.equal((await get('/todos/'+companyTodo.id,client)).status,404)
  assert.equal((await post('/todos',{title:'No company client grant',due_at:'2026-12-01T09:00Z',items:[{title:'Invalid',assignee:{kind:'client',email:'synthetic-plinth-2@example.com'}}]})).status,403)
 }finally{await f.close()}
})
