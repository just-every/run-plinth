import type { Bindings } from '../auth.server'
import { requireOwner } from './auth'
import { planAccess } from './plan-access'
import { bidOffice } from './bid-access'
import { costAccess } from './cost-access'
import { digest } from './cost-model'
import { prepareDiary } from './attachments'
import { prepareSchedule } from './operations'
import { jobOf, jobs, readClock, saveJob } from './store'
import { find, need, object, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'

type SourceRef = { kind:'plan'; set_id:string; sheet_id:string } | { kind:'bid'; package_id:string; invitation_id:string; response_id:string } | { kind:'decision'; decision_id:string } | { kind:'cost'; entry_id:string }
interface PacketSource { id:string; ref:SourceRef; digest:string; href:string; recorded:unknown }
interface Statement { text:string; citations:{source_id:string;digest:string}[] }
interface Answer { id:string; prepared_by:Stamp; facts:Statement[]; conflicts:Statement[]; assumptions:Statement[]; unresolved:string[]; draft?:{kind:'diary'|'schedule';id:string;prepared_by:Stamp} }
export interface QuestionPacket { id:string; job_id:string; question:string; reviewed_by:Stamp; owner_version:number; sources:PacketSource[]; digest:string; answers:Answer[]; revoked_by?:Stamp }
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
const root=(job:Job)=>'/api/plinth/jobs/'+encodeURIComponent(job.id)

/** Owner review can disclose only these selected native facts, never an entire cost record. */
function reference(value:unknown):SourceRef {
 const v=object(value),kind=String(v.kind)
 const keys=kind==='plan'?['set_id','sheet_id']:kind==='bid'?['package_id','invitation_id','response_id']:kind==='decision'?['decision_id']:kind==='cost'?['entry_id']:[]
 need(keys.length&&Object.keys(v).every(k=>k==='kind'||keys.includes(k)),'Select a supported exact source reference')
 return {kind,...Object.fromEntries(keys.map(k=>[k,text(v[k],k,100)]))} as SourceRef
}
async function source(db:D1Database,job:Job,owner:Actor,ref:SourceRef) {
 requireOwner(owner)
 if(ref.kind==='plan'){
  await planAccess(db,job,owner)
  const set=find(job.plan_sets??[],ref.set_id),sheet=find(set.sheets,ref.sheet_id)
  const matching=(job.plan_sets??[]).flatMap(s=>s.sheets.filter(p=>p.kind===sheet.kind&&p.number.toLowerCase()===sheet.number.toLowerCase()).map(p=>({set_id:s.id,sheet_id:p.id,revision:p.revision,approved:!!s.approved_by})))
  return {href:root(job)+'/plans/'+set.id+'/files/'+sheet.id,recorded:{set_id:set.id,title:set.title,issue_on:set.issue_on,sheet,approved_by:set.approved_by??null,annotations:set.annotations.filter(a=>a.sheet_id===sheet.id),reviews:set.drawing_review?.reviews.filter(r=>r.sheet_id===sheet.id)??[],matching_revisions:matching}}
 }
 if(ref.kind==='bid'){
  need(bidOffice(owner),'Bid access required',403,'forbidden')
  const bid=find(job.bids??[],ref.package_id),invitation=find(bid.invitations,ref.invitation_id),response=find(invitation.responses,ref.response_id)
  need(!invitation.revoked_by,'Bid source is no longer available',403,'forbidden')
  return {href:'/api/plinth/bids/'+job.id,recorded:{package_id:bid.id,title:bid.title,scope:bid.scope,revisions:bid.revisions.map(({id,number,note,due_on})=>({id,number,note,due_on})),invitation_id:invitation.id,vendor_name:invitation.vendor_name,response:{id:response.id,revision_id:response.revision_id,items:response.items,total_cents:response.total_cents,exclusions:response.exclusions,attachments:response.attachments},latest_response_id:invitation.responses.at(-1)?.id}}
 }
 if(ref.kind==='decision'){
  const decision=find(job.variations,ref.decision_id)
  return {href:root(job),recorded:{id:decision.id,revision:decision.revision,description:decision.description,amount_cents:decision.amount_cents,status:decision.status,approved_by:decision.approved_by??null}}
 }
 costAccess(owner,new Request('https://local.invalid'+root(job)+'/costs/ledger'))
 const entry=find(job.cost_records?.entries??[],ref.entry_id)
 return {href:root(job)+'/costs/ledger',recorded:{id:entry.id,source_id:entry.source_id,source_line_id:entry.source_line_id,source_kind:entry.source_kind,cost_code:entry.cost_code,amount_cents:entry.amount_cents,dated_on:entry.dated_on,period:entry.period,reversal_of:entry.reversal_of??null,related_entries:(job.cost_records?.entries??[]).filter(e=>e.reversal_of===entry.id).map(e=>({id:e.id,amount_cents:e.amount_cents})),currency:job.currency??'USD'}}
}
async function currentOwner(db:D1Database,actor:Actor):Promise<Actor> {
 need(actor.role==='owner'||actor.role==='agent'&&actor.agent_door?.sponsor_role==='owner','Only the signed-in owner and their scoped MCP analysis may use question packets',403,'forbidden')
 const row=await db.prepare("SELECT id,display_name AS name,version FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(actor.id).first<{id:string;name:string;version:number}>()
 need(row,'Packet sponsor no longer has owner authority',403,'forbidden')
 return {...actor,name:row.name,role:'owner',version:row.version,agent_door:undefined,agent_native_role:undefined}
}
export async function checkPacket(db:D1Database,job:Job,owner:Actor,packet:QuestionPacket){
 need(packet.job_id===job.id&&packet.reviewed_by.id===owner.id&&packet.owner_version===owner.version&&!packet.revoked_by,'Question packet authority is no longer current',403,'packet_revoked')
 for(const selected of packet.sources){const live=await source(db,job,owner,selected.ref);need(await digest(live)===selected.digest,'Reviewed question sources changed; ask the owner to review a new packet',409,'packet_stale')}
}
function statements(value:unknown,packet:QuestionPacket,name:string,minCitations:number):Statement[]{
 need(Array.isArray(value)&&value.length<=30,'Supply at most thirty '+name)
 return value.map(raw=>{const row=object(raw);need(Object.keys(row).every(k=>['text','citations'].includes(k)),'Statements contain text and exact packet citations only');need(Array.isArray(row.citations)&&row.citations.length>=minCitations&&row.citations.length<=20,'Supply exact citations for '+name)
  const citations=row.citations.map(raw=>{const cite=object(raw);need(Object.keys(cite).every(k=>['source_id','digest'].includes(k)),'Citations must refer to the reviewed packet');const selected=packet.sources.find(s=>s.id===cite.source_id);need(selected&&selected.digest===cite.digest,'Citation is not in this exact reviewed packet',400,'invalid_citation');return {source_id:selected.id,digest:selected.digest}})
  need(new Set(citations.map(c=>c.source_id)).size>=minCitations,'Conflict citations must name distinct reviewed sources',400,'invalid_citation')
  return {text:text(row.text,name,4000),citations}
 })
}
/** No creation or consent tool exists: an authenticated owner explicitly chooses every packet source. */
export async function answerResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(request:Request)=>Promise<Input>){
 if(parts[0]!=='jobs'||parts[2]!=='agent-answers')return null
 const owner=await currentOwner(env.DB,actor),clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,parts[1]!)
 const packets=previous.agent_answers??[],selected=parts[3]?find(packets,parts[3]):undefined
 if(request.method==='GET'){
  need(parts.length===3||parts.length===4,'Unknown question packet route',404,'not_found')
  if(selected){await checkPacket(env.DB,previous,owner,selected);return json({record:selected,version:previous.version})}
  const visible=[]
  for(const packet of packets){try{await checkPacket(env.DB,previous,owner,packet);visible.push({id:packet.id,digest:packet.digest,question:packet.question})}catch(error){if(!['packet_revoked','packet_stale','not_found','forbidden'].includes((error as {code:string}).code))throw error}}
  return json({record:{packets:visible},version:previous.version})
 }
 need(request.method==='POST'&&(parts.length===3||parts.length===5),'Unknown question packet action',404,'not_found')
 const input=await body(request)
 need(input.expected_version===previous.version,'The job changed; reload before acting',409,'stale_version')
 const job=structuredClone(previous),state=job.agent_answers??=[],packet=selected?find(state,selected.id):undefined
 let record:QuestionPacket|Answer, writes:D1PreparedStatement[]=[]
 if(!packet){
  requireOwner(actor);need(input.confirm===true,'Explicitly review these facts for this question')
  need(state.length<100,'This job has reached its question packet limit')
  need(Array.isArray(input.sources)&&input.sources.length>0&&input.sources.length<=30,'Explicitly select one to thirty source records')
  const refs=input.sources.map(reference);need(new Set(refs.map(r=>JSON.stringify(r))).size===refs.length,'Choose each source once')
  const sources:PacketSource[]=[]
  for(const ref of refs){const live=await source(env.DB,previous,owner,ref);sources.push({id:crypto.randomUUID(),ref,digest:await digest(live),...live})}
  const content={job_id:job.id,question:text(input.question,'Question',4000),reviewed_by:stamp(actor),owner_version:owner.version,sources}
  record={...content,id:crypto.randomUUID(),digest:await digest(content),answers:[]};state.push(record)
 }else if(parts[4]==='revoke'){
  requireOwner(actor);packet.revoked_by??=stamp(actor);record=packet
 }else{
  await checkPacket(env.DB,previous,owner,packet)
  need(input.packet_digest===packet.digest,'Use the exact reviewed question packet',409,'packet_digest')
  if(parts[4]==='answers'){
   need(packet.answers.length<100,'This packet has reached its answer limit')
   const analysis=object(input.analysis)
   need(Object.keys(analysis).every(k=>['facts','conflicts','assumptions','unresolved'].includes(k)),'Retain analysis separately from instructions or actions')
   need(Array.isArray(analysis.unresolved)&&analysis.unresolved.length<=30,'List unresolved questions explicitly')
   record={id:crypto.randomUUID(),prepared_by:stamp(actor),facts:statements(analysis.facts,packet,'recorded facts',1),conflicts:statements(analysis.conflicts,packet,'conflicts',2),assumptions:statements(analysis.assumptions,packet,'assumptions',0),unresolved:analysis.unresolved.map(v=>text(v,'Unresolved question',2000))}
   need(record.facts.length+record.conflicts.length+record.assumptions.length+record.unresolved.length>0,'An answer must record analysis or an unresolved question')
   packet.answers.push(record)
  }else{
   need(parts[4]==='prepare','Unknown answer action',404,'not_found')
   const answer=find(packet.answers,text(input.answer_id,'Exact retained answer',100))
   // Native identity belongs to the retained answer, so a new transport replay key cannot duplicate a draft.
   if(answer.draft)return json({record:answer,version:previous.version})
   const proposed=object(input.input),kind=proposed.kind
   need(kind==='diary'||kind==='schedule','Prepare only a daily-log or schedule draft')
   const allowed=kind==='diary'?['kind','date','note']:['kind','trade','start','end','description']
   need(Object.keys(proposed).every(k=>allowed.includes(k)),'Draft handoff cannot grant authority or publish')
   const preparer={...actor,role:'agent' as const}
   const result=kind==='diary'?await prepareDiary(env.DB,job,preparer,{date:proposed.date,note:proposed.note,attachments:[]}):{row:prepareSchedule(job,preparer,proposed,await jobs(env.DB)),writes:[]}
   writes=result.writes;answer.draft={kind,id:result.row.id,prepared_by:stamp(preparer)};record=answer
  }
 }
 job.agent_answers=state
 await saveJob(env.DB,actor,previous,job,writes,clock)
 return json({record,version:job.version})
}
