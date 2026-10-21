import { useEffect, useState } from 'react'
import { Field, Form } from './shared'
import { PunchAnswerFields, readPunchAnswers, punchPhoto, type PunchMutate } from './punch-forms'
import type { PunchForm } from '../plinth/punch-model'
export interface PunchSheet { id: string; name: string; revisions: { id: string; revision: number; page: number }[] }
export function PunchCapture({ forms, sheets, mutate }: { forms: PunchForm[]; sheets: PunchSheet[]; mutate: PunchMutate }) {
 const [formId, setFormId] = useState(''), [photo, setPhoto] = useState<File>(), [preview, setPreview] = useState(''), [point, setPoint] = useState({ x: .5, y: .5 })
 useEffect(() => { if (!photo) { setPreview(''); return } const url = URL.createObjectURL(photo); setPreview(url); return () => URL.revokeObjectURL(url) }, [photo])
 const form = forms.find(f => f.id === formId)
 return <Form reset={false} submit="Create punch observation" action={async data => {
  if (!photo) throw new Error('Choose an original observation photo.')
  const revision = String(data.get('sheet')), sheet = sheets.find(s => s.revisions.some(r => r.id === revision))
  await mutate('/issues', { title: data.get('title'), description: data.get('description'), kind: data.get('kind'), severity: data.get('severity'), due_on: data.get('due'), location: data.get('location'), photo: await punchPhoto(photo), annotation: { ...point, note: data.get('annotation') }, ...(sheet ? { sheet: { sheet_id: sheet.id, revision_id: revision } } : {}), ...(form ? { form_id: form.id } : {}), answers: readPunchAnswers(form, data) })
 }}>
  <Field label="Observation title" name="title" maxLength={200}/><label>Observation details<textarea name="description" required maxLength={8000}/></label>
  <label>Observation type<select aria-label="Observation type" name="kind"><option value="punch">Punch</option><option value="quality">Quality</option><option value="safety">Safety observation</option></select></label><label>Severity<select aria-label="Severity" name="severity"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="critical">Critical</option></select></label>
  <Field label="Observation due date" name="due" type="date"/><Field label="Observation location" name="location" maxLength={500}/>
  <label>Exact drawing reference<select aria-label="Exact drawing reference" name="sheet"><option value="">No sheet reference</option>{sheets.flatMap(s => s.revisions.map(r => <option key={r.id} value={r.id}>{s.name} · revision {r.revision} · page {r.page}</option>))}</select></label>
  <label>Original observation photo<input type="file" name="photo" required accept="image/png,image/jpeg" capture="environment" onChange={e => { setPhoto(e.target.files?.[0]); setPoint({ x: .5, y: .5 }) }}/></label>
  {preview && <><p>Tap the photo to mark the observation, or set its position below.</p><div style={{ position: 'relative', width: 420, maxWidth: '100%' }}><img src={preview} alt="Observation photo to annotate" style={{ display: 'block', width: '100%' }} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setPoint({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }) }}/><span aria-hidden="true" style={{ position: 'absolute', left: `${point.x * 100}%`, top: `${point.y * 100}%`, transform: 'translate(-50%, -50%)', color: 'var(--ox)', fontSize: 30, pointerEvents: 'none' }}>⊕</span></div></>}
  <label>Annotation horizontal position (%)<input name="x" type="number" min="0" max="100" step="0.1" value={Number((point.x * 100).toFixed(1))} onChange={e => setPoint(p => ({ ...p, x: Number(e.target.value) / 100 }))}/></label><label>Annotation vertical position (%)<input name="y" type="number" min="0" max="100" step="0.1" value={Number((point.y * 100).toFixed(1))} onChange={e => setPoint(p => ({ ...p, y: Number(e.target.value) / 100 }))}/></label>
  <Field label="Photo annotation" name="annotation" maxLength={1000}/>
  <label>Reusable field form<select aria-label="Reusable field form" name="form" value={formId} onChange={e => setFormId(e.target.value)}><option value="">No field form</option>{forms.map(f => <option key={f.id} value={f.id}>{f.name} · revision {f.revision}</option>)}</select></label><PunchAnswerFields form={form}/>
 </Form>
}
