import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
export const address=n=>['synthetic-plinth-'+n,'example.test'].join('@')
export async function backgroundFixture(f,count=61){
 const api=(path,body,options={})=>f.json('/api/plinth'+path,{cookie:f.owner,...(body?{method:'POST',body}:{}),...options})
 const jobs=[]
 for(let n=1;n<=count;n++){const r=await api('/jobs',{name:'Synthetic export job '+n,client_email:address(n)});assert.equal(r.status,201,JSON.stringify(r.value));jobs.push(r.value.job)}
 const input={expected_version:0,name:'Durable job export',sharing:'personal',scope:{record_scope:'job',record_ids:jobs.map(j=>j.id)},filters:[],selected_columns:['native.stage','native.contract']}
 const r=await api('/reports/views',input);assert.equal(r.status,201,JSON.stringify(r.value));const saved=r.value
 const create=async(format='csv')=>{const r=await api('/reports/work',{view_id:saved.view.id,expected_view_version:saved.version,format});assert.equal(r.status,201,JSON.stringify(r.value));return r.value.task}
 const action=(task,verb)=>api('/reports/work/'+task.id+'/'+verb,{expected_version:task.version,...(verb==='review'?{confirm:true,digest:task.digest}:{})})
 const read=async task=>{const r=await api('/reports/work/'+task.id);assert.equal(r.status,200);return r.value.task}
 const finish=async task=>{while(task.state!=='complete'){const prior=task.progress,r=await action(task,'resume');assert.equal(r.status,200,JSON.stringify(r.value));task=r.value.task;assert.ok(task.progress-prior<=25);assert.ok(task.progress>=prior)}return task}
 return {api,jobs,saved,create,action,read,finish}
}
export async function verifyDownload(f,task,jobs){
 const response=await f.request('/api/plinth/reports/work/'+task.id+'/download',{cookie:f.owner});assert.equal(response.status,200)
 const bytes=Buffer.from(await response.arrayBuffer())
 assert.equal(createHash('sha256').update(bytes).digest('hex'),task.checksum)
 assert.equal(response.headers.get('x-content-sha256'),task.checksum)
 assert.equal(response.headers.get('cache-control'),'private, no-store')
 if(task.format==='csv'){
  const text=bytes.toString('utf8')
  for(const j of jobs)assert.equal(text.split('"'+j.name+'"').length-1,1,'Each independently seeded record appears once')
  for(const status of new Set(jobs.map(j=>j.status)))assert.equal(text.split('\r\n').filter(row=>row.includes('"'+status+'"')).length,jobs.filter(j=>j.status===status).length)
 }else{
  const zip=await JSZip.loadAsync(bytes),xml=await zip.file('xl/worksheets/sheet1.xml').async('string')
  for(const j of jobs)assert.equal(xml.split('>'+j.name+'<').length-1,1)
  for(const status of new Set(jobs.map(j=>j.status)))assert.equal(xml.split('>'+status+'<').length-1,jobs.filter(j=>j.status===status).length)
  assert.ok(!xml.includes('<f>'))
 }
 return bytes
}
