import type { JobProps } from './job'
import { Action, Field, Form, money } from './shared'

/** Uses the existing job record/forms; source drafts stay with their approved event. */
export function Continuity({ job, role, mutate, go }: JobProps) {
 if (!job.continuity?.length) return null
 return <details><summary>Sale and change follow-through · {job.continuity.filter(w => w.stage !== 'complete').length} to prepare</summary>
  <p>Each step saves one linked draft. Resume after interruption. Review and approve schedules, orders and progress separately.</p>
  {job.continuity.map(w => <article className="record" key={w.id}>
   <h3>{w.source.kind === 'quote' ? 'Accepted sale' : 'Approved change'} · revision {w.source.revision}</h3>
   <p>Budget revision {job.budgets?.find(b => b.id === w.budget_id)?.revision} · {w.stage === 'complete' ? 'Draft preparation complete' : `Next: ${w.stage}`}</p>
   {w.schedule && <p>Schedule proposal: {w.schedule.calendar_day_impact === null ? 'Date impact needs review' : `${w.schedule.calendar_day_impact} calendar days`} · {w.schedule.reference}. {w.schedule.tasks.length} source tasks retained for review. <button onClick={() => go('Schedule')}>Review schedule</button></p>}
   {w.purchasing && <p>{w.purchasing.label}. <button onClick={() => go('Purchasing')}>Review purchasing</button></p>}
   {w.billing && <><p>Next application adjustment: {money(w.billing.adjustment_cents, job.currency)}. {w.billing.purpose}</p><p>{w.billing.claim_ids.length ? 'Linked to the next prepared application.' : 'Awaiting the next human-prepared application.'} <button onClick={() => go('Billing')}>Review billing</button></p></>}
   {w.stage !== 'complete' && <Action action={() => mutate(`/continuity/${w.id}/resume`)}>Prepare next linked draft</Action>}
   {(w.notices ?? []).map(n => <p key={n.id}>{n.email}: {n.label}</p>)}
   {role === 'owner' && <details><summary>Approve an email notice</summary><p>No notice is sent by draft preparation. Choose a current person with access to this job. One attempt per event and recipient; unknown outcomes require separate reconciliation.</p><Form submit="Approve email notice" action={f => mutate(`/continuity/${w.id}/notify`, { email: f.get('email'), channel: 'email', confirm: f.get('confirm') === 'on' })}><Field label="Current job recipient email" name="email" type="email" /><label><input type="checkbox" name="confirm" required />I approve this recipient and the email channel for this event</label></Form></details>}
  </article>)}
 </details>
}
