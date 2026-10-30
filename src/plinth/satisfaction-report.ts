import type { Actor, Job } from './model'
import { assignedJob } from './auth'
import { need } from './model'
import { jobs } from './store'

export function satisfactionValues(job:Job,actor?:Actor) {
 if(actor?.permissions&&!actor.team?.job_ids.includes(job.id))return {'native.satisfaction_count':null,'native.satisfaction_score':null,'native.satisfaction_low':null}
 const surveys=job.satisfaction?.surveys.filter(s=>s.response)??[]
 return {'native.satisfaction_count':surveys.length,'native.satisfaction_score':surveys.length?surveys.reduce((n,s)=>n+s.response!.score,0)/surveys.length:null,'native.satisfaction_low':surveys.filter(s=>s.response!.score<=s.settings.low_score).length}
}
/** Responses keep the people and companies involved at the source; report access uses today's grants. */
export async function satisfactionReport(db:D1Database,actor:Actor) {
 need(['owner','admin','project_manager'].includes(actor.role)&&(!actor.permissions||actor.permissions.matrix.reports.view&&actor.permissions.matrix.documents.view),'Satisfaction reports are office-only',403,'forbidden')
 const allowed=(await jobs(db)).filter(j=>assignedJob(actor,j)&&(!actor.team||actor.role!=='project_manager'&&!actor.permissions||actor.team.job_ids.includes(j.id)))
 const responses=allowed.flatMap(job=>(job.satisfaction?.surveys??[]).filter(s=>s.response).map(s=>({job_id:job.id,job_name:job.name,survey_id:s.id,source:s.source,score:s.response!.score,answers:s.response!.answers,comment:s.response!.comment,context:s.context,follow_up:s.follow_up??null})))
 const group=(kind:'managers'|'crew'|'subs')=>{
  const groups=new Map<string,{id:string;name:string;trade?:string;count:number;score_total:number;low_scores:number}>()
  for(const job of allowed)for(const survey of job.satisfaction?.surveys??[]){
   if(!survey.response)continue
   for(const person of survey.context[kind]){
    const trade='trade' in person?person.trade:undefined,key=person.id+(trade?':'+trade:'')
    const row=groups.get(key)??{...person,count:0,score_total:0,low_scores:0}
    row.count++;row.score_total+=survey.response.score;if(survey.response.score<=survey.settings.low_score)row.low_scores++
    groups.set(key,row)
   }
  }
  return [...groups.values()].map(r=>({...r,average_score:r.score_total/r.count}))
 }
 return {responses,managers:group('managers'),crew:group('crew'),trades:group('subs')}
}
