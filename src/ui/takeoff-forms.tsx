import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DrawingRevision, Point, TakeoffSheet } from '../plinth/takeoff-model'
import type { JobProps } from './job'
import { Field, Form } from './shared'
import { openDrawing } from './takeoff-viewer'

export function DrawingUpload({ sheet, mutate, onSaved }: { sheet?: TakeoffSheet; mutate: JobProps['mutate']; onSaved: (id: string) => void }) {
  const [file, setFile] = useState<File>(), [pdf, setPdf] = useState<PDFDocumentProxy>(), [page, setPage] = useState(1), [size, setSize] = useState<{ width: number; height: number }>(), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const sequence = useRef(0)
  useEffect(() => {
    const version = ++sequence.current
    let disposed = false, loaded: PDFDocumentProxy | undefined
    setPdf(undefined); setSize(undefined); setError(''); setPage(1); setLoading(false)
    if (!file) return
    if(file.size>2*1024*1024){setError('Each PDF original must be 2 MB or smaller.');return}
    setLoading(true)
    file.arrayBuffer().then(data => openDrawing(new Uint8Array(data))).then(document => { loaded = document; if (disposed) void document.loadingTask.destroy(); else setPdf(document) }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : 'Could not inspect PDF.') }).finally(() => { if (sequence.current === version) setLoading(false) })
    return () => { disposed = true; void loaded?.loadingTask.destroy() }
  }, [file])
  useEffect(() => {
    let disposed = false
    setSize(undefined)
    if (pdf) pdf.getPage(page).then(value => { if (!disposed) { const viewport = value.getViewport({ scale: 1 }); setSize({ width: viewport.width, height: viewport.height }) } }).catch(cause => { if (!disposed) setError(cause.message) })
    return () => { disposed = true }
  }, [pdf, page])
  return <details><summary>{sheet ? 'Replace drawing revision' : 'Upload drawing'}</summary>
    {sheet && <p>A replacement keeps the original PDF and measurements. Calibrate and measure the new revision before using its quantities.</p>}
    <Form reset={false} submit={sheet ? 'Upload replacement revision' : 'Upload drawing sheet'} action={async form => {
      if (!file || !pdf || !size) throw new Error('Choose a readable PDF and wait for page inspection.')
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(new Error('Could not read PDF bytes.')); reader.readAsDataURL(file) })
      const result = await mutate('/takeoff' + (sheet ? `/${sheet.id}/revise` : ''), { name: form.get('name'), page, ...size, document: { name: file.name, mime: 'application/pdf', base64 } })
      const saved = sheet?.id ?? result.job?.takeoff?.at(-1)?.id
      if (saved) onSaved(saved)
    }}>
      <Field label="Drawing sheet name" name="name" defaultValue={sheet?.name ?? ''} />
      <p>Original PDF, up to 2 MB per file. Choose each required page as its own sheet.</p><label>PDF drawing<input name="drawing" type="file" accept="application/pdf,.pdf" required onChange={event => setFile(event.target.files?.[0])} /></label>
      {loading && <p role="status">Inspecting PDF pages…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {pdf && <><p>{pdf.numPages} {pdf.numPages === 1 ? 'page' : 'pages'} in this PDF. Upload each needed page as a separate sheet.</p><label>Drawing page<select aria-label="Drawing page" value={page} onChange={event => setPage(Number(event.target.value))}>{Array.from({ length: pdf.numPages }, (_, index) => <option key={index + 1} value={index + 1}>Page {index + 1}</option>)}</select></label></>}
      {size && <p>Source coordinates: {size.width.toFixed(2)} × {size.height.toFixed(2)} PDF units.</p>}
    </Form>
  </details>
}

export function PointEditor({ points, revision, onChange }: { points: Point[]; revision: DrawingRevision; onChange: (points: Point[]) => void }) {
  const [x, setX] = useState(''), [y, setY] = useState(''), [error, setError] = useState('')
  return <fieldset><legend>Drawing points</legend>
    <p>Coordinates use the original page, from its top left. X: 0–{revision.width.toFixed(2)}; Y: 0–{revision.height.toFixed(2)}. Points stay fixed when the drawing resizes.</p>
    <ol>{points.map((point, index) => <li key={index}>Point {index + 1}: {point.x}, {point.y} <button type="button" className="secondary" aria-label={`Remove point ${index + 1}`} onClick={() => onChange(points.filter((_, item) => item !== index))}>Remove</button></li>)}</ol>
    <div className="fields"><label>Point X<input type="number" min="0" max={revision.width} step="any" value={x} onChange={event => setX(event.target.value)} /></label><label>Point Y<input type="number" min="0" max={revision.height} step="any" value={y} onChange={event => setY(event.target.value)} /></label></div>
    <button type="button" className="secondary" onClick={() => {
      const point = { x: Number(x), y: Number(y) }
      if (x === '' || y === '' || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > revision.width || point.y > revision.height) { setError('Enter coordinates within the drawing page.'); return }
      onChange([...points, point]); setX(''); setY(''); setError('')
    }}>Add coordinate point</button>
    {points.length > 0 && <button type="button" className="secondary" onClick={() => onChange([])}>Clear unsaved points</button>}
    {error && <p role="alert" className="error">{error}</p>}
    <p role="status">{points.length} unsaved {points.length === 1 ? 'point' : 'points'}.</p>
  </fieldset>
}
