import { useEffect, useState } from 'react'
import type { CatalogEntry } from '../plinth/catalog-model'
import type { Point, TakeoffMeasurement, TakeoffSheet } from '../plinth/takeoff-model'
import type { JobProps } from './job'
import { Action, api, Field, Form, money } from './shared'
import { DrawingUpload, PointEditor } from './takeoff-forms'
import { drawingUrl, TakeoffViewer } from './takeoff-viewer'

type Mode = 'calibrate' | TakeoffMeasurement['kind']
const dimensionFor = (kind: Mode) => kind === 'area' ? 'floor_area' : kind === 'count' ? 'fixture_count' : 'wall_length'

export function Takeoff({ job, mutate }: Pick<JobProps, 'job' | 'mutate'>) {
  const sheets = job.takeoff ?? []
  const [sheetId, setSheetId] = useState(''), [revisionId, setRevisionId] = useState(''), [mode, setMode] = useState<Mode>('calibrate'), [points, setPoints] = useState<Point[]>([]), [dimension, setDimension] = useState('wall_length'), [parentId, setParentId] = useState(''), [calibrationId, setCalibrationId] = useState('')
  const sheet = sheets.find(item => item.id === sheetId) ?? sheets[0], latest = sheet?.revisions.at(-1), revision = sheet?.revisions.find(item => item.id === revisionId) ?? latest
  const current = revision?.id === latest?.id, calibrations = sheet?.calibrations.filter(item => item.revision_id === revision?.id) ?? [], calibration = calibrations.find(item => item.id === calibrationId) ?? calibrations.at(-1)
  const parents = sheet?.measurements.filter(item => item.revision_id === revision?.id && item.kind === mode && !item.deduct_from) ?? []
  function selectSheet(id: string) { setSheetId(id); setRevisionId('') }
  useEffect(() => { setPoints([]); setMode('calibrate'); setParentId(''); setCalibrationId('') }, [revision?.id])
  function selectMode(value: Mode) { setMode(value); setPoints([]); setDimension(dimensionFor(value)); setParentId('') }
  const editable = !!current
  return <details className="side-section"><summary>Drawing takeoff</summary>
    <p>Upload a PDF, calibrate a known length, then measure lengths, floor areas and fixture counts. Combine current sheets and deduct openings before reviewing an estimate.</p>
    <DrawingUpload mutate={mutate} onSaved={selectSheet} />
    {sheet && revision && <>
      <label>Takeoff sheet<select aria-label="Takeoff sheet" value={sheet.id} onChange={event => selectSheet(event.target.value)}>{sheets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Drawing revision<select aria-label="Drawing revision" value={revision.id} onChange={event => { setRevisionId(event.target.value); setPoints([]); setParentId(''); setCalibrationId('') }}>{sheet.revisions.map(item => <option key={item.id} value={item.id}>Revision {item.revision} · page {item.page}{item.id === latest?.id ? ' · current' : ' · historical'}</option>)}</select></label>
      <p><a href={drawingUrl(job.id, revision)} download={revision.document.name}>Download original PDF · {revision.document.name}</a> · uploaded by {revision.uploaded_by.name}</p>
      {current ? <DrawingUpload key={sheet.id} sheet={sheet} mutate={mutate} onSaved={selectSheet} /> : <p className="notice">Historical revision. Its measurements need review and cannot be used in a new estimate preview. Select the current revision to calibrate and measure again.</p>}
      <label>Measurement type<select aria-label="Measurement type" value={mode} disabled={!editable} onChange={event => selectMode(event.target.value as Mode)}><option value="calibrate">Calibrate known length</option><option value="length">Length / wall</option><option value="area">Area / floor or opening</option><option value="count">Count / fixture</option></select></label>
      <TakeoffViewer jobId={job.id} revision={revision} mode={mode} points={points} calibrations={sheet.calibrations} measurements={sheet.measurements} editable={editable} onPoint={point => setPoints(previous => mode === 'calibrate' && previous.length >= 2 ? previous : [...previous, point])} />
      {editable && <>
        <PointEditor key={revision.id} points={points} revision={revision} onChange={setPoints} />
        {mode === 'calibrate' ? <Form key={`calibrate-${revision.id}`} reset={false} submit="Save drawing calibration" action={async form => {
          if (points.length !== 2) throw new Error('Calibration needs exactly two points on a known length.')
          await mutate(`/takeoff/${sheet.id}/calibrate`, { revision_id: revision.id, points, length: form.get('length'), unit: form.get('unit') }); setPoints([]); setCalibrationId(''); setMode('length'); setDimension('wall_length')
        }}>
          <p>Choose exactly two ends of a known plan dimension. Enter the real distance between them.</p>
          <Field label="Known real-world length" name="length" type="number" min="0.000001" step="any" />
          <label>Calibration unit<select aria-label="Calibration unit" name="unit"><option value="ft">Feet</option><option value="m">Meters</option></select></label>
        </Form> : <Form key={`${revision.id}-${mode}`} reset={false} submit="Save drawing measurement" action={async form => {
          const minimum = mode === 'area' ? 3 : mode === 'count' ? 1 : 2
          if (points.length < minimum) throw new Error(`Choose at least ${minimum} drawing points for this measurement.`)
          if (mode !== 'count' && !calibration) throw new Error('Calibrate this drawing revision before measuring lengths or areas.')
          await mutate(`/takeoff/${sheet.id}/measure`, { revision_id: revision.id, ...(calibration ? { calibration_id: calibration.id } : {}), kind: mode, points, name: form.get('name'), dimension, annotation: form.get('annotation'), ...(parentId ? { deduct_from: parentId } : {}) }); setPoints([])
        }}>
          {mode === 'area' && <p>Choose polygon corners in order around the floor or opening; the last corner joins the first.</p>}
          {mode === 'length' && <p>Choose successive wall or line endpoints. Segment lengths are added together.</p>}
          {mode === 'count' && <p>Each point counts one fixture.</p>}
          {!calibration && mode !== 'count' && <p className="notice">This revision needs calibration before saving a length or area.</p>}
          {mode !== 'count' && calibrations.length > 0 && <label>Measurement calibration<select aria-label="Measurement calibration" disabled={!!parentId} value={calibration?.id ?? ''} onChange={event => setCalibrationId(event.target.value)}>{calibrations.map((item, index) => <option key={item.id} value={item.id}>Calibration {index + 1}: {item.length} {item.unit} · {item.by.name}</option>)}</select></label>}
          <Field label="Measurement name" name="name" />
          <label>Deduct opening from<select aria-label="Deduct opening from" value={parentId} onChange={event => { const parent = parents.find(item => item.id === event.target.value); setParentId(event.target.value); if (parent) { setDimension(parent.dimension); setCalibrationId(parent.calibration_id ?? '') } }}><option value="">No deduction · add quantity</option>{parents.map(item => <option key={item.id} value={item.id}>{item.name} · {item.dimension}</option>)}</select></label>
          <label>Estimate dimension<input name="dimension" value={dimension} required readOnly={!!parentId} pattern="[a-z][a-z0-9_]*" onChange={event => setDimension(event.target.value)} /></label>
          <p>Use the dimension name expected by the estimate template. Deductions use the parent measurement’s kind and dimension.</p>
          <Field label="Measurement annotation" name="annotation" />
        </Form>}
      </>}
      <MeasurementHistory jobId={job.id} sheet={sheet} />
    </>}
    <MeasuredEstimate job={job} mutate={mutate} sheets={sheets} />
  </details>
}

function MeasurementHistory({ jobId, sheet }: { jobId: string; sheet: TakeoffSheet }) {
  const current = sheet.revisions.at(-1)?.id
  return <details><summary>Saved measurements and revision history ({sheet.measurements.length})</summary>
    {sheet.measurements.length === 0 && <p>No measurements saved for this sheet.</p>}
    {sheet.revisions.toReversed().map(revision => <section key={revision.id} className="record"><h3>Revision {revision.revision}{revision.id === current ? ' · current' : ' · Needs review'}</h3>
      <p><a href={drawingUrl(jobId, revision)} download={revision.document.name}>Original PDF · page {revision.page}</a> · {revision.uploaded_by.name}</p>
      <ul>{sheet.calibrations.filter(item => item.revision_id === revision.id).map(item => <li key={item.id}>Calibration: {item.length} {item.unit}, {item.points.map(point => `(${point.x}, ${point.y})`).join(' → ')} · {item.by.name}</li>)}</ul>
      <ul>{sheet.measurements.filter(item => item.revision_id === revision.id).map(item => <li key={item.id}><strong>{item.name}</strong> · {item.kind} · {item.dimension}{item.deduct_from && ` · deduction from ${sheet.measurements.find(parent => parent.id === item.deduct_from)?.name ?? item.deduct_from}`}{revision.id !== current && ' · Needs review'}<p>{item.annotation || 'No annotation'} · {item.points.length} points · recorded by {item.by.name}</p><details><summary>Source geometry</summary><p>{item.points.map(point => `(${point.x}, ${point.y})`).join(' → ')}</p></details></li>)}</ul>
    </section>)}
  </details>
}

function MeasuredEstimate({ job, mutate, sheets }: Pick<JobProps, 'job' | 'mutate'> & { sheets: TakeoffSheet[] }) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]), [catalogError, setCatalogError] = useState(''), [templateId, setTemplateId] = useState(''), [excluded, setExcluded] = useState<string[]>([]), [preview, setPreview] = useState<any>(), [review, setReview] = useState<Record<string, unknown>>()
  const measurements = sheets.flatMap(sheet => sheet.measurements.filter(item => item.revision_id === sheet.revisions.at(-1)?.id).map(item => ({ ...item, sheet_name: sheet.name })))
  useEffect(() => { let active = true; api('/estimate-catalog').then(result => { if (active) setEntries(result.entries) }).catch(cause => { if (active) setCatalogError(cause.message) }); return () => { active = false } }, [])
  useEffect(() => { setPreview(undefined) }, [job.id, job.version])
  const templates = entries.filter(entry => entry.kind === 'template')
  function changeSelection(id: string, checked: boolean) {
    const children = measurements.filter(item => item.deduct_from === id).map(item => item.id)
    setExcluded(previous => checked ? previous.filter(item => item !== id && !children.includes(item)) : [...new Set([...previous, id, ...children])]); setPreview(undefined)
  }
  return <section className="record"><h3>Price measured quantities</h3>
    <p>Current measurements across all sheets feed template dimensions. Template assemblies define units, productivity and waste; review their priced quantities before approving a draft estimate.</p>
    <Form reset={false} submit="Preview measured estimate" action={async form => {
      const ids = measurements.filter(item => !item.deduct_from && !excluded.includes(item.id)).map(item => item.id)
      if (!ids.length) throw new Error('Select at least one current drawing measurement.')
      const input = { template_id: templateId, as_of: form.get('as_of'), measurement_ids: ids }
      setPreview(undefined); const result = await mutate('/takeoff-estimate/preview', input); setReview(input); setPreview({ ...result.preview, job_version: job.version })
    }}>
      {templates.length > 0 ? <label>Takeoff estimate template<select aria-label="Takeoff estimate template" value={templateId} required onChange={event => { setTemplateId(event.target.value); setPreview(undefined) }}><option value="">Choose estimate template</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name} · revision {item.version}</option>)}</select></label> : <><label>Takeoff estimate template ID<input name="template_id" value={templateId} required onChange={event => { setTemplateId(event.target.value); setPreview(undefined) }} /></label>{catalogError && <p role="status">Template list unavailable: {catalogError}. Enter a template ID supplied by the owner.</p>}</>}
      <Field label="Takeoff rate selection date" name="as_of" type="date" defaultValue={new Date().toISOString().slice(0, 10)} onChange={() => setPreview(undefined)} />
      <fieldset><legend>Current measurements to include</legend>
        {measurements.length === 0 && <p>Calibrate and save measurements on the current drawing revisions first.</p>}
        {measurements.filter(item => !item.deduct_from).map(item => <label key={item.id}><input type="checkbox" checked={!excluded.includes(item.id)} onChange={event => changeSelection(item.id, event.target.checked)} />{item.sheet_name} · {item.name} · {item.dimension}{measurements.filter(opening => opening.deduct_from === item.id).map(opening => ` · automatically deducts ${opening.name}`).join('')}</label>)}
      </fieldset>
      {sheets.some(sheet => sheet.measurements.some(item => item.revision_id !== sheet.revisions.at(-1)?.id)) && <p className="notice">Measurements from earlier drawing revisions need review and are excluded. Recalibrate and remeasure the current sheets.</p>}
    </Form>
    {preview && preview.job_version === job.version && <section className="record"><h3>Reviewed measured impact: {preview.catalog.template_name}</h3>
      <p>Previous {money(preview.catalog.previous_total_cents, job.currency)} → proposed {money(preview.catalog.proposal.total_cents, job.currency)} · change {money(preview.catalog.total_delta_cents, job.currency)}</p>
      <h4>Derived quantities</h4>{preview.source.dimension_changes?.length>0&&<ul>{preview.source.dimension_changes.map((change:any)=><li key={change.dimension}>{change.dimension}: {change.before??'No prior measured value'} → {change.after} {change.unit}</li>)}</ul>}
      <ul>{preview.source.measurements.map((item: any) => <li key={item.id}>{item.name} · {item.dimension}: gross {item.gross_quantity}, net {item.net_quantity} {item.unit}{item.deductions?.length > 0 && ` · deducts ${item.deductions.map((opening: any) => opening.name).join(', ')}`}</li>)}</ul>
      <p>Estimate dimensions: {Object.entries(preview.source.dimensions).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>
      <h4>Priced assembly lines</h4>
      <ul>{preview.catalog.proposal.lines.map((line: any) => <li key={line.id}>{line.phase} / {line.cost_code}: {line.description} · {line.quantity} {line.unit} · cost {money(line.cost_total_cents, job.currency)} · sell {money(line.total_cents, job.currency)}</li>)}</ul>
      {preview.catalog.sold ? <p className="notice">Sold estimate: impact preview only. Review a change order for changed terms; the accepted estimate remains fixed.</p> : <Action action={async () => {
        if (preview.job_version !== job.version) throw new Error('Job changed; preview measured quantities again.')
        await mutate('/takeoff-estimate/apply', { ...review, digest: preview.digest }); setPreview(undefined)
      }}>Approve measured draft estimate</Action>}
    </section>}
  </section>
}
