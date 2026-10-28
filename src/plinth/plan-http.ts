import type { Bindings } from '../auth.server'
import { need, type Actor, type Input } from './model'
import { planAccess } from './plan-access'
import { planAction, planFile, planView } from './plans'
import { jobs, readClock, saveJob } from './store'
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
export async function planResponse(request:Request,env:Bindings,actor:Actor,parts:string[],body:(request:Request)=>Promise<Input>){
 const inbox=parts[0]==='plan-inbox',jobRoute=parts[0]==='jobs'&&parts[2]==='plans'
 if(!inbox&&!jobRoute)return null
 need(actor.role!=='agent','A signed-in person opens distributed plans',403,'human_required')
 if(inbox){
  need(parts.length===1&&request.method==='GET','Unknown plan inbox route',404,'not_found')
  const visible=[]
  for(const job of await jobs(env.DB)){
   try{await planAccess(env.DB,job,actor)}catch(error){if((error as {status?:number}).status===403||(error as {status?:number}).status===404)continue;throw error}
   if((job.plan_sets??[]).length)visible.push(await planView(env.DB,job,actor))
  }
  return json({jobs:visible})
 }
 const clock=await readClock(env.DB),previous=(await jobs(env.DB)).find(j=>j.id===parts[1]);need(previous,'Plan job not found',404,'not_found');await planAccess(env.DB,previous,actor)
 if(request.method==='GET'&&parts.length===3)return json({plans:await planView(env.DB,previous,actor)})
 if(request.method==='GET'&&parts.length===6&&parts[4]==='files')return planFile(env.DB,previous,actor,parts[3]!,parts[5]!)
 need(request.method==='POST'&&(parts.length===3||parts.length===5),'Unknown plan route',404,'not_found')
 const input=await body(request);need(input.expected_version===previous.version,'Plans changed. Reload before acting.',409,'stale_version')
 const job=structuredClone(previous),result=await planAction(env.DB,job,actor,input,parts[3],parts[4]);await saveJob(env.DB,actor,previous,job,result.writes,clock)
 return json({plans:await planView(env.DB,job,actor),record:{id:result.record.id}})
}
