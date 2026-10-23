import { requireOpenCostPeriod } from './cost-periods'
import { active, cents, find, need, recordApproval, stamp, sum, text, usdOnly, type Actor, type Input, type Job } from './model'
import { costs, costCode, costDate, positive } from './cost-model'
import { auditStatement, jobRef } from './audit'
import { jobOf, transaction } from './store'
import { refreshExceptions } from './cost-exceptions'
export async function transferCost(db:D1Database,actor:Actor,previous:Job,input:Input,clock:number){
 const target_id=text(input.target_job_id,'target_job_id',100),target=target_id===previous.id?previous:await jobOf(db,actor,target_id);active(target);usdOnly(target)
 need(input.target_expected_version===target.version,'Destination job changed; reload both jobs',409,'stale_version')
 const from=structuredClone(previous),to=target.id===from.id?from:structuredClone(target),source=find(costs(from).entries,text(input.entry_id,'entry_id',100));need(source.amount_cents>0&&!source.source_kind.startsWith('transfer'),'Choose an original positive cost entry',409,'cost_source')
 const amount=positive(input.amount_cents),moved=sum(costs(from).entries.filter(e=>e.source_kind==='transfer.out'&&e.source_id===source.id).map(e=>-e.amount_cents))
 need(amount<=source.amount_cents-moved,'Correction exceeds this source’s remaining allocation',409,'cost_transfer')
 const code=costCode(to,input.target_cost_code);need(to.id!==from.id||code!==source.cost_code,'Choose another code or job')
 const reason=text(input.reason,'Correction evidence',2000),reference=text(input.reference,'Correction reference',200),dated=costDate(input),id=crypto.randomUUID()
 requireOpenCostPeriod(from,dated.period);requireOpenCostPeriod(to,dated.period)
 need(!costs(from).entries.some(e=>e.source_kind==='transfer.out'&&e.source_line_id===reference),'Correction reference already used',409,'cost_duplicate')
 for(const [job,sign,kind,cost_code] of [[from,-1,'transfer.out',source.cost_code],[to,1,'transfer.in',code]] as const){const entry={id:crypto.randomUUID(),source_id:source.id,source_line_id:reference,source_kind:kind,cost_code,amount_cents:sign*amount,...dated,matches:[],by:stamp(actor)};costs(job).entries.push(entry);recordApproval(job,actor,'cost.transfer',{id,prepared_by:source.by},{entry,from_job_id:from.id,to_job_id:to.id,reason});refreshExceptions(job)}
 from.version=previous.version+1;to.version=target.id===from.id?from.version:target.version+1
 const fromData=JSON.stringify(from),toData=JSON.stringify(to);need(fromData.length<=8000000&&toData.length<=8000000,'Job history is too large')
 const writes=[db.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(from.version,fromData,from.id,previous.version)]
 if(to.id!==from.id)writes.push(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(target.id,target.version),db.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(to.version,toData,to.id,target.version),auditStatement(db,actor,{job_id:to.id,version_before:target.version,version_after:to.version,before_ref:await jobRef(JSON.stringify(target)),after_ref:await jobRef(toData)}))
 await transaction(db,actor,previous,writes,clock,{job_id:from.id,version_before:previous.version,version_after:from.version,before_ref:await jobRef(JSON.stringify(previous)),after_ref:await jobRef(fromData)})
 return {id,version:from.version,target_version:to.version,amount_cents:amount,source_entry_id:source.id,from_job_id:from.id,to_job_id:to.id,reason}
}
