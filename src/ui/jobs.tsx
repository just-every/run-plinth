import type { RefObject } from 'react'
import type { Job } from '../plinth/model'
import { api, Badge, day, Field, Form, money } from './shared'
import { Icon } from './icons'
import { Page } from './shell'
import { contractTotal } from './job'
import { waiting } from './decisions'

type Props = { jobs: Job[]; all: number; query: string; manager: boolean; create: RefObject<HTMLElement | null>; onOpen: (id: string) => void; onCreated: () => Promise<void> }

/** Jobs: a create bar, then one card per job with its contract, its schedule span and what waits on you. */
export function Jobs({ jobs, all, query, manager, create, onOpen, onCreated }: Props) {
  const active = jobs.filter(j => j.status === 'active').length, decisions = jobs.reduce((n, j) => n + waiting(j, manager).filter(w => !w.onClient).length, 0)
  const now = Date.now()
  return <Page title="Jobs" lead="Keep the agreed scope, daily logs and the next pay app together." aside={<ul className="chips" aria-label="Job counts"><li><Icon name="folder" />{active} active</li><li><Icon name="calendar" />{jobs.length - active} quoting</li><li className={decisions ? 'is-late' : undefined}><Icon name="spark" />{decisions} waiting on you</li></ul>}>
    {manager && <section className="card create-job" ref={create} aria-labelledby="create-title"><h2 id="create-title">Create a job</h2><Form submit="Create job" action={async f => { const result = await api('/jobs', {name:f.get('name'),client_email:f.get('email'),address:f.get('address')}); await onCreated(); onOpen(result.job?.id || result.id) }}><div className="fields"><Field name="name" label="Job name" placeholder="Hartley kitchen remodel" maxLength={160} /><Field name="email" label="Client email" type="email" /><Field name="address" label="Site address" required={false} maxLength={300} /></div></Form></section>}
    {all === 0 ? <section className="card empty-state"><span className="empty-icon" aria-hidden="true"><Icon name="folder" /></span><h2>{manager ? 'Start with an agreed job' : 'No jobs shared yet'}</h2><p>{manager ? 'Create the job, prepare its quote, then record the client’s acceptance.' : 'Your builder must use your sign-in email as the client on the job.'}</p></section>
      : jobs.length === 0 ? <section className="card empty-state"><h2>No jobs match “{query}”</h2><p>Search looks at job names, clients and addresses.</p></section>
      : <ul className="job-grid" aria-label="Jobs">{jobs.map(job => {
        const times = job.schedules.flatMap(s => [Date.parse(s.start), Date.parse(s.end)]), first = Math.min(...times), last = Math.max(...times)
        const next = [...job.schedules].filter(s => Date.parse(s.end) >= now).sort((a, b) => a.start.localeCompare(b.start))[0], mine = waiting(job, manager).filter(w => !w.onClient).length
        return <li key={job.id}><button className="job-card" onClick={() => onOpen(job.id)}>
          <span className="job-card-top"><Badge>{job.status}</Badge>{mine > 0 && <span className="waiting-chip">{mine} waiting</span>}</span>
          <strong className="job-name">{job.name}</strong>
          <span className="muted">{job.address || 'Site address not entered'}</span>
          <span className="muted">{job.client_email}</span>
          <dl className="job-facts"><div><dt>{job.status === 'active' ? 'Contract' : 'Latest quote'}</dt><dd>{money(job.status === 'active' ? contractTotal(job) : job.quotes.at(-1)?.total_cents)}</dd></div><div><dt>Next booking</dt><dd>{next ? `${day(next.start)} · ${next.trade}` : 'None booked'}</dd></div></dl>
          {times.length > 0 && <span className="span-track" aria-label={`Booked ${day(first)} to ${day(last)}`}><span style={{ left: '0%', width: '100%' }} /><i style={{ left: `${Math.min(100, Math.max(0, (now - first) / (last - first || 1) * 100))}%` }} /></span>}
          <span className="open-job">Open job <Icon name="chevron" /></span>
        </button></li>
      })}</ul>}
  </Page>
}
