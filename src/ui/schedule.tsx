import { CalendarSubscription } from './calendar'
import { BookingChanges } from './booking-changes'
import { useState } from 'react'
import type { Schedule as Booking } from '../plinth/model'
import { Action, Badge, clientName, day, dateTime, Field, Form, money, time } from './shared'
import { Icon } from './icons'
import { Gantt, weeks } from './gantt'
import { JobLog } from './history'
import { DecisionStrip } from './decisions'
import type { JobProps } from './job'

const workdays = (s: Booking) => { let n = 0; for (let t = new Date(s.start); t <= new Date(s.end); t.setDate(t.getDate() + 1)) if (t.getDay() % 6) n++; return n }

/** The Schedule tab: the chart, the job's log and the booking form under it, and the selected booking beside it. */
export function Schedule(props: JobProps) {
  const { job, manager, mutate, go } = props
  const [now] = useState(() => Date.now())
  const logs = job.diary.filter(d => d.status === 'published').sort((a, b) => a.date.localeCompare(b.date))
  const fallback = job.schedules.find(s => s.status === 'draft') ?? [...job.schedules].sort((a, b) => a.start.localeCompare(b.start)).find(s => Date.parse(s.end) >= now) ?? job.schedules[0]
  const [picked, setPicked] = useState<string>()
  const selected = job.schedules.find(s => s.id === picked) ?? fallback
  const grid = weeks(job.schedules, logs, now), drafts = job.schedules.filter(s => s.status === 'draft').length
  return <div className="split">
    <div className="stack">
      <DecisionStrip job={job} manager={manager} go={go} />
      <section className="card schedule-card" aria-labelledby="schedule-title">
        <div className="card-head"><h2 id="schedule-title">Schedule</h2><p className="range">{day(grid.start)} – {day(grid.end)}, {new Date(grid.end).getFullYear()}</p>
          <p className="card-meta">{job.schedules.length} {job.schedules.length === 1 ? 'booking' : 'bookings'}{drafts > 0 && <> · <span className="late">{drafts} draft</span></>} · overlaps refused across all jobs</p></div>
        {job.status !== 'active' ? <p className="empty">Accept the quote before booking trades. The schedule starts with the first booking.</p>
          : job.schedules.length === 0 && logs.length === 0 ? <p className="empty">No trades booked yet. Book the first trade below; Plinth refuses a trade booked twice at the same time on any job.</p>
          : <Gantt schedules={job.schedules} logs={logs} now={now} selected={selected?.id} onSelect={id => { setPicked(id); if (window.innerWidth < 1240) document.getElementById('booking-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }} onLogs={() => go('Daily logs')} />}
      </section>
      <div className="under">
        <JobLog job={job} go={go} limit={4} />
        {manager && job.status === 'active' && <section className="card book"><h3>Book a trade</h3><Form submit="Book trade" action={async f => mutate('/schedules', { trade: f.get('trade'), start: new Date(String(f.get('start'))).toISOString(), end: new Date(String(f.get('end'))).toISOString(), description: f.get('description') })}><div className="fields"><Field label="Trade or subcontractor" name="trade" placeholder="Halvorsen Roofing" /><Field label="Work to complete" name="description" placeholder="Roof dry-in" /><Field label="Starts (your local time)" name="start" type="datetime-local" /><Field label="Ends (your local time)" name="end" type="datetime-local" /></div></Form></section>}
      </div>
      <CalendarSubscription mutate={mutate} />
    </div>
    {selected && <BookingPanel {...props} booking={selected} onPick={setPicked} />}
  </div>
}

function BookingPanel({ job, manager, mutate, go, booking, onPick }: JobProps & { booking: Booking; onPick: (id: string) => void }) {
  const draft = booking.status === 'draft', cancelled = booking.status === 'cancelled', approval = job.approvals.find(a => a.kind === 'schedule' && a.subject_id === booking.id)
  const trades = [...new Map(job.schedules.map(s => [s.trade.toLowerCase(), s])).values()]
  const changes = job.variations.filter(v => v.status === 'draft')
  return <aside className="card side booking-panel" id="booking-panel" aria-label="Selected booking">
    <h2>{booking.description}</h2>
    <div className={`side-status${draft ? ' is-late' : ''}`}><Icon name={draft ? 'spark' : 'hammer'} /><p><strong>{draft ? `Draft from ${booking.prepared_by.role === 'agent' ? 'Plinth agent' : booking.prepared_by.name}` : cancelled ? `Cancelled · ${booking.trade}` : `Booked with ${booking.trade}`}</strong><span>{draft ? `${booking.trade} · needs your approval` : `${workdays(booking)} working ${workdays(booking) === 1 ? 'day' : 'days'}`}</span></p></div>
    <dl className="facts">
      <div><dt>Starts</dt><dd>{day(booking.start)}, {time(booking.start)}</dd></div>
      <div><dt>Ends</dt><dd>{day(booking.end)}, {time(booking.end)}</dd></div>
      <div><dt>Prepared</dt><dd>{booking.prepared_by.name} · {dateTime(booking.prepared_by.at)}</dd></div>
      {approval && <div><dt>Approved</dt><dd>{approval.approved_by.name} · {dateTime(approval.approved_by.at)}</dd></div>}
    </dl>
    {manager && draft && <div className="side-actions"><Action className="primary" action={() => mutate('/schedules/' + booking.id + '/approve')}>Approve trade booking</Action><p className="hint">Approval checks every job: a trade can’t be booked twice at the same time.</p></div>}
    {manager && booking.status === 'booked' && <BookingChanges booking={booking} mutate={mutate} />}
    <section className="side-section"><h3>Trades on this job</h3><ul className="trades">{trades.map(s => { const all = job.schedules.filter(x => x.trade.toLowerCase() === s.trade.toLowerCase()), open = all.some(x => x.status === 'draft'); return <li key={s.id}><button type="button" onClick={() => onPick((all.find(x => x.status === 'draft') ?? all[0]!).id)}><Icon name={open ? 'clock' : 'check'} className={`state-icon${open ? ' is-open' : ''}`} /><span>{s.trade}</span><Badge status={open ? 'draft' : 'booked'}>{open ? 'Draft' : all.every(x => x.status === 'cancelled') ? 'Cancelled' : `${all.filter(x => x.status === 'booked').length} booked`}</Badge><Icon name="chevron" className="chev" /></button></li> })}</ul></section>
    <section className="side-section"><h3>{manager ? `Waiting on ${clientName(job)}` : 'Waiting on you'}</h3>{changes.length === 0 ? <p className="muted">No change orders waiting on the client.</p> : <ul className="waiting">{changes.map(v => <li key={v.id}><button type="button" onClick={() => go('Changes')}><span>{v.description}</span><strong>{money(v.amount_cents)}</strong></button></li>)}</ul>}</section>
  </aside>
}
