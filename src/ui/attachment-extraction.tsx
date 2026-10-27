import { useEffect, useRef, useState } from 'react'
import { extractAttachmentText, untilStopped, type Result, type Run } from './attachment-text'

/** A local draft beside the owner and administrator reviewed-text editor. */
export function AttachmentExtraction({ href, name, onText }: { href: string; name: string; onText: (text: string) => void }) {
 const [password, setPassword] = useState(''), [everyPage, setEveryPage] = useState(false)
 const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState(''), [result, setResult] = useState<Result>()
 const active = useRef<AbortController | null>(null)
 useEffect(() => {
  setResult(undefined); setPassword(''); setError(''); setStatus('')
  return () => active.current?.abort()
 }, [href])
 async function start() {
  if (active.current) return
  const controller = new AbortController(), cleanup: (() => void)[] = []
  active.current = controller
  const run: Run = { signal: controller.signal, cleanup, progress: setStatus }, suppliedPassword = password
  setPassword(''); setBusy(true); setError(''); setResult(undefined); setStatus('Reading original file…')
  const release = () => cleanup.splice(0).reverse().forEach(dispose => dispose())
  controller.signal.addEventListener('abort', release, { once: true })
  const timeout = window.setTimeout(() => controller.abort(new Error('Extraction exceeded five minutes. Try a smaller original or supply reviewed text manually.')), 300_000)
  try {
   const work = extractAttachmentText(href, name, suppliedPassword, everyPage, run)
   const output = await untilStopped(work, controller.signal)
   run.signal.throwIfAborted()
   if (!output.text.trim()) throw new Error('No text was recognized. Nothing was copied. Check the original and supply text manually.')
   setResult(output); setStatus('Draft ready. Compare it with the original before using it.')
  } catch (cause) {
   const problem = controller.signal.aborted ? controller.signal.reason : cause
   // Password and parser errors may contain source details. Never display library errors verbatim.
   setError(controller.signal.aborted ? (problem instanceof Error && problem.name !== 'AbortError' ? problem.message : 'Extraction stopped. Nothing was copied.')
    : cause instanceof Error && (cause.name === 'PasswordException') ? 'This PDF needs a valid password. Enter it below and extract again.'
    : cause instanceof Error && /^(Extracted text|Original file|This |PDF page|Browser extraction|Extraction requires|No text|Office extraction: )/.test(cause.message) ? cause.message
    : 'Extraction failed. The file may be damaged, encrypted, or use unsupported features. Nothing was copied; supply reviewed text manually.')
   setStatus('')
  } finally { window.clearTimeout(timeout); release(); active.current = null; setBusy(false) }
 }
 return <details><summary>Extract text in this browser</summary>
  <p>Read the original locally, then review a draft. File bytes and PDF passwords stay in this browser; OCR resources come from this installation. Nothing is saved by extraction.</p>
  <p>Limits: 20 MB original, 16 megapixels per image or rendered page, 100,000 text characters, five minutes. Every PDF page is read within these limits; an incomplete run copies no draft. OCR reads English.</p>
  <label>PDF password (if needed)<input type="password" autoComplete="off" value={password} disabled={busy} onChange={event => setPassword(event.target.value)}/></label>
  <label><input type="checkbox" checked={everyPage} disabled={busy} onChange={event => setEveryPage(event.target.checked)}/> OCR every PDF page, including pages with embedded text</label>
  <button type="button" className="secondary" disabled={busy} onClick={() => void start()}>Extract draft text</button>
  {busy && <button type="button" className="secondary" onClick={() => active.current?.abort()}>Stop extraction</button>}
  <p role="status" aria-live="polite" aria-busy={busy}>{status}</p>
  {error && <p role="alert" className="error">{error}</p>}
  {result && <>
   {result.notes.map((note, index) => <p key={index}>{note}</p>)}
   <label>Unverified extracted draft<textarea value={result.text} readOnly rows={10}/></label>
   <p>Using this draft replaces the current editor text. Correct it there, then review and confirm the full text in the existing save step.</p>
   <button type="button" className="secondary" onClick={() => { onText(result.text); setStatus('Draft copied to the editor. Review and correct it before saving.'); setResult(undefined) }}>Use text in editor</button>
  </>}
 </details>
}
