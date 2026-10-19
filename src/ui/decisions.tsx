import type { Job } from '../plinth/model'
import { calendarDay, clientName, money } from './shared'
import { Icon } from './icons'
import type { Section } from './job'

type Waiting = { label: string; section: Section; agent: boolean; onClient?: boolean }

/** Every draft on the job that someone still has to decide, and who. */
export function waiting(job: Job, manager: boolean): Waiting[] {
  const rows: Waiting[] = []
  const latest = job.quotes.at(-1)
  if (manager) {
    if (job.status === 'quoting' && latest?.status === 'draft') rows.push({ label: `Quote ${latest.revision} needs the client's acceptance recorded`, section: 'Quote', agent: latest.prepared_by.role === 'agent' })
    for (const s of job.schedules.filter(s => s.status === 'draft')) rows.push({ label: `${s.trade}: ${s.description}`, section: 'Schedule', agent: s.prepared_by.role === 'agent' })
    for (const d of job.diary.filter(d => d.status === 'draft')) rows.push({ label: `Daily log for ${calendarDay(d.date)} to publish`, section: 'Daily logs', agent: d.prepared_by.role === 'agent' })
    for (const o of job.orders.filter(o => o.status === 'draft')) rows.push({ label: `PO to ${o.supplier} for ${money(o.amount_cents, job.currency)}`, section: 'Purchasing', agent: o.prepared_by.role === 'agent' })
    for (const c of job.claims.filter(c => c.status === 'draft')) rows.push({ label: `${c.description} for ${money(c.reconciliation.current_cents, job.currency)}`, section: 'Billing', agent: c.prepared_by.role === 'agent' })
    for (const c of job.claims.filter(c => c.status === 'approved')) rows.push({ label: `${c.description}: record its export`, section: 'Billing', agent: false })
  }
  for (const selection of job.selections ?? []) {
    const current = selection.revisions.at(-1)
    if (current && (current.status === 'presented' || manager && current.status === 'draft')) rows.push({ label: `${current.room} ${current.category}: ${current.status === 'draft' ? 'present options' : 'choose and sign'}`, section: 'Selections', agent: current.prepared_by.role === 'agent', onClient: manager && current.status === 'presented' })
  }
  for (const v of job.variations.filter(v => v.status === 'draft')) rows.push({ label: `Change order for ${money(v.amount_cents, job.currency)}`, section: 'Changes', agent: v.prepared_by.role === 'agent', onClient: manager })
  return rows
}

/** The agent strip: what Plinth's agents prepared and what waits on a person. Agents prepare; people approve. */
export function DecisionStrip({ job, manager, go }: { job: Job; manager: boolean; go: (section: Section) => void }) {
  const rows = waiting(job, manager), yours = rows.filter(r => !r.onClient), client = rows.filter(r => r.onClient), drafted = rows.filter(r => r.agent).length
  const lead = drafted
    ? <><strong>Plinth agent:</strong> prepared {drafted === 1 ? '1 draft' : `${drafted} drafts`} on this job; {yours.length === 1 ? '1 needs' : `${yours.length} need`} your approval</>
    : yours.length ? <><strong>Waiting on you:</strong> {yours.length === 1 ? '1 draft needs' : `${yours.length} drafts need`} a decision</> : <><strong>Nothing waiting on you.</strong> {client.length ? `${client.length} client decisions pending.` : 'Every draft on this job is decided.'}</>
  return <section className="agent-strip" aria-label="Decisions">
    <Icon name="spark" className="spark" />
    <div>
      <p>{lead}</p>
      <p className="agent-sub">{yours.length > 0 && <>{yours.map((r, i) => <button key={i} className="strip-link" onClick={() => go(r.section)}>{r.label}</button>)}</>}{client.length > 0 && <span>Waiting on {clientName(job)}: {client.map((r, i) => <button key={i} className="strip-link" onClick={() => go(r.section)}>{r.label}</button>)}</span>}{rows.length === 0 && 'Agents prepare drafts; a person approves each one.'}</p>
    </div>
  </section>
}
