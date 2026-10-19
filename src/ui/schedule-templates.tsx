import { useEffect, useState } from 'react'
import { templateTaskId, type BaselineJob, type ScheduleTemplate } from '../plinth/schedule-baseline-model'
import { defaultCalendar, type SchedulePreview } from '../plinth/schedule-model'
import type { JobProps } from './job'
import { Action, api, Badge, Field } from './shared'
import { ScheduleEntryForm } from './schedule-baseline-forms'
import { fromLocalInput, jobZone, scheduleInstant } from './schedule-views'

export type TemplatePreviewInput = { template_id: string; start: string }
export function ScheduleTemplates({ job, mutate, onPreview }: { job: BaselineJob; mutate: JobProps['mutate']; onPreview: (preview: SchedulePreview, input: TemplatePreviewInput) => void }) {
  const zone = jobZone(job)
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]), [selectedId, setSelectedId] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  async function load() {
    setLoading(true); setError('')
    try { const result = await api('/schedule-templates'); setTemplates(result.templates) } catch (e) { setError(e instanceof Error ? e.message : 'Could not load schedule templates.'); throw e } finally { setLoading(false) }
  }
  useEffect(() => { load().catch(() => {}) }, [])
  const selected = templates.find(template => template.id === selectedId)
  const published = job.schedules.filter(task => task.status === 'booked')
  const calendar = job.schedule_calendar ?? defaultCalendar
  const tasks = published.map(task => ({ ...task, duration_minutes: task.duration_minutes ?? Math.round((Date.parse(task.end) - Date.parse(task.start)) / 60000) }))
  const replace = (template: ScheduleTemplate) => { setTemplates(current => [template, ...current.filter(row => row.id !== template.id)]); setSelectedId(template.id) }
  const sourceReady = job.status === 'active' && tasks.length > 0 && job.schedules.every(task => task.status !== 'draft')
  return <section className="card" aria-labelledby="schedule-templates-title"><h3 id="schedule-templates-title">Schedule templates</h3>
    <p>Reuse published tasks, dependencies and working calendars on an accepted job. Preview the proposed dates before applying a template.</p>
    {job.schedule_template && <p>Applied: {job.schedule_template.template_name} · version {job.schedule_template.template_version} · starts {scheduleInstant(job.schedule_template.start, zone)} · approved by {job.schedule_template.approved_by.name}.</p>}
    {error && <p role="alert" className="error">{error}</p>}{loading && <p role="status">Loading schedule templates…</p>}
    <Action className="secondary" action={load}>Reload templates</Action>
    <label>Schedule template<select aria-label="Schedule template" value={selectedId} onChange={e => setSelectedId(e.target.value)}><option value="">Choose a template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name} · v{template.version}{template.archived ? ' · Archived' : ''}</option>)}</select></label>
    {!loading && !templates.length && <p>No templates saved yet.</p>}
    {selected && <div className="side-section">
      <div className="card-head"><h4>{selected.name}</h4><div className="row-end"><Badge>{selected.archived ? 'Archived' : 'Active'}</Badge></div></div>
      <p>{selected.tasks.length} tasks · working hours {selected.calendar.start_hour}:00–{selected.calendar.end_hour}:00 local time, applied in {zone}.</p>
      {!selected.archived && job.status === 'active' && <ScheduleEntryForm key={'apply-' + selected.id} submit="Preview template dates" action={async f => {
        const input = { template_id: selected.id, start: fromLocalInput(String(f.get('start')), zone) }
        const result = await mutate('/schedule-template/preview', input)
        onPreview(result.preview, input)
      }}><Field label={`Template start (${zone})`} name="start" type="datetime-local" /></ScheduleEntryForm>}
      {job.status !== 'active' && <p>Accept the job’s quote before applying a template.</p>}
      <details><summary>Template revision history</summary><ol className="rows">{[...selected.revisions].reverse().map(revision => <li className="row" key={revision.revision}><div className="row-main"><strong>v{revision.revision} · {revision.name}</strong><span>{revision.reason || 'Initial template'}</span><span>{revision.approved_by.name} · {scheduleInstant(revision.approved_by.at, zone)}</span><details><summary>Approved template snapshot</summary><pre>{JSON.stringify(revision, null, 2)}</pre></details></div><div className="row-end"><Badge>{revision.archived ? 'Archived' : 'Approved'}</Badge></div></li>)}</ol></details>
      {!selected.archived && <>
        <details><summary>Revise template from this job’s published tasks</summary><ScheduleEntryForm key={'revision-' + selected.id + ':' + selected.version} disabled={!sourceReady} submit="Save template revision" action={async f => {
          const localIds = [...new Set(selected.revisions.flatMap(revision => revision.tasks.map(task => task.id)))]
          const reverse = new Map(await Promise.all(localIds.map(async id => [await templateTaskId(job.id, selected.id, id), id] as const)))
          const sourceTasks = tasks.map(task => ({...task,id:reverse.get(task.id) ?? task.id,predecessors:task.predecessors?.map(link => ({...link,id:reverse.get(link.id) ?? link.id}))}))
          const result = await api('/schedule-templates/' + selected.id, { expected_version: selected.version, name: f.get('name'), calendar, tasks: sourceTasks, revision_name: f.get('revision_name'), reason: f.get('reason') }, 'PUT'); replace(result.template)
        }}><Field label="Template name" name="name" defaultValue={selected.name} /><Field label="Template revision name" name="revision_name" /><label>Template revision reason<textarea name="reason" required maxLength={4000} rows={2} /></label></ScheduleEntryForm></details>
        <details><summary>Archive template</summary><p>Archiving retains the template’s revisions and approved decisions.</p><ScheduleEntryForm key={'archive-' + selected.id + ':' + selected.version} submit="Archive template" action={async f => {
          const result = await api('/schedule-templates/' + selected.id, { expected_version: selected.version, revision_name: f.get('revision_name'), reason: f.get('reason') }, 'DELETE'); replace(result.template)
        }}><Field label="Archive revision name" name="revision_name" /><label>Archive reason<textarea name="reason" required maxLength={4000} rows={2} /></label></ScheduleEntryForm></details>
      </>}
    </div>}
    <details className="side-section"><summary>Save this job’s published schedule as a template</summary>
      {!sourceReady && <p>Publish at least one active task and resolve schedule drafts before saving a template.</p>}
      <ScheduleEntryForm disabled={!sourceReady} submit="Save schedule template" action={async f => {
        const result = await api('/schedule-templates', { name: f.get('name'), reason: f.get('reason'), calendar, tasks }); replace(result.template)
      }}><Field label="New template name" name="name" /><label>Template purpose<textarea name="reason" maxLength={4000} rows={2} /></label></ScheduleEntryForm>
    </details>
  </section>
}
