import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
export const dailyAddress=n=>'synthetic-plinth-'+n+String.fromCharCode(64)+'example.test'
export const dailyPng=(await readFile(new URL('../fixtures/daily/synthetic-plinth.png',import.meta.url))).toString('base64')
export const dailyVideo=()=>readFile(new URL('../fixtures/daily/synthetic-plinth.mp4',import.meta.url))
/** Only the NWS transport is replaced; source selection, date filtering and custody run in the real Worker. */
export function weatherEdge(request) {
 const url=new URL(request.url)
 assert.equal(url.origin,'https://api.weather.gov')
 if(url.pathname.startsWith('/points/'))return Response.json({properties:{observationStations:'https://api.weather.gov/gridpoints/BOU/1,1/stations'}})
 if(url.pathname.endsWith('/stations'))return Response.json({features:[{id:'https://api.weather.gov/stations/KSYN'}]})
 assert.equal(url.pathname,'/stations/KSYN/observations')
 return Response.json({features:[{properties:{timestamp:'2026-11-01T12:00:00Z',textDescription:'Clear',temperature:{value:20,unitCode:'wmoUnit:degC'}}},{properties:{timestamp:'2026-10-30T12:00:00Z',textDescription:'Earlier day',temperature:{value:2,unitCode:'wmoUnit:degC'}}}]})
}
export const dailyInput=task=>({date:'2026-11-01',work:'Synthetic private wall installation',headcounts:[{trade:'Framing',count:3},{trade:'Delivery crew',count:2}],delays:'Synthetic private access delay',equipment:'Synthetic private lift allocation',deliveries:'Synthetic private ticket 740',quantities:[{task_id:task.id,cost_code:'Unassigned',quantity:'12.500',unit:'sq ft'}]})
export async function proveDailyRecords(f,initial,client,agent,other) {
 let job=initial
 const path='/api/plinth/jobs/'+job.id,read=async(cookie=f.owner)=>{const r=await f.json(path+'/daily-logs',{cookie});assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
 const post=async(suffix,input={},cookie=f.owner,token)=>{const r=await f.json(path+'/daily-logs'+suffix,{method:'POST',cookie,token,body:{expected_version:job.version,...input}});if(r.status===200)job=r.value.job;return r}
 const crew=await f.invite(dailyAddress(741),'Synthetic field crew','admin'),team=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team,person=team.find(p=>p.email===dailyAddress(741))
 assert.equal((await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'crew',job_ids:[job.id],po_limit_cents:0}})).status,200)
 let r=await post('/settings',{site:'Synthetic named building site',latitude:39.7,longitude:-104.9});assert.equal(r.status,200)
 const task=job.schedules.find(t=>t.status!=='cancelled'),input=dailyInput(task),video=await dailyVideo()
 const createVersion=job.version
 const before=structuredClone({schedules:job.schedules,actuals:job.schedule_actuals??[],costs:job.cost_records??null,time:job.field_time??null,budgets:job.budgets,invoices:job.invoices??[]})
 r=await post('',{...input,attachments:[{name:'synthetic-plinth.png',mime:'image/png',base64:dailyPng},{name:'synthetic-plinth.mp4',mime:'video/mp4',base64:video.toString('base64')}]},crew);assert.equal(r.status,200,JSON.stringify(r.value))
 // Crew projections intentionally omit financial fields; reload the owner's full job before comparing them.
 job=(await f.json(path,{cookie:f.owner})).value.job
 let data=await read(),row=data.logs[0],rev=row.revisions[0]
 assert.equal(data.production.length,0);assert.equal(row.weather.status,'available');assert.equal(row.weather.site,'Synthetic named building site');assert.equal(row.weather.source,'US National Weather Service');assert.deepEqual(row.weather.observations,[{at:'2026-11-01T12:00:00Z',description:'Clear',temperature_c:20}]);assert.equal(rev.quantities[0].quantity,'12.5');assert.deepEqual(rev.headcounts,input.headcounts)
 const captured=JSON.stringify(data)
 assert.equal((await post('',{...input,expected_version:createVersion},crew)).status,409,'Replaying a saved capture cannot create another daily record')
 const oversized=Buffer.alloc(1_500_000);video.copy(oversized)
 assert.equal((await post('',{...input,attachments:[{name:'synthetic-plinth-too-large.mp4',mime:'video/mp4',base64:oversized.toString('base64')}]},crew)).status,400)
 assert.equal(JSON.stringify(await read()),captured,'Refused media and replay create no partial daily record')
 const weather=structuredClone(row.weather),filePath=file=>path+'/daily-logs/'+row.id+'/files/'+file.id
 for(const [file,bytes] of [[row.attachments[0],Buffer.from(dailyPng,'base64')],[row.attachments[1],video]]){const response=await f.request(filePath(file),{cookie:crew});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await f.request(filePath(file),{cookie:client})).status,403);assert.equal((await f.request(filePath(file),{cookie:other})).status,404)}
 assert.equal((await f.request(path+'/daily-logs',{cookie:client})).status,403)
 assert.equal((await post('/'+row.id+'/review',{revision_id:rev.id,confirm:true,reason:'Unsafe crew approval'},crew)).status,403)
 assert.equal((await post('/'+row.id+'/comment',{revision_id:rev.id,text:'Unsafe agent comment'},undefined,agent)).status,403)
 assert.equal((await post('/'+row.id+'/comment',{revision_id:rev.id,text:'Synthetic private internal comment'},crew)).status,200)
 assert.equal((await post('/'+row.id+'/annotate',{revision_id:rev.id,file_id:row.attachments[0].id,x:25,y:40,text:'Synthetic revision-one photo markup'},crew)).status,200)
 assert.equal((await post('/'+row.id+'/review',{revision_id:rev.id,confirm:true,reason:'Synthetic reviewed field quantities'})).status,200)
 data=await read();assert.equal(data.production[0].quantity,'12.5');assert.equal(data.production[0].revision_id,rev.id)
 const oldVersion=job.version
 r=await post('/'+row.id+'/correct',{...input,revision_id:rev.id,reason:'Synthetic recount and weather correction',quantities:[{...input.quantities[0],quantity:'13.1250'}],weather_correction:'Synthetic observed rain under the canopy'},crew);assert.equal(r.status,200)
 data=await read();row=data.logs[0];const corrected=row.revisions.at(-1)
 assert.equal(data.production.length,0);assert.equal(corrected.quantities[0].quantity,'13.125');assert.deepEqual(row.revisions[0].quantities,rev.quantities);assert.deepEqual(row.weather,weather);assert.equal(corrected.weather_correction,'Synthetic observed rain under the canopy');assert.equal(row.annotations[0].revision_id,rev.id);assert.equal(row.annotations[0].checksum,row.attachments[0].checksum);assert.equal(row.comments[0].text,'Synthetic private internal comment')
 const unchanged=JSON.stringify(data)
 assert.equal((await post('/'+row.id+'/comment',{expected_version:oldVersion,revision_id:rev.id,text:'Stale overwrite'},crew)).status,409)
 assert.equal((await post('/'+row.id+'/review',{revision_id:rev.id,confirm:true,reason:'Stale source'})).status,409)
 assert.equal(JSON.stringify(await read()),unchanged)
 assert.equal((await post('/'+row.id+'/review',{revision_id:corrected.id,confirm:true,reason:'Synthetic exact corrected revision review'})).status,200)
 assert.equal((await post('/'+row.id+'/review',{revision_id:corrected.id,confirm:true,reason:'Synthetic repeated review'})).status,409)
 data=await read();assert.equal(data.production[0].quantity,'13.125');assert.equal(data.production[0].task_id,task.id);assert.equal(data.production[0].cost_code,'Unassigned');assert.equal(data.production[0].log_id,row.id)
 job=(await f.json(path,{cookie:f.owner})).value.job
 assert.deepEqual({schedules:job.schedules,actuals:job.schedule_actuals??[],costs:job.cost_records??null,time:job.field_time??null,budgets:job.budgets,invoices:job.invoices??[]},before,'Review records quantities without time, payroll, actual costs, budgets or schedule promises')
 for(const endpoint of [path,'/api/plinth/jobs','/api/plinth/search?q=Synthetic%20private']){const visible=await f.json(endpoint,{cookie:client});assert.equal(visible.status,200);assert.doesNotMatch(JSON.stringify(visible.value),/daily_logs|daily_log_settings|Synthetic private|Synthetic observed rain|daily-log.review/)}
 const customCookie=await f.invite(dailyAddress(742),'Synthetic private log reviewer','admin'),customPerson=(await f.json('/api/plinth/team',{cookie:f.owner})).value.team.find(p=>p.email===dailyAddress(742))
 const customRole=await f.json('/api/plinth/roles',{method:'POST',cookie:f.owner,body:{copy_of:'project_manager',name:'Synthetic daily log read only',permissions:{logs:{create:false,edit:false,approve:false}}}});assert.equal(customRole.status,201)
 const assign=async(expected_version,job_ids)=>{const r=await f.json('/api/plinth/team/'+customPerson.id,{method:'PUT',cookie:f.owner,body:{expected_version,role:'custom',role_id:customRole.value.role.id,job_ids}});assert.equal(r.status,200,JSON.stringify(r.value))}
 await assign(0,[job.id]);assert.equal((await f.request(path+'/daily-logs',{cookie:customCookie})).status,200)
 const guarded=JSON.stringify(await read())
 for(const [suffix,body] of [['',input],['/'+row.id+'/comment',{revision_id:corrected.id,text:'Synthetic disallowed edit'}],['/'+row.id+'/review',{revision_id:corrected.id,confirm:true,reason:'Synthetic disallowed approval'}]])assert.equal((await post(suffix,body,customCookie)).status,403)
 assert.equal(JSON.stringify(await read()),guarded)
 await assign(1,[]);assert.equal((await f.request(path+'/daily-logs',{cookie:customCookie})).status,404);assert.equal((await f.request(filePath(row.attachments[1]),{cookie:customCookie})).status,404)
 await assign(2,[job.id]);assert.equal((await f.json('/api/plinth/roles/'+customRole.value.role.id,{method:'PUT',cookie:f.owner,body:{expected_version:1,permissions:{logs:{view:false}}}})).status,200)
 assert.equal((await f.request(path+'/daily-logs',{cookie:customCookie})).status,403);assert.equal((await f.request(filePath(row.attachments[1]),{cookie:customCookie})).status,403)
 assert.equal((await f.json(path+'/daily-logs/weather?date=2026-11-03',{cookie:crew})).value.weather.status,'unavailable')
 assert.equal((await f.json('/api/plinth/team/'+person.id,{method:'PUT',cookie:f.owner,body:{expected_version:1,role:'crew',job_ids:[],po_limit_cents:0}})).status,200)
 assert.equal((await f.request(filePath(row.attachments[1]),{cookie:crew})).status,404)
 assert.equal((await f.request(path+'/daily-logs',{cookie:crew})).status,404)
 return job
}
