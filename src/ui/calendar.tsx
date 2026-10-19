import { useState } from 'react'
import { Action } from './shared'
import type { JobProps } from './job'

export function CalendarSubscription({ mutate }: Pick<JobProps, 'mutate'>) {
  const [url, setUrl] = useState(''), [revoked, setRevoked] = useState(false)
  return <section className="card"><h3>Calendar subscription</h3>
    <p>Read-only approved work for this job. Anyone holding your private link can read this schedule while you have access. Keep it private.</p>
    <div className="button-row"><Action className="primary" action={async () => { const result = await mutate('/calendar', { action: 'rotate' }); setUrl(new URL(result.urlPath, window.location.origin).href); setRevoked(false) }}>Create or rotate calendar link</Action>
      <Action className="danger-button" action={async () => { await mutate('/calendar', { action: 'revoke' }); setUrl(''); setRevoked(true) }}>Revoke calendar link</Action></div>
    {url && <label>Private calendar URL<input aria-label="Private calendar URL" readOnly value={url} onFocus={e => e.target.select()} /><span className="hint">Paste into your calendar’s subscription URL field. Rotation disables your previous link.</span></label>}
    {revoked && <p role="status">Calendar link revoked.</p>}
  </section>
}
