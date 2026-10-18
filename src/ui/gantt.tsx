import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Diary, Schedule } from '../plinth/model'
import { calendarDay, day } from './shared'

const WEEK = 7 * 86_400_000
const monday = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime() }
const logTime = (d: Diary) => new Date(d.date + 'T12:00:00').getTime()
const vars = (values: Record<string, number | string>) => values as CSSProperties
/** A week column this wide fits "Mon 19" at 12px with its padding. */
const WEEKDAY_ROOM = 48

/** Whole weeks, Monday to Sunday, covering every booking, every daily log and today. */
export function weeks(schedules: Schedule[], logs: Diary[], now: number) {
  const times = [now, ...schedules.flatMap(s => [Date.parse(s.start), Date.parse(s.end)]), ...logs.map(logTime)]
  const start = monday(Math.min(...times)), count = Math.max(4, Math.ceil((Math.max(...times) - start + 1) / WEEK))
  const at = (t: number) => Math.min(1, Math.max(0, (t - start) / (count * WEEK)))
  const mondays = Array.from({ length: count }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i * 7); return d })
  return { start, count, at, mondays, end: start + count * WEEK - 1 }
}

type Props = { schedules: Schedule[]; logs: Diary[]; now: number; selected?: string; onSelect: (id: string) => void; onLogs: () => void }

/** The schedule chart: one row per booking with its bar on a weekly grid, a today line, and the daily logs as milestones. Below 760px the rows stack, each with its own track. */
export function Gantt({ schedules, logs, now, selected, onSelect, onLogs }: Props) {
  const grid = weeks(schedules, logs, now), rows = [...schedules].sort((a, b) => a.start.localeCompare(b.start) || a.trade.localeCompare(b.trade))
  const scale = useRef<HTMLDivElement>(null), [room, setRoom] = useState(false)
  useEffect(() => { const el = scale.current; if (!el) return; const seen = new ResizeObserver(([entry]) => setRoom(entry!.contentRect.width / grid.count >= WEEKDAY_ROOM)); seen.observe(el); return () => seen.disconnect() }, [grid.count])
  const months = grid.mondays.reduce<{ label: string; span: number }[]>((all, d) => { const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase(); if (all.at(-1)?.label === label) all.at(-1)!.span++; else all.push({ label, span: 1 }); return all }, [])
  return <div className={`gantt${room ? ' has-room' : ''}`} style={vars({ '--weeks': grid.count, '--now': grid.at(now) })}>
    <div className="g-head" aria-hidden="true">
      <span className="g-col g-task">Task / Sub</span><span className="g-col">Start</span><span className="g-col">Finish</span>
      <div className="g-scale">
        <span className="g-today-badge">{day(now)}</span>
        <div className="g-months">{months.map(m => <span key={m.label} style={vars({ gridColumn: `span ${m.span}` })}>{m.span > 1 ? m.label : m.label.slice(0, 3)}</span>)}</div>
        <div className="g-weeks" ref={scale}>{grid.mondays.map((d, i) => <span key={d.getTime()}>{(i === 0 || d.getDate() <= 7) && <span className="g-mon">Mon </span>}{d.getDate()}</span>)}</div>
      </div>
    </div>
    <ol className="g-body" aria-label="Bookings by start date">
      {rows.map(s => {
        const a = grid.at(Date.parse(s.start)), b = grid.at(Date.parse(s.end)), draft = s.status === 'draft'
        return <li key={s.id}><button type="button" className={`g-row${draft ? ' is-draft' : ''}${selected === s.id ? ' is-selected' : ''}${Date.parse(s.end) < now ? ' is-past' : ''}`} aria-pressed={selected === s.id} onClick={() => onSelect(s.id)}>
          <span className="g-task"><strong>{s.description}</strong><span>{s.trade}</span></span>
          <span className="g-date"><span className="g-label">Start </span>{day(s.start)}</span>
          <span className="g-date"><span className="g-label">Finish </span>{day(s.end)}{draft && <em>Needs approval</em>}</span>
          <span className="g-track"><span className="g-bar" style={vars({ '--a': a, '--b': b })} /><span className="g-tick" /></span>
        </button></li>
      })}
      {logs.length > 0 && <li><button type="button" className="g-row g-logs" onClick={onLogs}>
        <span className="g-task"><strong>Daily logs</strong><span>{logs.length} published</span></span>
        <span className="g-date"><span className="g-label">First </span>{calendarDay(logs[0]!.date)}</span>
        <span className="g-date"><span className="g-label">Latest </span>{calendarDay(logs.at(-1)!.date)}</span>
        <span className="g-track">{logs.map(d => <span key={d.id} className="g-diamond" style={vars({ '--a': grid.at(logTime(d)) })} />)}<span className="g-tick" /></span>
      </button></li>}
      <li className="g-today" aria-hidden="true" />
    </ol>
    <ul className="legend" aria-label="Legend">
      <li><i className="swatch" />Booked</li>
      <li><i className="swatch is-draft" />Draft, needs approval</li>
      {logs.length > 0 && <li><i className="diamond" />Daily log</li>}
      <li><i className="today-key" />Today ({day(now)})</li>
    </ul>
  </div>
}
