import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Job } from '../plinth/model'

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
/** Plinth keeps money in cents of the job's currency: USD, or AUD on a labelled historical import. The screen, the pay app CSV and the export all say which. */
export const money = (cents: number = 0, currency: string = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: currency === 'USD' ? 'symbol' : 'code' }).format(cents / 100)
export class FieldError extends Error {
  constructor(message: string, public field?: string) { super(message) }
}
export const cents = (value: FormDataEntryValue | null, field?: string) => {
  const raw = String(value ?? '')
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new FieldError('Enter a positive amount with at most two decimal places.', field)
  const [whole, fraction = ''] = raw.split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(result)) throw new FieldError('Amount is too large.', field)
  return result
}
/** "Oct 14, 2026, 9:20 am": the same lower-case time as everywhere else. */
export const dateTime = (value: string | number) => `${new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium' })}, ${time(value)}`
/** "Mon Oct 12": the weekday and date, in the viewer's time. */
export const day = (value: string | number | Date) => new Date(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
/** A stored YYYY-MM-DD date (a daily log's), read as that calendar day. */
export const calendarDay = (value: string) => day(value + 'T12:00:00')
export const time = (value: string | number) => new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
/** The client's name from People & access or their own approvals; their email until Plinth knows it. */
export const clientName = (job: Job) => job.client_name ?? job.approvals.find(a => a.approved_by.role === 'member')?.approved_by.name ?? job.client_email
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('')
export function Field({ label, name, type = 'text', required = true, ...props }: {label: string; name: string; type?: string; required?: boolean; [key: string]: unknown}) {
  return <label>{label}<input name={name} type={type} required={required} {...props} /></label>
}
export function Form({ children, action, submit = 'Save', reset = true }: {children: ReactNode; action: (form: FormData) => Promise<unknown>; submit?: string; reset?: boolean}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const id = useId(), formRef = useRef<HTMLFormElement>(null), errorRef = useRef<HTMLParagraphElement>(null)
  const [invalid, setInvalid] = useState<string[]>([]), [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!busy) return
    const start = performance.now(), timer = setInterval(() => setElapsed((performance.now() - start) / 1000), 100)
    return () => clearInterval(timer)
  }, [busy])
  useEffect(() => {
    const controls = formRef.current?.querySelectorAll<HTMLInputElement>('input,select,textarea')
    controls?.forEach(control => {
      const descriptions = (control.getAttribute('aria-describedby') ?? '').split(' ').filter(value => value && value !== id)
      if (invalid.includes(control.name)) { control.setAttribute('aria-invalid', 'true'); descriptions.push(id) }
      else control.removeAttribute('aria-invalid')
      if (descriptions.length) control.setAttribute('aria-describedby', descriptions.join(' ')); else control.removeAttribute('aria-describedby')
    })
    if (error) {
      const first = [...(controls ?? [])].find(control => invalid.includes(control.name))
      ;(first ?? errorRef.current)?.focus()
    }
  }, [error, invalid, id])
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget
    if (busy) return
    const invalidControls = [...form.querySelectorAll<HTMLInputElement>('input,select,textarea')].filter(control => !control.validity.valid)
    if (invalidControls.length) {
      setInvalid(invalidControls.map(control => control.name))
      setError(invalidControls.map(control => `${control.labels?.[0]?.textContent?.trim() || control.name}: ${control.validationMessage}`).join(' ')); setMessage(''); return
    }
    const data = new FormData(form), start = performance.now(), fallback = form.closest('.card,.record')?.querySelector<HTMLElement>('summary,h2,h3')
    const focused = document.activeElement instanceof HTMLElement && form.contains(document.activeElement) ? document.activeElement : form.querySelector<HTMLButtonElement>('button[type=submit]')
    setInvalid([]); setBusy(true); setError(''); setMessage(''); setElapsed(0)
    let saved = false
    try { await action(data); if (reset) form.reset(); setMessage(`Saved in ${((performance.now() - start) / 1000).toFixed(1)} seconds.`); saved = true }
    catch (e) { setInvalid(e instanceof FieldError && e.field ? [e.field] : []); setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); if (saved) requestAnimationFrame(() => { const target = focused?.isConnected ? focused : fallback; if (target?.isConnected) { if (!target.matches('input,select,textarea,button,summary')) target.tabIndex = -1; target.focus() } }) }
  }
  return <form ref={formRef} onSubmit={send} noValidate aria-label={submit} aria-busy={busy} aria-describedby={error ? id : undefined}><fieldset disabled={busy}>{children}<button type="submit">{busy ? 'Saving…' : submit}</button></fieldset><p role="status" aria-live="polite">{busy ? `Saving… ${elapsed.toFixed(1)} seconds elapsed. Keep this page open.` : message}</p>{error && <p id={id} ref={errorRef} tabIndex={-1} role="alert" className="error">{error} Your entries are still here. Review them and try again.</p>}</form>
}

export function ReadState({ label, error, retry, loading }: { label: string; error?: string; retry: () => Promise<void>; loading: boolean }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!loading) return
    setElapsed(0); const start = performance.now(), timer = setInterval(() => setElapsed((performance.now() - start) / 1000), 100)
    return () => clearInterval(timer)
  }, [loading])
  return <section className="read-state" aria-label={label} aria-busy={loading}>{loading ? <p role="status">{label}… {elapsed.toFixed(1)} seconds elapsed.</p> : error ? <><p role="alert" className="error">{error} No empty or up-to-date result is confirmed.</p><button type="button" className="secondary" onClick={() => { void retry().catch(() => {}) }}>Retry {label.toLowerCase()}</button></> : null}</section>
}
export function Action({ children, action, className = '' }: {children: ReactNode; action: () => Promise<unknown>; className?: string}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const errorRef = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  return <span className="action" aria-busy={busy}><button className={className} disabled={busy} onClick={async event => {
    const button = event.currentTarget, fallback = button.closest('.record')?.querySelector<HTMLElement>('summary,h3,h2')
    setBusy(true); setError('')
    try {
      await action()
      requestAnimationFrame(() => {
        const target = button.isConnected ? button : fallback
        if (target?.isConnected) { if (!target.matches('button,summary')) target.tabIndex = -1; target.focus() }
      })
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed.') }
    finally { setBusy(false) }
  }}>{busy ? 'Working…' : children}</button>{busy && <span role="status">Request in progress…</span>}{error && <span ref={errorRef} tabIndex={-1} role="alert" className="error">{error} Review and try again.</span>}</span>
}
export function Download({ filename, data, label }: {filename: string; data: string; label: string}) {
  return <button className="secondary" onClick={() => { const url = URL.createObjectURL(new Blob([data], {type:'text/plain'})); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>{label}</button>
}

export function Badge({ children, status = String(children) }: { children: ReactNode; status?: string }) {
  const checked = ['accepted', 'approved', 'published', 'booked', 'exported', 'issued', 'completed'].includes(status.toLowerCase())
  const label = typeof children === 'string' && children ? children[0]!.toUpperCase() + children.slice(1) : children
  return <span className={`badge status-${status.toLowerCase().replace(/[^a-z-]/g, '')}`}><span className={checked ? 'badge-icon is-check' : 'badge-icon'} aria-hidden="true">{checked ? '✓' : ''}</span>{label}</span>
}
