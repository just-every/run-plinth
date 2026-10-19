import { useState } from 'react'
import type { Schedule } from '../plinth/model'
import { scheduleVariance, type BaselineJob } from '../plinth/schedule-baseline-model'
import type { JobProps } from './job'
import { Badge, Field } from './shared'
import { ScheduleActualsForm, ScheduleEntryForm } from './schedule-baseline-forms'
import { scheduleInstant } from './schedule-views'

const recordedDate = (value: string | null) => value ? scheduleInstant(value) : 'Not recorded'
const variance = (minutes: number | null) => minutes === null ? 'No baseline comparison' : minutes === 0 ? 'On baseline' : `${Math.abs(minutes)} elapsed minutes ${minutes > 0 ? 'later' : 'earlier'}`

function AuthorizingDecision({ job, approvalId }: { job: BaselineJob; approvalId: string }) {
  const approval = job.approvals.find(row => row.id === approvalId)
  return <details><summary>Authorizing decision</summary><p>Approval reference: {approvalId}</p>{approval && <><p>{approval.approved_by.name} · {scheduleInstant(approval.approved_by.at)} · revision {approval.revision}</p><pre>{JSON.stringify(approval.snapshot, null, 2)}</pre></>}</details>
}

/** Immutable promises remain alongside the current forecast and appended field evidence. */
export function ScheduleBaselines({ job, mutate, manager, forecast }: { job: BaselineJob; mutate: JobProps['mutate']; manager: boolean; forecast?: Schedule[] }) {
  const baselines = job.schedule_baselines ?? [], original = baselines[0]
  const [selectedId, setSelectedId] = useState('')
  const selected = baselines.find(row => row.id === selectedId) ?? original
  const rows = scheduleVariance(job, forecast ?? job.schedules, selected?.id)
  const originalRows = scheduleVariance(job)
  const canBaseline = job.status === 'active' && job.schedules.some(task => task.status === 'booked') && job.schedules.every(task => task.status !== 'draft')
  return <section className="card" aria-labelledby="schedule-baselines-title"><h3 id="schedule-baselines-title">Baselines, forecasts and actual work</h3>
    <p>Keep the original promised dates, human-approved baselines and named schedule revisions beside field evidence. Date comparisons use elapsed UTC minutes.</p>
    {manager && <details><summary>Approve a named schedule baseline</summary>
      <p>This records the currently published dates and working calendar as an immutable promise.</p>
      {!canBaseline && <p>Publish an active schedule and resolve its drafts before approving a baseline.</p>}
      <ScheduleEntryForm submit="Approve schedule baseline" disabled={!canBaseline} action={async f => { await mutate('/schedule-baseline', { name: f.get('name'), reason: f.get('reason') }) }}>
        <Field label="Baseline name" name="name" maxLength={200} />
        <label>Baseline reason<textarea name="reason" required maxLength={4000} rows={2} /></label>
      </ScheduleEntryForm>
    </details>}
    {!original && <p>No approved baseline yet. Current dates and actual evidence remain visible below.</p>}
    {!!baselines.length && <label>Compare with baseline<select aria-label="Compare with baseline" value={selected?.id ?? ''} onChange={e => setSelectedId(e.target.value)}>{baselines.map((baseline, i) => <option key={baseline.id} value={baseline.id}>{baseline.name}{i === 0 ? ' · Original promise' : ''}</option>)}</select></label>}
    <ol className="rows" aria-label="Schedule baseline and actual variance">{rows.map(row => {
      const promised = originalRows.find(task => task.task_id === row.task_id)
      return <li className="row" key={row.task_id}><div className="row-main"><strong>{row.description}</strong>
        <dl className="facts">
          <div><dt>Original promise{original ? ` · ${original.name}` : ''}</dt><dd>{recordedDate(promised?.baseline_start ?? null)} – {recordedDate(promised?.baseline_finish ?? null)}</dd></div>
          <div><dt>Selected baseline{selected ? ` · ${selected.name}` : ''}</dt><dd>{recordedDate(row.baseline_start)} – {recordedDate(row.baseline_finish)}</dd></div>
          <div><dt>Current / forecast</dt><dd>{recordedDate(row.forecast_start)} – {recordedDate(row.forecast_finish)}<br />Start: {variance(row.forecast_start_variance_minutes)}. Finish: {variance(row.forecast_finish_variance_minutes)}.</dd></div>
          <div><dt>Actual work</dt><dd>{recordedDate(row.actual_start)} – {recordedDate(row.actual_finish)}<br />Start: {variance(row.actual_start_variance_minutes)}. Finish: {variance(row.actual_finish_variance_minutes)}.</dd></div>
          {row.evidence && <div><dt>Latest evidence</dt><dd>{row.evidence}{row.recorded_by && <p>{row.recorded_by.name} · {scheduleInstant(row.recorded_by.at)}</p>}</dd></div>}
        </dl>
      </div><div className="row-end"><Badge>{row.status}</Badge></div></li>
    })}</ol>
    {manager && <ScheduleActualsForm job={job} mutate={mutate} />}
    {manager && <p><a href="#schedule-title">Preview the schedule to review forecasts against recorded actual work.</a></p>}
    <details className="side-section"><summary>Approved baseline history</summary>
      {!baselines.length && <p>No baseline decisions recorded.</p>}
      <ol className="rows">{baselines.map((baseline, i) => <li className="row" key={baseline.id}><div className="row-main"><strong>{baseline.name}{i === 0 ? ' · Original promise' : ''}</strong><span>{baseline.reason}</span><span>{baseline.approved_by.name} · {scheduleInstant(baseline.approved_by.at)}</span><AuthorizingDecision job={job} approvalId={baseline.approval_id} /></div><div className="row-end"><Badge>Approved</Badge></div></li>)}</ol>
    </details>
    <details className="side-section"><summary>Named schedule revisions</summary>
      {!job.schedule_revisions?.length && <p>No named revisions recorded. Publishing after a baseline requires a revision name and reason.</p>}
      <ol className="rows">{[...(job.schedule_revisions ?? [])].reverse().map(revision => <li className="row" key={revision.id}><div className="row-main"><strong>{revision.name}</strong><span>{revision.reason}</span><span>{revision.approved_by.name} · {scheduleInstant(revision.approved_by.at)}</span><span>Baseline: {baselines.find(baseline => baseline.id === revision.baseline_id)?.name ?? 'Before first baseline'}</span><AuthorizingDecision job={job} approvalId={revision.approval_id} /></div><div className="row-end"><Badge>Approved</Badge></div></li>)}</ol>
    </details>
    {manager && <details className="side-section"><summary>Actual work evidence history</summary>
      {!job.schedule_actuals?.length && <p>No actual work evidence recorded.</p>}
      <ol className="rows">{[...(job.schedule_actuals ?? [])].reverse().map(actual => <li className="row" key={actual.id}><div className="row-main"><strong>{job.schedules.find(task => task.id === actual.task_id)?.description ?? actual.task_id}</strong><span>{recordedDate(actual.actual_start)} – {recordedDate(actual.actual_finish ?? null)}</span><span>{actual.evidence}</span><span>Evidence reference: {actual.id}</span><span>{actual.recorded_by.name} · {scheduleInstant(actual.recorded_by.at)}</span>{actual.reason && <span>Correction or update: {actual.reason}</span>}{actual.supersedes && <span>Supersedes evidence record {actual.supersedes}; the earlier record remains below.</span>}</div></li>)}</ol>
    </details>}
  </section>
}
