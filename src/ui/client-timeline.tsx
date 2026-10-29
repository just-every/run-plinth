import { useEffect, useRef, useState } from 'react'
import type { TimelinePage } from '../plinth/client-timeline'
import { api, ReadState } from './shared'

export function ClientTimeline({ jobId }: { jobId: string }) {
 const initial = new URLSearchParams(window.location.search).get('source') ?? ''
 const [query, setQuery] = useState(''), [source, setSource] = useState(initial), [page, setPage] = useState<TimelinePage>(), [error, setError] = useState(''), [loading, setLoading] = useState(false)
 const generation = useRef(0)
 async function read(cursor?: string, term = query, record = source) {
  const current = ++generation.current
  setLoading(true); setError(''); setPage(undefined)
  try {
   const params = new URLSearchParams({ q: term, source: record, ...(cursor ? { cursor } : {}) })
   const result = await api(`/jobs/${jobId}/client-timeline?${params}`)
   if (current === generation.current) setPage(result)
  } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Could not read the timeline.') }
  finally { if (current === generation.current) setLoading(false) }
 }
 useEffect(() => { read(); return () => { generation.current++ } }, [jobId])
 return <section className="panel" aria-label="Client timeline">
  <h2>Job timeline</h2>
  <p>Published work, decisions, issued invoices and messages addressed to you.</p>
  <form className="form-grid" onSubmit={event => { event.preventDefault(); read() }}>
   <label>Search timeline<input value={query} maxLength={200} onChange={event => setQuery(event.target.value)}/></label>
   <button type="submit" disabled={loading}>Search timeline</button>
   {(source || query) && <button type="button" onClick={() => { setSource(''); setQuery(''); const url = new URL(window.location.href); url.searchParams.delete('source'); window.history.replaceState(null, '', url); read(undefined, '', '') }}>Show all records</button>}
  </form>
  {!page ? <ReadState label="Reading timeline" loading={loading} error={error} retry={() => read()}/> : <>
   <p role="status">{page.count} {page.count === 1 ? 'record' : 'records'} found</p>
   {page.items.length === 0 && <p>No matching records are available for your access.</p>}
   <div className="timeline-records">{page.items.map(item => <article className="record" key={item.source}>
    <h3><a href={item.href}>{item.title}</a></h3>
    <p>{item.date_label}: <time dateTime={item.date}>{item.date}</time> · {item.status}</p>
    {item.text && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</p>}
    <p><a href={item.source_href}>Open source section</a></p>
    {item.files.length > 0 && <ul>{item.files.map(file => <li key={file.href}><a href={file.href}>{file.name}</a></li>)}</ul>}
   </article>)}</div>
   {page.next_cursor && <button type="button" onClick={() => read(page.next_cursor!)}>Next records</button>}
  </>}
 </section>
}
