import type { Attachment, Stamp } from './model'

export interface ConstraintEvent {
 id: string; action: 'requested' | 'failed' | 'held' | 'cleared'; reason: string; recorded_by: Stamp; documents: Attachment[]
}
export interface ScheduleConstraint {
 id: string; kind: 'permit' | 'inspection' | 'weather' | 'site'; title: string; jurisdiction: string; accountable: string
 task_ids: string[]; events: ConstraintEvent[]
}
export interface ScheduleBlocker { constraint_id: string; title: string; task_id: string; task: string; status: string; accountable: string }
