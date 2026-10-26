import { useState } from 'react'
import type { DecisionHit } from '../plinth/decision-search'
import type { FileTranscription as Revision } from '../plinth/file-transcriptions'
import type { Job } from '../plinth/model'
import { api, dateTime, Form } from './shared'
import { AttachmentExtraction } from './attachment-extraction'

type Review = { source: string; checksum: string; expected_version: number; text: string; digest: string; previous_revision: number }
export function FileTranscription({ job, hit, canEdit, refresh }: { job: Job; hit: DecisionHit; canEdit: boolean; refresh: () => Promise<void> }) {
 const [revisions, setRevisions] = useState<Revision[]>(), [value, setValue] = useState(''), [review, setReview] = useState<Review>(), [error, setError] = useState('')
 const path = `/jobs/${job.id}/decision-search/`
 return <details onToggle={async event => {
  if (!event.currentTarget.open || revisions) return
  try { const result = await api(path + 'transcriptions?' + new URLSearchParams({ source: hit.source })); setRevisions(result.revisions); setValue(result.revisions.at(-1)?.text ?? ''); setError('') }
  catch (e) { setError((e as Error).message) }
 }}><summary>Supplied attachment text</summary>
 <p>Supplementary human text follows the original file’s audience. It does not replace the original or change its extraction status.</p>
 <p style={{overflowWrap:'anywhere'}}>Original SHA-256: {hit.file_checksum}</p>
 {error && <p role="alert" className="error">{error}</p>}
 {revisions && <>
 {revisions.length > 0 && <details><summary>Saved revisions ({revisions.length})</summary>{revisions.map(revision => <article key={revision.revision}><p>Revision {revision.revision} · Supplied by {revision.supplied_by.name} · {dateTime(revision.supplied_by.at)}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',font:'inherit'}}>{revision.text}</pre></article>)}</details>}
 {canEdit && !review && <Form submit="Review complete supplied text" reset={false} action={async () => { setReview(await api(path + 'transcription-preview', { source: hit.source, checksum: hit.file_checksum, expected_version: job.version, text: value })) }}>{hit.files?.[0] && <AttachmentExtraction href={hit.files[0].href} name={hit.title} onText={setValue}/>}<label>Human-supplied transcription<textarea name="text" value={value} onChange={event => setValue(event.target.value)} required maxLength={100000} rows={10}/></label></Form>}
 {canEdit && review && <Form submit="Confirm and save supplied text" reset={false} action={async f => { await api(path + 'transcriptions', { ...review, confirm: f.get('confirm') === 'on' }); await refresh() }}>
 <h3>Review complete supplied text</h3><p>For {hit.title} · New revision {review.previous_revision + 1}</p>
 <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',font:'inherit'}}>{review.text}</pre>
 <label><input type="checkbox" name="confirm" required/> I reviewed the entire supplied text against this exact original and confirm it can be seen by everyone who can access that file.</label>
 <button type="button" className="secondary" onClick={() => setReview(undefined)}>Edit supplied text</button>
 </Form>}
 </>}
 </details>
}
