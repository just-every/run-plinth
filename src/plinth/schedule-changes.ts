import { allocations } from './schedule-resource-model'
import { travelFields } from './schedule-travel'
import { requireScheduleClearance } from './schedule-constraints'
import { requireJobManager } from './auth'
import { find, need, recordApproval, type Actor, type Input, type Job } from './model'
import { checkConflicts, scheduleTime } from './operations'

/** A human decision changes published work without replacing its calendar identity. */
export function changeSchedule(job: Job, actor: Actor, id: string, input: Input, action: string, all: Job[]) {
  requireJobManager(actor)
  const row = find(job.schedules, id)
  need(row.duration_minutes === undefined && !job.schedules.some(s => s.predecessors?.some(d => d.id === id)), 'Review dependent shifts in the schedule planner before publishing', 409, 'schedule_review')
  need(row.status === 'booked', 'Only a booked trade can be moved or cancelled', 409, 'schedule_state')
  const before = structuredClone(row)
  if (action === 'move') {
    const travel = travelFields(input, row)
    delete (row as typeof row & { travel_minutes?: number }).travel_minutes
    Object.assign(row, allocations(input,row), travel)
    row.start = scheduleTime(input, 'start')
    row.end = scheduleTime(input, 'end')
    need(row.end > row.start, 'Schedule must end after it starts')
    checkConflicts(all, job, row)
    requireScheduleClearance(job, [row])
  } else row.status = 'cancelled'
  row.revision = (row.revision ?? 0) + 1
  row.updated_at = new Date().toISOString()
  recordApproval(job, actor, 'schedule.' + action, row, { before, after: structuredClone(row) })
  return row
}
