import type { ReactNode } from 'react'
import { api, initials } from './shared'
import { Icon, type IconName } from './icons'

export type View = 'jobs' | 'imports' | 'people' | 'customers' | 'vendors'
export type Me = { displayName: string; email: string; role: string }
const roles: Record<string, string> = { owner: 'Owner', admin: 'Project manager', client: 'Client', member: 'Client' }

type RailProps = { view: View; role: string; me?: Me; jobs: { id: string; name: string }[]; selected: string; open: boolean; onView: (view: View) => void; onJob: (id: string) => void; onClose: () => void }

/** The left rail: the mark, the workspace's real places, the job switcher and who is signed in. Below 900px it is a drawer. */
export function Rail({ view, role, me, jobs, selected, open, onView, onJob, onClose }: RailProps) {
  const manager = role === 'owner' || role === 'admin' || role === 'manager'
  const item = (to: View, icon: IconName, label: string, badge?: number) => <li><button aria-current={view === to && (to !== 'jobs' || !selected) ? 'page' : undefined} className={view === to ? 'is-active' : undefined} onClick={() => onView(to)}><Icon name={icon} />{label}{badge !== undefined && <span className="rail-count">{badge}</span>}</button></li>
  return <aside className={`rail${open ? ' is-open' : ''}`} aria-label="Workspace">
    <div className="rail-top"><a className="lockup" href="/app"><img src="/brand/mark.svg" alt="" /><span data-rer-name>Plinth</span></a><button className="icon-button rail-close" aria-label="Close menu" onClick={onClose}><Icon name="close" /></button></div>
    <ul className="rail-nav">
      {item('jobs', 'folder', 'Jobs', jobs.length)}
      {role === 'owner' && item('imports', 'upload', 'Move in')}
      {manager && item('customers', 'people', 'Customers')}
      {manager && item('vendors', 'people', 'Subcontractors')}
      {manager && item('people', 'people', 'People & access')}
      <li><a href="/auth/settings/identity"><Icon name="account" />Account</a></li>
    </ul>
    {jobs.length > 0 && <nav className="recent" aria-label="Recent jobs"><p>Recent jobs</p><ul>{jobs.slice(0, 8).map(job => <li key={job.id}><button aria-current={selected === job.id ? 'page' : undefined} onClick={() => onJob(job.id)}>{job.name}</button></li>)}</ul></nav>}
    {me && <div className="profile"><span className="avatar" aria-hidden="true">{initials(me.displayName || me.email)}</span><div><p>{me.displayName || me.email}</p><p className="muted">{roles[role] ?? role}</p></div></div>}
    <button className="signout" onClick={async () => { await api('/auth/signout', {}); window.location.assign('/signin') }}><Icon name="signout" />Sign out</button>
  </aside>
}

export function TopBar({ query, onQuery, onMenu, onNew, manager }: { query: string; onQuery: (value: string) => void; onMenu: () => void; onNew: () => void; manager: boolean }) {
  return <header className="topbar">
    <button className="icon-button menu-button" aria-label="Open menu" onClick={onMenu}><Icon name="menu" /></button>
    <a className="lockup topbar-lockup" href="/app"><img src="/brand/mark.svg" alt="" /><span>Plinth</span></a>
    <label className="search"><Icon name="search" /><span className="visually-hidden">Search jobs</span><input type="search" value={query} onChange={e => onQuery(e.target.value)} placeholder="Search jobs, clients or addresses" /></label>
    <p className="today">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).replace(',', '')}</p>
    {manager && <button className="primary new-job" onClick={onNew}><Icon name="plus" />New job</button>}
  </header>
}

export function Page({ title, lead, aside, children }: { title: string; lead?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return <div className="page"><header className="page-head"><div><h1>{title}</h1>{lead && <p className="page-lead">{lead}</p>}</div>{aside}</header>{children}</div>
}
