import { useEffect, useState } from 'react'
import { api, dateTime, Field, Form } from './shared'
import { Page } from './shell'

type Event = { seq: number; at: string; kind: string; action: string; actor_name: string; actor_role: string; source: string; subject_id: string | null; job_id: string | null; version_before: number | null; version_after: number | null; before_ref: string | null; after_ref: string | null }
const kinds = ['financial', 'permission', 'export', 'send', 'import', 'automation', 'record', 'hold', 'erasure']
/** ROLE-005: search and export the append-only history (owners and administrators). Rows are references only; they hold no record content. */
export function Audit() {
 const [filter, setFilter] = useState(''), [events, setEvents] = useState<Event[]>([]), [next, setNext] = useState<string | null>(null), [error, setError] = useState('')
 const load = async (query: string, more?: string) => { try { const r = await api('/audit?' + query + (more ? '&before=' + more : '')); setEvents(old => more ? [...old, ...r.events] : r.events); setNext(r.next); setError('') } catch (e) { setError((e as Error).message) } }
 useEffect(() => { load(filter) }, [filter])
 const ref = (value: string | null) => value ? value.slice(0, 10) : '—'
 return <Page title="Audit history" lead="Every financial change, permission change, export, send, import and automated action, with who did it, how, and the record version before and after. Entries are never edited, and they remain after a job is erased.">
  <section className="card"><Form reset={false} submit="Search history" action={async f => { const p = new URLSearchParams(); for (const key of ['q', 'kind', 'from', 'to', 'job_id']) if (f.get(key)) p.set(key, String(f.get(key))); setFilter(p.toString()) }}>
   <div className="fields"><Field label="Search" name="q" required={false} /><label>Kind<select name="kind"><option value="">Any kind</option>{kinds.map(k => <option key={k}>{k}</option>)}</select></label><Field label="From" name="from" type="date" required={false} /><Field label="To" name="to" type="date" required={false} /><Field label="Job id" name="job_id" required={false} /></div>
  </Form>
  <p><a href={`/api/plinth/audit/export.csv?${filter}`}>Export matching events as CSV</a> · <a href={`/api/plinth/audit/export.json?${filter}`}>Export matching events as JSON</a></p>
  {error && <p role="alert">{error}</p>}
  {events.length === 0 && !error ? <p className="empty">No events match.</p> : <div className="table-scroll"><table className="lines"><thead><tr><th scope="col">When</th><th scope="col">Event</th><th scope="col">By</th><th scope="col">Record</th><th scope="col">Version</th></tr></thead><tbody>{events.map(e => <tr key={e.seq}><td>{dateTime(e.at)}</td><td><strong>{e.action}</strong><p className="muted">{e.kind}</p></td><td>{e.actor_name}<p className="muted">{e.actor_role} · {e.source}</p></td><td>{e.job_id ? <span className="muted">job {e.job_id.slice(0, 8)}</span> : '—'}{e.subject_id && <p className="muted">{e.subject_id.slice(0, 8)}</p>}</td><td>{e.version_before ?? '—'} → {e.version_after ?? '—'}<p className="muted" title="Content digest before and after">{ref(e.before_ref)} → {ref(e.after_ref)}</p></td></tr>)}</tbody></table></div>}
  {next && <button className="secondary" onClick={() => load(filter, next)}>Show older events</button>}
  </section></Page>
}
