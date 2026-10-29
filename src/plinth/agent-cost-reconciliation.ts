import { costs, digest } from './cost-model'
import { actualEntries, costLedger, procurement } from './cost-ledger'
import { discrepancies } from './cost-exceptions'
import { active, find, need, stamp, sum, text, type Actor, type Input, type Job, type Stamp } from './model'
import { jobOf, readClock, saveJob } from './store'
import { localDate } from './remittances'
import type { Bindings } from '../auth.server'

interface Evidence { kind:string; id:string; line_id?:string; checksum?:string; reference?:string; amount_cents?:number; cost_code?:string; quantity?:string; unit?:string }
interface Finding { id:string; kind:string; amount_cents:number; reason:string; uncertainty:string; evidence:Evidence[]; proposed:{action:string; human_door:string} }
interface Review { digest:string; finding_ids:string[]; by:Stamp; owner_version:number; generation:number; reason:string }
export interface CostReconciliationPacket {
 id:string; source_version:number; source_digest:string; digest:string; as_of:string; requested_by:Stamp; reason:string;
 findings:Finding[]; uncertainties:string[]; ledger:{posted_actual_cents:number;received_not_billed_cents:number};
 reviews:Review[]; revocations:{by:Stamp;reason:string}[];
 proposals:{id:string; by:Stamp; findings:Finding[]; digest:string; label:string}[];
 decisions:{proposal_id:string; finding_id:string; decision:'accepted'|'rejected'; reason:string; by:Stamp}[];
}
const packets=(job:Job)=>costs(job).reconciliation_packets??=[]
/** Packet history is excluded, so reviewing a diagnostic cannot make its own sources stale. */
async function sourceDigest(job:Job){
 const {reconciliation_packets:_,...state}=costs(job)
 return digest({budgets:job.budgets,orders:job.orders,subcontracts:job.subcontracts,actual:actualEntries(job),state,bid_cost_adjustments:job.bid_cost_adjustments,variations:job.variations,schedule_actuals:job.schedule_actuals})
}
export async function prepareCostReconciliation(job:Job,actor:Actor,input:Input):Promise<CostReconciliationPacket>{
 const state=costs(job),findings:Finding[]=[],ledger=costLedger(job),add=(kind:string,amount_cents:number,reason:string,uncertainty:string,evidence:Evidence[],action:string,human_door:string)=>findings.push({id:crypto.randomUUID(),kind,amount_cents,reason,uncertainty,evidence,proposed:{action,human_door:'./api/plinth/jobs/'+job.id+'/'+human_door.slice(2)}})
 const originals=new Map<string,typeof state.bills>()
 for(const bill of state.bills.filter(b=>b.kind==='bill')){const group=originals.get(bill.document.checksum)??[];group.push(bill);originals.set(bill.document.checksum,group)}
 for(const group of originals.values())if(group.length>1)add('suspected_duplicate',sum(group.slice(1).map(b=>b.amount_cents)),'Distinct bill references retain identical original bytes. Candidate exposure excludes the first capture; it is not an approved reversal.','Identical bytes can be intentional; a person must verify vendor scope, credits and legitimate split coding.',group.map(b=>({kind:'bill',id:b.id,checksum:b.document.checksum,reference:b.reference,amount_cents:b.amount_cents})),'Investigate duplicate originals; retain every original and use a separately reviewed credit if required.','./costs/bills')
 for(const bill of state.bills.filter(b=>b.status==='draft'))for(const line of bill.lines){
  const matched=sum(line.matches.map(m=>m.amount_cents)),gap=sum([line.subtotal_cents,-matched])
  const evidence:Evidence[]=[{kind:'bill',id:bill.id,line_id:line.id,checksum:bill.document.checksum,reference:bill.reference,amount_cents:line.amount_cents,cost_code:line.cost_code},...line.matches.map(m=>({kind:'receipt',id:m.receipt_id,reference:m.order_id,amount_cents:m.amount_cents,cost_code:m.cost_code}))]
  if(gap)add('unmatched_bill',gap,'Draft bill subtotal exceeds its explicit receipt matches. Tax is excluded from this comparison.','Native bills record coded amounts, not attested billed quantities. A money match cannot establish physical quantities.',evidence,'Request missing receipt and field attestation before human bill review.','./costs/bills')
  if(line.matches.some(m=>m.cost_code!==line.cost_code))add('coding',line.amount_cents,'Bill coding differs from the matched receipt code.','A deliberate allocation may be valid; no code is changed by this suggestion.',evidence,'Review the allocation and recode the draft only if incorrect.','./costs/bills')
 }
 for(const receipt of procurement(job).filter(r=>r.kind==='receipt')){
  const posted=state.entries.flatMap(e=>e.matches.filter(m=>m.order_id===receipt.order_id&&m.receipt_id===receipt.receipt_id&&m.cost_code===receipt.cost_code).map(m=>({...m,entry_id:e.id}))),unmatched=sum([receipt.amount_cents,-sum(posted.map(m=>m.amount_cents))])
  if(!unmatched)continue
  const order=job.orders.find(o=>o.id===receipt.order_id),native=order?.receipts.find(r=>r.id===receipt.receipt_id)??order?.returns?.find(r=>r.id===receipt.receipt_id)
  const quantities=(native?.lines??[]).flatMap(l=>{const source=order?.lines?.find(s=>s.id===l.line_id);return source?.cost_code===receipt.cost_code?[{kind:'receipt_quantity',id:receipt.receipt_id!,line_id:l.line_id,quantity:String(l.quantity),unit:source.unit}]:[]})
  add('unmatched_receipt',unmatched,'Net receipt value less posted receipt matches; unposted bill candidates are not consumed again.','Receipt quantities are recorded observations. Billed quantities and field attestation remain unknown; returns can create a negative discrepancy.',[{kind:'receipt',id:receipt.receipt_id!,reference:receipt.reference,amount_cents:receipt.amount_cents,cost_code:receipt.cost_code},{kind:'order',id:receipt.order_id},...quantities,...posted.map(m=>({kind:'posted_match',id:m.entry_id,amount_cents:m.amount_cents}))],'Compare exact receipt evidence with supplier originals before matching a bill.','./costs/bills')
 }
 for(const source of state.sources.filter(s=>!s.approved_by))add(source.kind==='time'?'unposted_labor':'unposted_source',source.amount_cents,'A native source exists without approval or a ledger posting.','Recorded source cost is a candidate, not verified payroll. Individual pay rates and employee details are withheld.',[{kind:'source',id:source.id,reference:source.reference,amount_cents:source.amount_cents,cost_code:source.cost_code}],'Have an authorized independent reviewer approve the source at its existing human door.','./costs/sources')
 for(const issue of discrepancies(job).filter(i=>!['unapproved','unmatched'].includes(i.kind)))add('discrepancy',issue.amount_cents,issue.evidence,'Native discrepancy detection is diagnostic; accounting completeness is not established.',[{kind:'exception',id:issue.key}],'Reconcile native and authorized accounting evidence before human exception clearance.','./costs/exceptions')
 const source_digest=await sourceDigest(job),as_of=localDate(input.as_of,'as_of'),reason=text(input.reason,'Diagnostic request reason',2000),source_version=job.version
 const uncertainties=['Accounting and payroll provider observations are unavailable; no live synchronization is claimed.','Physical billed quantities and field attestation are unknown. Amounts across findings overlap and must not be added as a forecast adjustment.']
 const snapshot={source_version,source_digest,as_of,reason,findings,uncertainties,ledger:{posted_actual_cents:ledger.totals.posted_actual_cents,received_not_billed_cents:ledger.totals.received_not_billed_cents}}
 return {id:crypto.randomUUID(),...snapshot,digest:await digest(snapshot),requested_by:stamp(actor),reviews:[],revocations:[],proposals:[],decisions:[]}
}
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'}
const json=(value:unknown)=>Response.json(value,{headers})
export async function costReconciliationResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(request:Request)=>Promise<Input>):Promise<Response|null>{
 if(parts[0]!=='jobs'||parts[2]!=='cost-reconciliation')return null
 const agent=actor.role==='agent'
 need(actor.role==='owner'&&!actor.permissions||agent&&actor.agent_native_role==='owner'&&actor.agent_door,'Only the signed-in owner or their bounded packet tool may use reconciliation',403,'forbidden')
 need(!agent||parts.length===5&&parts[4]==='propose'&&request.method==='POST'||parts.length===4&&parts[3]==='reviewed'&&request.method==='GET'||parts.length===5&&parts[4]==='reviewed'&&request.method==='GET','The agent may only prepare a reviewed packet',403,'forbidden')
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,parts[1]!)
 const generation=(await env.DB.prepare('SELECT generation FROM oa_auth_settings WHERE singleton=1').first<{generation:number}>())!.generation
 const current=await sourceDigest(previous)
 const valid=(p:CostReconciliationPacket)=>!p.revocations.length&&p.source_digest===current&&p.reviews.some(r=>r.by.id===actor.id&&r.owner_version===actor.version&&r.generation===generation)
 if(request.method==='GET'&&(parts[3]==='reviewed'||parts[4]==='reviewed')){
  const list=parts[4]?[find(packets(previous),parts[3]!)]:packets(previous).filter(valid)
  need(list.every(valid),'Packet requires current owner review of unchanged sources',409,'packet_stale')
  return json({version:previous.version,packets:list.map(p=>({id:p.id,digest:p.digest,source_digest:p.source_digest,source_version:p.source_version,as_of:p.as_of,findings:p.findings.filter(f=>p.reviews.at(-1)!.finding_ids.includes(f.id)),label:'Owner-selected diagnostic facts only; no raw originals, individual rates or provider observations.'}))})
 }
 if(request.method==='GET'){
  need(parts.length===3||parts.length===4,'Unknown packet route',404,'not_found')
  const list=parts[3]?[find(packets(previous),parts[3])]:packets(previous)
  return json({version:previous.version,packets:list.map(p=>({...p,stale:p.source_digest!==current,review_required:!valid(p)}))})
 }
 need(request.method==='POST','Method not allowed',405,'method_not_allowed');active(previous)
 const input=await body(request);need(input.expected_version===previous.version,'Job changed; reload before reconciliation',409,'stale_version')
 const job=structuredClone(previous);let record:unknown
 if(parts.length===3){need(!agent,'Only the owner requests native diagnostics',403,'forbidden');const packet=await prepareCostReconciliation(job,actor,input);packets(job).push(packet);record=packet}
 else{
  const packet=find(packets(job),parts[3]!),action=parts[4]
  need(parts.length===5,'Unknown packet action',404,'not_found')
  need(input.digest===packet.digest,'Review the exact packet digest',409,'packet_digest')
  if(action==='revoke'){
   need(!agent,'Only the owner revokes packet consent',403,'forbidden');need(!packet.revocations.length,'Packet already revoked',409,'immutable');packet.revocations.push({by:stamp(actor),reason:text(input.reason,'Revocation reason',2000)});record=packet
  }else if(action==='review'){
   need(!agent,'Only the owner reviews native sources',403,'forbidden');need(packet.source_digest===current&&!packet.revocations.length,'Sources changed or packet revoked; request a new diagnostic',409,'packet_stale')
   need(input.confirm===true&&Array.isArray(input.finding_ids)&&input.finding_ids.length>0&&input.finding_ids.length<=200,'Explicitly select findings for this request')
   const ids=input.finding_ids.map(id=>text(id,'finding_id',100));need(new Set(ids).size===ids.length&&ids.every(id=>packet.findings.some(f=>f.id===id)),'Select distinct findings from this exact packet')
   need(!packet.reviews.length,'Review is immutable; prepare a new packet for different consent',409,'immutable')
   packet.reviews.push({digest:packet.digest,finding_ids:ids,by:stamp(actor),owner_version:actor.version,generation,reason:text(input.reason,'Source review reason',2000)});record=packet
  }else if(action==='propose'){
   need(valid(packet),'Packet requires current owner review of unchanged sources',409,'packet_stale')
   const review=packet.reviews.at(-1)!,findings=packet.findings.filter(f=>review.finding_ids.includes(f.id))
   const proposal={id:crypto.randomUUID(),by:stamp(actor),findings:structuredClone(findings),digest:packet.digest,label:'Proposed only. No bill review, posting, payroll, payment, forecast approval or exception clearance.'}
   packet.proposals.push(proposal);record=proposal
  }else if(action==='decide'){
   need(!agent,'Only the owner records a suggestion decision',403,'forbidden');need(packet.source_digest===current&&!packet.revocations.length,'Sources changed or packet revoked; request a new diagnostic',409,'packet_stale')
   const proposal=find(packet.proposals,text(input.proposal_id,'proposal_id',100)),finding_id=text(input.finding_id,'finding_id',100)
   need(proposal.findings.some(f=>f.id===finding_id),'Finding not in the prepared proposal',404,'not_found');need(!packet.decisions.some(d=>d.proposal_id===proposal.id&&d.finding_id===finding_id),'Suggestion decision is immutable',409,'immutable')
   need(input.decision==='accepted'||input.decision==='rejected','Choose accepted or rejected')
   const decision:CostReconciliationPacket['decisions'][number]={proposal_id:proposal.id,finding_id,decision:input.decision,reason:text(input.reason,'Decision reason',2000),by:stamp(actor)};packet.decisions.push(decision);record=decision
  }else need(false,'Unknown packet action',404,'not_found')
 }
 await saveJob(env.DB,actor,previous,job,[],clock)
 return json({version:job.version,record})
}
