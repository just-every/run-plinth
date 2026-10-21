import {runtimeBindings,type Bindings} from '../auth.server'
import {authorize,requireJobManager,requireManager} from './auth'
import {DomainError,find,need,object,type Input} from './model'
import {jobs,readClock,saveJob} from './store'
import {bidComparisonAction} from './bid-comparison-actions'
import {bidComparisonFlags} from './bid-comparison-review'
import {bidCostBudget} from './bid-comparison-budget'
import type {BidComparisonJob,BidComparisonSource} from './bid-comparison-model'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
export function bidComparisonSource(job:BidComparisonJob):BidComparisonSource{return {id:job.id,version:job.version,name:job.name,packages:(job.bids??[]).map(b=>({id:b.id,title:b.title,revision_id:b.revisions.at(-1)!.id,response_count:b.invitations.filter(i=>i.responses.some(r=>r.revision_id===b.revisions.at(-1)!.id)).length})),comparisons:(job.bid_comparisons??[]).map(c=>({...c,flags:c.candidates.map(candidate=>({candidate_id:candidate.id,items:bidComparisonFlags(c,candidate,c.reviews.filter(r=>r.candidate_id===candidate.id).at(-1))}))})),awards:job.bid_comparison_awards??[],cost_budget:bidCostBudget(job),commitments:(job.subcontracts??[]).filter(s=>(job.bid_comparison_awards??[]).some(a=>a.subcontract_id===s.id)).map(s=>({id:s.id,vendor_name:s.vendor_name,scope:s.scope,amount_cents:s.amount_cents,status:s.status}))}}
async function body(request:Request):Promise<Input>{need(request.headers.get('content-type')?.split(';')[0]?.trim()==='application/json','Send application/json',415,'content_type');const reader=request.body?.getReader();need(reader,'JSON body required');const chunks:Uint8Array[]=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1_500_000){await reader.cancel();need(false,'Comparison request too large',413,'body_size')}chunks.push(value)}const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length}try{return object(JSON.parse(new TextDecoder().decode(bytes)))}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('invalid_json','Invalid JSON body')}}
/** Financial comparison and originals are office-only, independently authenticated on every route. */
export async function bidComparisonResponse(request:Request,original:Bindings):Promise<Response|null>{
 const match=/^\/api\/plinth\/bid-comparisons\/([^/]+)(?:\/([^/]+)\/([^/]+))?$/.exec(new URL(request.url).pathname);if(!match)return null
 try{const env=runtimeBindings(original),actor=await authorize(request,env);requireJobManager(actor);if(request.method!=='GET')requireManager(actor)
  const clock=request.method==='GET'?undefined:await readClock(env.DB),previous=find(await jobs(env.DB) as BidComparisonJob[],match[1]!);need(actor.role!=='project_manager'||actor.team!.job_ids.includes(previous.id),'Job not found',404,'not_found')
  if(request.method==='GET'){need(!match[2],'Unknown comparison route',404,'not_found');return json({source:bidComparisonSource(previous)})}
  need(request.method==='POST','Method not allowed',405,'method_not_allowed');const input=await body(request);need(input.expected_version===previous.version,'The comparison job changed; reload',409,'stale_version')
  const job=structuredClone(previous),result=await bidComparisonAction(env.DB,job,actor,input,match[2],match[3]);await saveJob(env.DB,actor,previous,job,result.writes,clock);return json({source:bidComparisonSource(job),record_id:result.record.id},match[2]?200:201)
 }catch(error){if(error instanceof DomainError)return json({error:error.code,message:error.message,details:error.details},error.status);throw error}
}
