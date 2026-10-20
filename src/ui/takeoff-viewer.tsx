/// <reference types="vite/client" />
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Calibration, DrawingRevision, Point, TakeoffMeasurement } from '../plinth/takeoff-model'

export async function openDrawing(data: string | Uint8Array) {
  const pdf = await import('pdfjs-dist')
  pdf.GlobalWorkerOptions.workerSrc = workerUrl
  return pdf.getDocument(typeof data === 'string' ? { url: data } : { data }).promise
}

export const drawingUrl = (jobId: string, revision: DrawingRevision) => `/api/plinth/jobs/${encodeURIComponent(jobId)}/takeoff-files/${encodeURIComponent(revision.document.id)}`

function Geometry({ points, kind, color, label, width }: { points: Point[]; kind: string; color: string; label: string; width: number }) {
  if (!points.length) return null
  const coordinates = points.map(point => `${point.x},${point.y}`).join(' ')
  return <g aria-label={label}>
    <title>{label}</title>
    {kind === 'area' ? <polygon points={coordinates} fill={color} fillOpacity="0.14" stroke={color} strokeWidth={width} /> : kind !== 'count' && <polyline points={coordinates} fill="none" stroke={color} strokeWidth={width} />}
    {points.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r={width * 2} fill={color} stroke="white" strokeWidth={width / 2} /><text x={point.x + width * 3} y={point.y - width * 3} fontSize={width * 6} fill={color} stroke="white" strokeWidth={width / 3} paintOrder="stroke">{index + 1}</text></g>)}
  </g>
}

export function TakeoffViewer({ jobId, revision, points, mode, calibrations, measurements, onPoint, editable }: {
  jobId: string; revision: DrawingRevision; points: Point[]; mode: string; calibrations: Calibration[]; measurements: TakeoffMeasurement[]; onPoint: (point: Point) => void; editable: boolean
}) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const [document, setDocument] = useState<PDFDocumentProxy>(), [width, setWidth] = useState(0), [error, setError] = useState(''), [rendered, setRendered] = useState(false), [retry, setRetry] = useState(0)
  useEffect(() => {
    let disposed = false, loaded: PDFDocumentProxy | undefined
    setDocument(undefined); setRendered(false); setError('')
    openDrawing(drawingUrl(jobId, revision)).then(pdf => { loaded = pdf; if (disposed) void pdf.loadingTask.destroy(); else setDocument(pdf) }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : 'Could not open PDF.') })
    return () => { disposed = true; void loaded?.loadingTask.destroy() }
  }, [jobId, revision.document.id, retry])
  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(entries => setWidth(entries[0]!.contentRect.width))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!document || !canvas.current || !width) return
    let disposed = false, render: { cancel: () => void; promise: Promise<void> } | undefined
    setRendered(false); setError('')
    document.getPage(revision.page).then(page => {
      if (disposed || !canvas.current) return
      const scale = width / revision.width, ratio = Math.min(window.devicePixelRatio || 1, 2), viewport = page.getViewport({ scale: scale * ratio })
      canvas.current.width = Math.ceil(viewport.width); canvas.current.height = Math.ceil(viewport.height)
      const context = canvas.current.getContext('2d')
      if (!context) throw new Error('This browser could not create a PDF canvas.')
      render = page.render({ canvas: canvas.current, canvasContext: context, viewport })
      return render.promise
    }).then(() => { if (!disposed) setRendered(true) }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : 'Could not render PDF page.') })
    return () => { disposed = true; render?.cancel() }
  }, [document, width, revision.page, revision.width, revision.height])
  const strokeWidth = Math.max(1, revision.width / Math.max(width, 1) * 2)
  return <section aria-label={`Drawing revision ${revision.revision}, page ${revision.page}`}>
    <p>{rendered ? 'PDF ready. Choose points on the drawing or enter coordinates below.' : error ? 'PDF unavailable.' : 'Rendering PDF…'}</p>
    {error && <p role="alert" className="error">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry PDF</button></p>}
    <div ref={host} style={{ position: 'relative', width: '100%', maxWidth: revision.width, aspectRatio: `${revision.width} / ${revision.height}`, background: '#fff', overflow: 'hidden' }}>
      <canvas ref={canvas} aria-label={`Original drawing: ${revision.document.name}, page ${revision.page}`} style={{ display: 'block', width: '100%', height: '100%' }} />
      {rendered && <svg role="img" aria-label="Drawing measurement overlay. Coordinate entry is available below." viewBox={`0 0 ${revision.width} ${revision.height}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: editable ? 'crosshair' : 'default', touchAction: 'pan-y' }} onPointerDown={event => {
        if (!editable || event.button !== 0) return
        const bounds = event.currentTarget.getBoundingClientRect()
        onPoint({ x: Math.round((event.clientX - bounds.left) / bounds.width * revision.width * 100) / 100, y: Math.round((event.clientY - bounds.top) / bounds.height * revision.height * 100) / 100 })
      }}>
        {calibrations.filter(item => item.revision_id === revision.id).map(item => <Geometry key={item.id} points={item.points} kind="length" color="#757575" label={`Calibration: ${item.length} ${item.unit}`} width={strokeWidth} />)}
        {measurements.filter(item => item.revision_id === revision.id).map(item => <Geometry key={item.id} points={item.points} kind={item.kind} color={item.deduct_from ? '#903f4a' : '#167c72'} label={`${item.name}${item.deduct_from ? ' (deduction)' : ''}: ${item.annotation}`} width={strokeWidth} />)}
        <Geometry points={points} kind={mode} color="#245eb4" label="Unsaved points" width={strokeWidth} />
      </svg>}
    </div>
  </section>
}
