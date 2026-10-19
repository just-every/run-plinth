import type { Job } from '../plinth/model'
import type { JobProps } from './job'
import { Field, dateTime } from './shared'
import { ScheduleEntryForm } from './schedule-baseline-forms'

async function documents(form: FormData) {
 const file = form.get('document') as File | null
 if (!file?.size) return []
 if (file.size > 2_097_152) throw new Error('Each original document must be at most 2 MB.')
 const bytes = new Uint8Array(await file.arrayBuffer())
 let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
 return [{ name: file.name, mime: file.type || undefined, base64: btoa(binary) }]
}
function EvidenceFields({ required = false }: { required?: boolean }) {
 return <><label>Request, result or clearance reason<textarea name="reason" required rows={3} maxLength={4000} /></label><Field label="Original evidence (PDF, PNG or JPEG; up to 2 MB)" name="document" type="file" accept="application/pdf,image/png,image/jpeg" required={required} /></>
}
/** Office review follows the existing schedule forms; no document is implicitly shared. */
export function ScheduleConstraints({ job, mutate }: { job: Job; mutate: JobProps['mutate'] }) {
 return <section className="card" aria-labelledby="constraints-title"><h3 id="constraints-title">Inspections, permits and site holds</h3>
  <p>Open requirements block their tasks and successors from publication. All-work holds cover the whole job. A recorded clearance is a human decision, not certification of compliance or physical completion. Original evidence and notes stay in the office.</p>
  <details><summary>Add a schedule requirement</summary><ScheduleEntryForm reset submit="Record schedule requirement" action={async form => {
   await mutate('/schedule-constraints', { kind: form.get('kind'), title: form.get('title'), jurisdiction: form.get('jurisdiction'), accountable: form.get('accountable'), task_ids: form.getAll('task_ids'), reason: form.get('reason'), documents: await documents(form) })
  }}><label>Requirement kind<select name="kind" aria-label="Requirement kind"><option value="inspection">Inspection</option><option value="permit">Permit</option><option value="weather">Weather</option><option value="site">Site constraint</option></select></label>
   <Field label="Requirement title" name="title" maxLength={300} /><Field label="Jurisdiction" name="jurisdiction" maxLength={300} /><Field label="Accountable person" name="accountable" maxLength={200} />
   <fieldset><legend>Affected tasks (none selected means all work)</legend>{job.schedules.filter(t => t.status !== 'cancelled').map(task => <label key={task.id}><input type="checkbox" name="task_ids" value={task.id} />{task.description}</label>)}</fieldset>
   <EvidenceFields />
  </ScheduleEntryForm></details>
  <ul className="rows" aria-label="Schedule requirements">{(job.schedule_constraints ?? []).map(row => {
   const last = row.events.at(-1)!, cleared = last.action === 'cleared'
   return <li className="row" key={row.id}><div className="row-main"><h4>{row.title}</h4><strong>{cleared ? 'Cleared by a person' : 'Publication blocked'} · {last.action}</strong>
    <p>{row.kind} · {row.jurisdiction} · Accountable: {row.accountable}</p><p>{row.task_ids.length ? row.task_ids.map(id => job.schedules.find(t => t.id === id)?.description ?? id).join(', ') : 'All job work'} and affected successors</p>
    <details><summary>Request and clearance history</summary><ol>{row.events.map(event => <li key={event.id}><strong>{event.action}</strong> · {event.recorded_by.name} · {dateTime(event.recorded_by.at)}<p>{event.reason}</p>{event.documents.map(file => <p key={file.id}><a href={`/api/plinth/jobs/${job.id}/schedule-documents/${file.id}`}>{file.name}</a> · {file.size} bytes · SHA-256 {file.checksum}</p>)}</li>)}</ol></details>
    <details><summary>{cleared ? 'Record another result or hold' : 'Record a result or clearance'}</summary><ScheduleEntryForm key={last.id} submit="Append constraint decision" action={async form => {
     await mutate('/schedule-constraints/' + row.id, { action: form.get('action'), reason: form.get('reason'), documents: await documents(form) })
    }}><label>Constraint decision<select name="action" aria-label="Constraint decision"><option value="failed">Failed inspection / refused permit</option><option value="held">Weather or site hold</option><option value="requested">Inspection / permit requested</option><option value="cleared">Human clearance</option></select></label><p>Every clearance requires its original evidence; inspection and permit clearances require their passed result or permit.</p><EvidenceFields /></ScheduleEntryForm></details>
   </div></li>
  })}</ul>
 </section>
}
