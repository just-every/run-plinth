import { useState } from 'react'
import type { Schedule } from '../plinth/model'
import { Badge } from './shared'
import { wallClock, zonedInstant } from '../plinth/time-zone'

/** Schedule dates and times show in the job's IANA time zone (UTC for a job created without one), with that instant's abbreviation (CST or CDT). */
export const jobZone = (job: { time_zone?: string }) => job.time_zone ?? 'UTC'
export const scheduleDate = (value: string | number, zone = 'UTC') => new Date(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: zone })
export const scheduleTime = (value: string, zone = 'UTC') => new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(new Date(value).getUTCSeconds() || new Date(value).getUTCMilliseconds() ? {second: '2-digit' as const} : {}), timeZone: zone, timeZoneName: 'short' })
export const scheduleInstant = (value: string | null, zone = 'UTC') => value ? `${scheduleDate(value, zone)}, ${scheduleTime(value, zone)}` : 'No scheduled finish'
/** datetime-local fields hold the job's wall-clock time; the API receives the exact instant. */
export const localInput = (value: string | undefined, zone: string) => { if (!value) return ''; const w = wallClock(Date.parse(value), zone); return `${w.date}T${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}` }
export const fromLocalInput = (value: string, zone: string) => { const [date, clock] = value.split('T'), [h, m] = clock!.split(':').map(Number); return new Date(zonedInstant(date!, h! * 60 + m!, zone)).toISOString() }

export function TaskDetails({ task, tasks, critical }: { task: Schedule; tasks: Schedule[]; critical: boolean }) {
  return <span className="row-main"><span>{task.owner && `${task.owner} · `}{task.trade}{task.status === 'cancelled' && ' · Cancelled'}</span>
    <span>{task.milestone ? 'Milestone' : task.duration_minutes === undefined ? 'Trade booking' : `${task.duration_minutes} working minutes`}{critical && ' · Critical path'}</span>
    {!!task.predecessors?.length && <span>After {task.predecessors.map(p => `${tasks.find(t => t.id === p.id)?.description ?? p.id}${p.lag_minutes ? ` + ${p.lag_minutes} working minutes` : ''}`).join('; ')}</span>}
  </span>
}

type ViewProps = { tasks: Schedule[]; critical: string[]; select: (id: string) => void; zone: string }
export function ScheduleList({ tasks, critical, select, zone }: ViewProps) {
  return <ol className="rows" aria-label="Schedule task list">{[...tasks].sort((a, b) => a.start.localeCompare(b.start)).map(task => <li className="row" key={task.id}>
    <div className="row-main"><span><button type="button" className="link-button" onClick={() => select(task.id)}>{task.description}</button></span><TaskDetails task={task} tasks={tasks} critical={critical.includes(task.id)} /><span>{scheduleInstant(task.start, zone)} – {scheduleInstant(task.end, zone)}</span></div><div className="row-end"><Badge>{task.status}</Badge></div>
  </li>)}</ol>
}

/** Month agenda in the job's time zone includes every local date occupied by a task, including multi-day work. */
export function ScheduleCalendar({ tasks, critical, select, zone }: ViewProps) {
  const first = [...tasks].filter(t => t.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start))[0]
  const [month, setMonth] = useState(() => wallClock(first ? Date.parse(first.start) : Date.now(), zone).date.slice(0, 7))
  const start = new Date(month + '-01T00:00:00Z')
  const dates = Array.from({ length: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate() }, (_, i) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), i + 1)))
  const shift = (n: number) => setMonth(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1)).toISOString().slice(0, 7))
  const visible = dates.map(date => { const day = date.toISOString().slice(0, 10), open = zonedInstant(day, 0, zone), close = zonedInstant(day, 1440, zone); return { date, tasks: tasks.filter(task => task.status !== 'cancelled' && Date.parse(task.start) < close && (task.milestone ? Date.parse(task.start) >= open : Date.parse(task.end) > open)) } }).filter(day => day.tasks.length)
  return <section className="card" aria-label="Schedule calendar">
    <div className="card-head"><h3>{start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · {zone}</h3></div>
    <div className="button-row"><button type="button" className="secondary" onClick={() => shift(-1)} aria-label="Previous month">Previous month</button><button type="button" className="secondary" onClick={() => shift(1)} aria-label="Next month">Next month</button></div>
    <p className="hint">Calendar agenda · each occupied date in this month.</p>
    {!visible.length && <p className="empty">No scheduled work this month.</p>}
    <ol className="rows">{visible.map(({ date, tasks: onDate }) => <li className="row" key={date.toISOString()}><div className="row-main"><h4><time dateTime={date.toISOString().slice(0, 10)}>{scheduleDate(date.getTime(), 'UTC')}</time></h4><ul>{onDate.map(task => <li key={task.id}><span><button type="button" className="link-button" onClick={() => select(task.id)}>{task.description}</button></span><p>{scheduleTime(task.start, zone)} – {scheduleTime(task.end, zone)}</p><TaskDetails task={task} tasks={tasks} critical={critical.includes(task.id)} /></li>)}</ul></div></li>)}</ol>
  </section>
}
