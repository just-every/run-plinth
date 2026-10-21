import { Handover } from './handover'
import { PunchWorkspace } from './punch'
import { RfiWorkspace } from './rfis'
import { Products } from './products'
import { Warranties } from './warranties'
import { Selections } from './selections'
import { useEffect, useState } from 'react'
import type { Job } from '../plinth/model'
import { api, money } from './shared'
import { Icon } from './icons'
import { DecisionStrip } from './decisions'
import { Quotes, Changes } from './scope'
import { Schedule } from './schedule'
import { DailyLogs } from './site'
import { Orders, Billing } from './money'
import { JobCustomer } from './job-customer'
import { History } from './history'
import { Subcontracts } from './job-subcontracts'

export const sections = ['Quote', 'Schedule', 'Daily logs', 'Changes', 'Selections', 'Purchasing', 'Billing', 'Customer', 'Warranty', 'RFIs', 'Punch', 'Handover', 'History'] as const
export type Section = typeof sections[number]
export type JobProps = { job: Job; manager: boolean; role: string; mutate: (path: string, body?: Record<string, unknown>) => Promise<any>; go: (section: Section) => void }
export const contractTotal = (job: Job) => (job.quotes.find(q => q.status === 'accepted')?.total_cents || 0) + job.variations.filter(v => v.status === 'approved').reduce((sum, v) => sum + v.amount_cents, 0)

export function JobWorkspace({ id, role, onBack, onChange }: {id: string; role: string; onBack: () => void; onChange: () => Promise<void>}) {
  const [job, setJob] = useState<Job>(), [section, setSection] = useState<Section>(), [error, setError] = useState('')
  const manager = ['owner', 'admin', 'project_manager'].includes(role)
  async function refresh() { const result = await api('/jobs/' + id); setJob(result.job) }
  useEffect(() => { const tab = new URLSearchParams(window.location.search).get('tab'); setJob(undefined); setSection(sections.find(s => s === tab)); refresh().catch(e => setError(e.message)) }, [id])
  useEffect(() => { if (!section) return; const url = new URL(window.location.href); url.searchParams.set('tab', section); window.history.replaceState(null, '', url) }, [section])
  async function mutate(path: string, body: Record<string, unknown> = {}) {
    try {
      const result = await api('/jobs/' + id + path, { ...body, expected_version: job?.version })
      if (result.job) setJob(result.job); else await refresh()
      await onChange(); return result
    } catch (e) { await refresh(); throw e }
  }
  if (!job) return <p className="loading" role={error ? 'alert' : 'status'}>{error || 'Opening job…'}</p>
  const open = section ?? (job.status === 'active' ? 'Schedule' : 'Quote')
  const props: JobProps = { job, manager, role, mutate, go: setSection }
  const changes = job.variations.filter(v => v.status === 'draft').length
  return <div className="job">
    <header className="job-head">
      <h1>{job.name}</h1>
      <ul className="chips" aria-label="Job facts">
        <li><Icon name="pin" />{job.address || 'Site address not entered'}</li>
        <li><Icon name="money" />{job.status === 'active' ? <>Contract {money(contractTotal(job), job.currency)}</> : 'Quote preparation'}</li>
        <li><Icon name="mail" />Client {job.client_email}</li>
      </ul>
      <nav className="tabs" aria-label="Job sections">{sections.filter(s => !['Customer','Warranty','RFIs'].includes(s) || manager).map(s => <button key={s} aria-current={open === s ? 'page' : undefined} onClick={() => setSection(s)}>{s}{s === 'Changes' && changes > 0 && <span className="count" aria-label={`${changes} waiting`}>{changes}</span>}</button>)}</nav>
    </header>
    <div className="job-body">
      {open !== 'Schedule' && <DecisionStrip job={job} manager={manager} go={setSection} />}
      {open === 'Quote' && <Quotes {...props} />}
      {open === 'Schedule' && <Schedule {...props} />}
      {open === 'Daily logs' && <DailyLogs {...props} />}
      {open === 'Changes' && <Changes {...props} />}
      {open === 'Selections' && <Selections {...props} />}
      {open === 'Purchasing' && <>{manager&&<Products job={job} mutate={mutate}/>}<Orders {...props} /><Subcontracts {...props} /></>}
      {open === 'Billing' && <Billing {...props} />}
      {open === 'Customer' && manager && <JobCustomer {...props} />}
      {open === 'RFIs' && manager && <RfiWorkspace {...props}/>}
      {open === 'Warranty' && manager && <Warranties {...props} />}
      {open === 'Punch' && <PunchWorkspace {...props}/>}
      {open === 'Handover' && <Handover {...props}/>}
      {open === 'History' && <History {...props} onErased={onBack} />}
    </div>
  </div>
}
