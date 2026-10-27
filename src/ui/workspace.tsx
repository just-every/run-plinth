import {ReportSettings,ReportDownloads} from './report-schedules'
import {SubcontractorRecords} from './subcontractor-records'
import { Todos } from './todos'
import { BidInbox } from './bids'
import { PunchInbox } from './punch'
import { RfiInbox } from './rfis'
import { TradeInbox } from './trade-inbox'
import { Reports } from './reports'
import { useEffect, useRef, useState } from 'react'
import type { Job } from '../plinth/model'
import { api, Field, Form } from './shared'
import { JobWorkspace } from './job'
import { Imports } from './imports'
import { Customers } from './customers'
import { Vendors } from './vendors'
import { Jobs } from './jobs'
import { CompanySetup } from './company'
import { Connections } from './connections'
import { TeamRoles } from './team'
import { Audit } from './audit'
import type { CurrencyTotal } from '../plinth/currency-report'
import { Page, Rail, TopBar, type Me, type View } from './shell'
import './workspace.css'

export function Workspace() {
  const [jobs, setJobs] = useState<Job[]>([]), [role, setRole] = useState(''), [roleName, setRoleName] = useState(''), [me, setMe] = useState<Me>(), [selected, setSelected] = useState(''), [view, setView] = useState<View>('jobs'), [error, setError] = useState(''), [ready, setReady] = useState(false), [query, setQuery] = useState(''), [menu, setMenu] = useState(false)
  const create = useRef<HTMLElement>(null)
  const [totals, setTotals] = useState<CurrencyTotal[]>([])
  const [matches, setMatches] = useState<Job[]>([])
  async function refresh() { const result = await api('/jobs'); setJobs(result.jobs); setTotals(result.currency_totals ?? []); setRole(result.role); setRoleName(result.role_name ?? ''); setReady(true) }
  useEffect(() => { const job = new URLSearchParams(window.location.search).get('job'); if (job) setSelected(job); refresh().catch(e => setError(e.message)); api('/auth/session').then(s => setMe(s.operator)).catch(() => {}) }, [])
  // The open job is in the address (?job=…&tab=…), so a reload or a shared link reopens it.
  useEffect(() => { if (!ready) return; const url = new URL(window.location.href); if (selected) url.searchParams.set('job', selected); else { url.searchParams.delete('job'); url.searchParams.delete('tab') } window.history.replaceState(null, '', url) }, [selected, ready])
  const manager = role === 'owner' || role === 'admin' || role === 'manager'
  const go = (to: View) => { setView(to); setSelected(''); setMenu(false); if (to === 'jobs') refresh() }
  const open = (id: string) => { const url = new URL(window.location.href); url.searchParams.delete('tab'); window.history.replaceState(null, '', url); setView('jobs'); setSelected(id); setMenu(false); setQuery('') }
  const words = query.trim()
  useEffect(() => {
    if (!words) return
    let current = true
    const timer = setTimeout(() => api('/search?q=' + encodeURIComponent(words)).then(result => { if (current) setMatches(result.results.map((result: { job: Job }) => result.job)) }).catch(e => { if (current) { setMatches([]); setError(e.message) } }), 200)
    return () => { current = false; clearTimeout(timer) }
  }, [words])
  const shown = words ? matches : jobs
  if (!ready) return <div className="workspace is-loading">{error ? <p role="alert" className="error">{error}</p> : <p role="status">Opening your workspace…</p>}</div>
  return <div className="workspace">
    <Rail view={view} role={role} roleName={roleName} me={me} jobs={jobs} selected={selected} open={menu} onView={go} onJob={open} onClose={() => setMenu(false)} />
    {menu && <div className="scrim" onClick={() => setMenu(false)} />}
    <div className="main-col">
      <TopBar query={query} manager={manager} onMenu={() => setMenu(true)} onQuery={value => { setQuery(value); if (value) { setView('jobs'); setSelected('') } }} onNew={() => { go('jobs'); setTimeout(() => { create.current?.scrollIntoView({ block: 'center' }); create.current?.querySelector('input')?.focus() }) }} />
      <main className="content">
        {error && <p role="alert" className="error">{error}</p>}
        {view === 'todos' && <Todos jobs={jobs}/>}
        {view === 'subcontractor-records' && <SubcontractorRecords/>}
        {view === 'bids' && <BidInbox/>}
        {view === 'punch' && <PunchInbox/>}
        {view === 'rfis' && <RfiInbox/>}
        {view === 'trade' && <TradeInbox/>}
        {view === 'customers' && manager && <Customers />}
        {view === 'vendors' && manager && <Vendors />}
        {view === 'imports' && <Imports onChange={refresh} />}
        {view === 'audit' && manager && <Audit />}
        {view === 'people' && <Page title="People & access" lead="Invite a client using the email on their job. Clients see only their jobs and approve their own change orders. Administrators manage company records and every job; the owner can narrow one to a project manager for assigned jobs."><section className="card narrow"><h2>Send an invitation</h2><Form submit="Send invitation" action={async f => { await api('/auth/invite', {email:f.get('email'),displayName:f.get('displayName'),role:f.get('role'),returnTo:'/app'}) }}><div className="fields"><Field name="displayName" label="Full name" /><Field name="email" type="email" label="Email" /><label>Access<select name="role"><option value="member">Client</option>{role === 'owner' && <option value="admin">Administrator</option>}</select></label></div></Form></section>{role === 'owner' && <TeamRoles jobs={jobs} />}{manager && <CompanySetup />}{role === 'owner' && <><Connections jobs={jobs} /><ReportSettings jobs={jobs}/></>}</Page>}
        {view === 'jobs' && !selected && ['owner','admin','project_manager','client'].includes(role) && <ReportDownloads/>}
        {view === 'jobs' && !selected && ['owner','admin','project_manager'].includes(role) && <Reports role={role} />}
        {view === 'jobs' && (selected ? <JobWorkspace id={selected} role={role} onBack={() => go('jobs')} onChange={refresh} /> : <Jobs jobs={shown} totals={totals} all={jobs.length} query={query} manager={manager} role={role} create={create} onOpen={open} onCreated={refresh} />)}
      </main>
    </div>
  </div>
}
