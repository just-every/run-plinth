import { FollowupSettings } from './followup-rules'
import { PlanInbox } from './plans'
import { SatisfactionReport } from './satisfaction'
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
import { api, Field, Form, ReadState } from './shared'
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
  const [loading, setLoading] = useState(true), [searching, setSearching] = useState(false), [searchError, setSearchError] = useState(''), [searchAttempt, setSearchAttempt] = useState(0)
  const [totals, setTotals] = useState<CurrencyTotal[]>([])
  const [matches, setMatches] = useState<Job[]>([])
  async function refresh() {
    setLoading(true); setError('')
    try { const result = await api('/jobs'); setJobs(result.jobs); setTotals(result.currency_totals ?? []); setRole(result.role); setRoleName(result.role_name ?? ''); setReady(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read jobs.'); throw cause }
    finally { setLoading(false) }
  }
  useEffect(() => { const params=new URLSearchParams(window.location.search);if(params.get('view')==='plans')setView('plans'); const job = params.get('job'); if (job) setSelected(job); refresh().catch(e => setError(e.message)); api('/auth/session').then(s => setMe(s.operator)).catch(() => {}) }, [])
  // The open job is in the address (?job=…&tab=…), so a reload or a shared link reopens it.
  useEffect(() => { if (!ready) return; const url = new URL(window.location.href); if (selected) url.searchParams.set('job', selected); else { url.searchParams.delete('job'); url.searchParams.delete('tab') } window.history.replaceState(null, '', url) }, [selected, ready])
  const manager = role === 'owner' || role === 'admin' || role === 'manager'
  const go = (to: View) => { const url=new URL(window.location.href);for(const key of ['plan_job','plan_set','plan_sheet'])url.searchParams.delete(key);if(to==='plans')url.searchParams.set('view','plans');else url.searchParams.delete('view');window.history.replaceState(null,'',url);setView(to); setSelected(''); setMenu(false); if (to === 'jobs') void refresh().catch(() => {}) }
  const open = (id: string) => { const url = new URL(window.location.href);for(const key of ['view','plan_job','plan_set','plan_sheet'])url.searchParams.delete(key); url.searchParams.delete('tab'); window.history.replaceState(null, '', url); setView('jobs'); setSelected(id); setMenu(false); setQuery('') }
  const words = query.trim()
  useEffect(() => {
    if (!words) { setSearching(false); setSearchError(''); return }
    let current = true
    setSearching(true); setSearchError('')
    const timer = setTimeout(() => api('/search?q=' + encodeURIComponent(words)).then(result => { if (current) setMatches(result.results.map((result: { job: Job }) => result.job)) }).catch(e => { if (current) setSearchError(e.message) }).finally(() => { if (current) setSearching(false) }), 200)
    return () => { current = false; clearTimeout(timer) }
  }, [words, searchAttempt])
  useEffect(() => {
    // Typing in global search opens Jobs while the search field keeps keyboard focus.
    if (ready && !selected && document.activeElement?.id !== 'job-search') document.querySelector<HTMLElement>('main h1')?.focus()
  }, [view, selected, ready])
  useEffect(() => {
    if (!menu) return
    const previous = document.activeElement as HTMLElement | null, rail = document.querySelector<HTMLElement>('.rail')
    rail?.querySelector<HTMLButtonElement>('.rail-close')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenu(false) }
      if (event.key !== 'Tab' || !rail) return
      const controls = [...rail.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')].filter(element => element.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus() }
  }, [menu])
  const shown = words ? matches : jobs
  if (!ready) return <div className="workspace is-loading"><ReadState label="Opening workspace" loading={loading} error={error} retry={refresh}/></div>
  return <div className="workspace">
    <Rail view={view} role={role} roleName={roleName} me={me} jobs={jobs} selected={selected} open={menu} onView={go} onJob={open} onClose={() => setMenu(false)} />
    {menu && <div className="scrim" onClick={() => setMenu(false)} />}
    <a className="skip-link" href="#workspace-content">Skip to workspace content</a>
    <div className="main-col" inert={menu}>
      <TopBar query={query} manager={manager} onMenu={() => setMenu(true)} onQuery={value => { setQuery(value); if (value) { setView('jobs'); setSelected('') } }} onNew={() => { go('jobs'); setTimeout(() => { create.current?.scrollIntoView({ block: 'center' }); create.current?.querySelector('input')?.focus() }) }} />
      <main className="content" id="workspace-content" tabIndex={-1}>
        {(error || loading) && <ReadState label="Refreshing jobs" loading={loading} error={error} retry={refresh}/>}
        {words && <ReadState label="Searching jobs" loading={searching} error={searchError} retry={async () => { setSearchAttempt(value => value + 1) }}/>}
        {view === 'plans' && <PlanInbox/>}
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
        {view === 'people' && <Page title="People & access" lead="Invite a client using the email on their job. Clients see only their jobs and approve their own change orders. Administrators manage company records and every job; the owner can narrow one to a project manager for assigned jobs."><section className="card narrow"><h2>Send an invitation</h2><Form submit="Send invitation" action={async f => { await api('/auth/invite', {email:f.get('email'),displayName:f.get('displayName'),role:f.get('role'),returnTo:'/app'}) }}><div className="fields"><Field name="displayName" label="Full name" /><Field name="email" type="email" label="Email" /><label>Access<select name="role"><option value="member">Client</option>{role === 'owner' && <option value="admin">Administrator</option>}</select></label></div></Form></section>{role === 'owner' && <TeamRoles jobs={jobs} />}{manager && <CompanySetup />}{role === 'owner' && <><Connections jobs={jobs} /><ReportSettings jobs={jobs}/><section className="card"><details><summary>Settings</summary><FollowupSettings jobs={jobs}/></details></section></>}</Page>}
        {view === 'jobs' && !selected && ['owner','admin','project_manager','reader','client'].includes(role) && <ReportDownloads/>}
        {view === 'jobs' && !selected && ['owner','admin','project_manager'].includes(role) && <><Reports role={role} /><SatisfactionReport/></>}
        {view === 'jobs' && (selected ? <JobWorkspace id={selected} role={role} onBack={() => go('jobs')} onChange={refresh} /> : words && (searching || searchError) ? null : <Jobs jobs={shown} totals={totals} all={jobs.length} query={query} manager={manager} role={role} create={create} onOpen={open} onCreated={refresh} />)}
      </main>
    </div>
  </div>
}
