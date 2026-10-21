import { useEffect, useState } from 'react'
import type { Job } from '../plinth/model'
import type { PunchForm, PunchIssue } from '../plinth/punch-model'
import { api, Field, Form } from './shared'
import { Page } from './shell'
import { PunchCapture, type PunchSheet } from './punch-capture'
import { PunchFormEditor } from './punch-forms'
import { PunchRecords, type PunchScope } from './punch-records'
interface PunchSource { job_id: string; version: number; name: string; forms: PunchForm[]; issues: PunchIssue[]; scopes: PunchScope[]; sheets: PunchSheet[] }
function PunchPanel({ source, root, role, refresh }: { source: PunchSource; root: string; role: string; refresh: () => Promise<void> }) {
 const [query, setQuery] = useState(''), [status, setStatus] = useState('all'), manager = ['owner', 'admin', 'project_manager'].includes(role), office = ['owner', 'admin'].includes(role), trade = role === 'trade'
 const mutate = async (path: string, value: Record<string, unknown>) => { await api(root + path, { expected_version: source.version, ...value }); await refresh() }
 const shown = source.issues.filter(i => (status !== 'open' || i.status !== 'accepted') && (!query || JSON.stringify([i.title, i.description, i.location, i.sheet, i.assignment, i.answers, i.annotation.note, i.attempts]).toLowerCase().includes(query.toLowerCase())))
 const params = new URLSearchParams({ q: query, status })
 return <div className={manager ? 'split' : ''}><section className="card"><h2>Punch observations</h2><p>Repair evidence stays with every attempt and inspection. Field checklists support qualified human review; they do not certify safety.</p>
  <Form reset={false} submit="Search punch items" action={async f => { setQuery(String(f.get('q') ?? '')); setStatus(String(f.get('status'))) }}><Field label="Search punch items" name="q" required={false}/><label>Item status<select name="status"><option value="all">All items and history</option><option value="open">Open items</option></select></label></Form>
  <p><a href={'/api/plinth' + root + '/export.json?' + params}>Export matching punch JSON</a> · <a href={'/api/plinth' + root + '/export.csv?' + params}>Export matching punch CSV</a></p>
  <PunchRecords issues={shown} scopes={source.scopes} manager={manager} office={office} trade={trade} prefix={'/api/plinth' + root + '/files/'} mutate={mutate}/>
 </section>{manager && <aside className="card side"><h2>Capture a punch observation</h2><PunchCapture forms={source.forms} sheets={source.sheets} mutate={mutate}/><PunchFormEditor forms={source.forms} mutate={mutate}/></aside>}</div>
}
export function PunchWorkspace({ job, role }: { job: Job; role: string }) {
 const [source, setSource] = useState<PunchSource>(), [error, setError] = useState(''), root = `/jobs/${job.id}/punch`
 const refresh = async () => { const data = await api(root); setSource(data); setError('') }
 useEffect(() => { setSource(undefined); refresh().catch(e => setError(e.message)) }, [job.id])
 return <>{error && <p role="alert">{error}</p>}{source ? <PunchPanel source={source} root={root} role={role} refresh={refresh}/> : !error && <p>Loading punch observations…</p>}</>
}
export function PunchInbox() {
 const [sources, setSources] = useState<PunchSource[]>([]), [error, setError] = useState('')
 const refresh = async () => { const data = await api('/punch'); setSources(data.jobs); setError('') }
 useEffect(() => { refresh().catch(e => setError(e.message)) }, [])
 return <Page title="Punch inbox" lead="Only observations assigned to your current released company scope appear here. Submit repair evidence for builder inspection.">{error && <p role="alert">{error}</p>}{!sources.length && !error && <p>No punch assignments for this account.</p>}{sources.map(source => <section key={source.job_id}><h2>{source.name}</h2><PunchPanel source={source} root={'/punch/' + source.job_id} role="trade" refresh={refresh}/></section>)}</Page>
}
