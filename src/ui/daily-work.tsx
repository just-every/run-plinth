import { useEffect, useState } from 'react'
import type { TodoView } from '../plinth/todo-model'
import type { JobProps } from './job'
import { api } from './shared'

/** The current office/assigned-manager field door; ROLE-002 and FIELD-003 retain their broader crew/native obligations. */
export function DailyWork({ job }: JobProps) {
 const [rows, setRows] = useState<TodoView[]>([]), [email, setEmail] = useState(''), [error, setError] = useState('')
 useEffect(() => {
  Promise.all([api(`/jobs/${job.id}/todos?mine=true`), api('/auth/session')]).then(([r, session]) => { setRows(r.todos); setEmail(session.operator.email); setError('') }).catch(e => setError(e.message))
 }, [job.id, job.version])
 const zone = job.time_zone ?? 'UTC', today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
 const localTime = (value:string) => new Intl.DateTimeFormat('en-US',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
 const work = job.schedules.filter(s => s.status === 'booked' && s.end.slice(0, 10) >= today).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 14)
 const assigned = rows.map(t => ({ ...t, items: t.items.filter(i => i.assignee.email === email && !i.completed) })).filter(t => t.items.length)
 return <div className="split"><section className="card"><h2>My job day</h2><p>{today} · {zone} · {job.name} · {job.address}</p><h3>My open and overdue checklist items</h3>{error && <p role="alert">{error}</p>}{!assigned.length && !error && <p>No open checklist items assigned to you on this job.</p>}
 {assigned.map(t => <article className="record" key={t.id}><h4><a href={`/app?job=${job.id}&tab=To-dos#todo-${t.id}`}>{t.title}</a></h4><p>{t.due_at && <>Due {localTime(t.due_at)} · {Date.parse(t.due_at) < Date.now() ? 'Overdue' : 'Open'}</>}</p><ul>{t.items.map(i => <li key={i.id}>{i.title}</li>)}</ul></article>)}
 <h3>Published job work and look-ahead</h3>{work.length ? work.map(s => <article className="record" key={s.id}><h4>{s.description}</h4><p>{s.trade} · {localTime(s.start)} – {localTime(s.end)}</p><a href={`/app?job=${job.id}&tab=Schedule`}>Open approved schedule and dependencies</a></article>) : <p>No upcoming published work. Review the schedule before making site commitments.</p>}
 </section><aside className="card side"><h2>Current job drawings</h2>{(job.takeoff ?? []).map(s => { const r = s.revisions.at(-1); return r && <p key={s.id}>{s.name} · revision {r.revision} · page {r.page}<br/><a href={`/api/plinth/jobs/${job.id}/takeoff-files/${r.document.id}`}>Download current original</a></p> })}{!job.takeoff?.length && <p>No drawings recorded.</p>}<p>Check published inspection and site holds in the schedule before starting work.</p></aside></div>
}
