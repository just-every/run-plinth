import { ScheduleConstraints } from './schedule-constraints'
import { useEffect, useRef, useState } from 'react'
import type { Schedule as Booking } from '../plinth/model'
import { defaultCalendar, type SchedulePreview, type WorkingCalendar } from '../plinth/schedule-model'
import { ScheduleTemplates, type TemplatePreviewInput } from './schedule-templates'
import { ScheduleBaselines } from './schedule-baselines'
import { CalendarSubscription } from './calendar'
import { BookingChanges } from './booking-changes'
import { Action, Badge, clientName, dateTime, money } from './shared'
import { Icon } from './icons'
import { Gantt, weeks } from './gantt'
import { JobLog } from './history'
import { DecisionStrip } from './decisions'
import { CalendarEditor, TaskEditor, type TaskInput } from './schedule-editor'
import { ScheduleCalendar, ScheduleList, scheduleDate, scheduleInstant, TaskDetails } from './schedule-views'
import { ScheduleReview } from './schedule-review'
import type { JobProps } from './job'

/** Published dates stay visible until the server produces a reviewed proposal. */
export function Schedule(props: JobProps) {
  const { job, manager, mutate, go } = props
  const [now] = useState(() => Date.now())
  const [tasks, setTasks] = useState<TaskInput[]>(job.schedules)
  const [calendar, setCalendar] = useState<WorkingCalendar>(job.schedule_calendar ?? defaultCalendar)
  const [preview, setPreview] = useState<SchedulePreview>()
  const [templateInput, setTemplateInput] = useState<TemplatePreviewInput>()
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState<'Gantt' | 'Calendar' | 'List'>('Gantt')
  const [picked, setPicked] = useState<string>()
  const [editor, setEditor] = useState<string | 'new'>()
  const generation = useRef(0)
  useEffect(() => { generation.current++; setTasks(job.schedules); setCalendar(job.schedule_calendar ?? defaultCalendar); setPreview(undefined); setTemplateInput(undefined); setDirty(false); setEditor(undefined) }, [job.id, job.version])
  useEffect(() => { if (editor && window.innerWidth < 1240) document.getElementById('booking-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [editor])
  const shown = preview?.tasks ?? job.schedules
  const critical = preview?.critical_path ?? job.schedule_critical_path ?? []
  const logs = job.diary.filter(d => d.status === 'published').sort((a, b) => a.date.localeCompare(b.date))
  const selected = shown.find(s => s.id === picked) ?? shown.find(s => s.status === 'draft') ?? [...shown].sort((a, b) => a.start.localeCompare(b.start)).find(s => Date.parse(s.end) >= now) ?? shown[0]
  const grid = weeks(shown, logs, now)
  const pick = (id: string) => { setPicked(id); setEditor(undefined); if (window.innerWidth < 1240) document.getElementById('booking-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }
  const stage = (task: TaskInput) => {
    generation.current++
    setTasks(current => current.some(t => t.id === task.id) ? current.map(t => t.id === task.id ? task : t) : [...current, task])
    setPreview(undefined); setTemplateInput(undefined); setDirty(true); setEditor(undefined)
  }
  async function review() {
    const requested = generation.current
    const result = await mutate('/schedule/preview', { calendar, tasks })
    if (generation.current === requested) { setTemplateInput(undefined); setPreview(result.preview) }
  }
  return <div className="split">
    <div className="stack">
      <DecisionStrip job={job} manager={manager} go={go} />
      <section className="card schedule-card" aria-labelledby="schedule-title">
        <div className="card-head"><h2 id="schedule-title">Schedule</h2><p className="range">{scheduleDate(grid.start)} – {scheduleDate(grid.end)}</p><p className="card-meta">{shown.length} tasks · {preview ? 'Proposed dates' : 'Published dates'} · UTC</p></div>
        <nav className="tabs" aria-label="Schedule views">{(['Gantt', 'Calendar', 'List'] as const).map(name => <button type="button" key={name} aria-current={view === name ? 'page' : undefined} onClick={() => setView(name)}>{name}</button>)}</nav>
        {job.status !== 'active' ? <p className="empty">Accept the quote before planning job work.</p>
          : !shown.length && !logs.length ? <p className="empty">No tasks published. Add tasks and milestones, then preview and publish the schedule.</p>
          : view === 'Gantt' ? <Gantt schedules={shown} logs={logs} now={now} critical={critical} selected={selected?.id} onSelect={pick} onLogs={() => go('Daily logs')} />
          : view === 'Calendar' ? <ScheduleCalendar key={preview?.digest ?? job.version} tasks={shown} critical={critical} select={pick} />
          : <ScheduleList tasks={shown} critical={critical} select={pick} />}
      </section>
      {manager && job.status === 'active' && <>
        <section className="card"><h3>Plan tasks and milestones</h3>
          <p>Assign responsible people, connect predecessors and review the effect on the client’s completion date. Working times and lag use UTC.</p>
          {dirty && !preview && <p role="status">Unreviewed changes are staged. The views above still show the published schedule.</p>}
          <div className="button-row"><button type="button" className="secondary" onClick={() => setEditor('new')}>Add task or milestone</button><Action className="secondary" action={review}>Preview schedule</Action>{dirty && <button type="button" className="secondary" onClick={() => { generation.current++; setTasks(job.schedules); setCalendar(job.schedule_calendar ?? defaultCalendar); setPreview(undefined); setTemplateInput(undefined); setDirty(false); setEditor(undefined) }}>Discard staged changes</button>}</div>
          {!!tasks.length && <ul className="rows" aria-label="Tasks in schedule plan">{tasks.map(task => <li className="row" key={task.id}><div className="row-main"><span><button type="button" className="link-button" onClick={() => setEditor(task.id)}>{task.description}</button></span><span>{task.owner ?? task.trade}{task.milestone && ' · Milestone'}{task.status === 'cancelled' && ' · Cancelled'}</span></div></li>)}</ul>}
        </section>
        <CalendarEditor calendar={calendar} save={next => { generation.current++; setCalendar(next); setPreview(undefined); setTemplateInput(undefined); setDirty(true) }} />
        {preview && <ScheduleReview preview={preview} requiresRevision={!!job.schedule_baselines?.length} publish={async revision => { await mutate(templateInput ? '/schedule-template/apply' : '/schedule/publish', { ...(templateInput ?? { calendar, tasks }), digest: preview.digest, ...revision }) }} discard={() => { setTemplateInput(undefined); setPreview(undefined) }} />}
        <ScheduleTemplates job={job} mutate={mutate} onPreview={(proposal, input) => { generation.current++; setPreview(proposal); setTemplateInput(input); setDirty(false) }} />
      </>}
      {manager && job.status === 'active' && <ScheduleConstraints job={job} mutate={mutate} />}
      <ScheduleBaselines job={job} mutate={mutate} manager={manager} forecast={preview?.tasks} />
      <JobLog job={job} go={go} limit={4} />
      <CalendarSubscription mutate={mutate} />
    </div>
    {manager && editor ? <aside className="card side booking-panel" id="booking-panel" aria-label="Schedule task editor"><TaskEditor key={editor} task={editor === 'new' ? undefined : tasks.find(t => t.id === editor)} tasks={tasks} save={stage} close={() => setEditor(undefined)} /></aside>
      : selected && <BookingPanel {...props} booking={selected} tasks={shown} critical={critical.includes(selected.id)} onPick={pick} edit={() => setEditor(selected.id)} />}
  </div>
}

function BookingPanel({ job, manager, go, booking, tasks, critical, onPick, edit }: JobProps & { booking: Booking; tasks: Booking[]; critical: boolean; onPick: (id: string) => void; edit: () => void }) {
  const draft = booking.status === 'draft', cancelled = booking.status === 'cancelled'
  const approval = job.approvals.find(a => a.kind === 'schedule' && a.subject_id === booking.id)
  const trades = [...new Map(tasks.map(s => [s.trade.toLowerCase(), s])).values()]
  const changes = job.variations.filter(v => v.status === 'draft')
  return <aside className="card side booking-panel" id="booking-panel" aria-label="Selected booking">
    <h2>{booking.description}</h2>
    <div className={`side-status${draft ? ' is-late' : ''}`}><Icon name={draft ? 'spark' : 'hammer'} /><div><p><strong>{draft ? `Draft from ${booking.prepared_by.name}` : cancelled ? 'Cancelled' : booking.milestone ? 'Milestone' : `Booked with ${booking.trade}`}</strong></p><TaskDetails task={booking} tasks={tasks} critical={critical} /></div></div>
    <dl className="facts"><div><dt>Starts</dt><dd>{scheduleInstant(booking.start)}</dd></div><div><dt>Ends</dt><dd>{scheduleInstant(booking.end)}</dd></div><div><dt>Prepared</dt><dd>{booking.prepared_by.name} · {dateTime(booking.prepared_by.at)}</dd></div>{approval && <div><dt>Approved</dt><dd>{approval.approved_by.name} · {dateTime(approval.approved_by.at)}</dd></div>}</dl>
    {manager && !cancelled && <BookingChanges booking={booking} edit={edit} />}
    <section className="side-section"><h3>Trades on this job</h3><ul className="trades">{trades.map(s => { const all = tasks.filter(x => x.trade.toLowerCase() === s.trade.toLowerCase()), open = all.some(x => x.status === 'draft'); return <li key={s.id}><button type="button" onClick={() => onPick((all.find(x => x.status === 'draft') ?? all[0]!).id)}><Icon name={open ? 'clock' : 'check'} className={`state-icon${open ? ' is-open' : ''}`} /><span>{s.trade}</span><Badge status={open ? 'draft' : 'booked'}>{open ? 'Draft' : all.every(x => x.status === 'cancelled') ? 'Cancelled' : `${all.filter(x => x.status === 'booked').length} booked`}</Badge><Icon name="chevron" className="chev" /></button></li> })}</ul></section>
    <section className="side-section"><h3>{manager ? `Waiting on ${clientName(job)}` : 'Waiting on you'}</h3>{changes.length === 0 ? <p className="muted">No change orders waiting on the client.</p> : <ul className="waiting">{changes.map(v => <li key={v.id}><button type="button" onClick={() => go('Changes')}><span>{v.description}</span><strong>{money(v.amount_cents)}</strong></button></li>)}</ul>}</section>
  </aside>
}
