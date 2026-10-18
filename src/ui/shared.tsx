import { useState, type FormEvent, type ReactNode } from 'react'

export async function api(path: string, body?: unknown, method = 'POST') {
  const response = await fetch(path.startsWith('/auth/') ? path : '/api/plinth' + path, {
    method: body === undefined ? 'GET' : method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data: any = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || data.error?.message || data.error || data.code || `Request failed (${response.status})`)
  return data
}
/** Plinth keeps money in USD cents; the screen, the pay app CSV and the export all say so. */
export const CURRENCY = 'USD'
export const money = (cents: number = 0) => new Intl.NumberFormat('en-US', { style: 'currency', currency: CURRENCY }).format(cents / 100)
export const cents = (value: FormDataEntryValue | null) => {
  const raw = String(value ?? '')
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error('Enter a positive amount with at most two decimal places.')
  const [whole, fraction = ''] = raw.split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(result)) throw new Error('Amount is too large.')
  return result
}
/** "Oct 14, 2026, 9:20 am": the same lower-case time as everywhere else. */
export const dateTime = (value: string | number) => `${new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium' })}, ${time(value)}`
/** "Mon Oct 12": the weekday and date, in the viewer's time. */
export const day = (value: string | number | Date) => new Date(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
/** A stored YYYY-MM-DD date (a daily log's), read as that calendar day. */
export const calendarDay = (value: string) => day(value + 'T12:00:00')
export const time = (value: string | number) => new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('')
export function Field({ label, name, type = 'text', required = true, ...props }: {label: string; name: string; type?: string; required?: boolean; [key: string]: unknown}) {
  return <label>{label}<input name={name} type={type} required={required} {...props} /></label>
}
export function Form({ children, action, submit = 'Save', reset = true }: {children: ReactNode; action: (form: FormData) => Promise<unknown>; submit?: string; reset?: boolean}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget
    setBusy(true); setError(''); setMessage('')
    try { await action(new FormData(form)); if (reset) form.reset(); setMessage('Saved.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={send}><fieldset disabled={busy}>{children}<button type="submit">{busy ? 'Saving…' : submit}</button></fieldset>{error && <p role="alert" className="error">{error}</p>}{message && <p role="status">{message}</p>}</form>
}
export function Action({ children, action, className = '' }: {children: ReactNode; action: () => Promise<unknown>; className?: string}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <span className="action"><button className={className} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await action() } catch (e) { setError(e instanceof Error ? e.message : 'Action failed.') } finally { setBusy(false) } }}>{busy ? 'Working…' : children}</button>{error && <span role="alert" className="error">{error}</span>}</span>
}
export function Download({ filename, data, label }: {filename: string; data: string; label: string}) {
  return <button className="secondary" onClick={() => { const url = URL.createObjectURL(new Blob([data], {type:'text/plain'})); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>{label}</button>
}

export function Badge({ children, status = String(children) }: { children: ReactNode; status?: string }) {
  const checked = ['accepted', 'approved', 'published', 'booked', 'exported', 'issued', 'completed'].includes(status.toLowerCase())
  const label = typeof children === 'string' && children ? children[0]!.toUpperCase() + children.slice(1) : children
  return <span className={`badge status-${status.toLowerCase().replace(/[^a-z-]/g, '')}`}><span className={checked ? 'badge-icon is-check' : 'badge-icon'} aria-hidden="true">{checked ? '✓' : ''}</span>{label}</span>
}
