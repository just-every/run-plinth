import { assignedJob } from './auth'
import { jobs } from './store'
import { need, object, text, type Actor, type Job } from './model'
import { localDate } from './remittances'
export interface PortfolioScope { snapshot_id?:string; manager_id?:string; trade?:string; cost_code?:string; source_from?:string; source_to?:string }
export function parsePortfolioScope(value:unknown):PortfolioScope|undefined {
 if(value===undefined||value===null)return undefined
 const input=object(value),result:PortfolioScope={}
 for(const key of ['snapshot_id','manager_id','trade','cost_code'] as const)if(input[key])result[key]=text(input[key],key,100)
 for(const key of ['source_from','source_to'] as const)if(input[key])result[key]=localDate(input[key],key)
 need(!result.source_from||!result.source_to||result.source_from<=result.source_to,'Source date range must be ordered')
 need(Object.keys(input).every(key=>['snapshot_id','manager_id','trade','cost_code','source_from','source_to'].includes(key)),'Unknown portfolio selection')
 return result
}
export async function portfolioManagers(db:D1Database) {
 const rows=(await db.prepare('SELECT operator_id,data FROM pl_team').all<{operator_id:string;data:string}>()).results
 return rows.map(r=>({id:r.operator_id,...JSON.parse(r.data) as {role:string;job_ids:string[]}})).filter(r=>r.role==='project_manager')
}
export async function portfolioJobs(db:D1Database,actor:Actor,selection?:PortfolioScope) {
 const current=(await jobs(db)).filter(j=>assignedJob(actor,j)&&(actor.role!=='project_manager'||actor.team?.job_ids.includes(j.id)))
 let rows:{job:Job;manager_ids:string[];captured_at:string}[]
 if(selection?.snapshot_id){
  const saved=(await db.prepare('SELECT job_id,data FROM pl_portfolio_snapshots WHERE snapshot_id=?').bind(selection.snapshot_id).all<{job_id:string;data:string}>()).results
  rows=saved.filter(r=>current.some(j=>j.id===r.job_id)).map(r=>JSON.parse(r.data))
  need(rows.length,'Snapshot unavailable under current job grants',404,'not_found')
 }else{
  const managers=await portfolioManagers(db),captured_at=new Date(Date.now()).toISOString()
  rows=current.map(job=>({job,manager_ids:managers.filter(m=>m.job_ids.includes(job.id)).map(m=>m.id),captured_at}))
 }
 return rows.filter(r=>(!selection?.manager_id||r.manager_ids.includes(selection.manager_id))&&(!selection?.trade||r.job.schedules.some(s=>s.status!=='cancelled'&&s.trade.toLocaleLowerCase('en-US')===selection.trade!.toLocaleLowerCase('en-US'))))
}
