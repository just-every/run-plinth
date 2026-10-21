import { useState } from 'react'
import type { PunchAnswers, PunchField, PunchForm } from '../plinth/punch-model'
import { Field, Form } from './shared'

export type PunchMutate = (path: string, value: Record<string, unknown>) => Promise<unknown>
export function PunchFormEditor({ forms, mutate }: { forms: PunchForm[]; mutate: PunchMutate }) {
 const [base, setBase] = useState(''), [fields, setFields] = useState<PunchField[]>([{ id: 'field-1', label: '', type: 'boolean', required: true }])
 const update = (index: number, value: Partial<PunchField>) => setFields(rows => rows.map((r, i) => i === index ? { ...r, ...value } : r))
 return <details><summary>Configure reusable field forms</summary><Form reset={false} submit="Save form revision" action={async f => { await mutate('/forms' + (base ? '/' + base : ''), { name: f.get('name'), fields }); }}>
  <label>Revise an existing form<select name="base" value={base} onChange={e => { setBase(e.target.value); const form = forms.find(f => f.id === e.target.value); if (form) setFields(structuredClone(form.fields)) }}><option value="">New reusable form</option>{forms.map(f => <option key={f.id} value={f.id}>{f.name} · revision {f.revision}</option>)}</select></label>
  <Field label="Field form name" name="name" maxLength={200}/>
  {fields.map((field, i) => <section className="record" key={i}><label>Question {i + 1}<input aria-label={`Question ${i + 1}`} value={field.label} required maxLength={200} onChange={e => update(i, { label: e.target.value })}/></label><label>Answer type {i + 1}<select aria-label={`Answer type ${i + 1}`} value={field.type} onChange={e => update(i, { type: e.target.value as PunchField['type'], ...(e.target.value === 'choice' ? { options: ['Pass', 'Needs attention'] } : { options: undefined }) })}><option value="boolean">Yes / no</option><option value="text">Written answer</option><option value="choice">Choose an option</option></select></label>{field.type === 'choice' && <label>Options {i + 1} (comma separated)<input value={field.options?.join(', ') ?? ''} required onChange={e => update(i, { options: e.target.value.split(',').map(v => v.trim()) })}/></label>}<label><input type="checkbox" checked={field.required} onChange={e => update(i, { required: e.target.checked })}/> Required answer {i + 1}</label>{fields.length > 1 && <button type="button" className="secondary" onClick={() => setFields(rows => rows.filter((_, n) => n !== i))}>Remove question {i + 1}</button>}</section>)}
  {fields.length < 30 && <button type="button" className="secondary" onClick={() => setFields(rows => [...rows, { id: crypto.randomUUID(), label: '', type: 'text', required: true }])}>Add form question</button>}
 </Form><p>Saved revisions remain available. Observations keep the exact questions and answers captured with them.</p></details>
}
export function PunchAnswerFields({ form }: { form?: PunchForm }) {
 return <>{form?.fields.map(field => <label key={form.id + field.id}>{field.label}{field.type === 'text' ? <textarea name={'answer:' + field.id} required={field.required} maxLength={4000}/> : <select aria-label={field.label} name={'answer:' + field.id} required={field.required}><option value="">Choose an answer</option>{field.type === 'boolean' ? <><option value="true">Yes</option><option value="false">No</option></> : field.options?.map(v => <option key={v}>{v}</option>)}</select>}</label>)}</>
}
export function readPunchAnswers(form: PunchForm | undefined, data: FormData): PunchAnswers {
 return Object.fromEntries((form?.fields ?? []).flatMap(field => { const value = data.get('answer:' + field.id); return value === null || value === '' ? [] : [[field.id, field.type === 'boolean' ? value === 'true' : String(value)]] }))
}
export async function punchPhoto(file: File) {
 if (file.size === 0 || file.size > 2_097_152) throw new Error('Choose an original PNG or JPEG photo up to 2 MB.')
 const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(new Error('Could not read the original photo.')); reader.readAsDataURL(file) })
 return { name: file.name, mime: file.type, base64 }
}
