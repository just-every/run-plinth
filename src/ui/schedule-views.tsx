import { useState } from 'react'
import type { Schedule } from '../plinth/model'
import { Badge } from './shared'

export const scheduleDate = (value: string | number) => new Date(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
export const scheduleTime = (value: string) => new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(new Date(value).getUTCSeconds() || new Date(value).getUTCMilliseconds() ? {second: '2-digit' as const} : {}), timeZone: 'UTC' }) + ' UTC'
export const scheduleInstant = (value: string | null) => value ? `${scheduleDate(value)}, ${scheduleTime(value)}` : 'No scheduled finish'

export function TaskDetails({ task, tasks, critical }: { task: Schedule; tasks: Schedule[]; critical: boolean }) {
  return <span className="row-main"><span>{task.owner && `${task.owner} · `}{task.trade}{task.status === 'cancelled' && ' · Cancelled'}</span>
    <span>{task.milestone ? 'Milestone' : task.duration_minutes === undefined ? 'Trade booking' : `${task.duration_minutes} working minutes`}{critical && ' · Critical path'}</span>
    {!!task.predecessors?.length && <span>After {task.predecessors.map(p => `${tasks.find(t => t.id === p.id)?.description ?? p.id}${p.lag_minutes ? ` + ${p.lag_minutes} working minutes` : ''}`).join('; ')}</span>}
  </span>
}

type ViewProps = { tasks: Schedule[]; critical: string[]; select: (id: string) => void }
export function ScheduleList({ tasks, critical, select }: ViewProps) {
  return <ol className="rows" aria-label="Schedule task list">{[...tasks].sort((a, b) => a.start.localeCompare(b.start)).map(task => <li className="row" key={task.id}>
    <div className="row-main"><span><button type="button" className="link-button" onClick={() => select(task.id)}>{task.description}</button></span><TaskDetails task={task} tasks={tasks} critical={critical.includes(task.id)} /><span>{scheduleInstant(task.start)} – {scheduleInstant(task.end)}</span></div><div className="row-end"><Badge>{task.status}</Badge></div>
  </li>)}</ol>
}

/** UTC month agenda includes every date occupied by a task, including multi-day work. */
export function ScheduleCalendar({ tasks, critical, select }: ViewProps) {
  const first = [...tasks].filter(t => t.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start))[0]
  const [month, setMonth] = useState(() => (first?.start ?? new Date().toISOString()).slice(0, 7))
  const start = new Date(month + '-01T00:00:00Z')
  const dates = Array.from({ length: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate() }, (_, i) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), i + 1)))
  const shift = (n: number) => setMonth(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1)).toISOString().slice(0, 7))
  const visible = dates.map(date => ({ date, tasks: tasks.filter(task => task.status !== 'cancelled' && Date.parse(task.start) < date.getTime() + 86400000 && (task.milestone ? Date.parse(task.start) >= date.getTime() : Date.parse(task.end) > date.getTime())) })).filter(day => day.tasks.length)
  return <section className="card" aria-label="Schedule calendar">
    <div className="card-head"><h3>{start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · UTC</h3></div>
    <div className="button-row"><button type="button" className="secondary" onClick={() => shift(-1)} aria-label="Previous month">Previous month</button><button type="button" className="secondary" onClick={() => shift(1)} aria-label="Next month">Next month</button></div>
    <p className="hint">Calendar agenda · each occupied date in this month.</p>
    {!visible.length && <p className="empty">No scheduled work this month.</p>}
    <ol className="rows">{visible.map(({ date, tasks: onDate }) => <li className="row" key={date.toISOString()}><div className="row-main"><h4><time dateTime={date.toISOString().slice(0, 10)}>{scheduleDate(date.getTime())}</time></h4><ul>{onDate.map(task => <li key={task.id}><span><button type="button" className="link-button" onClick={() => select(task.id)}>{task.description}</button></span><p>{scheduleTime(task.start)} – {scheduleTime(task.end)}</p><TaskDetails task={task} tasks={tasks} critical={critical.includes(task.id)} /></li>)}</ul></div></li>)}</ol>
  </section>
}
