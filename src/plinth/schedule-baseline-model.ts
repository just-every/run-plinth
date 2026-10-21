import type { TravelFields } from './schedule-travel'
import type { Job, Schedule, Stamp } from './model'
import type { WorkingCalendar } from './schedule-model'

export type TemplateTask = TravelFields & Pick<Schedule, 'id' | 'trade' | 'description' | 'owner' | 'start' | 'duration_minutes' | 'milestone' | 'predecessors' | 'resources'>
export interface TemplateRevision {
 revision: number; name: string; reason: string; calendar: WorkingCalendar; tasks: TemplateTask[]
 archived: boolean; approved_by: Stamp
}
export interface ScheduleTemplate {
 id: string; version: number; name: string; calendar: WorkingCalendar; tasks: TemplateTask[]
 archived: boolean; revisions: TemplateRevision[]
}
export interface ScheduleSnapshot { calendar: WorkingCalendar; tasks: Schedule[] }
export interface ScheduleBaseline extends ScheduleSnapshot {
 id: string; revision: number; name: string; reason: string; approval_id: string; approved_by: Stamp
}
export interface ScheduleRevision extends ScheduleSnapshot {
 id: string; name: string; reason: string; baseline_id: string | null
 publication_id: string; approval_id: string; approved_by: Stamp
}
export interface ScheduleActual {
 id: string; task_id: string; actual_start: string; actual_finish?: string; evidence: string
 reason?: string; supersedes?: string; recorded_by: Stamp
}
export interface TemplateApplication {
 template_id: string; template_version: number; template_name: string; start: string
 task_ids: string[]; publication_id: string; approved_by: Stamp
}
export interface ScheduleBaselineFields {
 schedule_baselines?: ScheduleBaseline[]; schedule_revisions?: ScheduleRevision[]
 schedule_actuals?: ScheduleActual[]; schedule_template?: TemplateApplication
}
export type BaselineJob = Job & ScheduleBaselineFields
export interface ScheduleVariance {
 baseline_id: string | null; task_id: string; description: string; status: Schedule['status']
 baseline_start: string | null; baseline_finish: string | null
 forecast_start: string; forecast_finish: string; actual_start: string | null; actual_finish: string | null
 forecast_start_variance_minutes: number | null; forecast_finish_variance_minutes: number | null
 actual_start_variance_minutes: number | null; actual_finish_variance_minutes: number | null
 evidence: string | null; recorded_by: Stamp | null
}

/** Latest evidence is append-only: corrections retain the earlier attributed record. */
export function latestActual(job: BaselineJob, taskId: string): ScheduleActual | undefined {
 return job.schedule_actuals?.findLast(actual => actual.task_id === taskId)
}
/** Reports elapsed UTC variance; working duration remains a separate planner value. */
export function scheduleVariance(job: BaselineJob, forecast: Schedule[] = job.schedules, baselineId?: string): ScheduleVariance[] {
 const baseline = baselineId ? job.schedule_baselines?.find(row => row.id === baselineId) : job.schedule_baselines?.[0]
 const difference = (actual: string | undefined, promised: string | undefined) => actual && promised ? (Date.parse(actual) - Date.parse(promised)) / 60000 : null
 return forecast.map(task => {
  const promised = baseline?.tasks.find(row => row.id === task.id), actual = latestActual(job, task.id)
  return {
   baseline_id: baseline?.id ?? null, task_id: task.id, description: task.description, status: task.status,
   baseline_start: promised?.start ?? null, baseline_finish: promised?.end ?? null,
   forecast_start: task.start, forecast_finish: task.end, actual_start: actual?.actual_start ?? null, actual_finish: actual?.actual_finish ?? null,
   forecast_start_variance_minutes: difference(task.start, promised?.start), forecast_finish_variance_minutes: difference(task.end, promised?.end),
   actual_start_variance_minutes: difference(actual?.actual_start, promised?.start), actual_finish_variance_minutes: difference(actual?.actual_finish, promised?.end),
   evidence: actual?.evidence ?? null, recorded_by: actual?.recorded_by ?? null,
  }
 })
}

/** A planner consumes evidence without altering it or turning a forecast into approval. */
export function taskActualDates(job: BaselineJob, task: Schedule): Pick<ScheduleActual, 'actual_start' | 'actual_finish'> | undefined {
 const actual = latestActual(job, task.id)
 return actual && task.status !== 'cancelled' ? { actual_start: actual.actual_start, actual_finish: actual.actual_finish } : undefined
}


/** A template's local ids become stable, installation-wide calendar identities for this job. */
export async function templateTaskId(jobId: string, templateId: string, localId: string): Promise<string> {
 const bytes = new TextEncoder().encode(JSON.stringify([jobId, templateId, localId]))
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
