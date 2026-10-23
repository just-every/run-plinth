import { useEffect, useState } from 'react'
import type { Schedule } from '../plinth/model'
import type { TodoView } from '../plinth/todo-model'
import type { JobProps } from './job'
import { Action, api, Badge } from './shared'
import { ProgressForm, type Forecast } from './daily-progress'
import { logging } from './authority'

/** SCH-005: today's assigned work and a rolling look-ahead with the site, contacts, current sheet, prerequisites, materials due and the worker's own checklist items. */
export function DailyWork({ job, role, mutate }: JobProps) {
 const [rows, setRows] = useState<TodoView[]>([]), [email, setEmail] = useState(''), [error, setError] = useState(''), [forecast, setForecast] = useState<Forecast | null>(), [tick, setTick] = useState(0)
 useEffect(() => {
  Promise.all([api(`/jobs/${job.id}/todos?mine=true`), api('/auth/session'), api(`/jobs/${job.id}/forecast`)]).then(([r, session, planned]) => { setRows(r.todos); setEmail(session.operator.email); setForecast(planned.forecast); setError('') }).catch(e => setError(e.message))
 }, [job.id, job.version, tick])
 const zone = job.time_zone ?? 'UTC', dayOf = (value: string | number | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
 const today = dayOf(Date.now()), shift = (n: number) => dayOf(Date.parse(today + 'T12:00:00Z') + n * 86_400_000), tomorrow = shift(1), horizon = shift(7)
 const localTime = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
 const tasks = job.schedules.filter(s => s.status === 'booked' && !s.milestone).sort((a, b) => a.start.localeCompare(b.start))
 const actualOf = (id: string) => job.schedule_actuals?.findLast(a => a.task_id === id)
 const state = (task: Schedule) => { const a = actualOf(task.id); return a?.actual_finish ? 'Finished' : a ? 'Started' : 'Not started' }
 const now = tasks.filter(s => dayOf(s.start) <= today && dayOf(s.end) >= today && state(s) !== 'Finished'), ahead = tasks.filter(s => dayOf(s.start) > today && dayOf(s.start) <= horizon), next = tasks.filter(s => dayOf(s.start) === tomorrow)
 const prerequisites = (task: Schedule) => [
  ...(task.predecessors ?? []).map(p => job.schedules.find(s => s.id === p.id)).filter((s): s is Schedule => !!s).map(s => `Waiting on ${s.description} (${state(s).toLowerCase()})`),
  ...(job.schedule_constraints ?? []).filter(c => c.task_ids.includes(task.id)).map(c => `${c.kind[0]!.toUpperCase() + c.kind.slice(1)}: ${c.title} (${c.events.at(-1)?.action ?? 'requested'})`),
 ]
 const assigned = rows.map(t => ({ ...t, items: t.items.filter(i => i.assignee.email === email && !i.completed) })).filter(t => t.items.length)
 const materials = job.materials_due ?? job.orders.filter(o => o.status === 'issued').map(o => ({ id: o.id, supplier: o.supplier, description: o.description, promised_on: o.promised_on ?? null, received: o.receipts.length > 0 }))
 const canRecord = logging(role)
 const task = (s: Schedule, progress: boolean) => <article className="record" key={s.id}><div className="record-head"><h4>{s.description}</h4><Badge>{state(s)}</Badge></div><p>{s.trade} · {localTime(s.start)} – {localTime(s.end)}</p>
  {prerequisites(s).length > 0 && <ul className="muted">{prerequisites(s).map(p => <li key={p}>{p}</li>)}</ul>}
  {progress && canRecord && <ProgressForm task={s} actual={actualOf(s.id)} mutate={mutate} onForecast={setForecast} />}</article>
 return <div className="split"><section className="card"><h2>My job day</h2><p>{today} · {zone} · {job.name} · {job.address}</p>
  {job.site_contacts && job.site_contacts.length > 0 && <><h3>Site contacts</h3><ul className="rows">{job.site_contacts.map(c => <li className="row" key={c.email}><div className="row-main"><strong>{c.name}</strong><span className="muted">{c.role} · <a href={`mailto:${c.email}`}>{c.email}</a></span></div></li>)}</ul></>}
  <h3>My open and overdue checklist items</h3>{error && <p role="alert">{error}</p>}{!assigned.length && !error && <p>No open checklist items assigned to you on this job.</p>}
  {assigned.map(t => <article className="record" key={t.id}><h4><a href={`/app?job=${job.id}&tab=To-dos#todo-${t.id}`}>{t.title}</a></h4><p>{t.due_at && <>Due {localTime(t.due_at)} · {Date.parse(t.due_at) < Date.now() ? 'Overdue' : 'Open'}</>}</p>
   <ul className="rows">{t.items.map(i => <li className="row" key={i.id}><div className="row-main"><span>{i.title}</span><Action className="secondary" action={async () => { await api(`/jobs/${job.id}/todos/${t.id}/complete`, { expected_revision: t.revision, operation_id: crypto.randomUUID(), item_id: i.id }); setTick(n => n + 1) }}>Mark “{i.title}” done</Action></div></li>)}</ul></article>)}
  <h3>Today’s work</h3>{now.length ? now.map(s => task(s, true)) : <p>No unfinished work is booked today.</p>}
  {forecast && <p className="notice" role="status">Office forecast: project finish {forecast.completion_after ? localTime(forecast.completion_after) : 'not set'}{forecast.completion_before && forecast.completion_before !== forecast.completion_after ? ` (was ${localTime(forecast.completion_before)})` : ' (unchanged)'}.</p>}
  <h3>Tomorrow</h3>{next.length ? next.map(s => task(s, false)) : <p>Nothing starts tomorrow.</p>}
  <h3>Look-ahead, next 7 days</h3>{ahead.length ? ahead.map(s => task(s, false)) : <p>No upcoming published work. Review the schedule before making site commitments.</p>}
  <h3>Materials due</h3>{materials.length ? <ul className="rows">{materials.map(m => <li className="row" key={m.id}><div className="row-main"><strong>{m.supplier}</strong><span>{m.description}</span><span className="muted">{m.received ? 'Delivery received' : m.promised_on ? `Promised ${m.promised_on}` : 'No delivery date promised'}</span></div></li>)}</ul> : <p>No purchase orders are waiting for delivery.</p>}
 </section><aside className="card side"><h2>Current job drawings</h2>{(job.takeoff ?? []).map(s => { const r = s.revisions.at(-1); return r && <p key={s.id}>{s.name} · revision {r.revision} · page {r.page}<br/><a href={`/api/plinth/jobs/${job.id}/takeoff-files/${r.document.id}`}>Download current original</a></p> })}{!job.takeoff?.length && <p>No drawings recorded.</p>}<p>Check published inspection and site holds in the schedule before starting work.</p></aside></div>
}
