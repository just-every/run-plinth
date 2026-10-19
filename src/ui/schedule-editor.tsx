import { useState, type ChangeEvent } from 'react'
import type { Schedule } from '../plinth/model'
import type { WorkingCalendar } from '../plinth/schedule-model'
import { Field, Form } from './shared'

export type TaskInput = Omit<Schedule, 'prepared_by'> & { prepared_by?: Schedule['prepared_by'] }
const utcInput = (value: string) => new Date(value).toISOString().slice(0, 16)

export function TaskEditor({ task, tasks, save, close }: { task?: TaskInput; tasks: TaskInput[]; save: (task: TaskInput) => void; close: () => void }) {
  const [milestone, setMilestone] = useState(task?.milestone ?? false)
  const [links, setLinks] = useState(task?.predecessors ?? [])
  const candidates = tasks.filter(t => t.id !== task?.id && t.status !== 'cancelled')
  return <section className="side-section" id="schedule-task-editor"><h3>{task ? 'Edit task' : 'Add task'}</h3>
    <p className="hint">Stage your changes, then preview dependent dates before publishing. All task times use UTC.</p>
    <Form submit="Stage task" reset={false} action={async f => {
      const start = new Date(String(f.get('start')) + 'Z').toISOString()
      const duration_minutes = milestone ? 0 : Number(f.get('duration_minutes'))
      save({ ...task, id: task?.id ?? crypto.randomUUID(), description: String(f.get('description')), owner: String(f.get('owner')), trade: String(f.get('trade')), start, end: task?.end ?? start, duration_minutes, milestone, predecessors: links, status: task?.status === 'cancelled' || f.get('cancelled') ? 'cancelled' : task?.status === 'draft' ? 'draft' : 'booked' })
    }}>
      <Field label="Task name" name="description" defaultValue={task?.description ?? ''} />
      <Field label="Responsible person" name="owner" defaultValue={task?.owner ?? ''} />
      <Field label="Trade or subcontractor" name="trade" defaultValue={task?.trade ?? ''} />
      <Field label="Earliest start (UTC)" name="start" type="datetime-local" defaultValue={task ? utcInput(task.start) : ''} />
      <label><input type="checkbox" name="milestone" checked={milestone} onChange={e => setMilestone(e.target.checked)} /> Milestone (zero duration)</label>
      {!milestone && <Field label="Working duration (minutes)" name="duration_minutes" type="number" min={1} step={1} defaultValue={task?.duration_minutes ?? (task ? Math.max(1, Math.round((Date.parse(task.end) - Date.parse(task.start)) / 60000)) : 480)} />}
      <fieldset><legend>Predecessors · finish to start</legend>
        {candidates.length === 0 && <p className="muted">Stage another task to add a predecessor.</p>}
        {candidates.map(other => {
          const link = links.find(p => p.id === other.id)
          return <div key={other.id}>
            <label><input type="checkbox" checked={!!link} onChange={e => setLinks(current => e.target.checked ? [...current, { id: other.id, lag_minutes: 0 }] : current.filter(p => p.id !== other.id))} /> {other.description}</label>
            {link && <Field label={`Lag after ${other.description} (working minutes)`} name={'lag-' + other.id} type="number" min={0} step={1} value={link.lag_minutes} onChange={(e: ChangeEvent<HTMLInputElement>) => setLinks(current => current.map(p => p.id === other.id ? { ...p, lag_minutes: Number(e.target.value) } : p))} />}
          </div>
        })}
      </fieldset>
      {task && <label><input type="checkbox" name="cancelled" defaultChecked={task.status === 'cancelled'} disabled={task.status === 'cancelled'} /> Cancel this task</label>}
    </Form>
    <button type="button" className="link-button" onClick={close}>Close editor</button>
  </section>
}

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function CalendarEditor({ calendar, save }: { calendar: WorkingCalendar; save: (calendar: WorkingCalendar) => void }) {
  return <details className="card"><summary>Working calendar · UTC</summary>
    <p>Durations and predecessor lag count only these working hours, excluding holidays.</p>
    <Form key={JSON.stringify(calendar)} submit="Stage working calendar" reset={false} action={async f => save({ weekdays: f.getAll('weekday').map(Number), start_hour: Number(f.get('start_hour')), end_hour: Number(f.get('end_hour')), holidays: String(f.get('holidays') ?? '').split(/[\s,]+/).filter(Boolean) })}>
      <fieldset><legend>Working days</legend>{weekdays.map((name, day) => <label key={day}><input type="checkbox" name="weekday" value={day} defaultChecked={calendar.weekdays.includes(day)} /> {name}</label>)}</fieldset>
      <div className="fields"><Field label="Start hour (UTC, 0–23)" name="start_hour" type="number" min={0} max={23} step={1} defaultValue={calendar.start_hour} /><Field label="End hour (UTC, 1–24)" name="end_hour" type="number" min={1} max={24} step={1} defaultValue={calendar.end_hour} /></div>
      <label>Holidays (YYYY-MM-DD, one per line)<textarea name="holidays" defaultValue={calendar.holidays.join('\n')} rows={3} /></label>
    </Form>
  </details>
}
