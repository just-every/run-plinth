import { useState } from 'react'
import type { SchedulePreview } from '../plinth/schedule-model'
import { Action, Field } from './shared'
import { scheduleInstant } from './schedule-views'

export function ScheduleReview({ preview, publish, discard, requiresRevision = false, zone }: { zone: string; preview: SchedulePreview; publish: (revision: {revision_name?: string; reason?: string}) => Promise<unknown>; discard: () => void; requiresRevision?: boolean }) {
  const [name, setName] = useState(''), [reason, setReason] = useState('')
  return <section className="card" aria-labelledby="schedule-review-title"><h3 id="schedule-review-title">Review schedule before publishing</h3>
    <p>The Gantt, calendar and list show these proposed dates. Published dates and calendar subscriptions change when you publish.</p>
    <dl className="facts"><div><dt>Current client completion</dt><dd>{scheduleInstant(preview.completion_before, zone)}</dd></div><div><dt>Proposed client completion</dt><dd>{scheduleInstant(preview.completion_after, zone)}</dd></div><div><dt>Critical path</dt><dd>{preview.critical_path.map(id => preview.tasks.find(task => task.id === id)?.description ?? id).join(' → ') || 'No active tasks'}</dd></div></dl>
    <h4>{preview.changes.length} task changes</h4>
    {!preview.changes.length && <p>No task date or status changes.</p>}
    <ol className="rows">{preview.changes.map(change => <li className="row" key={change.id}><div className="row-main"><strong>{change.description}</strong><span>Before: {change.before ? `${scheduleInstant(change.before.start, zone)} – ${scheduleInstant(change.before.end, zone)} · ${change.before.status}` : 'New task'}</span><span>After: {scheduleInstant(change.after.start, zone)} – {scheduleInstant(change.after.end, zone)} · {change.after.status}</span></div></li>)}</ol>
    {!!preview.blockers?.length && <><h4>Inspection and site holds</h4><ul role="alert">{preview.blockers.map(b => <li key={b.constraint_id + b.task_id}>{b.task} · {b.title} · {b.status} · {b.accountable}</li>)}</ul><p>Clear the requirements with human evidence before publishing affected work.</p></>}
    <h4>Trade conflicts</h4>
    {preview.conflicts.length ? <><p role="alert">Resolve these conflicts before publishing.</p><ul>{preview.conflicts.map((conflict, i) => <li key={i}>{conflict.trade} · {conflict.job_name} · {scheduleInstant(conflict.start, zone)} – {scheduleInstant(conflict.end, zone)}</li>)}</ul></> : <p>No overlapping trade bookings.</p>}
    {requiresRevision && <div><Field label="Schedule revision name" name="revision_name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} /><label>Schedule revision reason<textarea name="reason" required value={reason} onChange={e => setReason(e.target.value)} /></label></div>}
    <div className="button-row">{!preview.conflicts.length && !preview.blockers?.length && <Action className="primary" action={() => publish(requiresRevision ? {revision_name:name,reason} : {})}>Publish reviewed schedule</Action>}<button type="button" className="secondary" onClick={discard}>Return to editing</button></div>
  </section>
}
