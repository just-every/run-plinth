import { useEffect, useState } from 'react'
import type { Job } from '../plinth/model'
import type { ScheduleTemplate } from '../plinth/schedule-baseline-model'
import type { TodoJobTemplate as Binding } from '../plinth/todo-job-template'
import type { TodoTemplate } from '../plinth/todo-model'
import { due } from '../plinth/todo-model'
import { api, Field, Form } from './shared'

export function TodoJobTemplate({job, version, changed}: {job: Job; version?: number; changed: () => Promise<void>}) {
 const [sources, setSources] = useState<ScheduleTemplate[]>([])
 const [templates, setTemplates] = useState<TodoTemplate[]>([])
 const [bindings, setBindings] = useState<Binding[]>([])
 const [selected, setSelected] = useState(''), [error, setError] = useState('')
 const [preview, setPreview] = useState<{digest: string; start: string; template_id: string; tasks: {id: string; description: string; start: string; end: string}[]}>()
 async function refresh() {
  const [schedule, todo, binding] = await Promise.all([api('/schedule-templates'), api('/todos/templates'), api('/todos/job-templates')])
  const active = schedule.templates.filter((t: ScheduleTemplate) => !t.archived)
  setSources(active); setTemplates(todo.templates); setBindings(binding.bindings)
  setSelected(current => active.some((t: ScheduleTemplate) => t.id === current) ? current : active[0]?.id ?? '')
 }
 useEffect(() => { refresh().catch(e => setError(e.message)) }, [version])
 const source = sources.find(s => s.id === selected)
 const binding = bindings.find(b => b.schedule_template_id === source?.id && b.schedule_template_revision === source.version)
 const local = (instant: string) => new Intl.DateTimeFormat('en-US', {timeZone: job.time_zone ?? 'UTC', dateStyle: 'medium', timeStyle: 'short'}).format(new Date(instant))
 return <details><summary>Job-template schedule and to-dos</summary>
  <p>Bind reusable checklists to an approved schedule-template revision. Applying the reviewed schedule creates its to-dos in the same job update. Existing checklist progress stays intact when the template is applied again.</p>
  {error && <p role="alert">{error}</p>}
  {!sources.length ? <p>Create an approved schedule template in Schedule before binding its checklists.</p> : <>
   <label>Schedule template for to-dos<select aria-label="Schedule template for to-dos" value={selected} onChange={e => {setSelected(e.target.value); setPreview(undefined)}}>{sources.map(s => <option key={s.id} value={s.id}>{s.name} · revision {s.version}</option>)}</select></label>
   {source && <>
    <Form key={source.id+':'+source.version+':'+(binding?.revision ?? 0)} submit="Save job-template checklist binding" reset={false} action={async f => {
     await api('/todos/job-templates/'+source.id, {expected_version: binding?.revision ?? 0, schedule_template_revision: source.version, templates: templates.filter(t => f.get('include-'+t.id) === 'on').map(t => ({todo_template_id: t.id, ...(f.get('anchor-'+t.id) ? {task_id: f.get('anchor-'+t.id)} : {})}))})
     setPreview(undefined); await refresh()
    }}>
     {templates.length === 0 && <p>Create a reusable to-do template first.</p>}
     {templates.map(t => {const existing = binding?.templates.find(b => b.todo_template_id === t.id); return <div className="fields" data-todo-template-id={t.id} key={t.id}>
      <label><input type="checkbox" name={'include-'+t.id} defaultChecked={!!existing}/>Include to-do template {t.name}</label>
      <label>Date anchor for {t.name}<select aria-label={'Date anchor for '+t.name} name={'anchor-'+t.id} defaultValue={existing?.task_id ?? ''}><option value="">Job template start</option>{source.tasks.map(task => <option key={task.id} value={task.id}>{task.description}</option>)}</select></label>
     </div>})}
    </Form>
    <p>{binding ? `${binding.templates.length} checklist template(s) bound to schedule revision ${source.version}.` : 'This schedule revision has no bound checklist templates.'}</p>
    {job.status === 'active' ? <>
     <Form submit="Preview job template with to-dos" reset={false} action={async f => {
      const start = due(f.get('start'), job.time_zone ?? 'UTC')
      const r = await api(`/jobs/${job.id}/schedule-template/preview`, {expected_version: version, template_id: source.id, start})
      setPreview({template_id: source.id, start, digest: r.preview.digest, tasks: r.preview.tasks})
     }}><Field label={`Job-template start (${job.time_zone ?? 'UTC'})`} name="start" type="datetime-local"/></Form>
     {preview && preview.template_id === source.id && <div>
      <h3>Reviewed job-template schedule</h3>
      {preview.tasks.map(t => <p key={t.id}>{t.description} · {local(t.start)} – {local(t.end)} · {job.time_zone ?? 'UTC'}</p>)}
      <p>Creates the bound checklists after checking each person's current job and company scope.</p>
      <Form submit="Apply reviewed job template" action={async f => {
       if (f.get('confirm') !== 'on') throw new Error('Review the schedule and bound checklists first')
       await api(`/jobs/${job.id}/schedule-template/apply`, {expected_version: version, template_id: preview.template_id, start: preview.start, digest: preview.digest})
       setPreview(undefined); await changed()
      }}><label><input name="confirm" type="checkbox" required/>I reviewed this schedule and its bound checklist templates</label></Form>
     </div>}
    </> : <p>Choose this schedule template when recording quote acceptance to create its schedule and bound checklists together.</p>}
   </>}
  </>}
 </details>
}
