import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {stripeEdge, intent} from '../../tests/plinth/payment-fixture.mjs'
import {createFixture} from '../../tests/plinth/helpers.mjs'

/** A real Worker and real test-mode processor, with optional loss of the first Checkout response. */
export async function stripeFixture(key, {providerEdge=false}={}) {
 let lose=false
 const edge=providerEdge?stripeEdge():null,syntheticEvents=[]
 const f=await createFixture({stripeSecret:key,stripeEdge:async request=>{
  const response=edge?await edge.handler(request):await fetch(request.url,{method:request.method,headers:request.headers,...(request.method==='POST'?{body:await request.text()}:{})})
  if(lose&&request.method==='POST'&&new URL(request.url).pathname==='/v1/checkout/sessions'){lose=false;await response.arrayBuffer();return new Response(null,{status:502})}
  return response
 }})
 const email='synthetic-plinth-client@example.com',client=await f.invite(email,'Alex Chen')
 const api=(path,body,cookie=f.owner)=>f.json('/api/plinth'+path,{cookie,...(body===undefined?{}:{method:'POST',body})})
 let job=(await api('/jobs',{name:'Maple Street settlement and corrections',client_email:email,address:'2480 Maple Street, Burlington, VT 05401',time_zone:'America/New_York'})).value.job
 const read=async()=>job=(await api(`/jobs/${job.id}`)).value.job
 const act=async(path,body={},cookie=f.owner)=>{await read();const r=await api(`/jobs/${job.id}${path}`,{expected_version:job.version,...body},cookie);assert.equal(r.status,200,path+' '+r.status);await read();return r.value.record??r.value}
 await act('/quotes',{lines:[{id:'scope',description:'Original reviewed scope',cost_code:'06-100',phase:'Framing',category:'material',quantity:'1',unit:'job',unit_cents:1000000,cost_unit_cents:500000}]})
 const rate=(await api('/pricing-rates',{jurisdiction:'Human-reviewed synthetic jurisdiction',kind:'sales',percent:'10',effective_on:'2026-01-01',reference:'Synthetic human review',human_reviewed:true})).value.rate
 const pricing={basis:'sell',as_of:'2026-10-21',rules:[],tax:{rate_id:rate.id,taxable_line_ids:[],exemption_reference:'Reviewed exempt source'}}
 const preview=await act('/pricing/preview',pricing);await act('/pricing/apply',{...pricing,digest:preview.preview.digest})
 await act(`/quotes/${job.quotes.at(-1).id}/accept`,{method:'signed',evidence:'Reviewed signed source',schedule_choice:{kind:'none',reason:'Planned separately'}})
 const change={description:'Client-approved finish addition',direction:'charge',basis:'sell',as_of:'2026-10-21',lines:[{id:'addition',description:'Added finish',cost_code:'06-100',phase:'Finish',category:'material',quantity:'1',unit:'job',unit_cents:10000,cost_unit_cents:5000}],rules:[],tax:{rate_id:rate.id,taxable_line_ids:['addition']}}
 const cp=await act('/variation-pricing/preview',change);await act('/variation-pricing/apply',{...change,digest:cp.preview.digest});await act(`/variations/${job.variations.at(-1).id}/approve`,{},client)
 const changeId='variation:'+job.variations.at(-1).id;await act('/sov',{code_assignments:{[changeId]:'06-100'}})
 const invoice=async(amount,description,milestone=false)=>{
  let source
  if(milestone){const claim=await act('/claims',{description,lines:[{line_id:'quote:scope',completed_cents:0,stored_cents:0,evidence:'Not billed'},{line_id:changeId,completed_cents:11000,stored_cents:0,evidence:'Reviewed installed addition'}]});await act(`/claims/${claim.id}/approve`);await act(`/claims/${claim.id}/issue`);source=claim.id}
  const row=await act('/invoices',{kind:milestone?'milestone':'deposit',description,amount_cents:amount,recipient_email:email,due_on:'2026-11-15',terms:'Due fourteen days from issue',...(source?{source_application_id:source}:{})});await act(`/invoices/${row.id}/issue`);return row.id
 }
 const send=async event=>{const body=JSON.stringify(event),at=Math.floor(Date.now()/1000);return fetch(f.origin+'/api/plinth/payments/stripe/events',{method:'POST',body,headers:{'content-type':'application/json','stripe-signature':`t=${at},v1=${createHmac('sha256','synthetic-plinth-webhook-secret-1').update(`${at}.${body}`).digest('hex')}`}})}
 const stripe=async path=>{if(edge){if(path.startsWith('/events?')){const type=new URL('https://synthetic-plinth.example'+path).searchParams.get('type');return {data:syntheticEvents.filter(e=>e.type===type)}}const r=await edge.handler(new Request('https://api.stripe.com/v1'+path));assert.ok(r.ok,'Synthetic provider lookup succeeds');return r.json()}const r=await fetch('https://api.stripe.com/v1'+path,{headers:{authorization:`Bearer ${key}`}});assert.ok(r.ok,'Provider lookup succeeded');return r.json()}
 const attempts=async()=>(await api(`/jobs/${job.id}/payments`)).value.attempts
 const pay=async id=>{const r=await api(`/jobs/${job.id}/payments`,{invoice_id:id,confirm:true},client);return r}
 const events=async(type,attempt)=>{const list=await stripe(`/events?type=${encodeURIComponent(type)}&limit=100&created[gte]=${Math.floor(Date.now()/1000)-3600}`);return list.data.filter(e=>e.data.object.client_reference_id===attempt||e.data.object.metadata?.plinth_attempt===attempt)}
 const settle=async(url,disputed)=>{const session=edge.sessions.find(s=>s.id===new URL(url).pathname.split('/').pop());assert.ok(session);const amount=Number(session.form.get('line_items[0][price_data][unit_amount]')),id='synthetic-plinth-intent-'+edge.intents.size,payment=intent(id,amount);session.payment_intent=id;session.status='complete';session.payment_status='paid';payment.metadata={plinth_attempt:session.form.get('client_reference_id')};if(disputed){const dispute={id:'synthetic-plinth-dispute-'+edge.disputes.length,amount,status:'needs_response',reason:'fraudulent',payment_intent:id};payment.latest_charge.dispute=dispute;edge.disputes.push(dispute);syntheticEvents.push({id:crypto.randomUUID(),type:'charge.dispute.created',livemode:false,data:{object:dispute}})}edge.intents.set(id,payment);syntheticEvents.push({id:crypto.randomUUID(),type:'checkout.session.completed',livemode:false,data:{object:{id:session.id,payment_intent:id,client_reference_id:session.form.get('client_reference_id'),currency:'usd',amount_total:amount,payment_status:'paid'}}})}
 return {edge,settle,f,read,act,invoice,pay,send,stripe,attempts,events,loseNext:()=>{lose=true},job:()=>job}
}
