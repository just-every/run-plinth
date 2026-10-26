import { useEffect, useState } from 'react'
import type { JobProps } from './job'
import type { MailMessage } from '../plinth/mail-model'
import { Badge, dateTime, Field, Form, api } from './shared'

const kinds = [['selection_request', 'Selection request (required)'], ['selection_reminder', 'Selection reminder (optional)'], ['proposal', 'Proposal (required)'], ['update', 'Job update (optional)'], ['message', 'Message (optional)'], ['note', 'Private note, office only'], ['capture', 'Capture original email, private']] as const
const direction = (m: MailMessage) => m.direction === 'in' ? (m.visibility === 'private' ? 'Private email from ' + m.counterparty : 'Reply from client') : m.direction === 'note' ? 'Private note' : `Sent to ${m.counterparty}`
/** INT-007: the job thread. Replies arrive by email with their files; private notes never leave the office and a client sees only their own messages. */
export function Correspondence({ job, manager }: Pick<JobProps, 'job' | 'manager'>) {
 const [messages, setMessages] = useState<MailMessage[]>([]), [kind, setKind] = useState<string>('selection_request'), [error, setError] = useState('')
 const load = () => api(`/jobs/${job.id}/correspondence`).then(r => { setMessages(r.messages); setError('') }).catch(e => setError(e.message))
 useEffect(() => { load() }, [job.id])
 const presented = (job.selections ?? []).filter(s => s.revisions.at(-1)?.status === 'presented'), free = ['update', 'message'].includes(kind)
 return <div className="split"><section className="card" aria-labelledby="mail-title"><div className="card-head"><h2 id="mail-title">Messages</h2><span className="muted">{messages.length} on this job</span></div>
  <p className="card-lead">{manager ? 'Messages to the client and their emailed replies, with files. Required messages (proposals, selection requests, invoices) always go; optional notices stop when the client unsubscribes. Private notes are never emailed.' : 'Your messages with the builder about this job.'}</p>
  {error && <p role="alert" className="error">{error}</p>}
  {messages.length === 0 && <p className="empty">No messages yet.</p>}
  <ul className="rows">{messages.map(m => <li className="row" key={m.id}><div className="row-main">
   <strong>{m.subject}</strong>
   <span className="muted">{direction(m)} · {dateTime(m.created_at)}{m.direction === 'out' ? (m.required ? ' · required message' : ' · optional notice') : ''}</span>
   <span><Badge status={m.status}>{m.status}</Badge> {m.label}</span>
   <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
   {m.kind === 'captured' && <a href={`/api/plinth/jobs/${job.id}/correspondence/${m.id}/original`} download="original-email.eml">Download original email</a>}
   {m.files.length > 0 && <ul aria-label="Attachments">{m.files.map(f => <li key={f.id}><a href={`/api/plinth/jobs/${job.id}/correspondence/files/${f.id}`} download={f.name}>{f.name}</a> <span className="muted">{Math.ceil(f.size / 1024)} KB</span></li>)}</ul>}
  </div></li>)}</ul>
 </section>
 {manager && <section className="card" aria-labelledby="mail-compose"><h2 id="mail-compose">Send a message</h2>
  <Form submit={kind === 'note' ? 'Save note' : kind === 'capture' ? 'Capture private email' : 'Send message'} action={async f => {
   const body: Record<string, unknown> = { kind }
   if (kind === 'capture') { const file=f.get('original'); if (!(file instanceof File) || !file.size || file.size > 10*1024*1024) throw new Error('Choose an original email of up to 10 MB.'); const bytes=new Uint8Array(await file.arrayBuffer()); let raw=''; for (const byte of bytes) raw+=String.fromCharCode(byte); body.original_base64=btoa(raw); body.confirm=f.get('confirm')==='on' }
   else if (kind.startsWith('selection')) body.selection_id = f.get('selection_id'); else if (kind === 'proposal') body.quote_id = f.get('quote_id'); else { body.body = f.get('body'); if (free) body.subject = f.get('subject') }
   const result = await api(`/jobs/${job.id}/correspondence`, body); setMessages(result.messages)
  }}>
   <label>Kind<select name="kind" value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
   {kind.startsWith('selection') && <label>Selection<select name="selection_id" required>{presented.length === 0 && <option value="">No presented selection</option>}{presented.map(s => <option key={s.id} value={s.id}>{s.revisions.at(-1)!.room} / {s.revisions.at(-1)!.category}</option>)}</select></label>}
   {kind === 'proposal' && <label>Proposal revision<select name="quote_id" required>{job.quotes.filter(q => q.status !== 'superseded').map(q => <option key={q.id} value={q.id}>Revision {q.revision}</option>)}</select></label>}
   {free && <Field label="Subject" name="subject" />}
   {(free || kind === 'note') && <label>{kind === 'note' ? 'Note' : 'Message'}<textarea name="body" rows={5} required /></label>}
   {kind === 'capture' && <><label>Original email file<input type="file" name="original" accept=".eml,message/rfc822" required/></label><p>Stored privately with its original files. No message is sent and the sender is not independently verified.</p><label><input type="checkbox" name="confirm" required/>I reviewed this original email and approve its private capture on this job.</label></>}
   {kind !== 'note' && kind !== 'capture' && <p className="muted">Goes to {job.client_email}. Replies to the email join this thread.</p>}
  </Form></section>}
 </div>
}
