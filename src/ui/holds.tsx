import { useEffect, useState } from 'react'
import { Action, api, dateTime, Field, Form } from './shared'

type Hold = { id: string; kind: 'legal_hold' | 'retention'; reason: string; until: string | null; placed_by: { name: string; at: string }; released_at?: string; release_reason?: string; released_by?: { name: string } }
/** ROLE-005: the owner's legal holds and retention dates stop a job's erasure until released or past, and say why. */
export function JobHolds({ jobId }: { jobId: string }) {
 const [holds, setHolds] = useState<Hold[]>([]), [error, setError] = useState('')
 const load = () => api('/holds?subject_kind=job&subject_id=' + jobId).then(r => { setHolds(r.holds); setError('') }).catch(e => setError(e.message))
 useEffect(() => { load() }, [jobId])
 const today = new Date().toISOString().slice(0, 10), inForce = (h: Hold) => !h.released_at && (h.kind === 'legal_hold' || (h.until ?? '') >= today)
 return <section className="card" aria-labelledby="holds-title"><h2 id="holds-title">Holds and retention</h2>
  <p className="card-lead">A legal hold or retention date keeps this job’s documents and communications from being erased. Only the owner places or releases one, and each is recorded in the audit history.</p>
  {error && <p role="alert">{error}</p>}
  {holds.length === 0 ? <p className="muted">No holds on this job.</p> : <ul className="rows">{holds.map(h => <li className="row" key={h.id}><div className="row-main"><strong>{h.kind === 'legal_hold' ? 'Legal hold' : `Retention until ${h.until}`}{inForce(h) ? ' · in force' : h.released_at ? ' · released' : ' · expired'}</strong><span>{h.reason}</span><span className="muted">Placed by {h.placed_by.name} · {dateTime(h.placed_by.at)}{h.released_at && <> · released by {h.released_by?.name} · {h.release_reason}</>}</span>
   {!h.released_at && <Form submit="Release this hold" action={async f => { await api(`/holds/${h.id}/release`, { reason: f.get('reason') }); await load() }}><Field label="Reason for releasing" name="reason" /></Form>}</div></li>)}</ul>}
  <Form submit="Place hold" action={async f => { await api('/holds', { subject_kind: 'job', subject_id: jobId, kind: f.get('kind'), until: f.get('kind') === 'retention' ? f.get('until') : undefined, reason: f.get('reason'), confirm: f.get('confirm') === 'on' }); await load() }}>
   <label>Hold type<select name="kind"><option value="legal_hold">Legal hold until released</option><option value="retention">Retain until a date</option></select></label>
   <Field label="Retain until (retention only)" name="until" type="date" required={false} />
   <Field label="Reason" name="reason" />
   <label><input name="confirm" type="checkbox" required />This stops erasure of the job and only I can release it.</label>
  </Form>
 </section>
}
