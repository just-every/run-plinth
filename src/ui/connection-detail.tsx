import { useState } from 'react'
import type { Job } from '../plinth/model'
import { api, Action, dateTime, Field, Form } from './shared'
import { ConnectionHistory } from './connection-history'

export type Credential = { id: string; expires_at: number; revoked_at: number | null }
export type Connection = { id: string; receiver: string; job_ids: string[]; event_types: string[]; credential_id: string; generation: number; revoked_at: string | null; grant_id: string | null; grant_origin: string | null; grant_event_types: string[]; grant_payload_class: string | null; grant_rate_cap: number | null; grant_expires_at: string | null; grant_revoked_at: string | null; paused_at: string | null; pause_reason: string | null; failure_count: number; next_retry_at: string | null }
const localDate = (value: number) => { const date = new Date(value); return new Date(value - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) }
export function SigningKey({ value, dismiss }: { value: string; dismiss: () => void }) {
 const [visible, setVisible] = useState(false)
 return <div className="connection-key"><p role="status">Signing key created. Store it in the receiver now; it is shown only this time.</p><label>Signing key<input type={visible ? 'text' : 'password'} value={value} readOnly autoComplete="off" /></label><div className="button-row"><button className="secondary" type="button" onClick={() => setVisible(!visible)}>{visible ? 'Hide signing key' : 'Show signing key'}</button><button className="secondary" type="button" onClick={dismiss}>Dismiss key</button></div></div>
}
export function ConnectionDetail({ row, jobs, credentials, refresh }: { row: Connection; jobs: Job[]; credentials: Credential[]; refresh: () => Promise<void> }) {
 const [key, setKey] = useState(''), [opened, setOpened] = useState(false)
 const expired = Boolean(row.grant_expires_at && new Date(row.grant_expires_at).getTime() <= Date.now())
 const status = row.revoked_at ? 'Receiver revoked' : row.grant_revoked_at ? 'Standing grant revoked' : expired ? 'Standing grant expired' : row.paused_at ? 'Delivery paused' : row.grant_id ? 'Standing grant active' : 'No standing grant'
 return <details className="connection-record" onToggle={e => setOpened(e.currentTarget.open)}><summary><span>{row.receiver}</span><span className="muted">{status}</span></summary>
  <dl className="connection-facts"><div><dt>Jobs</dt><dd>{row.job_ids.map(id => jobs.find(j => j.id === id)?.name ?? id).join(', ')}</dd></div><div><dt>Events</dt><dd>{row.event_types.join(', ')}</dd></div><div><dt>Signing generation</dt><dd>{row.generation}</dd></div><div><dt>Credential</dt><dd>{row.credential_id.slice(0, 8)}{credentials.some(c => c.id === row.credential_id) ? '' : ' · no longer current'}</dd></div></dl>
  {row.paused_at && <div className="connection-warning"><p><strong>Delivery paused</strong> · {dateTime(row.paused_at)}</p><p>{row.pause_reason?.replaceAll('_', ' ') || 'Repeated delivery failures'} · {row.failure_count} failed attempts.</p><p>Review the receiver, then explicitly renew the standing grant to resume future events. Rotating a key does not resume delivery.</p></div>}
  {!row.paused_at && row.failure_count > 0 && <p className="hint">{row.failure_count} failed attempts.</p>}
  {row.next_retry_at && <p className="hint">Next retry: {dateTime(row.next_retry_at)}</p>}
  <h3>Standing grant</h3>
  {row.grant_id ? <dl className="connection-facts"><div><dt>Origin</dt><dd>{row.grant_origin}</dd></div><div><dt>Events</dt><dd>{row.grant_event_types.join(', ')}</dd></div><div><dt>Payload</dt><dd>{row.grant_payload_class === 'references' ? 'References only' : row.grant_payload_class}</dd></div><div><dt>Rate cap</dt><dd>{row.grant_rate_cap} attempts per rolling hour</dd></div><div><dt>Expires</dt><dd>{row.grant_expires_at && dateTime(row.grant_expires_at)}</dd></div>{row.grant_revoked_at && <div><dt>Revoked</dt><dd>{dateTime(row.grant_revoked_at)}</dd></div>}</dl> : <p className="hint">Scheduled delivery is off until you explicitly approve a standing grant.</p>}
  {!row.revoked_at && <>
   <details className="connection-grant"><summary>{row.grant_id ? 'Renew standing grant' : 'Set standing grant'}</summary>
    <Form reset={false} submit="Approve standing grant" action={async f => {
     await api(`/connections/${row.id}/grant`, {confirm: f.get('confirm') === 'on', origin: new URL(row.receiver).origin, event_types: f.getAll('event_types'), payload_class: 'references', rate_cap: Number(f.get('rate_cap')), expires_at: new Date(String(f.get('expires_at'))).toISOString()}); await refresh()
    }}>
     <Field name="origin" label="Receiver origin" value={new URL(row.receiver).origin} readOnly />
     <fieldset className="connection-choices"><legend>Authorized events</legend>{row.event_types.map(type => <label key={type}><input name="event_types" type="checkbox" value={type} defaultChecked={!row.grant_id || row.grant_event_types?.includes(type)} />{type}</label>)}</fieldset>
     <p className="hint">Payload: references only. Only events created after this approval are eligible.</p>
     <Field label="Attempts per rolling hour" name="rate_cap" type="number" min="1" max="1000" step="1" defaultValue={row.grant_rate_cap ?? 60} />
     <Field label="Grant expiry (your local time)" name="expires_at" type="datetime-local" step="1" min={localDate(Date.now())} defaultValue={localDate(Date.now() + 23 * 60 * 60_000)} />
     <label className="connection-check"><input name="confirm" type="checkbox" required />I authorize scheduled delivery to this origin for these events, reference fields, rate cap and expiry.</label>
    </Form>
   </details>
   {row.grant_id && !row.grant_revoked_at && <Action className="secondary" action={async () => { await api(`/connections/${row.id}/grant/revoke`, {}); await refresh() }}>Revoke standing grant</Action>}
   <details className="connection-security"><summary>Keys and receiver access</summary>
    {key && <SigningKey value={key} dismiss={() => setKey('')} />}
    <Form submit="Rotate signing key" action={async f => { const result = await api(`/connections/${row.id}/rotate`, {credential_id: f.get('credential_id')}); setKey(result.signing_key); await refresh() }}>
     <label>Replacement owner credential<select name="credential_id" aria-label="Replacement owner credential" required defaultValue={row.credential_id}><option value="">Choose a current credential</option>{credentials.map(c => <option key={c.id} value={c.id}>{c.id.slice(0, 8)} · expires {dateTime(c.expires_at)}</option>)}</select></label>
     <p className="hint">Rotation replaces the signing key immediately. Update the receiver with the new key.</p>
    </Form>
    <Form submit="Revoke receiver" action={async () => { await api(`/connections/${row.id}/revoke`, {}); setKey(''); await refresh() }}><label className="connection-check"><input type="checkbox" required />I want to revoke this receiver and stop all further deliveries.</label></Form>
   </details>
  </>}
  {opened && <ConnectionHistory id={row.id} />}
 </details>
}
