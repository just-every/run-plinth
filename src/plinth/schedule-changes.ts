import { requireManager } from './auth'
import { find, need, recordApproval, type Actor, type Input, type Job } from './model'
import { checkConflicts, scheduleTime } from './operations'

/** A human decision changes published work without replacing its calendar identity. */
export function changeSchedule(job: Job, actor: Actor, id: string, input: Input, action: string, all: Job[]) {
  requireManager(actor)
  const row = find(job.schedules, id)
  need(row.status === 'booked', 'Only a booked trade can be moved or cancelled', 409, 'schedule_state')
  const before = structuredClone(row)
  if (action === 'move') {
    row.start = scheduleTime(input, 'start')
    row.end = scheduleTime(input, 'end')
    need(row.end > row.start, 'Schedule must end after it starts')
    checkConflicts(all, job, row)
  } else row.status = 'cancelled'
  row.revision = (row.revision ?? 0) + 1
  row.updated_at = new Date().toISOString()
  recordApproval(job, actor, 'schedule.' + action, row, { before, after: structuredClone(row) })
  return row
}
