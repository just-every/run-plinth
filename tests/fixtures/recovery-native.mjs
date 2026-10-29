/** Seed real native decisions and record explicit owner source review through HTTP. */
export async function recoveryNative(call,{name,client,share=true,sensitive=false}){
 let job=(await call('jobs',{name,client_email:client,address:'Synthetic recovery site'})).job
 const root='jobs/'+job.id
 const read=async()=>{job=(await call(root,undefined,'GET')).job;return job}
 const act=async(path,input={})=>{const value=await call(root+path,{expected_version:job.version,...input});if(value.job)job=value.job;else if(value.version)job={...job,version:value.version};return value}
 await act('/quotes',{lines:[{id:'package',description:'Delayed long-lead package',cost_code:'06-100',phase:'Framing',category:'material',quantity:'1',unit:'lot',cost_unit_cents:100000,unit_cents:200000},{id:'labor',description:'Installation labor',cost_code:'01-100',phase:'Framing',category:'labor',quantity:'1',unit:'lot',cost_unit_cents:50000,unit_cents:100000}]})
 const rate=(await call('pricing-rates',{jurisdiction:'Synthetic recovery jurisdiction',kind:'sales',percent:'0',effective_on:'2026-01-01',reference:'synthetic-plinth-recovery-tax',human_reviewed:true})).rate
 const pricing={basis:'sell',as_of:'2026-10-23',rules:[],tax:{rate_id:rate.id,taxable_line_ids:['package','labor']}}
 const priced=await act('/pricing/preview',pricing);await act('/pricing/apply',{...pricing,digest:priced.preview.digest})
 await act('/quotes/'+job.quotes.at(-1).id+'/accept',{method:'signed',evidence:'Synthetic reviewed client scope',schedule_choice:{kind:'none',reason:'Separately reviewed native schedule'}})
 await act('/costs/policy',{budget_limit_cents:0,commitment_limit_cents:0,bill_limit_cents:1000000,separate_approval:false,owner_id:job.created_by.id,due_on:'2026-11-01'})
 let value=await act('/orders',{supplier:'Synthetic package supplier',description:'Long-lead package',promised_on:'2026-11-02',source:{kind:'budget',cost_code:'06-100'},lines:[{id:'package',description:'Package units',cost_code:'06-100',quantity:'10',unit:'pack',unit_cents:10000}]})
 const order=value.record
 await act('/orders/'+order.id+'/issue')
 await act('/orders/'+order.id+'/receive',{lines:[{line_id:'package',quantity:'2'}],reference:'synthetic-plinth-early-delivery'})
 await act('/orders/'+order.id+'/promise',{promised_on:'2026-11-09',reason:'Supplier reported a seven-day delay on the remaining package'})
 value=await act('/costs/sources',{kind:'time',reference:'synthetic-plinth-labor-overrun',employee_reference:'synthetic-plinth-crew',dated_on:'2026-10-23',period:'2026-10',cost_code:'01-100',minutes:600,hour_cents:6000})
 await act('/costs/sources/'+value.record.id+'/approve')
 const resource=(await call('resources',{name:'Recovery crew '+job.id,kind:'crew',capacity:2,available:[],leave:[],reason:'Recorded native crew capacity'})).resource
 const calendar={weekdays:[1,2,3,4,5],start_hour:8,end_hour:16,holidays:[]},arrival=crypto.randomUUID(),install=crypto.randomUUID(),trade='Recovery trade '+job.id
 const tasks=[{id:arrival,trade:'Package arrival '+job.id,description:'Package availability milestone',owner:'Purchasing owner',start:'2026-11-02T08:00:00Z',duration_minutes:0,milestone:true,predecessors:[]},{id:install,trade,description:'Install delayed package',owner:'Site owner',start:'2026-11-02T08:00:00Z',duration_minutes:960,predecessors:[{id:arrival,lag_minutes:0}],resources:[{resource_id:resource.id,units:1}]}]
 value=await act('/schedule/preview',{calendar,tasks})
 await act('/schedule/publish',{calendar,tasks:value.preview.tasks,digest:value.preview.digest})
 await act('/sov')
 value=await act('/claims',{description:'Reviewed completed stage',lines:job.sov.at(-1).lines.map((l,i)=>({line_id:l.id,completed_cents:i?0:50000,stored_cents:0,evidence:'Native reviewed completed work'}))})
 const claim=value.record
 await act('/claims/'+claim.id+'/approve');await act('/claims/'+claim.id+'/issue')
 value=await act('/invoices',{kind:'milestone',description:'Expected collection',source_application_id:claim.id,recipient_email:client,due_on:'2026-12-20',terms:'Reviewed native collection terms'})
 const invoice=value.record
 await act('/invoices/'+invoice.id+'/issue');await read()
 let sources,request
 const review=async(as_of='2026-10-29')=>{sources=await call(root+'/recovery/sources',undefined,'GET')
 value=await act('/recovery/requests',{source_digest:sources.digest,confirm:true,purpose:sensitive?'Synthetic SSN 123-45-6789':'Compare delayed package and labor overrun',as_of,package_order_id:order.id,package_task_id:arrival,package_cost_code:'06-100',labor_cost_code:'01-100',labor_task_id:install,share_with_owner_agents:share})
 request=value.record;return request}
 await review()
 const alternatives=[false,true].map(fast=>({id:fast?'expedite':'wait',name:fast?'Expedite with two crew units':'Wait for recorded delivery',assumptions:'Owner assumption on 29 October: remaining units and labor are unverified; supplier, trade and client decisions are outstanding',schedule:{calendar,tasks:tasks.map(t=>({...t,start:fast?'2026-11-06T08:00:00Z':'2026-11-09T08:00:00Z',...(t.id===install?{duration_minutes:fast?480:960,resources:[{resource_id:resource.id,units:fast?2:1}]}:{})}))},forecast:{source_as_of:'Reviewed native ledger and remaining eight units; external accounting unavailable',codes:[{cost_code:'06-100',remaining_quantity:'0',minutes_per_unit:'0',labor_hour_cents:0,outstanding_commitment_cents:100000,unbought_cents:0,risk_cents:0,reference:'Exact unconsumed issued commitment'},{cost_code:'01-100',remaining_quantity:'8',minutes_per_unit:'120',labor_hour_cents:fast?7500:6000,outstanding_commitment_cents:0,unbought_cents:0,risk_cents:0,reference:'Sixteen remaining crew hours; two units only reduce elapsed work'}]},amendment:{extra_cents:fast?10000:0,promised_on:fast?'2026-11-06':'2026-11-09',reason:'Proposed supplier terms only; no delivery or send is recorded'},client_decision:{description:'Proposed completion date requires actual client review',proposed_price_delta_cents:fast?50000:0},cash:{start_period:'2026-10',months:3,opening_cash_cents:200000,remaining_dates:[{cost_code:'06-100',expected_on:fast?'2026-11-09':'2026-12-15',reference:'Assumed amendment payment date'},{cost_code:'01-100',expected_on:fast?'2026-11-09':'2026-12-15',reference:'Assumed remaining labor payment date'}],invoice_dates:fast?[{invoice_id:invoice.id,expected_on:'2026-11-20',reference:'Unconfirmed earlier collection assumption; no client decision'}]:[]}}))
 return {get job(){return job},get request(){return request},get sources(){return sources},review,resource,order,invoice,arrival,install,alternatives,act,read,root}
}
