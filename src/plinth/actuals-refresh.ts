import { active, DomainError, need, stamp, sum, text, usdOnly, type Actor, type Input, type Job } from './model'
import { costs, digest, type CostForecast } from './cost-model'
import { actualEntries, costLedger } from './cost-ledger'
import { calculateCostForecast } from './cost-forecast'
import { exceptionView } from './cost-exceptions'
import { canonical, previewReceiptApplication } from './sov'
import { localDate } from './remittances'
import type { SovApplication } from './sov-model'

export interface RefreshSource {
 id:string; kind:string; revision:string; dated_on:string|null; review_state:string; checksums:string[]; facts:unknown
}
export interface ActualsRefresh {
 id:string; operation_id:string; request_digest:string; digest:string; job_id:string; source_digest:string; as_of:string; reviewed_by:ReturnType<typeof stamp>
 reference:string; sources:RefreshSource[]; assumptions:unknown; stored_allocations:unknown
 forecast:CostForecast|null; sov:SovApplication|null; unavailable:{scope:string;reason:string}[]
 baseline_id:string|null; codes:{cost_code:string;actual_cents:number;open_commitment_cents:number;received_cents:number;remaining_cents:number|null;margin_cents:number|null;delta:{actual_cents:number;open_commitment_cents:number;received_cents:number;remaining_cents:number|null;margin_cents:number|null}|null}[]
 exceptions:ReturnType<typeof exceptionView>; boundary:string
}
const history=(job:Job)=>costs(job).actuals_refresh??=[]
const withoutBytes=(value:unknown):unknown=>Array.isArray(value)?value.map(withoutBytes):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='base64').map(([k,v])=>[k,withoutBytes(v)])):value

/** Exact native revisions, original digests and recorded dates. Missing originals stay explicit. */
export async function refreshSources(job:Job){
 const state=costs(job),sources:RefreshSource[]=[]
 const add=async(kind:string,id:string,facts:unknown,dated_on:string|null,review_state:string,checksums:string[]=[])=>{
  const clean=withoutBytes(facts)
  sources.push({kind,id,revision:await digest(canonical(clean)),dated_on,review_state,checksums,facts:clean})
 }
 for(const budget of job.budgets??[])await add('budget',budget.id,budget,budget.recorded_by.at.slice(0,10),'human approved')
 for(const order of job.orders.filter(o=>o.status!=='draft')){
  await add('order',order.id,order,order.issued_by?.at.slice(0,10)??null,order.status)
  for(const receipt of order.receipts)await add('receipt',receipt.id,{order_id:order.id,...receipt},receipt.received_on??receipt.recorded_by.at.slice(0,10),'staff recorded; original not captured')
  for(const returned of order.returns??[])await add('return',returned.id,{order_id:order.id,...returned},returned.recorded_by.at.slice(0,10),'staff recorded; original not captured')
 }
 for(const bill of state.bills)await add(bill.kind,bill.id,bill,bill.dated_on,bill.status==='posted'?'human posted':bill.reviews.length?'reviewed; unposted':'unreviewed', [bill.document.checksum])
 for(const source of state.sources)await add(source.kind,source.id,source,source.dated_on,source.approved_by?'human approved':'unapproved',source.document?[source.document.checksum]:[])
 for(const claim of job.claims.filter(c=>c.status!=='draft'))await add('approved application',claim.id,claim,claim.approved_by?.at.slice(0,10)??null,claim.status)
 // Every calculator input is bound; preview history and unapproved daily notes are deliberately absent.
 await add('ledger',job.id+':ledger',{ledger:costLedger(job).rows.map(({uncommitted_forecast_cents,...r})=>r),entries:actualEntries(job),opening:state.opening,subcontracts:job.subcontracts,bid_cost_adjustments:job.bid_cost_adjustments,variations:job.variations},null,'recorded native sources')
 await add('billing terms',job.id+':billing',{sov:job.sov,quotes:job.quotes.filter(q=>q.status==='accepted'),retainage:job.retainage},null,'human approvals only')
 const {source_version:_,...exceptions}=exceptionView(job)
 await add('exceptions',job.id+':exceptions',{policy:state.policy,reconciliations:state.reconciliations,exceptions},null,'unresolved states retained')
 return {sources,source_digest:await digest(canonical(sources))}
}

export async function prepareActualsRefresh(job:Job,actor:Actor,input:Input):Promise<ActualsRefresh>{
 active(job);usdOnly(job)
 need(actor.role==='owner'&&!actor.agent_door,'Only the signed-in owner may review actuals refresh',403,'forbidden')
 need(input.confirm===true,'Explicitly confirm the current native sources and assumptions')
 const current=await refreshSources(job)
 need(input.source_digest===current.source_digest,'Sources changed; reload and freshly review assumptions and allocations',409,'actuals_stale')
 const as_of=localDate(input.as_of,'as_of'),reference=text(input.reference,'Review reference',2000)
 const unavailable:{scope:string;reason:string}[]=[]
 let forecast:CostForecast|null=null,sov:SovApplication|null=null
 if(input.codes===undefined||!Array.isArray(input.codes)||!input.codes.length)unavailable.push({scope:'forecast',reason:'Explicit fresh assumptions for every cost code are missing'})
 else forecast=await calculateCostForecast(job,actor,{as_of,source_as_of:reference,codes:input.codes,scenario:input.scenario})
 if(input.stored_allocations===undefined)unavailable.push({scope:'SOV',reason:'Explicit stored material allocations are missing'})
 else{
  try{sov=previewReceiptApplication(job,actor,input.stored_allocations)}
  catch(error){if(!(error instanceof DomainError))throw error;unavailable.push({scope:'SOV',reason:error.message})}
 }
 const exceptions=exceptionView(job)
 if(!exceptions.healthy)unavailable.push({scope:'reconciliation',reason:'Native discrepancies or unresolved exceptions remain; this preview cannot clear them'})
 unavailable.push({scope:'external accounting',reason:'No authorized external accounting synchronization or independent reconciliation is supplied'})
 const previous=history(job).at(-1),ledger=costLedger(job)
 const codes=ledger.rows.map(r=>{
  const calculated=forecast?.codes.find(c=>c.cost_code===r.cost_code),before=previous?.codes.find(c=>c.cost_code===r.cost_code)
  const row={cost_code:r.cost_code,actual_cents:r.posted_actual_cents,open_commitment_cents:r.open_commitment_cents,received_cents:r.received_cents,remaining_cents:calculated?.remaining_cents??null,margin_cents:calculated?.margin_cents??null}
  return {...row,delta:before?{actual_cents:sum([row.actual_cents,-before.actual_cents]),open_commitment_cents:sum([row.open_commitment_cents,-before.open_commitment_cents]),received_cents:sum([row.received_cents,-before.received_cents]),remaining_cents:row.remaining_cents===null||before.remaining_cents===null?null:sum([row.remaining_cents,-before.remaining_cents]),margin_cents:row.margin_cents===null||before.margin_cents===null?null:sum([row.margin_cents,-before.margin_cents])}:null}
 })
 const operation_id=text(input.operation_id,'operation_id',100),request_digest=await digest(canonical({source_digest:current.source_digest,as_of,reference,codes:input.codes,scenario:input.scenario,stored_allocations:input.stored_allocations}))
 const old=history(job).find(r=>r.operation_id===operation_id)
 if(old){need(old.request_digest===request_digest&&old.reviewed_by.id===actor.id,'Operation already used for a different review',409,'actuals_replay');return old}
 need(history(job).length<100,'Refresh history limit reached',409,'actuals_limit')
 const value={id:crypto.randomUUID(),operation_id,request_digest,job_id:job.id,source_digest:current.source_digest,as_of,reviewed_by:stamp(actor),reference,sources:current.sources,assumptions:input.codes??null,stored_allocations:input.stored_allocations??null,forecast,sov,unavailable,baseline_id:previous?.id??null,codes,exceptions,boundary:'Private prospective native preview. No field approval, new completed work, date publication, bill posting, exception clearance, claim or invoice issue, sending or payment.'}
 const record={...value,digest:await digest(canonical(value))}
 history(job).push(record);return record
}
