import assert from 'node:assert/strict'
import { takeoffPlan } from '../fixtures/takeoff-plan.mjs'

export const layoutEmail=tag=>['synthetic-plinth-'+tag,'example.com'].join(String.fromCharCode(64))
export const roomGeometry=()=>({unit:'m',points:[{x:0,y:0},{x:4,y:0},{x:4,y:3},{x:0,y:3}],openings:[{id:'Kitchen entry',kind:'door',wall:0,offset:0.4,width:0.9,height:2.1},{id:'Kitchen window',kind:'window',wall:2,offset:0.5,width:1.2,height:1.1}],placements:[],reconstructed:true,reason:'Manually reconstructed and measured kitchen'})
export const layoutPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64')
export async function seedRoomLayout(f,job,{client,tag='layout'}={}){
 const root='/api/plinth/jobs/'+job.id
 const read=async()=>{const r=await f.json(root,{cookie:f.owner});assert.equal(r.status,200,JSON.stringify(r.value));job=r.value.job;return job}
 const act=async(path,body={},credentials={cookie:f.owner})=>{const r=await f.json(root+path,{method:'POST',...credentials,body:{expected_version:job.version,...body}});if(r.status===200)await read();return r}
 const ok=async(path,body)=>{const r=await act(path,body);assert.equal(r.status,200,JSON.stringify(r.value));return r.value.record}
 const sources=[]
 for(const [i,name] of ['Oak base cabinet','Kitchen appliance'].entries()){
  const p=await ok('/products',{name,sku:'synthetic-plinth-'+tag+'-'+i,supplier:'Synthetic kitchen supplier',source_url:'https://supplier.example.com/kitchen',dimensions:i?'0.6 m wide and 0.65 m deep':'0.9 m wide and 0.6 m deep',cost_quote_cents:i?45000:32000,lead_days:14,captured_on:'2026-10-01',valid_until:'2099-12-31',discontinued:false,evidence:'Reviewed synthetic product dimensions and supplier capture',image:{name:'synthetic-plinth-product.png',mime:'image\u002fpng',base64:layoutPng.toString('base64')}})
  await ok('/products/'+p.id+'/review',{revision_id:p.revisions[0].id,confirm:true});sources.push({product_id:p.id,product_revision_id:p.revisions[0].id,name})
 }
 const selection=await ok('/selections',{room:'Kitchen',category:'Measured cabinet option',allowance_cents:40000,cost_code:'06-400',decision_on:'2026-12-01',lead_days:14,options:[{name:sources[0].name,supplier:'Synthetic kitchen supplier',specifications:'Reviewed oak cabinet dimensions',price_cents:40000,...sources[0]}]})
 if(client){await ok('/selections/'+selection.id+'/present',{revision_id:selection.revisions[0].id});const signed=await act('/selections/'+selection.id+'/sign',{revision_id:selection.revisions[0].id,option_id:selection.revisions[0].options[0].id,statement:'I approve the exact cabinet source and specification',confirm:true},{cookie:client});assert.equal(signed.status,200,JSON.stringify(signed.value))}
 let layout=await ok('/room-layouts',{name:'Measured kitchen '+tag})
 const original=takeoffPlan()
 await ok('/room-layouts/'+layout.id+'/underlay',{document:{name:'synthetic-plinth-historical.pdf',mime:'application\u002fpdf',base64:original.toString('base64')}})
 await ok('/room-layouts/'+layout.id+'/underlay',{document:{name:'synthetic-plinth-historical.png',mime:'image\u002fpng',base64:layoutPng.toString('base64')}})
 const g=roomGeometry();g.placements=sources.map((s,i)=>({id:'fixture-'+i,name:s.name,x:i?2:0.2,y:0.2,width:i?0.6:0.9,depth:i?0.65:0.6,rotation:0,...s,...(!i?{selection:{id:selection.id,revision_id:selection.revisions[0].id,option_id:selection.revisions[0].options[0].id}}:{})}))
 layout=await ok('/room-layouts/'+layout.id+'/revise',{...g,base_revision_id:null})
 const list=async()=>{const r=await f.json(root+'/room-layouts',{cookie:f.owner});assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
 return {root,get job(){return job},get layout(){return layout},g,selection,sources,original,read,act,ok,list,refresh:async()=>{layout=(await list()).layouts.find(l=>l.id===layout.id);return layout}}
}
