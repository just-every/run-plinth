import assert from 'node:assert/strict'
import { takeoffPlan } from '../fixtures/takeoff-plan.mjs'

/** One native rejected and resubmitted package, reused by procurement and archive journeys. */
export async function submittalFixture(f, initial) {
 let job=initial
 const root='/api/plinth/jobs/'+job.id
 const act=async(path,body={})=>{
  const r=await f.json(root+path,{method:'POST',cookie:f.owner,body:{expected_version:job.version,...body}})
  assert.equal(r.status,200,JSON.stringify(r.value));job=r.value.job;return r.value.record
 }
 const view=await f.json(root+'/submittals',{cookie:f.owner});assert.equal(view.status,200)
 const reviewer=view.value.person_id
 const original=takeoffPlan(),revised=takeoffPlan(true)
 const submission=(product,bytes)=>({product_reference:product,reviewer_id:reviewer,required_on:'2026-11-12',specified_scope:'Window schedule W1: insulated low-e glazing',deviates:product.endsWith('one'),deviation:'First package omits the specified low-e coating',attachments:[{name:'synthetic-plinth-window.pdf',mime:'application/pdf',base64:bytes.toString('base64')}]})
 const order=await act('/orders',{supplier:'Synthetic window supplier',description:'Window package W1',vendor_email:['synthetic-plinth-vendor','example.test'].join('@'),amount_cents:120000})
 let row=await act('/submittals',{title:'Window package review',order_id:order.id,...submission('Window W1 version one',original)})
 const first=row.cycles[0]
 await act('/submittals/'+row.id+'/annotate',{cycle_id:first.id,file_id:first.attachments[0].id,page:1,text:'Glazing performance does not match the specified schedule'})
 row=await act('/submittals/'+row.id+'/review',{cycle_id:first.id,disposition:'rejected',comment:'Replace the glazing specification and resubmit',confirm:true})
 row=await act('/submittals/'+row.id+'/resubmit',{cycle_id:first.id,...submission('Window W1 version two',revised)})
 const second=row.cycles[1]
 row=await act('/submittals/'+row.id+'/review',{cycle_id:second.id,disposition:'approved',comment:'Revised low-e glazing matches W1',confirm:true})
 await act('/submittals/'+row.id+'/release',{cycle_id:second.id,order_id:order.id,product_reference:second.product_reference,confirm:true})
 return {get job(){return job},row,order,original,revised,act,submission}
}
