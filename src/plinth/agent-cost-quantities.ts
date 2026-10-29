import { costs } from './cost-model'
import { active, find, need, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'
import { jobOf, readClock, saveJob } from './store'
import { localDate } from './remittances'
import type { Bindings } from '../auth.server'

export interface CostQuantityEvidence {
 id:string;kind:'bill_read'|'field_receipt';order_id:string;receipt_id:string;order_line_id:string;bill_id?:string;bill_line_id?:string;checksum?:string;
 quantity:string;unit:string;dated_on:string;reference:string;by:Stamp;supersedes?:string
}
const records=(job:Job)=>costs(job).quantity_evidence??=[]
const key=(row:CostQuantityEvidence)=>[row.kind,row.order_id,row.receipt_id,row.order_line_id,row.bill_id??'',row.bill_line_id??''].join(':')
function latest(job:Job){const current=new Map<string,CostQuantityEvidence>();for(const row of records(job))current.set(key(row),row);return [...current.values()]}
const milli=(value:unknown)=>{const raw=String(value);need(/^\d{1,9}(?:\.\d{1,3})?$/.test(raw),'Quantity requires a nonnegative decimal with at most three places');const [n,f='']=raw.split('.');return BigInt(n!)*1000n+BigInt(f.padEnd(3,'0'))}
const decimal=(value:bigint)=>{const sign=value<0n?'-':'';const n=value<0n?-value:value;return sign+String(n/1000n)+(n%1000n?'.'+String(n%1000n).padStart(3,'0').replace(/0+$/,''):'')}
function receiptSource(job:Job,input:Input,issued=true){
 const order=find(job.orders,text(input.order_id,'order_id',100));need(!issued||order.status==='issued','Use an issued native order',409,'cost_order')
 const receipt=find(order.receipts,text(input.receipt_id,'receipt_id',100)),line=find(order.lines??[],text(input.order_line_id,'order_line_id',100)),received=receipt.lines?.find(r=>r.line_id===line.id)
 need(received,'The exact receipt must contain this order line',409,'cost_receipt');return {order,receipt,line,received}
}
/** Supplementary human observations retain original receipts and bills unchanged. */
export async function quantityEvidenceResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(request:Request)=>Promise<Input>):Promise<Response|null>{
 if(parts.length!==4||parts[3]!=='quantity-evidence')return null
 need(['owner','superintendent','crew'].includes(actor.role)&&!actor.agent_door,'Only currently assigned field people or the signed-in owner may read receipt quantities',403,'forbidden')
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,parts[1]!)
 const view=(job:Job)=>({version:job.version,evidence:records(job).filter(r=>actor.role==='owner'||r.kind==='field_receipt'),receipts:job.orders.filter(o=>o.status==='issued').flatMap(o=>o.receipts.flatMap(r=>(r.lines??[]).flatMap(q=>{const line=o.lines?.find(l=>l.id===q.line_id);return line?[{order_id:o.id,receipt_id:r.id,order_line_id:line.id,description:line.description,quantity:String(q.quantity),unit:line.unit}]:[]})))})
 if(request.method==='GET')return Response.json(view(previous),{headers:{'cache-control':'private, no-store'}})
 need(request.method==='POST','Method not allowed',405,'method_not_allowed');need(actor.role==='owner'||actor.role==='superintendent','Crew read quantities; the assigned superintendent records attestations',403,'forbidden');active(previous)
 const input=await body(request);need(input.expected_version===previous.version,'Job changed; reload quantity evidence',409,'stale_version')
 need(input.kind==='field_receipt'||input.kind==='bill_read','Choose field receipt attestation or office bill reading');need(input.kind!=='bill_read'||actor.role==='owner','Only the signed-in owner records a bill reading',403,'forbidden')
 const job=structuredClone(previous),{order,receipt,line}=receiptSource(job,input),quantity=decimal(milli(input.quantity))
 need(input.unit===line.unit,'Use the exact order quantity unit; no implicit conversion')
 const row:CostQuantityEvidence={id:crypto.randomUUID(),kind:input.kind,order_id:order.id,receipt_id:receipt.id,order_line_id:line.id,quantity,unit:line.unit,dated_on:localDate(input.dated_on,'dated_on'),reference:text(input.reference,'Human observation evidence',2000),by:stamp(actor)}
 if(input.kind==='bill_read'){
  const bill=find(costs(job).bills,text(input.bill_id,'bill_id',100));need(bill.kind==='bill','Record quantities from a supplier bill original');const billLine=find(bill.lines,text(input.bill_line_id,'bill_line_id',100))
  need(billLine.matches.some(m=>m.order_id===order.id&&m.receipt_id===receipt.id&&m.cost_code===line.cost_code),'Bill reading must name a receipt explicitly matched by this original line',409,'cost_receipt')
  Object.assign(row,{bill_id:bill.id,bill_line_id:billLine.id,checksum:bill.document.checksum})
 }
 const prior=latest(job).find(r=>key(r)===key(row));need(input.supersedes===(prior?.id??null),'Name the current observation, or null for the first one',409,'stale_evidence')
 if(prior)row.supersedes=prior.id
 records(job).push(row);await saveJob(env.DB,actor,previous,job,[],clock)
 return Response.json({...view(job),record:row},{headers:{'cache-control':'private, no-store'}})
}
export function quantityFindings(job:Job){
 const current=latest(job)
 return current.filter(r=>r.kind==='bill_read').map(bill=>{
  const {received}=receiptSource(job,bill as unknown as Input,false),field=current.find(r=>r.kind==='field_receipt'&&r.order_id===bill.order_id&&r.receipt_id===bill.receipt_id&&r.order_line_id===bill.order_line_id)
  const difference=field?decimal(milli(bill.quantity)-milli(field.quantity)):null
  return {id:crypto.randomUUID(),kind:difference==='0'&&field?.quantity===String(received.quantity)?'quantity_match':'quantity',amount_cents:0,
   quantities:{bill:bill.quantity,recorded_receipt:String(received.quantity),field:field?.quantity??null,difference,unit:bill.unit},
   reason:'Explicit human bill reading compared with its exact native receipt and latest field attestation. A quantity difference is not a monetary adjustment.',
   uncertainty:field?'Both readings are attributed human evidence, not independently verified physical completion. Originals remain unchanged.':'Field attestation is unavailable; physical agreement remains unknown.',
   evidence:[{kind:'bill_quantity',id:bill.id,reference:bill.bill_id!,line_id:bill.bill_line_id!,checksum:bill.checksum!,quantity:bill.quantity,unit:bill.unit},{kind:'receipt_quantity',id:bill.receipt_id,line_id:bill.order_line_id,quantity:String(received.quantity),unit:bill.unit},...(field?[{kind:'field_attestation',id:field.id,quantity:field.quantity,unit:field.unit}]:[])],
   proposed:{action:'Have accounts staff and the field recorder resolve the cited quantity difference before any native cost correction.',human_door:'./api/plinth/jobs/'+job.id+'/cost-reconciliation/quantity-evidence'}}
 })
}
