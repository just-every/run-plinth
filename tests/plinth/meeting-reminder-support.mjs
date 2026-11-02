import assert from 'node:assert/strict'
import { createReleasedScope } from './helpers.mjs'

// This scenario extends the existing public meeting-mail journey without another test registration.
export async function delegateReminderJourney(s, meeting, controls) {
 const { f } = s
 let job=(await s.api(`/jobs/${s.job().id}`)).value.job
 const root=`/jobs/${job.id}`,read=async()=>job=(await s.api(root)).value.job
 const act=async(path,body={})=>{await read();const r=await s.api(root+path,{method:'POST',body:{expected_version:job.version,...body}});assert.equal(r.status,200,JSON.stringify(r.value));return r.value.record}
 const people={}
 for(const [name,role,kind] of [['field','admin','office'],['custom','admin','office'],['client','member','client'],['sub','member','sub']]) {
  const email=['synthetic-plinth-reminder-'+name,'example.test'].join('@'),cookie=await f.invite(email,'Synthetic reminder '+name,role)
  const person=(await s.api('/team')).value.team.find(p=>p.email===email)
  people[name]={email,cookie,person,kind,teamVersion:0}
 }
 const team=async(p,ids,extra={})=>{const r=await s.api('/team/'+p.person.id,{method:'PUT',body:{expected_version:p.teamVersion,role:p.kind==='office'?'superintendent':'crew',job_ids:ids,po_limit_cents:0,...extra}});assert.equal(r.status,200);p.teamVersion=r.value.member.version}
 await team(people.field,[job.id])
 let role=(await s.api('/roles',{method:'POST',body:{copy_of:'project_manager',name:'Synthetic reminder document viewer',permissions:{documents:{view:true,create:false}}}})).value.role
 await team(people.custom,[job.id],{role:'custom',role_id:role.id})
 const customer=(await s.api('/customers',{method:'POST',body:{name:'Synthetic reminder household',kind:'household',contacts:[{id:'synthetic-plinth-reminder-contact',name:'Synthetic reminder client',email:people.client.email}],properties:[{id:'synthetic-plinth-reminder-property',label:'Site',address:'Synthetic reminder site'}]}})).value.customer
 const link={customer_id:customer.id,property_id:'synthetic-plinth-reminder-property',client_contact_ids:['synthetic-plinth-reminder-contact']}
 await act('/customer',link)
 const released=await createReleasedScope(f,await read(),people.sub.email,'Synthetic reminder package');job=released.job;people.sub.scope=released.scope.id
 const newAction=async(p,title='Synthetic outstanding '+p.kind)=>act(`/meetings/${meeting.id}/add-action`,{title,owner_kind:p.kind,owner_email:p.email,confirm_title:true,due_on:'2026-11-06',...(p.scope?{subcontract_id:p.scope}:{})})
 const publish=async(p,meetingId=meeting.id)=>act(`/meetings/${meetingId}/share`,{operation_id:crypto.randomUUID(),title:'Reviewed reminder context '+p.kind,body:'Only this reviewed clearance context is shared.',confirm:true,recipients:[{email:p.email,kind:p.kind,can_comment:false,...(p.scope?{subcontract_id:p.scope}:{})}]})
 const request=async(p,action=p.action,share=p.share,extra={})=>{await read();return s.api(`/meeting-inbox/${job.id}/${share.id}/email-copy`,{method:'POST',cookie:p.cookie,body:{expected_version:job.version,operation_id:crypto.randomUUID(),kind:'action_reminder',action_id:action.id,confirm:true,...extra}})}
 const preview=(p,r)=>s.api(root+`/meeting-shares/${p.share.id}/email-preview?request_id=${r.id}`)
 const send=async(p,r,review,version)=>{await read();return s.api(root+`/meeting-shares/${p.share.id}/send-email`,{method:'POST',body:{expected_version:version??job.version,request_id:r.id,digest:review.digest,confirm:true}})}
 const state=async(p,r)=>(await read()).meeting_shares.find(row=>row.id===p.share.id).email_requests.find(row=>row.id===r.id)
 const pending=async p=>{const r=await request(p);assert.equal(r.status,200,JSON.stringify(r.value));const review=await preview(p,r.value.record);assert.equal(review.status,200,JSON.stringify(review.value));return {record:r.value.record,review:review.value}}
 const refused=async(p,attempt,error)=>{
  const before=f.messages.length,previous=structuredClone(await read())
  for(const result of [await preview(p,attempt.record),await send(p,attempt.record,attempt.review)]){assert.ok([403,409].includes(result.status),JSON.stringify(result));assert.equal(result.value.error,error)}
  assert.deepEqual(await read(),previous,'Refused review and send leave action, consent, reservation and history unchanged')
  assert.equal((await state(p,attempt.record)).status,'requested');assert.equal(f.messages.length,before,'No provider call after lost reminder eligibility')
 }
 // Action ownership supplies no independent reviewed-extract grant.
 people.field.action=await newAction(people.field,'Synthetic delegated field clearance')
 const actionOnly=await s.api('/meeting-inbox/'+job.id,{cookie:people.field.cookie});assert.equal(actionOnly.status,200);assert.deepEqual(actionOnly.value.shares,[])
 assert.equal((await request(people.field,people.field.action,{id:'synthetic-plinth-ungranted-extract'})).status,404)
 const foreignMeeting=await act('/meetings',{title:'Synthetic separate meeting',held_on:'2026-10-26',agenda:'Separate context',minutes:'Private separate minutes',attendees:[],decisions:'Private separate decision',tags:[],actions:[]})
 const foreignShare=await publish(people.field,foreignMeeting.id)
 assert.equal((await request(people.field,people.field.action,foreignShare)).status,404,'An extract of another meeting grants no reminder for this action')
 const durable=[]
 for(const [name,p] of Object.entries(people)) {
  p.action??=await newAction(p,'Synthetic delegated '+name+' clearance');p.share=await publish(p)
  const inbox=await s.api('/meeting-inbox/'+job.id,{cookie:p.cookie});assert.equal(inbox.status,200)
  assert.deepEqual(inbox.value.shares.find(row=>row.id===p.share.id).reminder_action_ids,[p.action.id])
  if(name==='field')assert.deepEqual(inbox.value.shares.find(row=>row.id===foreignShare.id).reminder_action_ids,[])
  assert.equal((await request(p,people.field.action)).status,name==='field'?200:409)
  // Cancel the field's extra consent; other delegates never owned that action.
  if(name==='field'){const copy=(await s.api('/meeting-inbox/'+job.id,{cookie:p.cookie})).value.shares.find(row=>row.id===p.share.id).email_copy;assert.equal((await request(p,p.action,p.share,{cancel:true,request_id:copy.id})).status,200)}
  const attempt=await pending(p)
  const before=f.messages.length
  assert.equal((await request(p)).value.error,'mail_pending')
  assert.equal((await s.api(root+`/meeting-shares/${p.share.id}/email-preview?request_id=${attempt.record.id}`,{cookie:p.cookie})).status,403,'A delegate cannot review their own outgoing reminder')
  assert.equal((await send(p,attempt.record,{...attempt.review,digest:'synthetic-plinth-stale-review'})).value.error,'mail_review')
  assert.equal(f.messages.length,before)
  if(name==='custom') {
   const pref={assignment:'off',comment:'off',reminder:'off'}
   assert.equal((await s.api('/todos/preferences',{method:'POST',cookie:p.cookie,body:{expected_revision:0,...pref,quiet:{start:'00:00',end:'00:00',time_zone:'America/New_York'}}})).status,200)
   await refused(p,attempt,'mail_quiet')
   assert.equal((await s.api('/todos/preferences',{method:'POST',cookie:p.cookie,body:{expected_revision:1,...pref}})).status,200)
   assert.equal((await preview(p,attempt.record)).value.digest,attempt.review.digest)
  }
  if(name==='field') {
   const gate={entered:Promise.withResolvers(),release:Promise.withResolvers()};controls.gate(gate)
   const version=(await read()).version
   const attempts=Promise.all([send(p,attempt.record,attempt.review,version),send(p,attempt.record,attempt.review,version)])
   try {await Promise.race([gate.entered.promise,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Delegate reminder did not reach the provider')),20000);t.unref();gate.entered.promise.then(()=>clearTimeout(t))})]);assert.equal((await state(p,attempt.record)).status,'unknown','Reservation persists before the provider response')}
   finally {gate.release.resolve();controls.gate(undefined)}
   assert.deepEqual((await attempts).map(r=>r.status).sort(),[200,409])
  } else {
   controls.uncertain(name==='sub')
   try {assert.equal((await send(p,attempt.record,attempt.review)).status,200)} finally {controls.uncertain(false)}
  }
  assert.equal(f.messages.length,before+1)
  const wire=f.messages.at(-1);assert.deepEqual(wire.to,[p.email]);assert.equal(wire.subject,attempt.review.subject);assert.equal(wire.text,attempt.review.body)
  assert.ok(wire.text.includes(p.action.title)&&wire.text.includes(p.action.due_on)&&wire.text.includes('/api/plinth/mail/unsubscribe/'))
  assert.ok(!wire.text.includes('Private separate minutes'))
  const status=name==='sub'?'unknown':'accepted';assert.equal((await state(p,attempt.record)).status,status)
  const sent=await state(p,attempt.record);assert.equal(sent.approved_by.name,'Builder');assert.notEqual(sent.approved_by.id,p.person.id);assert.equal(sent.by.id,p.person.id);assert.equal(sent.body,wire.text)
  assert.equal((await send(p,attempt.record,attempt.review)).value.error,'mail_reserved');assert.equal(f.messages.length,before+1)
  durable.push({share:p.share,request:attempt.record,review:attempt.review,status})
 }
 // Recheck every current native authority at review and final send, and never reserve a refused attempt.
 for(const [name,p] of Object.entries(people)) {
  const attempt=await pending(p)
  if(name==='field')await team(p,[])
  if(name==='custom'){const changed=await s.api('/roles/'+role.id,{method:'PUT',body:{expected_version:role.version,permissions:{documents:{view:false}}}});assert.equal(changed.status,200);role=changed.value.role}
  if(name==='client')await act('/customer',{...link,client_contact_ids:[]})
  if(name==='sub')await act(`/subcontracts/${p.scope}/access`,{contact_ids:[],reason:'Synthetic current scope authority ended'})
  await refused(p,attempt,'recipient_authority')
 }
 // A still-authorized recipient cannot remind themselves after reassignment or completion.
 const p=people.field;await team(p,[job.id]);p.share=await publish(p)
 const completed=await pending(p)
 await read();const finish=await s.api(`/meeting-inbox/${job.id}/actions/${p.action.id}/complete`,{method:'POST',cookie:p.cookie,body:{expected_version:job.version,answer:'Synthetic clearance checked',links:[]}});assert.equal(finish.status,200)
 await refused(p,completed,'meeting_action');assert.equal((await request(p)).value.error,'meeting_action')
 p.action=await newAction(p,'Synthetic reassigned reminder action');const reassigned=await pending(p)
 await act(`/meetings/${meeting.id}/reassign`,{action_id:p.action.id,owner_email:['builder','example.com'].join('@'),owner_kind:'manager',reason:'Synthetic builder takes the outstanding action'})
 await refused(p,reassigned,'meeting_action');assert.equal((await request(p)).value.error,'meeting_action')
 p.action=await newAction(p,'Synthetic suppressed reminder action');const suppressed=await pending(p)
 const unsubscribe=new URL(suppressed.review.body.match(/https?:\/\/\S+\/api\/plinth\/mail\/unsubscribe\/\S+/)[0])
 assert.equal((await fetch(f.origin+unsubscribe.pathname,{method:'POST'})).status,200)
 await refused(p,suppressed,'mail_suppressed')
 console.log('PROBE DOC-011 point 4: HTTP meeting inbox and owner review -> four current delegate kinds reserved once; exact outgoing bodies; replay, completion, reassignment, quiet hours, suppression and current job, client, custom-role and released-scope loss refused without provider calls')
 return durable
}
