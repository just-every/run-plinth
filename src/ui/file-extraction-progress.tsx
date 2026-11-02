import { useEffect, useState } from 'react'
import type { DecisionHit } from '../plinth/decision-search'
import { api, Form } from './shared'

export function FileExtractionProgress({ hit, owner }: { hit: DecisionHit; owner: boolean }) {
 const [extraction, setExtraction] = useState(hit.extraction), [error, setError] = useState('')
 const path = hit.files?.[0]?.href.replace('/api/plinth', '') + '/extraction'
 useEffect(() => { setExtraction(hit.extraction) }, [hit])
 useEffect(() => {
  if (!owner || extraction?.status !== 'queued') return
  const timer = setInterval(() => { void api(path).then(r => { setExtraction(r.extraction); setError('') }).catch(e => setError(e.message)) }, 5000)
  return () => clearInterval(timer)
 }, [owner, path, extraction?.status])
 if (!extraction?.method) return null
 const act = async (action: string, confirm = false) => { const r = await api(path, { action, expected_version: extraction.version, checksum: hit.file_checksum, confirm }); setExtraction(r.extraction); setError('') }
 return <div data-extraction-source={hit.source}>
 <p role="status">File text: {extraction.status.replaceAll('_', ' ')} · {extraction.method} · {extraction.progress} of {extraction.total ?? 'unknown'} pages</p>
 {extraction.detail && <p>{extraction.detail}</p>}{error && <p role="alert" className="error">{error}</p>}
 {owner && extraction.status === 'review_required' && <Form submit="Enable recovered extraction" reset={false} action={async f => act('review', f.get('confirm') === 'on')}><label><input type="checkbox" name="confirm" required/> I reviewed this exact original and authorize native extraction in this installation.</label></Form>}
 {owner && ['queued', 'failed'].includes(extraction.status) && <Form submit={extraction.status === 'failed' ? 'Retry native extraction' : 'Process next PDF step'} reset={false} action={async () => act(extraction.status === 'failed' ? 'retry' : 'continue')}>{null}</Form>}
 </div>
}
