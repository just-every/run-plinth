import { useEffect, useState } from 'react'
import type { professionalView } from '../plinth/professional-prerequisites'
import type { JobProps } from './job'
import { api, Badge, Field, Form } from './shared'

type View = Awaited<ReturnType<typeof professionalView>>
export function ProfessionalPrerequisites({ job, refresh }: Pick<JobProps, 'job' | 'refresh'>) {
 const [view, setView] = useState<View>(), [error, setError] = useState('')
 const root = `/jobs/${job.id}/professional-prerequisites`
 async function load() { try { setView(await api(root)); setError('') } catch (error) { setError(error instanceof Error ? error.message : 'Could not load prerequisites') } }
 useEffect(() => { void load() }, [job.id, job.version])
 async function act(path: string, body: Record<string, unknown>) { try { await api(root + path, { expected_version: view?.version, ...body }) } finally { await refresh(); await load() } }
 async function files(form: FormData) { return Promise.all((form.getAll('originals') as File[]).filter(f => f.size).map(async file => { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return { name: file.name, mime: file.type, base64: btoa(binary) } })) }
 if (error) return <p role="alert">{error}</p>
 if (!view) return null
 return <section className="card stack" aria-label="Professional prerequisite register">
  <h2>Professional prerequisites</h2>
  <p>Keep affected work held until its designated office reviewer records an exact sourced decision. Recorded qualifications and signed originals are evidence; Plinth does not certify professional status, coverage or legal forms.</p>
  {view.manage && <details><summary>Register a prerequisite</summary><Form submit="Register prerequisite" action={async form => {
   const chosen = view.sources[Number(form.get('source'))]
   await act('', { title: form.get('title'), due_on: form.get('due_on'), source: chosen?.source, task_ids: form.getAll('task_ids') })
  }}>
   <Field label="Prerequisite title" name="title" />
   <label>Existing requirement<select aria-label="Existing requirement" name="source" required>{view.sources.map((s, index) => <option key={index} value={index}>{s.source.kind} · {s.title}</option>)}</select></label>
   <Field label="Decision deadline" name="due_on" type="date" />
   <p>Select affected tasks. An inspection without selected tasks holds all job work; coverage and waiver requirements also hold their linked subcontract.</p>
   <fieldset><legend>Affected tasks</legend>{job.schedules.map(t => <label key={t.id}><input type="checkbox" name="task_ids" value={t.id} />{t.description}</label>)}</fieldset>
  </Form></details>}
  {!view.register.length && <p>No professional prerequisites registered. Existing inspection, compliance and waiver controls still apply.</p>}
  {view.register.map(row => <article className="stack" key={row.id} aria-label={row.title}>
   <h3>{row.title}</h3><Badge status={row.hold ? 'held' : 'approved'}>{row.hold ? 'Held' : 'Review accepted'}</Badge>
   <p>{row.source.kind} · Decision due {row.due_on} · {row.task_ids.map(id => job.schedules.find(t => t.id === id)?.description).join(', ') || (row.source.subcontract_id ? 'Linked subcontract release' : 'All job work')}</p>
   {row.hold && <p role="status">{row.hold}</p>}
   {row.evidence.map(evidence => <section className="stack" key={evidence.id} aria-label={`Evidence version ${evidence.revision}`}>
    <h4>Evidence version {evidence.revision} · {evidence.professional}</h4>
    <p>Designated reviewer: {evidence.reviewer.name} · {evidence.signed ? 'Signed original recorded' : 'Unsigned evidence'} · In force {evidence.effective_on} to {evidence.expires_on}</p>
    <p>Qualification evidence: {evidence.qualification}</p>
    <p>Exact source: <a href={evidence.source.href}>{evidence.source.document.name}</a> · <span style={{overflowWrap:'anywhere'}}>Checksum {evidence.source.document.checksum}</span></p>
    <ul>{evidence.attachments.map(file => <li key={file.id}><a href={`/api/plinth${root}/files/${file.id}`}>{file.name}</a></li>)}</ul>
    {evidence.decision ? <p>Decision: {evidence.decision.disposition} · {evidence.decision.reason} · {evidence.decision.by.name}</p> : evidence.id === row.evidence.at(-1)?.id && evidence.reviewer.id === view.person_id && <details><summary>Review exact evidence</summary><Form submit="Record professional decision" action={form => act(`/${row.id}/review`, { evidence_id: evidence.id, source_document_id: evidence.source.document.id, source_checksum: evidence.source.document.checksum, disposition: form.get('disposition'), reason: form.get('reason'), confirm: form.get('confirm') === 'on' })}>
     <label>Decision<select aria-label="Decision" name="disposition"><option value="rejected">Rejected</option><option value="approved">Approved</option></select></label>
     <Field label="Reasoned decision" name="reason" />
     <label><input type="checkbox" name="confirm" required />I reviewed these exact source and qualification originals.</label>
    </Form></details>}
   </section>)}
   {view.manage && <details><summary>Submit new evidence</summary><Form submit="Submit prerequisite evidence" action={async form => act(`/${row.id}/evidence`, { reviewer_id: form.get('reviewer_id'), professional: form.get('professional'), qualification: form.get('qualification'), effective_on: form.get('effective_on'), expires_on: form.get('expires_on'), signed: form.get('signed') === 'on', source_document_id: row.current_source.document?.id, source_checksum: row.current_source.document?.checksum, attachments: await files(form) })}>
    <label>Designated office reviewer<select aria-label="Designated office reviewer" name="reviewer_id" required>{view.reviewers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <Field label="Accountable professional" name="professional" />
    <Field label="Recorded qualification evidence" name="qualification" />
    <Field label="Evidence effective date" name="effective_on" type="date" /><Field label="Evidence expiry date" name="expires_on" type="date" />
    <label><input type="checkbox" name="signed" />A signed original was received; signature is not certified by Plinth.</label>
    <p>Current source: {row.current_source.document?.name || 'Original source document required before submission'}</p>
    <label>Decision and qualification originals<input type="file" name="originals" accept="application/pdf,image/png,image/jpeg" multiple required /></label>
   </Form></details>}
  </article>)}
 </section>
}
