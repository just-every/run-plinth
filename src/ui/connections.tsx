import { useEffect, useState } from 'react'
import type { Job } from '../plinth/model'
import { api, Action, Field, Form } from './shared'
import { ConnectionDetail, SigningKey } from './connection-detail'
import type { Connection, Credential } from './connection-detail'
import './connections.css'

const eventTypes = ['job.updated', 'financial.updated', 'decision.approved', 'change.approved']

/** Receiver configuration belongs with company setup and is mounted only for the owner. */
export function Connections({ jobs }: { jobs: Job[] }) {
 const [opened, setOpened] = useState(false)
 return <section className="card narrow connections" aria-label="Connections"><details onToggle={e => setOpened(e.currentTarget.open)}><summary>Connections</summary>{opened && <ConnectionSettings jobs={jobs} />}</details></section>
}
function ConnectionSettings({ jobs }: { jobs: Job[] }) {
 const [rows, setRows] = useState<Connection[]>([]), [credentials, setCredentials] = useState<Credential[]>([]), [ready, setReady] = useState(false), [error, setError] = useState(''), [key, setKey] = useState('')
 const load = async () => {
  const [connections, access] = await Promise.all([api('/connections'), api('/agent-credentials')])
  setRows(connections.subscriptions); setCredentials(access.credentials); setReady(true); setError('')
 }
 useEffect(() => { load().catch(e => setError(e.message)) }, [])
 const active = credentials.filter(c => !c.revoked_at && c.expires_at > Date.now())
 return <div className="connection-content">
  <p className="card-lead">Choose which jobs and event references a receiver may receive. A standing grant allows scheduled delivery until its expiry or revocation.</p>
  <Action className="secondary" action={load}>Refresh connections</Action>
  {error && <p className="error" role="alert">{error}</p>}
  {!ready && !error && <p role="status">Loading connections…</p>}
  {key && <SigningKey value={key} dismiss={() => setKey('')} />}
  {ready && <>
   <details className="connection-create" open={rows.length === 0}><summary>Add receiver</summary>
    <Form submit="Create receiver" action={async f => {
     const result = await api('/connections', {credential_id: f.get('credential_id'), receiver: f.get('receiver'), job_ids: f.getAll('job_ids'), event_types: f.getAll('event_types'), confirm: f.get('confirm') === 'on'})
     setKey(result.signing_key); await load()
    }}>
     <Field label="Receiver URL" name="receiver" type="url" placeholder="https://example.com/plinth-events" />
     <p className="hint">Use a configured public HTTPS receiver. Redirects are refused.</p>
     <label>Owner credential<select name="credential_id" required><option value="">Choose a current credential</option>{active.map(c => <option key={c.id} value={c.id}>{c.id.slice(0, 8)} · expires {new Date(c.expires_at).toLocaleString()}</option>)}</select></label>
     <fieldset className="connection-choices"><legend>Jobs</legend>{jobs.map(job => <label key={job.id}><input type="checkbox" name="job_ids" value={job.id} />{job.name}</label>)}</fieldset>
     <fieldset className="connection-choices"><legend>Event types</legend>{eventTypes.map(type => <label key={type}><input type="checkbox" name="event_types" value={type} defaultChecked={type === 'job.updated'} />{type}</label>)}</fieldset>
     <p className="hint">References only: event ID, job ID and version, event type, subject ID and timestamp. No record contents or attachments.</p>
     <label className="connection-check"><input name="confirm" type="checkbox" required />I approve this receiver and the selected reference fields.</label>
    </Form>
   </details>
   <details className="connection-credentials"><summary>Connection credentials</summary><p className="hint">A receiver needs a current owner credential. This creates one valid for 24 hours; its bearer token is not displayed.</p>
    <Action className="secondary" action={async () => { await api('/agent-credentials', {expires_in_seconds: 86400}); await load() }}>Create 24-hour credential</Action>
    <form action="/auth/step-up" method="post"><input type="hidden" name="action" value="credentials:mint" /><input type="hidden" name="returnTo" value="/app" /><p className="hint">If creation asks for fresh identity confirmation, confirm by email, then return here.</p><button className="secondary" type="submit">Confirm identity by email</button></form>
   </details>
   {rows.map(row => <ConnectionDetail key={row.id} row={row} jobs={jobs} credentials={active} refresh={load} />)}
  </>}
 </div>
}
