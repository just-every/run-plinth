import assert from 'node:assert/strict'
import { takeoffPlan } from '../fixtures/takeoff-plan.mjs'

/** A complete reviewed drawing lifecycle through authenticated HTTP and real D1. */
export async function proveDrawingReview(f,job,{existingClient}={}){
 const root=`/api/plinth/jobs/${job.id}/plans`,read=async(cookie=f.owner)=>f.json(root,{cookie})
 const act=async(path,input={},cookie=f.owner)=>{const state=(await read()).value.plans;return f.json(root+path,{method:'POST',cookie,body:{expected_version:state.version,...input}})}
 const ok=async(path,input={},cookie)=>{const r=await act(path,input,cookie);assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
 const noWrite=async(path,input,cookie=f.owner)=>{const before=(await read()).value;const audit=(await f.db.prepare('SELECT count(*) AS n FROM pl_audit').first()).n;const r=await act(path,input,cookie);assert.ok([400,403,404,409].includes(r.status),JSON.stringify(r));assert.deepEqual((await read()).value,before);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM pl_audit').first()).n,audit);return r}
 const original=takeoffPlan(),source=(number,page,revision='Review A')=>({number,revision,kind:'plan',page,width:400,height:400,document:{name:'synthetic-plinth-drawing.pdf',mime:'application/pdf',base64:original.toString('base64')}})
 const uploaded=await ok('',{title:'Drawing recognition review set',issue_on:'2026-10-01',sheets:[source('A1',1),source('A2',2)]}),setId=uploaded.record.id,set=uploaded.plans.sets.find(s=>s.id===setId),[one,two]=set.sheets
 const client=existingClient??await f.invite(job.client_email,'Drawing client'),pm=await f.invite(['synthetic-plinth-drawing-manager','example.test'].join('@'),'Drawing manager','admin')
 const person=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team.find(p=>p.name==='Drawing manager')
 let assignment=await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'project_manager',job_ids:[job.id],po_limit_cents:0}});assert.equal(assignment.status,200)
 const recipient=uploaded.plans.recipients.find(p=>p.id===uploaded.plans.person_id)
 await ok('/'+setId+'/approve',{confirm:true,recipient_ids:[recipient.id]})
 await ok('/'+setId+'/annotate',{sheet_id:one.id,x:80,y:90,text:'Source-only reviewed site markup'})
 const annotationOnly=await f.json(root+'/review-search?q=Source-only',{cookie:pm});assert.equal(annotationOnly.status,200);assert.equal(annotationOnly.value.results[0].sheet_id,one.id);assert.equal(annotationOnly.value.results[0].review,undefined,'Existing authored markup is searchable before OCR review')
 const proposalInput=(sheet,number,text)=>({sheet_id:sheet.id,checksum:sheet.document.checksum,page:sheet.page,number,name:'Kitchen plan',text,regions:[{text:number+' - Kitchen plan',x:50,y:80,width:200,height:20,confidence:48}]})
 await noWrite('/'+setId+'/recognition-propose',{...proposalInput(one,'AI','Unreviewed secret'),checksum:'wrong-source'})
 await noWrite('/'+setId+'/recognition-propose',{...proposalInput(one,'AI','Unreviewed secret'),page:2})
 await noWrite('/'+setId+'/recognition-propose',{...proposalInput(one,'AI','Unreviewed secret'),regions:[{text:'outside',x:399,y:0,width:20,height:20,confidence:70}]})
 const draft=await ok('/'+setId+'/recognition-propose',proposalInput(one,'AI','Unreviewed secret; SEE A2 DETAIL 1'),pm),proposal=draft.record.id
 assert.equal(draft.plans.sets.find(s=>s.id===setId).sheets[0].number,'A1','Recognition never silently renames an approved sheet')
 assert.equal((await f.json(root+'/review-search?q=Unreviewed',{cookie:f.owner})).value.count,0,'Unreviewed proposals are not searchable reviewed text')
 const adoption={proposal_id:proposal,previous_review_id:null,number:'A1',name:'Kitchen plan',text:'Reviewed framing detail SEE A2 DETAIL 1',confirm:true}
 await noWrite('/'+setId+'/recognition-review',{...adoption,confirm:false})
 await noWrite('/'+setId+'/recognition-review',adoption,client)
 const approved=await ok('/'+setId+'/recognition-review',adoption,pm),review=approved.plans.sets.find(s=>s.id===setId).drawing_review.reviews[0]
 const next=await ok('/'+setId+'/recognition-propose',proposalInput(two,'A2','Laundry detail exact reviewed source'))
 const second=await ok('/'+setId+'/recognition-review',{proposal_id:next.record.id,previous_review_id:null,number:'A2',name:'Laundry plan',text:'Laundry detail exact reviewed source',confirm:true})
 const target=second.plans.sets.find(s=>s.id===setId).drawing_review.reviews.at(-1)
 const linkInput={from_review:review.id,to_set:setId,to_review:target.id,label:'Open laundry detail',x:50,y:80,width:200,height:20,confirm:true}
 await noWrite('/'+setId+'/detail-link',{...linkInput,to_set:crypto.randomUUID()})
 await noWrite('/'+setId+'/detail-link',{...linkInput,to_review:review.id})
 const linked=await ok('/'+setId+'/detail-link',linkInput),link=linked.record.id
 await ok('/'+setId+'/detail-link',linkInput)
 assert.equal((await read()).value.plans.sets.find(s=>s.id===setId).drawing_review.links.length,1,'Review replay cannot duplicate a detail link')
 const follow=await f.json(root+'/'+setId+'/links/'+link,{cookie:pm});assert.equal(follow.status,200);assert.equal(new URL(follow.value.href,f.origin).searchParams.get('plan_sheet'),two.id);assert.equal(follow.value.to.checksum,two.document.checksum)
 await ok('/'+setId+'/annotate',{sheet_id:one.id,x:120,y:130,text:'Reviewed waterproofing markup'})
 for(const term of ['Reviewed framing','waterproofing']){const found=await f.json(root+'/review-search?'+new URLSearchParams({q:term}),{cookie:pm});assert.equal(found.status,200);assert.equal(found.value.count,1);assert.equal(found.value.results[0].sheet_id,one.id);assert.equal(found.value.results[0].revision,one.revision)}
 for(const cookie of [client]){
  assert.ok([403,404].includes((await f.json(root+'/review-search?q=Reviewed',{cookie})).status))
  assert.ok([403,404].includes((await f.json(root+'/'+setId+'/links/'+link,{cookie})).status))
 }
 assert.equal((await f.json('/api/plinth/jobs/'+job.id,{cookie:client})).value.job.plan_sets,undefined)
 const other=await f.json('/api/plinth/jobs',{method:'POST',cookie:f.owner,body:{name:'Another drawing job',address:'2 Synthetic Lane',client_email:['synthetic-plinth-other','example.test'].join('@')}});assert.equal(other.status,201)
 for(const path of ['/'+setId+'/links/'+link,'/review-search?q=Reviewed'])assert.ok([403,404].includes((await f.json('/api/plinth/jobs/'+other.value.job.id+'/plans'+path,{cookie:pm})).status),'An assigned manager cannot read reviews through another job')
 assert.equal((await f.json('/api/plinth/jobs/'+other.value.job.id+'/plans/'+setId+'/links/'+link,{cookie:f.owner})).status,404,'Even an owner cannot mix jobs and source identifiers')
 const staleVersion=(await read()).value.plans.version
 await ok('/'+setId+'/recognition-review',{...adoption,previous_review_id:review.id,text:'Corrected reviewed framing SEE A2 DETAIL 1'})
 assert.equal((await f.json(root+'/'+setId+'/recognition-review',{method:'POST',cookie:f.owner,body:{expected_version:staleVersion,...adoption}})).status,409)
 await noWrite('/'+setId+'/recognition-review',adoption)
 assert.equal((await f.json(root+'/'+setId+'/links/'+link,{cookie:f.owner})).status,409,'A stale reviewed detail link needs fresh approval')
 await noWrite('/'+setId+'/detail-link',linkInput)
 assignment=await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:assignment.value.member.version,role:'project_manager',job_ids:[],po_limit_cents:0}});assert.equal(assignment.status,200)
 assert.equal((await f.json(root+'/review-search?q=Reviewed',{cookie:pm})).status,404)
 assert.equal((await f.json(root+'/'+setId+'/links/'+link,{cookie:pm})).status,404)
 await noWrite('/'+setId+'/recognition-review',{...adoption,previous_review_id:review.id},pm)
 const agent=await f.agent();assert.equal((await f.json(root+'/review-search?q=Reviewed',{token:agent})).status,403)
 for(const sheet of [one,two]){const downloaded=await f.request(root+'/'+setId+'/files/'+sheet.id,{cookie:f.owner});assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),original)}
 const state=(await read()).value.plans,retained=state.sets.find(s=>s.id===setId)
 assert.equal(retained.drawing_review.reviews.filter(r=>r.sheet_id===one.id).length,2);assert.equal(retained.drawing_review.reviews[0].number,'A1');assert.equal(retained.drawing_review.proposals[0].number,'AI')
 const audit=await f.json('/api/plinth/audit?job_id='+job.id,{cookie:f.owner});assert.equal(audit.status,200);assert.ok(audit.value.events.some(e=>JSON.stringify(e).includes('plans.recognition')))
 return {set:retained,one,two,original,link}
}
