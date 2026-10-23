import { NewJob } from './new-job'
import { CurrencyTotals } from './company'
import type { CurrencyTotal } from '../plinth/currency-report'
import type { RefObject } from 'react'
import type { Job } from '../plinth/model'
import { Badge, day, money } from './shared'
import { Icon } from './icons'
import { Page } from './shell'
import { contractTotal } from './job'
import { waiting } from './decisions'
import { limited } from './authority'

type Props = { jobs: Job[]; totals: CurrencyTotal[]; all: number; query: string; manager: boolean; role: string; create: RefObject<HTMLElement | null>; onOpen: (id: string) => void; onCreated: () => Promise<void> }

/** Jobs: a create bar, then one card per job with its contract, its schedule span and what waits on you. */
export function Jobs({ jobs, totals, all, query, manager, role, create, onOpen, onCreated }: Props) {
  const active = jobs.filter(j => j.status === 'active').length, decisions = limited(role) ? 0 : jobs.reduce((n, j) => n + waiting(j, manager).filter(w => !w.onClient).length, 0)
  const now = Date.now()
  return <Page title="Jobs" lead="Keep the agreed scope, daily logs and the next pay app together." aside={<ul className="chips" aria-label="Job counts"><li><Icon name="folder" />{active} active</li><li><Icon name="calendar" />{jobs.length - active} quoting</li>{!limited(role) && <li className={decisions ? 'is-late' : undefined}><Icon name="spark" />{decisions} waiting on you</li>}</ul>}>
    {manager && <NewJob create={create} onCreated={onCreated} onOpen={onOpen} />}
    {manager && totals.length > 0 && <CurrencyTotals totals={totals} />}
    {all === 0 ? <section className="card empty-state"><span className="empty-icon" aria-hidden="true"><Icon name="folder" /></span><h2>{manager ? 'Start with an agreed job' : 'No jobs shared yet'}</h2><p>{manager ? 'Create the job, prepare its quote, then record the client’s acceptance.' : 'Your builder must use your sign-in email as the client on the job.'}</p></section>
      : jobs.length === 0 ? <section className="card empty-state"><h2>No jobs match “{query}”</h2><p>Search looks at job names, clients and addresses.</p></section>
      : <ul className="job-grid" aria-label="Jobs">{jobs.map(job => {
        const times = job.schedules.filter(s => s.status === 'booked').flatMap(s => [Date.parse(s.start), Date.parse(s.end)]), first = Math.min(...times), last = Math.max(...times)
        const next = [...job.schedules].filter(s => s.status === 'booked' && Date.parse(s.end) >= now).sort((a, b) => a.start.localeCompare(b.start))[0], mine = limited(role) ? 0 : waiting(job, manager).filter(w => !w.onClient).length
        return <li key={job.id}><button className="job-card" onClick={() => onOpen(job.id)}>
          <span className="job-card-top"><Badge>{job.status}</Badge>{job.currency && job.currency !== 'USD' && <Badge status="historical">{`Historical ${job.currency}`}</Badge>}{mine > 0 && <span className="waiting-chip">{mine} waiting</span>}</span>
          <strong className="job-name">{job.name}</strong>
          <span className="muted">{job.address || 'Site address not entered'}</span>
          {job.client_email && <span className="muted">{job.client_email}</span>}
          <dl className="job-facts">{(!limited(role) || role === 'estimator') && <div><dt>{job.status === 'active' && !limited(role) ? 'Contract' : 'Latest quote'}</dt><dd>{money(job.status === 'active' && !limited(role) ? contractTotal(job) : job.quotes.at(-1)?.total_cents, job.currency)}</dd></div>}<div><dt>Next booking</dt><dd>{next ? `${day(next.start)} · ${next.trade}` : 'None booked'}</dd></div></dl>
          {times.length > 0 && <span className="span-track" aria-label={`Booked ${day(first)} to ${day(last)}`}><span style={{ left: '0%', width: '100%' }} /><i style={{ left: `${Math.min(100, Math.max(0, (now - first) / (last - first || 1) * 100))}%` }} /></span>}
          <span className="open-job">Open job <Icon name="chevron" /></span>
        </button></li>
      })}</ul>}
  </Page>
}
