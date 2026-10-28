import { FollowupPreferences } from './followup-rules'
import { PlanWorkspace } from './plans'
import { Submittals } from './submittals'
import { Satisfaction } from './satisfaction'
import { Meetings, DecisionSearch } from './meetings'
import { FinancialAccess } from './financial-access'
import {SubcontractorRecords} from './subcontractor-records'
import { DailyWork } from './daily-work'
import { LinkedTodos } from './linked-todos'
import { Todos } from './todos'
import { Bids } from './bids'
import { BidComparisons } from './bid-comparison'
import { Handover } from './handover'
import { PunchWorkspace } from './punch'
import { RfiWorkspace } from './rfis'
import { Products } from './products'
import { Warranties } from './warranties'
import { Correspondence } from './correspondence'
import { Selections } from './selections'
import { useEffect, useState } from 'react'
import type { Job } from '../plinth/model'
import { api, money } from './shared'
import { limited, office } from './authority'
import { Icon } from './icons'
import { DecisionStrip } from './decisions'
import { Quotes, Changes } from './scope'
import { Schedule } from './schedule'
import { DailyLogs } from './site'
import { Orders, Billing } from './money'
import { JobCustomer } from './job-customer'
import { History } from './history'
import { Subcontracts } from './job-subcontracts'

export const sections = ['Quote', 'Plans', 'Schedule', 'Daily logs', 'Changes', 'Selections', 'Purchasing', 'Billing', 'Customer', 'Warranty', 'RFIs', 'Punch', 'Bids', 'Today', 'To-dos', 'Handover', 'Messages', 'Meetings', 'Decision search', 'Financial review', 'History'] as const
export type Section = typeof sections[number]
export type JobProps = { job: Job; manager: boolean; role: string; refresh: () => Promise<void>; mutate: (path: string, body?: Record<string, unknown>) => Promise<any>; go: (section: Section) => void }
export const contractTotal = (job: Job) => (job.quotes.find(q => q.status === 'accepted')?.total_cents || 0) + job.variations.filter(v => v.status === 'approved').reduce((sum, v) => sum + v.amount_cents, 0)

export function JobWorkspace({ id, role, onBack, onChange }: {id: string; role: string; onBack: () => void; onChange: () => Promise<void>}) {
  const [job, setJob] = useState<Job>(), [section, setSection] = useState<Section>(), [error, setError] = useState('')
  const manager = office(role)
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
  const open = section ?? (role === 'bookkeeper' || role === 'reader' ? 'Financial review' : role === 'estimator' ? 'Quote' : limited(role) ? 'Today' : job.status === 'active' ? 'Schedule' : 'Quote')
  const clientSection:Partial<Record<Section,string>>={Quote:'contracts',Schedule:'schedule','Daily logs':'photos',Changes:'changes',Selections:'selections',Billing:'billing','To-dos':'todos',Handover:'handover',Punch:'punch'}
  const roleSections:Record<string,readonly Section[]>={estimator:['Plans','Quote','Bids','To-dos'],superintendent:['Plans','Today','Schedule','Daily logs','Punch','To-dos'],crew:['Plans','Today','Schedule','Daily logs','Punch','To-dos'],bookkeeper:['Financial review'],reader:['Financial review']}
  const sectionAllowed=(s:Section)=>s==='Plans'?role!=='client'&&role!=='bookkeeper'&&role!=='reader':s==='Meetings'?true:s==='Handover'&&role==='client'?(!job.portal_features||job.portal_features.includes('handover')||job.portal_features.includes('warranty')):limited(role)?roleSections[role]!.includes(s):manager||s==='History'||s==='Messages'||s==='Decision search'||!job.portal_features||!!clientSection[s]&&job.portal_features.includes(clientSection[s]!)
  const props: JobProps = { job, manager, role, mutate, refresh, go: setSection }
  const changes = job.variations.filter(v => v.status === 'draft').length
  return <div className="job">
    {['owner','admin','project_manager','client'].includes(role)&&<FollowupPreferences jobId={job.id}/>}
    <header className="job-head">
      <h1>{job.name}</h1>
      <ul className="chips" aria-label="Job facts">
        <li><Icon name="pin" />{job.address || 'Site address not entered'}</li>
        <li><Icon name="money" />{job.status === 'active' ? limited(role)||!job.quotes.some(quote=>quote.status==='accepted')||job.portal_features&&!job.portal_features.includes('contracts')?'Active job':<>Contract {money(contractTotal(job), job.currency)}</> : 'Quote preparation'}</li>
        {job.client_email&&<li><Icon name="mail" />Client {job.client_email}</li>}
      </ul>
      <nav className="tabs" aria-label="Job sections">{sections.filter(s => (!['Customer','Warranty','RFIs','Bids','Today'].includes(s) || manager || limited(role))&&sectionAllowed(s)).map(s => <button key={s} aria-current={open === s ? 'page' : undefined} onClick={() => setSection(s)}>{s}{s === 'Changes' && changes > 0 && <span className="count" aria-label={`${changes} waiting`}>{changes}</span>}</button>)}</nav>
    </header>
    {!sectionAllowed(open)?<p role="alert" className="notice">This feature is not available for your access.</p>:<div className="job-body">
      {open !== 'Schedule' && !limited(role) && <DecisionStrip job={job} manager={manager} go={setSection} />}
      {open === 'Financial review' && <FinancialAccess {...props}/>}
      {open === 'Plans' && <PlanWorkspace jobId={job.id}/>}
      {open === 'Quote' && <Quotes {...props} />}
      {open === 'Schedule' && <Schedule {...props} />}
      {open === 'Daily logs' && <DailyLogs {...props} />}
      {open === 'Changes' && <Changes {...props} />}
      {open === 'Selections' && <Selections {...props} />}
      {open === 'Purchasing' && <>{manager&&<Products job={job} mutate={mutate}/>}<Orders {...props} />{manager&&<Submittals job={job} refresh={refresh}/>}<Subcontracts {...props} />{manager&&<SubcontractorRecords jobId={job.id}/>}</>}
      {open === 'Billing' && <Billing {...props} />}
      {open === 'Customer' && manager && <JobCustomer {...props} />}
      {open === 'RFIs' && manager && <RfiWorkspace {...props}/>}
      {open === 'Warranty' && manager && <Warranties {...props} />}
      {open === 'Punch' && <PunchWorkspace {...props}/>}
      {open === 'Bids' && (manager || role === 'estimator') && <><Bids {...props}/>{manager&&<BidComparisons {...props}/>}</>}
      {open === 'Today' && (manager || limited(role)) && <DailyWork {...props}/>}
      {open === 'To-dos' && <Todos job={job}/>}
      {open === 'Handover' && <>{(!job.portal_features||job.portal_features.includes('handover'))&&<Handover {...props}/>}<Satisfaction {...props}/></>}
      {open === 'Messages' && <Correspondence {...props}/>}
      {open === 'Meetings' && <Meetings {...props}/>}
      {open === 'Decision search' && <DecisionSearch {...props}/>}
      {open === 'History' && <History {...props} onErased={onBack} />}
      {manager && <LinkedTodos job={job} section={open}/>}
    </div>}
  </div>
}
