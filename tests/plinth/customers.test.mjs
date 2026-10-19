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
   r=await post(`/jobs/${job.id}/quotes/${job.quotes[0].id}/accept`,{expected_version:job.version,method:'signed',evidence:'Client signed current scope and USD price'});assert.equal(r.status,200);return r.value.job
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
