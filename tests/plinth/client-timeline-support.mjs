import assert from 'node:assert/strict'
export const timelineAddress = n => ['synthetic-plinth-timeline-'+n,'example.invalid'].join(String.fromCharCode(64))
export const timelinePhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64')
/** Native business preparation shared by the HTTP and installed sanity journeys. */
export async function timelineFixture(f) {
 const first = await f.invite(timelineAddress(1),'Timeline Alex'), second = await f.invite(timelineAddress(2),'Timeline Jordan'), outsider = await f.invite(timelineAddress(3),'Other household')
 const api = (path,body,cookie=f.owner,token) => f.json('/api/plinth'+path,{method:body===undefined?'GET':'POST',cookie:token?undefined:cookie,token,body})
 let response = await api('/customers',{kind:'household',name:'Synthetic timeline household',contacts:[{id:'synthetic-plinth-1',name:'Timeline Alex',email:timelineAddress(1)},{id:'synthetic-plinth-2',name:'Timeline Jordan',email:timelineAddress(2)}],properties:[{id:'synthetic-plinth-1',label:'Kitchen',address:'22 Synthetic Street'}]})
 assert.equal(response.status,201,JSON.stringify(response.value))
 const customer = response.value.customer
 response=await api('/jobs',{name:'Synthetic household timeline',client_email:timelineAddress(1),address:'22 Synthetic Street',customer_id:customer.id,property_id:customer.properties[0].id,client_contact_ids:customer.contacts.map(c=>c.id)})
 assert.equal(response.status,201,JSON.stringify(response.value))
 let job=response.value.job
 const root='/jobs/'+job.id
 const read=async()=>{const r=await api(root);assert.equal(r.status,200);job=r.value.job;return job}
 const act=async(path,body={},cookie=f.owner,token)=>{await read();const r=await api(root+path,{expected_version:job.version,...body},cookie,token);assert.equal(r.status,[ '/correspondence' ].includes(path)?201:200,JSON.stringify(r.value));await read();return r.value.record??r.value}
 await act('/quotes',{lines:[{id:'synthetic-plinth-line-1',description:'Reviewed kitchen construction',quantity:'1',unit:'job',unit_cents:100000,cost_unit_cents:53000,cost_code:'06-100',category:'material',phase:'Construction'}]})
 const rate=await api('/pricing-rates',{jurisdiction:'Synthetic timeline jurisdiction',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'synthetic-plinth-tax-1',human_reviewed:true});assert.equal(rate.status,201)
 const pricing={basis:'sell',as_of:'2026-10-27',rules:[],tax:{rate_id:rate.value.rate.id,taxable_line_ids:[],exemption_reference:'Reviewed exempt construction'}}
 const preview=await act('/pricing/preview',pricing);await act('/pricing/apply',{...pricing,digest:preview.preview.digest})
 await act('/quotes/'+job.quotes.at(-1).id+'/accept',{method:'signed',evidence:'Exact synthetic client agreement',schedule_choice:{kind:'none',reason:'Schedule follows reviewed permit'}})
 const schedule=await act('/schedules',{trade:'Synthetic carpenter',description:'Published oak installation',start:'2026-11-02T09:00:00Z',end:'2026-11-02T12:00:00Z'})
 const diaries=[]
 for(let n=1;n<=16;n++)diaries.push(await act('/diary',{date:'2026-10-'+String(n).padStart(2,'0'),note:'Published oak progress '+n,...(n===1?{attachments:[{name:'synthetic-plinth-photo.png',mime:'image/png',base64:timelinePhoto.toString('base64')}]}:{})}))
 const change=await act('/variations',{description:'Oak pending decision',amount_cents:1000})
 const selection=await act('/selections',{room:'Kitchen',category:'Cabinet finish',allowance_cents:10000,cost_code:'06-100',decision_on:'2026-11-04',lead_days:7,options:[{name:'Oak',supplier:'Synthetic supply',specifications:'Reviewed matte oak',price_cents:10000}]})
 await act('/selections/'+selection.id+'/present',{revision_id:selection.revisions[0].id})
 const invoice=await act('/invoices',{kind:'deposit',description:'Oak construction deposit',amount_cents:10000,recipient_email:timelineAddress(1),due_on:'2026-11-04',terms:'Reviewed deposit terms'})
 await act('/invoices/'+invoice.id+'/issue')
 await act('/invoices',{kind:'deposit',description:'Private draft invoice sentinel',amount_cents:1000,recipient_email:timelineAddress(1),due_on:'2026-11-04',terms:'Office draft'})
 const agent=await f.agent()
 const foreman=f.fieldPerson?await f.fieldPerson(job.id):null
 const hidden=await act('/diary',{date:'2026-10-17',note:'Private draft diary sentinel',attachments:[{name:'synthetic-plinth-private.png',mime:'image/png',base64:timelinePhoto.toString('base64')}]},foreman??f.owner,foreman?undefined:agent)
 if(!foreman)await act('/schedules',{trade:'Synthetic private trade',description:'Private draft schedule sentinel',start:'2026-11-03T09:00:00Z',end:'2026-11-03T12:00:00Z'},f.owner,agent)
 await act('/correspondence',{kind:'message',to:timelineAddress(1),subject:'Alex oak discussion',body:'Alex private-to-recipient oak detail'})
 await act('/correspondence',{kind:'message',to:timelineAddress(2),subject:'Jordan oak discussion',body:'Jordan private-to-recipient oak detail'})
 await act('/correspondence',{kind:'note',body:'Private bid margin sentinel'})
 const other=(await api('/jobs',{name:'Other household job',client_email:timelineAddress(3),address:'17 Synthetic Street'})).value.job
 const timeline=(cookie=first,params={})=>api(root+'/client-timeline?'+new URLSearchParams(params),undefined,cookie)
 const revoke=async()=>act('/customer',{customer_id:customer.id,property_id:customer.properties[0].id,client_contact_ids:['synthetic-plinth-1']})
 const restrict=async(client)=>act('/portal-policy',{disabled:{client,subcontractor:[]},reason:'Owner reviewed current external restrictions'})
 return {agentDeniedStatus:f.agentDeniedStatus??403,first,second,outsider,agent,api,root,job:()=>job,read,act,schedule,diaries,hidden,change,selection,invoice,other,timeline,revoke,restrict}
}
export async function proveTimeline(c) {
 let r=await c.timeline();assert.equal(r.status,200,JSON.stringify(r.value));const firstPage=r.value
 assert.equal(firstPage.count,21);assert.equal(firstPage.items.length,20);assert.ok(firstPage.next_cursor)
 const next=await c.timeline(c.first,{cursor:firstPage.next_cursor});assert.equal(next.status,200);assert.equal(next.value.items.length,1)
 const all=[...firstPage.items,...next.value.items]
 assert.equal(new Set(all.map(i=>i.source)).size,21)
 assert.deepEqual(new Set(all.map(i=>i.kind)),new Set(['schedule','diary','change','selection','invoice','correspondence']))
 assert.equal(all.find(i=>i.source==='schedule:'+c.schedule.id).date,'2026-11-02T09:00:00.000Z')
 assert.equal(all.find(i=>i.source==='diary:'+c.diaries[0].id).date,'2026-10-01')
 assert.ok(all.every(i=>i.date_label&&i.date&&i.href.includes('source=')&&i.source_href))
 assert.equal(all.find(i=>i.kind==='invoice').status,'Issued · Balance outstanding')
 assert.match(all.find(i=>i.kind==='invoice').text,/100\.00/)
 assert.doesNotMatch(JSON.stringify(all),/Private draft|Private bid|margin sentinel|Jordan private-to-recipient|53000/)
 r=await c.timeline(c.second);assert.equal(r.status,200);assert.equal(r.value.count,21)
 assert.match(JSON.stringify(r.value),/Jordan oak discussion/);assert.doesNotMatch(JSON.stringify(r.value),/Alex oak discussion/)
 assert.equal((await c.timeline(c.second,{cursor:firstPage.next_cursor})).status,409)
 r=await c.timeline(c.first,{q:'oak'});assert.equal(r.value.count,20)
 r=await c.timeline(c.first,{q:'Private bid margin sentinel'});assert.deepEqual(r.value,{items:[],count:0,next_cursor:null})
 r=await c.timeline(c.first,{q:'Jordan private-to-recipient'});assert.equal(r.value.count,0)
 r=await c.timeline(c.first,{source:'diary:'+c.diaries[0].id});assert.equal(r.value.count,1);assert.equal(r.value.items[0].files.length,1)
 assert.equal((await c.timeline(c.first,{limit:0})).status,400)
 assert.equal((await c.timeline(c.first,{cursor:'invalid'})).status,400)
 for(const cookie of [c.outsider])assert.equal((await c.timeline(cookie)).status,404)
 assert.equal((await c.api('/jobs/'+c.other.id+'/client-timeline',undefined,c.first)).status,404)
 assert.equal((await c.api(c.root+'/client-timeline',undefined,undefined,c.agent)).status,c.agentDeniedStatus)
 // Neither private records nor another recipient's new messages alter visible counts or cursors.
 await c.act('/correspondence',{kind:'note',body:'More private bid margin sentinel'})
 await c.act('/correspondence',{kind:'message',to:timelineAddress(2),subject:'Jordan additional private correspondence',body:'Recipient-only later discussion'})
 assert.deepEqual((await c.timeline()).value,firstPage)
 assert.equal((await c.timeline(c.first,{cursor:firstPage.next_cursor})).status,200)
 return {firstPage,all}
}
