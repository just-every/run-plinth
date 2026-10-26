import { MeetingSharing, SharedMeetingDecisions } from './meeting-sharing'
import { useEffect, useState } from 'react'
import type { JobProps } from './job'
import type { Meeting } from '../plinth/meetings'
import type { MailMessage } from '../plinth/mail-model'
import { api, Badge, calendarDay, Field, Form } from './shared'

export function Meetings(props: JobProps) {
 const {job}=props
 if (!job.meeting_office_access) return <SharedMeetingDecisions job={job}/>
 return <OfficeMeetings {...props}/>
}
function OfficeMeetings(props: JobProps) {
 const {job,mutate}=props
 const [meetings, setMeetings] = useState<Meeting[]>([]), [mail, setMail] = useState<MailMessage[]>([]), [error, setError] = useState('')
 const load = () => Promise.all([api(`/jobs/${job.id}/meetings`), api(`/jobs/${job.id}/correspondence`)]).then(([m, c]) => { setMeetings(m.meetings); setMail(c.messages); setError('') }).catch(e => setError(e.message))
 useEffect(() => { load() }, [job.id, job.version])
 const links = [...job.schedules.map(r => ({ kind: 'schedule', id: r.id, title: r.description })), ...(job.rfis ?? []).map(r => ({ kind: 'rfi', id: r.id, title: r.title })), ...(job.selections ?? []).map(r => ({ kind: 'selection', id: r.id, title: r.revisions.at(-1)?.category })), ...job.variations.map(r => ({ kind: 'change', id: r.id, title: r.description })), ...job.diary.map(r => ({ kind: 'daily', id: r.id, title: r.note }))]
 return <div className="split"><section className="card"><h2>Site meetings</h2><p className="card-lead">Private office minutes, decisions and assigned actions. Completing an action keeps the exact work record and related email.</p>
 {error && <p role="alert" className="error">{error}</p>}
 {!error && meetings.length === 0 && <p className="empty">No meetings recorded.</p>}
 <ul className="rows">{meetings.map(m => <li className="row" key={m.id}><div className="row-main"><h3>{m.title}</h3><span className="muted">{calendarDay(m.held_on)} · {m.attendees.join(', ')}</span><p><strong>Agenda:</strong> {m.agenda}</p><p style={{whiteSpace:'pre-wrap'}}><strong>Minutes:</strong> {m.minutes}</p><p><strong>Decisions:</strong> {m.decisions}</p><span className="muted">{[...m.tags,m.sheet,m.cost_code].filter(Boolean).join(' · ')}</span>
 <ul className="rows">{m.actions.map(a => <li className="row" key={a.id}><div className="row-main"><strong>{a.title}</strong><span>{a.owner_email} · due {calendarDay(a.due_on)}</span><span><Badge status={a.completion ? 'completed' : 'open'}>{a.completion ? 'Completed' : 'Open'}</Badge></span>
 {a.completion ? <><p>{a.completion.answer}</p><span className="muted">Completed by {a.completion.by.name}</span><ul>{a.completion.links.map(l => <li key={l.href}><a href={l.href} target="_blank" rel="noreferrer">Retained {l.kind} answer source</a></li>)}</ul>{a.completion.message_id && <a href={`/api/plinth/jobs/${job.id}/decision-search?source=${encodeURIComponent('correspondence:'+a.completion.message_id)}`} target="_blank" rel="noreferrer">Related email source</a>}</> : <details><summary>Complete assigned action</summary><Form submit="Complete action" action={async f => { const [kind,id] = String(f.get('work')).split(':'); await mutate(`/meetings/${m.id}/complete`, { action_id: a.id, answer: f.get('answer'), links: [{kind,id}], ...(f.get('message_id') ? {message_id:f.get('message_id')} : {}) }); await load() }}><label>Resolved answer<textarea name="answer" required rows={3}/></label><label>Changed work<select name="work" required><option value="">Choose the work this answer changed</option>{links.map(l => <option key={l.id} value={`${l.kind}:${l.id}`}>{l.kind}: {l.title}</option>)}</select></label><label>Related email<select name="message_id"><option value="">No related email</option>{mail.map(r => <option value={r.id} key={r.id}>{r.subject} · {r.counterparty}</option>)}</select></label><p className="muted">Only the currently assigned action owner can complete it. The answer and source snapshot remain fixed.</p></Form></details>}
 {a.assignment_history?.map((change,index)=><p key={index}>Reassigned from {change.previous_owner_email} to {change.owner_email} by {change.by.name} at {change.by.at}: {change.reason}</p>)}{!a.completion && <details><summary>Reassign outstanding action</summary><Form submit="Confirm action reassignment" action={async f=>{await mutate(`/meetings/${m.id}/reassign`,{action_id:a.id,owner_email:f.get('owner_email'),reason:f.get('reason')});await load()}}><Field name="owner_email" label="New action owner email" type="email"/><Field name="reason" label="Reassignment reason"/><p>The original assignment stays in history. Only the new currently authorized owner completes this action.</p></Form></details>}</div></li>)}</ul><details><summary>Assign another action</summary><Form submit="Assign action" action={async f => { await mutate(`/meetings/${m.id}/add-action`, Object.fromEntries(f)); await load() }}><Field label="Action" name="title"/><Field label="Action owner email" name="owner_email" type="email"/><Field label="Due date" name="due_on" type="date"/></Form></details><MeetingSharing {...props} meeting={m}/><p className="muted">{m.history.length} history entries · recorded by {m.by.name}</p></div></li>)}</ul></section>
 {!error && <section className="card"><h2>Record a meeting</h2><Form submit="Record meeting" action={async f => { await mutate('/meetings', {title:f.get('title'),held_on:f.get('held_on'),agenda:f.get('agenda'),minutes:f.get('minutes'),decisions:f.get('decisions'),attendees:String(f.get('attendees')).split(',').map(s=>s.trim()).filter(Boolean),tags:String(f.get('tags')).split(',').map(s=>s.trim()).filter(Boolean),sheet:f.get('sheet'),cost_code:f.get('cost_code'),actions:[{title:f.get('action'),owner_email:f.get('owner_email'),due_on:f.get('due_on')}]}); await load() }}>
 <Field label="Meeting title" name="title"/><Field label="Meeting date" name="held_on" type="date"/><Field label="Attendees, separated by commas" name="attendees"/>
 <label>Agenda<textarea name="agenda" required rows={3}/></label><label>Minutes<textarea name="minutes" required rows={4}/></label><label>Decisions<textarea name="decisions" required rows={3}/></label>
 <Field label="Tags, separated by commas" name="tags" required={false}/><Field label="Sheet" name="sheet" required={false}/><Field label="Cost code" name="cost_code" required={false}/><Field label="Assigned action" name="action"/><Field label="Action owner email" name="owner_email" type="email"/><Field label="Due date" name="due_on" type="date"/>
 </Form></section>}
 </div>
}

export { DecisionSearch } from './decision-search'
