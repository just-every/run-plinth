import assert from 'node:assert/strict'

const address = n => ['synthetic-plinth-raw-'+n,'example.test'].join('@')
export async function proveRawMeetingGrants(f, jobId, meeting, people) {
 const root='/api/plinth/jobs/'+jobId, get=(path,cookie=f.owner)=>f.json(path,{cookie})
 const job=async()=>(await get(root)).value.job
 const act=async(path,body,cookie=f.owner,token)=>f.json(root+path,{method:'POST',cookie:token?undefined:cookie,token,body:{expected_version:(await job()).version,...body}})
 const office=await f.invite(address('office'),'Raw office bookkeeper','admin')
 const unrelated=await f.invite(address('unrelated'),'Unassigned office','admin')
 const all=(await get('/api/plinth/team')).value.team,officePerson=all.find(p=>p.email===address('office'))
 assert.equal((await f.json('/api/plinth/team/'+officePerson.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'bookkeeper',job_ids:[jobId],po_limit_cents:0}})).status,200)
 const grant=(email,cookie=f.owner,extra={})=>act(`/meetings/${meeting.id}/raw-grant`,{email,reason:'Review the site coordination minutes for assigned work',confirm:true,operation_id:crypto.randomUUID(),...extra},cookie)
 const agent=await f.agent()
 const before=(await job()).version, mail=f.messages.length
 for(const email of [people.clientEmail,people.subEmail,people.customEmail,address('unrelated')])assert.equal((await grant(email)).status,403)
 assert.equal((await grant(people.fieldEmail,people.field)).status,403)
 assert.equal((await act(`/meetings/${meeting.id}/raw-grant`,{email:people.fieldEmail,reason:'Agent cannot authorize',confirm:true,operation_id:crypto.randomUUID()},undefined,agent)).status,403)
 assert.equal((await grant(people.fieldEmail,f.owner,{reason:''})).status,400)
 assert.equal((await grant(people.fieldEmail,f.owner,{confirm:false})).status,400)
 assert.equal((await job()).version,before,'Refused grants leave the job unchanged')
 const fieldGrant=await grant(people.fieldEmail);assert.equal(fieldGrant.status,200,JSON.stringify(fieldGrant.value))
 const officeGrant=await grant(address('office'),people.admin);assert.equal(officeGrant.status,200,JSON.stringify(officeGrant.value))
 const missing=await act('/meetings',{title:'Unshared office discussion',held_on:'2026-10-26',agenda:'Other meeting',minutes:'Unshared private raw marker',decisions:'Never disclosed',attendees:['Builder'],tags:[],sheet:'',cost_code:'',actions:[]});assert.equal(missing.status,200)
 const doors=async(cookie,visible)=>{
  const list=await get(root+'/meetings',cookie)
  if(visible){assert.equal(list.status,200);assert.deepEqual(list.value.meetings.map(m=>m.id),[meeting.id]);assert.equal(list.value.count,1);assert.equal(list.value.meetings[0].minutes,meeting.minutes);assert.equal(list.value.meetings[0].decisions,meeting.decisions);assert.deepEqual(list.value.meetings[0].actions.map(a=>a.title),meeting.actions.map(a=>a.title));assert.equal(JSON.stringify(list.value).includes('raw_grants'),false)}else assert.equal(list.status,403)
  const one=await get(root+'/meetings/'+meeting.id,cookie);assert.equal(one.status,visible?200:403)
  const exported=await get(root+'/meetings/'+meeting.id+'/export.json',cookie);assert.equal(exported.status,visible?200:403)
  if(visible){assert.equal(exported.value.minutes,meeting.minutes);assert.equal(exported.value.raw_grants,undefined);assert.ok(exported.value.actions.every(a=>!a.completion||a.completion.links.length===0),'No retained source snapshot crosses a raw grant')}
  const search=await get(root+'/decision-search?'+new URLSearchParams({source:'meetings:'+meeting.id}),cookie);assert.equal(search.status,200);assert.equal(search.value.count,visible?1:0)
  const inbox=await get('/api/plinth/meeting-inbox',cookie);assert.equal(inbox.status,200);assert.equal(inbox.value.jobs.flatMap(j=>j.raw_meetings).length,visible?1:0)
  if(visible){const shared=await get('/api/plinth/meeting-inbox/'+jobId+'/decision-search?'+new URLSearchParams({source:'meetings:'+meeting.id}),cookie);assert.equal(shared.value.count,1);assert.equal(shared.value.results[0].text.includes(meeting.minutes),true);assert.equal((await get(root+'/meetings/'+missing.value.record.id,cookie)).status,404)}
 }
 for(const cookie of [people.field,office])await doors(cookie,true)
 const state=await job()
 assert.equal((await act(`/meetings/${meeting.id}/add-action`,{title:'Must stay read-only',owner_email:address('office'),due_on:'2026-11-06'},office)).status,403)
 assert.deepEqual(await job(),state,'Raw access grants no meeting mutation')
 const other=await f.json('/api/plinth/jobs',{method:'POST',cookie:f.owner,body:{name:'Separate raw grant job',client_email:address('other-client'),address:'Other site'}});assert.equal(other.status,201)
 assert.equal((await get('/api/plinth/jobs/'+other.value.job.id+'/meetings/'+meeting.id+'/export.json',people.field)).status,404)
 const revoke=await act(`/meetings/${meeting.id}/revoke-raw-grant`,{grant_id:fieldGrant.value.record.id,reason:'Field coordination review is finished',confirm:true,operation_id:crypto.randomUUID()});assert.equal(revoke.status,200)
 await doors(people.field,false)
 assert.equal((await f.json('/api/plinth/team/'+officePerson.id,{method:'PUT',cookie:f.owner,body:{expected_version:1,role:'bookkeeper',job_ids:[],po_limit_cents:0}})).status,200)
 assert.equal((await get('/api/plinth/meeting-inbox',office)).value.jobs.length,0)
 assert.equal((await get(root+'/meetings',office)).status,404)
 assert.equal((await f.json('/api/plinth/team/'+officePerson.id,{method:'PUT',cookie:f.owner,body:{expected_version:2,role:'bookkeeper',job_ids:[jobId],po_limit_cents:0}})).status,200)
 await doors(office,false)
 const history=(await get(root+`/meetings/${meeting.id}/raw-grants`)).value.grants
 assert.equal(history.length,2);assert.equal(history.find(g=>g.id===fieldGrant.value.record.id).revocation.reason,'Field coordination review is finished');assert.ok(history.every(g=>g.active===false))
 assert.ok((await get('/api/plinth/audit?kind=permission')).value.events.some(e=>e.action==='meetings.raw-grant'))
 assert.equal(f.messages.length,mail,'Grant, reads, refusal and revocation send nothing')
 console.log('PROBE DOC-010 4: owner and administrator raw grants -> named field and office read minutes, decisions and actions; unsafe audiences and writes refused')
 console.log('PROBE DOC-010 6: raw grant revoked and office assignment removed -> API, inbox, search, counts and export lose access; reasoned history retained')
}
