import { decisionSearch } from './decision-search'
import type {Bindings} from '../auth.server'
import { find, need, type Actor, type Input } from './model'
import { jobs, readClock, saveJob } from './store'
import { rfiAction, rfiFile, rfiGrant, rfiCurrent, rfiProjection } from './rfis'
const json=(v:unknown)=>Response.json(v,{headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
/** Native collaborator portal checks the current grant independently on every request and file download. */
export async function rfiInboxResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(r:Request)=>Promise<Input>){
 if(parts[0]!=='rfi-inbox')return null
 need(actor.role==='member','Use the builder job RFI screen for office work',403,'rfi_role')
 const clock=await readClock(env.DB),all=(await Promise.all((await jobs(env.DB)).map(async job=>await rfiCurrent(env.DB,job,actor.email)?job:null))).filter((j):j is NonNullable<typeof j>=>j!==null)
 if(request.method==='GET'&&parts.length===1)return json({jobs:all.map(job=>{const grant=rfiGrant(job,actor.email)!;return {id:job.id,version:job.version,name:job.name,role:grant.role,sheets:(job.takeoff??[]).filter(s=>grant.sheet_ids.includes(s.id)).map(s=>({id:s.id,name:s.name,revisions:s.revisions.map(r=>({id:r.id,revision:r.revision,page:r.page}))})),tasks:job.schedules.filter(t=>grant.role!=='trade'||job.subcontracts?.find(s=>s.id===grant.subcontract_id)?.trade.toLowerCase()===t.trade.toLowerCase()).map(t=>({id:t.id,description:t.description})),cost_codes:grant.role==='trade'?[]:[...new Set(job.quotes.find(q=>q.status==='accepted')?.lines.map(l=>l.cost_code).filter(Boolean)??[])],designers:job.rfi_access?.filter(g=>g.role==='designer'&&!g.revoked_by&&rfiGrant(job,g.email)===g).map(g=>g.email)??[],rfis:rfiProjection(job,actor)}})})
 need(parts[1],'RFI job not found',404,'not_found');const previous=find(all,parts[1])
 if(request.method==='GET'&&parts.length===3&&parts[2]==='decision-search')return json(await decisionSearch(env.DB,previous,{diary:[],schedules:[],variations:[],selections:[],rfis:rfiProjection(previous,actor)},actor,new URL(request.url).searchParams,true))
 if(request.method==='GET'&&parts.length===4&&parts[2]==='files')return rfiFile(env.DB,previous,actor,parts[3])
 need(request.method==='POST'&&parts[2]==='rfis'&&(parts.length===3||parts.length===5),'Unknown RFI inbox action',404,'not_found')
 const input=await body(request);need(input.expected_version===previous.version,'The RFI job changed; reload before acting',409,'stale_version')
 const job=structuredClone(previous),result=await rfiAction(env.DB,job,actor,input,parts[3],parts[4]);await saveJob(env.DB,actor,previous,job,result.writes,clock)
 return json({rfi:rfiProjection(job,actor).find(r=>r.id===result.record.id),version:job.version})
}
