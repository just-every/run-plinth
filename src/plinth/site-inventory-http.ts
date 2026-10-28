import { runtimeBindings, type Bindings } from '../auth.server'
import { authorize } from './auth'
import { costAccess } from './cost-access'
import { active, need, type Input } from './model'
import { jobOf, jobs, readClock, saveJob, saveJobs } from './store'
import { inventory, inventoryAccess, inventoryOperation, inventoryView, receiveStock, moveStock, allocateEquipment, reviewClaim } from './site-inventory'

const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}
export async function inventoryResponse(request:Request,original:Bindings,body:(request:Request)=>Promise<Input>):Promise<Response|null>{
 const parts=new URL(request.url).pathname.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='plinth'||parts[2]!=='jobs'||parts[4]!=='inventory')return null
 const env=runtimeBindings(original),actor=await authorize(request,env);inventoryAccess(actor)
 const scoped=(id:string)=>need(!actor.permissions||!actor.team||actor.team.job_ids.includes(id),'Job not found',404,'not_found');scoped(parts[3]!)
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,parts[3]!)
 const json=(data:unknown)=>Response.json(data,{headers})
 if(request.method==='GET'){
  if(parts.length===5)return json(inventoryView(previous))
  need(parts.length===7&&parts[5]==='tickets','Inventory source not found',404,'not_found');const ticket=inventory(previous).tickets.find(t=>t.receipt_id===parts[6]);need(ticket,'Delivery ticket not found',404,'not_found');const d=ticket.document
  return new Response(Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0)),{headers:{...headers,'content-type':d.mime,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(d.name),'content-security-policy':"default-src 'none'; sandbox",'x-content-sha256':d.checksum}})
 }
 need(request.method==='POST'&&parts.length===6,'Unknown inventory action',404,'not_found');active(previous)
 const input=await body(request);need(input.expected_version===previous.version,'Job changed. Reload before recording stock.',409,'stale_version')
 const job=structuredClone(previous);inventoryOperation(job,input);let record:unknown
 if(parts[5]==='receive')record=await receiveStock(job,actor,input)
 else if(parts[5]==='install'||parts[5]==='return')record=moveStock(job,actor,input,parts[5])
 else if(parts[5]==='equipment')record=allocateEquipment(job,actor,input,await jobs(env.DB))
 else if(parts[5]==='claim-review'){costAccess(actor,new Request(new URL('/api/plinth/jobs/'+job.id+'/costs/forecasts',request.url),{method:'POST'}));record=reviewClaim(job,actor,input)}
 else if(parts[5]==='transfer'){
  scoped(String(input.target_job_id));const before=await jobOf(env.DB,actor,String(input.target_job_id));active(before);need(input.target_version===before.version,'Destination changed. Reload before transferring stock.',409,'stale_version')
  const target=structuredClone(before);inventoryOperation(target,input);record=moveStock(job,actor,input,'transfer',target)
  await saveJobs(env.DB,actor,[{previous,next:job},{previous:before,next:target}],clock)
  return json({...inventoryView(job),record,target_version:target.version})
 }else need(false,'Unknown inventory action',404,'not_found')
 await saveJob(env.DB,actor,previous,job,[],clock);return json({...inventoryView(job),record})
}
