import { useState } from 'react'
import type { SchedulePreview } from '../plinth/schedule-model'
import { Action, Field } from './shared'
import { scheduleInstant } from './schedule-views'

export function ScheduleReview({ preview, publish, discard, requiresRevision = false }: { preview: SchedulePreview; publish: (revision: {revision_name?: string; reason?: string}) => Promise<unknown>; discard: () => void; requiresRevision?: boolean }) {
  const [name, setName] = useState(''), [reason, setReason] = useState('')
  return <section className="card" aria-labelledby="schedule-review-title"><h3 id="schedule-review-title">Review schedule before publishing</h3>
    <p>The Gantt, calendar and list show these proposed dates. Published dates and calendar subscriptions change when you publish.</p>
    <dl className="facts"><div><dt>Current client completion</dt><dd>{scheduleInstant(preview.completion_before)}</dd></div><div><dt>Proposed client completion</dt><dd>{scheduleInstant(preview.completion_after)}</dd></div><div><dt>Critical path</dt><dd>{preview.critical_path.map(id => preview.tasks.find(task => task.id === id)?.description ?? id).join(' → ') || 'No active tasks'}</dd></div></dl>
    <h4>{preview.changes.length} task changes</h4>
    {!preview.changes.length && <p>No task date or status changes.</p>}
    <ol className="rows">{preview.changes.map(change => <li className="row" key={change.id}><div className="row-main"><strong>{change.description}</strong><span>Before: {change.before ? `${scheduleInstant(change.before.start)} – ${scheduleInstant(change.before.end)} · ${change.before.status}` : 'New task'}</span><span>After: {scheduleInstant(change.after.start)} – {scheduleInstant(change.after.end)} · {change.after.status}</span></div></li>)}</ol>
    <h4>Trade conflicts</h4>
    {preview.conflicts.length ? <><p role="alert">Resolve these conflicts before publishing.</p><ul>{preview.conflicts.map((conflict, i) => <li key={i}>{conflict.trade} · {conflict.job_name} · {scheduleInstant(conflict.start)} – {scheduleInstant(conflict.end)}</li>)}</ul></> : <p>No overlapping trade bookings.</p>}
    {requiresRevision && <div><Field label="Schedule revision name" name="revision_name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} /><label>Schedule revision reason<textarea name="reason" required value={reason} onChange={e => setReason(e.target.value)} /></label></div>}
    <div className="button-row">{!preview.conflicts.length && <Action className="primary" action={() => publish(requiresRevision ? {revision_name:name,reason} : {})}>Publish reviewed schedule</Action>}<button type="button" className="secondary" onClick={discard}>Return to editing</button></div>
  </section>
}
