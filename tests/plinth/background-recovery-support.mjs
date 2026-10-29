import assert from 'node:assert/strict'
import {verifyDownload} from './background-work-support.mjs'
export async function archiveExportWork(f,job){
 const api=(path,body)=>f.json('/api/plinth'+path,{cookie:f.owner,...(body?{method:'POST',body}:{})})
 let r=await api('/reports/views',{expected_version:0,name:'Recoverable private export',sharing:'personal',scope:{record_scope:'job',record_ids:[job.id]},filters:[],selected_columns:['native.stage','native.contract']});assert.equal(r.status,201)
 const saved=r.value,tasks=[]
 for(const format of ['csv','xlsx','csv']){r=await api('/reports/work',{view_id:saved.view.id,expected_view_version:saved.version,format});assert.equal(r.status,201);tasks.push(r.value.task)}
 r=await api('/reports/work/'+tasks[1].id+'/resume',{expected_version:tasks[1].version});assert.equal(r.status,200);tasks[1]=r.value.task
 r=await api('/reports/work/'+tasks[2].id+'/cancel',{expected_version:tasks[2].version});assert.equal(r.status,200);tasks[2]=r.value.task
 return {tasks,job}
}
export async function proveRecoveredWork(f,cookie,expected){
 const api=(path,body)=>f.json('/api/plinth'+path,{cookie,...(body?{method:'POST',body}:{})})
 const before=f.messages.length
 for(const task of expected.tasks){
  const path='/reports/work/'+task.id
  let r=await api(path);assert.equal(r.status,200);let current=r.value.task
  assert.equal(current.state,task.state==='cancelled'?'cancelled':'review_required')
  assert.equal(current.progress,task.progress);assert.equal(current.digest,task.digest)
  assert.equal((await api(path+'/resume',{expected_version:current.version})).status,409,'Recovered work cannot continue without destination authority')
  assert.equal((await f.request('/api/plinth'+path+'/download',{cookie})).status,409,'Even completed recovered bytes stay private until review')
  assert.equal((await api(path+'/review',{expected_version:current.version,confirm:true,digest:'wrong'})).status,task.state==='cancelled'?409:400)
  if(task.state==='cancelled')continue
  r=await api(path+'/review',{expected_version:current.version,confirm:true,digest:current.digest});assert.equal(r.status,200);current=r.value.task
  if(current.state!=='complete'){r=await api(path+'/resume',{expected_version:current.version});assert.equal(r.status,200);current=r.value.task}
  assert.equal(current.state,'complete')
  await verifyDownload({owner:cookie,request:f.request},current,[expected.job])
 }
 assert.equal(f.messages.length,before,'Recovery, approval, continuation and download make no provider calls')
}
