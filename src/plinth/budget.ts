import { cents, need, object, stamp, sum, text, type Actor, type Input, type Job, type Variation } from './model'
import { calculatePricing } from './pricing-model'
import { budgetCost, type BudgetCode, type BudgetRevision } from './budget-model'

/** EST-007: original economics and explicit plan choices are captured with acceptance, never inferred later. */
export function freezeOriginalBudget(job: Job, actor: Actor, input: Input) {
 need(!job.budgets?.length, 'An original budget already exists',409,'budget_exists')
 const quote=job.quotes.find(q=>q.status==='accepted')!;const plan=input.budget===undefined?{}:object(input.budget)
 const allocations=(key:string,describe=false)=>{const rows=plan[key]??[];need(Array.isArray(rows)&&rows.length<=100,`${key} must contain at most 100 entries`);return rows.map(raw=>{const r=object(raw);return {cost_code:text(r.cost_code,'cost code',80),amount_cents:cents(r.amount_cents),...(describe?{description:text(r.description,'commitment description',500)}:{})}})}
 const included=quote.lines.filter(l=>l.included!==false),codes=[...new Set(included.map(l=>l.cost_code??'Unassigned'))]
 const allowances=allocations('allowances'),commitment_plan=allocations('commitment_plan',true) as BudgetRevision['commitment_plan']
 need([...allowances,...commitment_plan].every(a=>codes.includes(a.cost_code)),'Plan allocations must name an included quote cost code')
 need(new Set(allowances.map(a=>a.cost_code)).size===allowances.length,'Use one allowance allocation per cost code')
 const scheduleInput=object(input.schedule_choice)
 need(scheduleInput.kind==='none'||scheduleInput.kind==='template','Explicitly choose a schedule template or no tasks')
 const schedule:BudgetRevision['schedule']=scheduleInput.kind==='none'?{kind:'none',reason:text(scheduleInput.reason,'No-tasks reason',1000)}:{kind:'template',application:structuredClone(job.schedule_template!)}
 need(schedule.kind==='none'||schedule.application,'Apply the selected schedule template before freezing its plan')
 const rows:BudgetCode[]=codes.map(code=>{const lines=included.filter(l=>(l.cost_code??'Unassigned')===code);return {cost_code:code,revenue_cents:sum(lines.map(l=>l.total_cents)),cost_cents:budgetCost(lines),allowance_cents:sum(allowances.filter(a=>a.cost_code===code).map(a=>a.amount_cents)),commitment_plan_cents:sum(commitment_plan.filter(a=>a.cost_code===code).map(a=>a.amount_cents))}})
 need(rows.every(r=>r.allowance_cents<=r.revenue_cents),'Allowance allocations cannot exceed their code’s selling value')
 const row:BudgetRevision={id:crypto.randomUUID(),revision:1,source:{kind:'quote',id:quote.id,revision:quote.revision},recorded_by:stamp(actor),contract_cents:quote.total_cents,codes:rows,billing_lines:included.map(l=>({id:'quote:'+l.id,cost_code:l.cost_code??'Unassigned',description:l.description,scheduled_cents:l.total_cents})),allowances,commitment_plan,schedule}
 job.budgets=[row];return row
}
/** Each approved change appends once; original costs, allocations and source lines never move. */
export function reviseBudget(job:Job,actor:Actor,v:Variation) {
 const before=job.budgets?.at(-1);if(!before)return
 need(!job.budgets!.some(b=>b.source.kind==='variation'&&b.source.id===v.id),'The approved change is already budgeted',409,'budget_exists')
 const next=structuredClone(before),sign=v.amount_cents<0?-1:1
 const priced=v.pricing?calculatePricing(v.pricing.base_lines,v.pricing.basis,v.pricing.rules,v.pricing.tax.rate.percent,v.pricing.tax.taxable_line_ids).lines.filter(l=>l.included!==false):undefined
 need(!priced||sum(priced.map(l=>l.total_cents))===Math.abs(v.amount_cents),'Approved priced change must reconcile by cost code',409,'budget_balance')
 const changes=priced?[...new Set(priced.map(l=>l.cost_code??'Unassigned'))].map(code=>{const lines=priced.filter(l=>(l.cost_code??'Unassigned')===code);return {code,revenue:sign*sum(lines.map(l=>l.total_cents)),cost:budgetCost(lines)}}):[{code:'Unassigned',revenue:v.amount_cents,cost:null}]
 for(const change of changes){let row=next.codes.find(c=>c.cost_code===change.code);if(!row){row={cost_code:change.code,revenue_cents:0,cost_cents:0,allowance_cents:0,commitment_plan_cents:0};next.codes.push(row)}
  row.revenue_cents=sum([row.revenue_cents,change.revenue]);row.cost_cents=row.cost_cents===null||change.cost===null?null:sum([row.cost_cents,sign*change.cost])
 }
 next.id=crypto.randomUUID();next.revision=before.revision+1;next.source={kind:'variation',id:v.id,revision:v.revision};next.recorded_by=stamp(actor);next.contract_cents=sum([before.contract_cents,v.amount_cents])
 next.billing_lines.push(...(priced?priced.map(l=>({id:'variation:'+v.id+':'+l.id,cost_code:l.cost_code??'Unassigned',description:l.description,scheduled_cents:sign*l.total_cents})):[{id:'variation:'+v.id,cost_code:'Unassigned',description:v.description,scheduled_cents:v.amount_cents}]))
 job.budgets!.push(next)
}
