import { useEffect, useState } from 'react'
import { api, Badge, Field, Form } from './shared'
import { JobWorkspace } from './job'
import { Imports } from './imports'
import './workspace.css'

export function Workspace() {
  const [jobs, setJobs] = useState<any[]>([]), [role, setRole] = useState(''), [selected, setSelected] = useState(''), [view, setView] = useState('jobs'), [error, setError] = useState(''), [ready, setReady] = useState(false)
  async function refresh() { const result = await api('/jobs'); setJobs(result.jobs); setRole(result.role); setReady(true) }
  useEffect(() => { refresh().catch(e => setError(e.message)) }, [])
  const manager = role === 'owner' || role === 'admin' || role === 'manager'
  return <div className="workspace">
    <header className="topbar"><a className="wordmark" href="/app"><img src="/brand/mark.svg" alt="" /><span data-rer-name>Plinth</span></a><span>Building jobs, clearly recorded</span><a href="/auth/settings/identity">Account</a><button className="secondary" onClick={async () => { await api('/auth/signout',{}); window.location.assign('/signin') }}>Sign out</button></header>
    <nav className="main-nav" aria-label="Workspace"><button aria-current={view === 'jobs' ? 'page' : undefined} onClick={() => { setView('jobs'); setSelected(''); refresh() }}>Jobs</button>{manager && <>{role === 'owner' && <button aria-current={view === 'imports' ? 'page' : undefined} onClick={() => setView('imports')}>Move in</button>}<button aria-current={view === 'people' ? 'page' : undefined} onClick={() => setView('people')}>People & access</button></>}</nav>
    {error && <p role="alert" className="error">{error}</p>}
    {!ready && !error && <p role="status">Opening your workspace…</p>}
    {ready && view === 'imports' && <Imports onChange={refresh} />}
    {ready && view === 'people' && <section className="panel people-panel"><h1>People & access</h1><p>Invite a client using the email on their job. Clients see only their jobs and approve their own variations. Managers can prepare job records.</p><Form submit="Send invitation" action={async f => { await api('/auth/invite', {email:f.get('email'),displayName:f.get('displayName'),role:f.get('role'),returnTo:'/app'}) }}><Field name="displayName" label="Full name" /><Field name="email" type="email" label="Email" /><label>Access<select name="role"><option value="member">Client</option>{role === 'owner' && <option value="admin">Project manager</option>}</select></label></Form></section>}
    {ready && view === 'jobs' && (selected ? <JobWorkspace id={selected} role={role} onBack={() => {setSelected(''); refresh()}} onChange={refresh} /> : <>
      <div className="heading jobs-heading"><div><p className="eyebrow">Project workspace</p><h1>Your building jobs</h1><p>Keep the agreed scope, daily record and next claim together.</p></div><span className="badge job-count">{jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}</span></div>
      <div className="dashboard"><section aria-label="Jobs" className="job-list">{jobs.length === 0 && <div className="panel empty-jobs"><span className="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3h8l4 4v14H6zM14 3v5h4" /></svg></span><h2>{manager ? 'Start with an agreed job' : 'No jobs shared yet'}</h2><p>{manager ? 'Create the job, prepare its quote, then record the client’s acceptance.' : 'Your builder must use your sign-in email as the client on the job.'}</p></div>}{jobs.map(job => <button key={job.id} className="job-card" onClick={() => setSelected(job.id)}><Badge>{job.status || 'Draft'}</Badge><h2>{job.name}</h2><p>{job.address || 'Site address not entered'}</p><p className="muted">{job.client_email}</p><span className="open-job">Open job →</span></button>)}</section>
      {manager && <section className="panel"><h2>Create a job</h2><Form submit="Create job" action={async f => { const result = await api('/jobs', {name:f.get('name'),client_email:f.get('email'),address:f.get('address')}); await refresh(); setSelected(result.job?.id || result.id) }}><Field name="name" label="Job name" placeholder="Hartley kitchen remodel" maxLength={160} /><Field name="email" label="Client email" type="email" /><Field name="address" label="Site address" required={false} maxLength={300} /></Form></section>}</div>
    </>)}
    <footer>Plinth · Claim exports are working records for your external books.</footer>
  </div>
}
