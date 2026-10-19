import type { Schedule } from './model'
import type { ScheduleBlocker } from './schedule-constraint-model'

export interface WorkingCalendar { weekdays: number[]; start_hour: number; end_hour: number; holidays: string[] }
export const defaultCalendar: WorkingCalendar = { weekdays: [1, 2, 3, 4, 5], start_hour: 8, end_hour: 17, holidays: [] }
export interface TaskDependency { id: string; lag_minutes: number }
export interface SchedulePreview {
 blockers: ScheduleBlocker[]; tasks: Schedule[]; calendar: WorkingCalendar
 changes: { id: string; description: string; before: { start: string; end: string; status: string } | null; after: { start: string; end: string; status: string } }[]
 conflicts: { job_id: string; job_name: string; schedule_id: string; trade: string; start: string; end: string }[]
 completion_before: string | null; completion_after: string | null; critical_path: string[]; digest: string
}
