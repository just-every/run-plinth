import { useEffect, useState } from 'react'
import type { Job } from '../plinth/model'
import type { TodoLink, TodoView } from '../plinth/todo-model'
import { api } from './shared'

/** Record lists are the existing record screens; show their reverse links without changing those APIs. */
export function LinkedTodos({ job, section }: { job: Job; section: string }) {
 const [rows, setRows] = useState<TodoView[]>([]), [error, setError] = useState('')
 const kind = ({ Schedule: 'schedule', 'Daily logs': 'daily', RFIs: 'rfi', Selections: 'selection', Changes: 'change' } as Record<string, TodoLink['kind']>)[section]
 useEffect(() => {
  if (!kind) return
  api(`/jobs/${job.id}/todos`).then(r => { setRows(r.todos); setError('') }).catch(e => setError(e.message))
 }, [job.id, job.version, kind])
 if (!kind) return null
 const records = kind === 'schedule' ? job.schedules.map(r => ({ id: r.id, name: r.description }))
  : kind === 'daily' ? job.diary.map(r => ({ id: r.id, name: r.date + ' · ' + r.note.slice(0, 80) }))
  : kind === 'rfi' ? (job.rfis ?? []).map(r => ({ id: r.id, name: r.title }))
  : kind === 'selection' ? (job.selections ?? []).map(r => ({ id: r.id, name: r.revisions.at(-1)?.category ?? 'Selection' }))
  : job.variations.map(r => ({ id: r.id, name: r.description }))
 const linked = records.map(record => ({ ...record, todos: rows.filter(t => t.links?.some(l => l.kind === kind && l.id === record.id)) })).filter(r => r.todos.length)
 if (!linked.length && !error) return null
 return <section className="card"><h2>Linked to-dos</h2>{error && <p role="status">{error}</p>}{linked.map(r => <article className="record" key={r.id}><h3>{r.name}</h3>{r.todos.map(t => <p key={t.id}><a href={`/app?job=${job.id}&tab=To-dos#todo-${t.id}`}>{t.title}</a> · {t.items.filter(i => !i.completed).length} open checklist items</p>)}</article>)}</section>
}
