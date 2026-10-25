import { useEffect, useState } from 'react'
import { api, Action, dateTime } from './shared'

type Delivery = { id: string; event_id: string; generation: number; started_at: string; status: string; mode: 'standing' | 'manual'; consent_grant_id: string | null; retry_at: string | null; http_status: number | null }
/** Delivery attempts remain inspectable after the receiver or its standing grant ends. */
export function ConnectionHistory({ id }: { id: string }) {
 const [rows, setRows] = useState<Delivery[]>([]), [next, setNext] = useState<string | null>(null), [ready, setReady] = useState(false), [error, setError] = useState('')
 const load = async (after?: string) => {
  const r = await api(`/connections/${id}/deliveries${after ? '?after=' + encodeURIComponent(after) : ''}`)
  setRows(old => after ? [...old, ...r.deliveries] : r.deliveries); setNext(r.next); setReady(true); setError('')
 }
 useEffect(() => { load().catch(e => setError(e.message)) }, [id])
 return <section className="connection-history" aria-label="Delivery history"><div className="card-head"><h3>Delivery history</h3><Action className="secondary" action={() => load()}>Refresh history</Action></div>
  {error && <p role="alert" className="error">{error}</p>}
  {!ready && !error && <p role="status">Loading delivery history…</p>}
  {ready && !rows.length && <p className="hint">No delivery attempts recorded.</p>}
  {!!rows.length && <ol className="connection-attempts">{rows.map(row => <li key={row.id}><strong>{row.status[0]?.toUpperCase()}{row.status.slice(1)}{row.http_status ? ` · HTTP ${row.http_status}` : ''}</strong><p className="muted">{dateTime(row.started_at)} · {row.mode === 'standing' ? 'Standing grant' : 'Manual consent'} · key generation {row.generation}</p><p>Event <span>{row.event_id}</span></p>{row.consent_grant_id && <p>Grant <span>{row.consent_grant_id}</span></p>}{row.retry_at && <p>Retry scheduled: {dateTime(row.retry_at)}</p>}</li>)}</ol>}
  {next && <Action className="secondary" action={() => load(next)}>Show more attempts</Action>}
 </section>
}
