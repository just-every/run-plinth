import { useEffect, useState } from 'react'
import type { MeetingRawGrant } from '../plinth/meeting-raw-grants'
import type { Meeting } from '../plinth/meetings'
import type { JobProps } from './job'
import { api, Field, Form, calendarDay } from './shared'

export function RawMeetingGrants({job,meeting,role,mutate}: JobProps & {meeting: Meeting}) {
 const [grants,setGrants]=useState<(MeetingRawGrant & {active:boolean})[]>([]),[error,setError]=useState('')
 const manage=role==='owner'||role==='admin'
 const load=()=>api(`/jobs/${job.id}/meetings/${meeting.id}/raw-grants`).then(r=>{setGrants(r.grants);setError('')}).catch(e=>setError(e.message))
 useEffect(()=>{if(manage)void load()},[job.id,job.version,meeting.id,manage])
 if(!manage)return null
 return <details><summary>Raw meeting access</summary><p>Read-only access to this meeting for a named, currently assigned superintendent or office person. Linked work keeps its own access. Nothing is sent.</p>
  {error&&<p role="alert" className="error">{error}</p>}
  {grants.map(g=><section className="side-section" key={g.id}><h4>{g.recipient.email}</h4><p>{g.active?'Current read-only grant':g.revocation?'Revoked':'Inactive authority'} · {g.by.name} · {g.by.at}</p><p>{g.reason}</p>{g.revocation?<p>Revoked by {g.revocation.by.name} at {g.revocation.by.at}: {g.revocation.reason}</p>:<Form submit="Revoke raw access" action={async f=>{await mutate(`/meetings/${meeting.id}/revoke-raw-grant`,{grant_id:g.id,reason:f.get('reason'),confirm:f.get('confirm')==='on',operation_id:crypto.randomUUID()});await load()}}><Field name="reason" label="Raw access revocation reason"/><label><input name="confirm" type="checkbox" required/>Revoke this person's raw meeting access.</label></Form>}</section>)}
  <Form submit="Grant raw meeting access" action={async f=>{await mutate(`/meetings/${meeting.id}/raw-grant`,{email:f.get('email'),reason:f.get('reason'),confirm:f.get('confirm')==='on',operation_id:crypto.randomUUID()});await load()}}><Field name="email" label="Named internal recipient email" type="email"/><Field name="reason" label="Raw meeting sharing reason"/><label><input name="confirm" type="checkbox" required/>Share these full minutes, decisions and actions with this person.</label></Form>
 </details>
}

export function RawMeetingReads({jobId,meetings}:{jobId:string;meetings:Meeting[]}) {
 const [results,setResults]=useState<{title:string;text:string;href:string}[]>([]),[count,setCount]=useState<number>(),[error,setError]=useState('')
 useEffect(()=>{setResults([]);setCount(undefined);setError('')},[jobId,meetings])
 return <section className="card"><h2>Shared raw meetings</h2>{!meetings.length?<p className="empty">No current raw meeting grants.</p>:<>
  <Form submit="Search shared meetings" action={async f=>{const r=await api(`/meeting-inbox/${jobId}/decision-search?`+new URLSearchParams({q:String(f.get('q'))}));setResults(r.results);setCount(r.count);setError('')}}><Field name="q" label="Shared meeting search"/></Form>
  {error&&<p role="alert" className="error">{error}</p>}{count!==undefined&&<p>{count} shared meeting matches</p>}{results.map((r,i)=><p key={i}><a href={r.href}>{r.title}</a> · {r.text}</p>)}
  {meetings.map(m=><section className="side-section" key={m.id}><h3>{m.title}</h3><p>{calendarDay(m.held_on)} · Read only</p><p><strong>Agenda:</strong> {m.agenda}</p><p style={{whiteSpace:'pre-wrap'}}><strong>Minutes:</strong> {m.minutes}</p><p><strong>Decisions:</strong> {m.decisions}</p><ul>{m.actions.map(a=><li key={a.id}><strong>{a.title}</strong> · {a.owner_email} · due {calendarDay(a.due_on)}{a.completion&&<p>{a.completion.answer}</p>}</li>)}</ul><a href={`/api/plinth/jobs/${jobId}/meetings/${m.id}/export.json`} download>Download raw meeting</a></section>)}
 </>}</section>
}
