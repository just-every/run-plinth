import { latestActual } from './schedule-baseline-model'
import { previewSchedule } from './schedule-plan'
import { scheduleTime } from './operations'
import { object, type Actor, type Input, type Job } from './model'
import { zonedInstant } from './time-zone'

/** Recovery durations describe remaining work. Actual starts remain historical
 * evidence on the source job, rather than anchoring the remaining work in the past. */
export async function remainingRecoverySchedule(job:Job,actor:Actor,plan:Input,all:Job[],asOf:string){
 const candidate=structuredClone(job),floor=zonedInstant(asOf,0,job.time_zone??'UTC')
 const completed=new Set(job.schedules.filter(task=>latestActual(job,task.id)?.actual_finish).map(task=>task.id))
 candidate.schedule_actuals=candidate.schedule_actuals?.filter(actual=>completed.has(actual.task_id))
 const tasks=(plan.tasks as unknown[]).map(value=>{
  const task=object(value),start=scheduleTime(task,'start')
  if(completed.has(String(task.id)))return task
  const actual=latestActual(job,String(task.id))
  return {...task,start:new Date(Math.max(Date.parse(start),floor,actual?Date.parse(actual.actual_start):floor)).toISOString()}
 })
 return previewSchedule(candidate,actor,{...plan,tasks},all)
}
