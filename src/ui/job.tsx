import { useEffect, useState } from 'react'
import type { Job } from '../plinth/model'
import { api, Action, Badge, dateTime, money } from './shared'
import { Quotes, Variations } from './scope'
import { SchedulePanel, DiaryPanel } from './site'
import { Orders, Claims } from './money'

export type JobProps = { job: Job; manager: boolean; mutate: (path: string, body?: Record<string, unknown>) => Promise<any> }
const sections = ['Quote', 'Trades', 'Site diary', 'Variations', 'Purchasing', 'Claims', 'History']
export function JobWorkspace({ id, role, onBack, onChange }: {id: string; role: string; onBack: () => void; onChange: () => Promise<void>}) {
  const [job, setJob] = useState<Job>(), [section, setSection] = useState('Quote'), [error, setError] = useState('')
  const manager = ['owner', 'admin', 'manager'].includes(role)
  async function refresh() { const result = await api('/jobs/' + id); setJob(result.job) }
  useEffect(() => { refresh().catch(e => setError(e.message)) }, [id])
  async function mutate(path: string, body: Record<string, unknown> = {}) {
    try {
      const result = await api('/jobs/' + id + path, { ...body, expected_version: job?.version })
      if (result.job) setJob(result.job); else await refresh()
      await onChange(); return result
    } catch (e) { await refresh(); throw e }
  }
  if (!job) return <p role={error ? 'alert' : 'status'}>{error || 'Opening job…'}</p>
  const props = {job, manager, mutate}, quote = job.quotes.find(q => q.status === 'accepted'), total = (quote?.total_cents || 0) + job.variations.filter(v => v.status === 'approved').reduce((sum,v) => sum + v.amount_cents,0)
  return <main className="job-workspace"><button className="text-button" onClick={onBack}>← All jobs</button><div className="heading job-heading"><div><p className="eyebrow"><Badge status={job.status}>{job.status === 'active' ? 'Active job' : 'Quote preparation'}</Badge></p><h1>{job.name}</h1><p>{job.address}</p><p className="muted">Client: {job.client_email}</p></div><div className="total"><span>Approved contract</span><strong>{money(total)}</strong><small>Revision {job.version}</small></div></div>
    <nav className="tabs" aria-label="Job sections">{sections.map(s => <button key={s} aria-current={section === s ? 'page' : undefined} onClick={() => setSection(s)}>{s}</button>)}</nav>
    {section === 'Quote' && <Quotes {...props} />}
    {section === 'Trades' && <SchedulePanel {...props} />}
    {section === 'Site diary' && <DiaryPanel {...props} />}
    {section === 'Variations' && <Variations {...props} />}
    {section === 'Purchasing' && <Orders {...props} />}
    {section === 'Claims' && <Claims {...props} />}
    {section === 'History' && <section className="panel"><h2>Approval history</h2><p>Each approval records the prepared version, the person and the decision.</p>{job.approvals.length === 0 && <p>No approvals yet.</p>}{[...job.approvals].reverse().map(a => <article className="record" key={a.id}><strong>{a.kind.replaceAll('_',' ')} approved</strong><p>{a.approved_by.name} · {dateTime(a.approved_by.at)}</p><p className="muted">Prepared by {a.prepared_by.name} · revision {a.revision}</p><details><summary>Approved record</summary><pre>{JSON.stringify(a.snapshot,null,2)}</pre></details></article>)}{role === 'owner' && <details className="danger"><summary>Erase this job</summary><p>Permanently removes the job, photos and imported source custody. Export your records first if retention is required. Later erasure journals prevent restoring older archives.</p><Action className="danger-button" action={async () => { if (!window.confirm('Permanently erase this job and its photos?')) return; await api('/jobs/' + id, {expected_version:job.version}, 'DELETE'); onBack() }}>Erase job permanently</Action></details>}</section>}
  </main>
}
