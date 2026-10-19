import type { Approval } from '../plinth/model'
import { api, Action, dateTime, day, time } from './shared'
import type { JobProps } from './job'

const kinds: Record<string, string> = { 'schedule.publish': 'published reviewed schedule dates', 'schedule.baseline': 'approved a schedule baseline', 'schedule.revision': 'approved a named schedule revision', 'schedule.template': 'applied an approved schedule template', 'client.contacts': 'updated authorized job contacts', quote: 'recorded the client’s quote acceptance', schedule: 'approved a trade booking', 'schedule.move': 'approved new booking dates', 'schedule.cancel': 'cancelled a trade booking', diary: 'published a daily log', variation: 'approved a change order', purchase_order: 'issued a purchase order', receipt: 'recorded a supplier receipt', claim: 'approved a pay app' }
const subject = (a: Approval) => { const s = a.snapshot as Record<string, any>; return s?.after?.description ?? s?.description ?? s?.trade ?? s?.supplier ?? s?.reference ?? (s?.revision ? `Quote ${s.revision}` : '') }
/** Newest first by the time of the decision, not by when the record was stored. */
export const newest = (approvals: Approval[]) => [...approvals].sort((a, b) => b.approved_by.at.localeCompare(a.approved_by.at))
export const logLine = (a: Approval) => { const carried = (a.snapshot as Record<string, any>)?.carried_over; return carried ? `Change order carried over, ${carried}` : `${a.approved_by.name} ${kinds[a.kind] ?? a.kind.replaceAll('_', ' ') + ' approved'}` }

/** The latest approvals, newest first: the job's own worklog. */
export function JobLog({ job, go, limit }: Pick<JobProps, 'job' | 'go'> & { limit: number }) {
  const rows = newest(job.approvals).slice(0, limit)
  return <section className="card job-log"><div className="card-head"><h3>Job log</h3><button className="link-button" onClick={() => go('History')}>All history</button></div>
    {rows.length === 0 ? <p className="muted">No approvals yet.</p> : <ol className="log">{rows.map(a => <li key={a.id}><time dateTime={a.approved_by.at}>{day(a.approved_by.at)}, {time(a.approved_by.at)}</time><span>{logLine(a)}{subject(a) && <> · {subject(a)}</>}</span></li>)}</ol>}
  </section>
}

export function History({ job, role, onErased }: JobProps & { onErased: () => void }) {
  return <div className="split">
    <section className="card"><div className="card-head"><h2>Approval history</h2><span className="muted">{job.approvals.length} {job.approvals.length === 1 ? 'approval' : 'approvals'}</span></div><p className="card-lead">Each approval records the prepared version, the person and the decision.</p>
      {job.approvals.length === 0 && <p className="empty">No approvals yet.</p>}
      <ol className="rows">{newest(job.approvals).map(a => <li className="row" key={a.id}><div className="row-main"><strong>{logLine(a)}</strong>{subject(a) && <span className="muted">{subject(a)}</span>}<span className="muted">{dateTime(a.approved_by.at)} · prepared by {a.prepared_by.name} · revision {a.revision}</span><details><summary>Approved record</summary><pre>{JSON.stringify(a.snapshot, null, 2)}</pre></details></div></li>)}</ol>
    </section>
    {role === 'owner' && <aside className="card side danger-zone"><details><summary>Erase this job</summary><p>Permanently removes the job, photos and imported source custody. Export your records first if retention is required. Later erasure journals prevent restoring older archives.</p><Action className="danger-button" action={async () => { if (!window.confirm('Permanently erase this job and its photos?')) return; await api('/jobs/' + job.id, { expected_version: job.version }, 'DELETE'); onErased() }}>Erase job permanently</Action></details></aside>}
  </div>
}
