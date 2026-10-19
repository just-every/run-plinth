import { useState, type FormEvent, type ReactNode } from 'react'
import type { BaselineJob } from '../plinth/schedule-baseline-model'
import { latestActual } from '../plinth/schedule-baseline-model'
import type { JobProps } from './job'
import { Field } from './shared'
import { scheduleInstant } from './schedule-views'

/** Schedule record forms share the workspace's status pattern and explicit button styles. */
export function ScheduleEntryForm({ children, action, submit, disabled = false }: { children: ReactNode; action: (data: FormData) => Promise<unknown>; submit: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true); setError(''); setSaved(false)
    try { await action(data); setSaved(true) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the schedule record.') } finally { setBusy(false) }
  }
  return <form onSubmit={send}><fieldset disabled={busy || disabled}>{children}<button type="submit" className="primary">{busy ? 'Saving…' : submit}</button></fieldset>{error && <p role="alert" className="error">{error}</p>}{saved && <p role="status">Saved.</p>}</form>
}

const utcInput = (value?: string) => value ? new Date(value).toISOString().slice(0, 16) : ''
export function ScheduleActualsForm({ job, mutate }: { job: BaselineJob; mutate: JobProps['mutate'] }) {
  const tasks = job.schedules.filter(task => task.status === 'booked')
  const [picked, setPicked] = useState('')
  const selected = tasks.find(task => task.id === picked) ?? tasks[0]
  const previous = selected ? latestActual(job, selected.id) : undefined
  return <section className="side-section" aria-labelledby="schedule-actuals-title"><h4 id="schedule-actuals-title">Record actual work</h4>
    <p className="hint">Record observed UTC dates and their evidence. Corrections append an attributed record and retain the earlier evidence.</p>
    {!tasks.length ? <p>Publish an active task before recording actual work.</p> : <>
      <label>Actual work task<select aria-label="Actual work task" value={selected?.id ?? ''} onChange={e => setPicked(e.target.value)}>{tasks.map(task => <option key={task.id} value={task.id}>{task.description}</option>)}</select></label>
      {previous && <p>Latest record: {scheduleInstant(previous.actual_start)} – {previous.actual_finish ? scheduleInstant(previous.actual_finish) : 'Not finished'} · {previous.recorded_by.name}. {previous.evidence}</p>}
      <ScheduleEntryForm key={(selected?.id ?? '') + ':' + (previous?.id ?? '')} submit={previous ? 'Append actual work record' : 'Record actual work'} action={async f => {
        const finish = String(f.get('actual_finish') ?? '')
        await mutate('/schedule-actuals', { task_id: selected!.id, actual_start: new Date(String(f.get('actual_start')) + 'Z').toISOString(), ...(finish ? { actual_finish: new Date(finish + 'Z').toISOString() } : {}), evidence: f.get('evidence'), ...(f.get('reason') ? { reason: f.get('reason') } : {}) })
      }}>
        <Field label="Actual start (UTC)" name="actual_start" type="datetime-local" defaultValue={utcInput(previous?.actual_start)} />
        <Field label="Actual finish (UTC)" name="actual_finish" type="datetime-local" required={!!previous?.actual_finish} defaultValue={utcInput(previous?.actual_finish)} />
        <label>Evidence<textarea name="evidence" required maxLength={4000} rows={3} placeholder="Inspection record, site log or delivery reference" /></label>
        {previous && <label>Reason for correction or update<textarea name="reason" required maxLength={4000} rows={2} /></label>}
      </ScheduleEntryForm>
    </>}
  </section>
}
