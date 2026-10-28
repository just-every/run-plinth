import { useRef, useState, type ChangeEvent } from 'react'
import type { Line, Quote } from '../plinth/model'
import type { JobProps } from './job'
import { cents, Field, Form } from './shared'

type EditLine = { key: string; source?: Line; group: string; option: string }
const editLine = (source?: Line): EditLine => ({ key: source?.id ?? crypto.randomUUID(), source, group: source?.alternate_group ?? '', option: source?.alternate_option ?? '' })
const amount = (value?: number) => value === undefined ? '' : (value / 100).toFixed(2)
const terms = (value: FormDataEntryValue | null) => String(value ?? '').split('\n').map(line => line.trim()).filter(Boolean)

/** The existing one-amount quote stays available; this form prepares measured revisions. */
export function EstimateEditor({ quote, mutate }: { quote?: Quote; mutate: JobProps['mutate'] }) {
 const [rows, setRows] = useState<EditLine[]>(() => quote?.lines.map(editLine) ?? [editLine()])
 const editor = useRef<HTMLDetailsElement>(null)
 const focusLine = (index: number) => requestAnimationFrame(() => editor.current?.querySelectorAll<HTMLInputElement>('input[name$="-description"]')[index]?.focus())
 const groups = new Map<string, Set<string>>()
 for (const row of rows) if (row.group.trim() && row.option.trim()) {
  const options = groups.get(row.group.trim()) ?? new Set<string>(); options.add(row.option.trim()); groups.set(row.group.trim(), options)
 }
 return <details ref={editor} className="side-section"><summary>{quote ? 'Revise measured estimate' : 'Build a measured estimate'}</summary>
  <p>Enter measurement and rate units. For a conversion, enter the exact numerator and denominator: 18 inches at a rate per foot uses 1 ÷ 12. Each cost and selling line rounds half-up to cents before totals are added.</p>
  <Form reset={false} submit="Prepare measured estimate revision" action={async f => {
   const lines = rows.map((row, index) => {
    const get = (name: string) => f.get(`line-${index}-${name}`)
    const cost = get('cost')
    return { id: row.key, description: get('description'), quantity: get('quantity'), unit: get('unit'), rate_unit: get('rate-unit'), cost_code: get('code'), phase: get('phase'), category: get('category'), unit_cents: cents(get('sell'), `line-${index}-sell`), ...(row.source?.product_source?{product_source:row.source.product_source}:{}), ...(cost ? { cost_unit_cents: cents(cost, `line-${index}-cost`) } : {}), conversion: { numerator: get('numerator'), denominator: get('denominator') }, alternate_group: get('group'), alternate_option: get('option') }
   })
   const alternate_selections = Object.fromEntries([...groups.keys()].flatMap((group, index) => { const selected = f.get(`alternate-${index}`); return selected ? [[group, selected]] : [] }))
   await mutate('/quotes', { lines, alternate_selections, inclusions: terms(f.get('inclusions')), exclusions: terms(f.get('exclusions')), notes: f.get('estimate-notes') || undefined })
  }}>
   {rows.map((row, index) => {
    const source = row.source, name = (field: string) => `line-${index}-${field}`
    return <section className="record" key={row.key} aria-label={`Estimate line ${index + 1}`}><h3>Line {index + 1}</h3>
     <Field label={`Description ${index + 1}`} name={name('description')} defaultValue={source?.description ?? ''} maxLength={500} />
     <div className="fields"><Field label={`Cost code ${index + 1}`} name={name('code')} defaultValue={source?.cost_code ?? ''} maxLength={80} /><Field label={`Phase ${index + 1}`} name={name('phase')} defaultValue={source?.phase ?? ''} maxLength={120} /></div>
     <label>Cost category {index + 1}<select aria-label={`Cost category ${index + 1}`} name={name('category')} defaultValue={source?.category ?? 'labor'}>{['labor', 'material', 'equipment', 'subcontract', 'other'].map(category => <option key={category} value={category}>{category[0]!.toUpperCase() + category.slice(1)}</option>)}</select></label>
     <div className="fields"><Field label={`Quantity ${index + 1}`} name={name('quantity')} inputMode="decimal" defaultValue={source?.quantity ?? '1'} /><Field label={`Measurement unit ${index + 1}`} name={name('unit')} defaultValue={source?.unit ?? 'each'} maxLength={40} /></div>
     <Field label={`Rate unit ${index + 1}`} name={name('rate-unit')} defaultValue={source?.rate_unit ?? source?.unit ?? 'each'} maxLength={40} />
     <div className="fields"><Field label={`Conversion numerator ${index + 1}`} name={name('numerator')} inputMode="decimal" defaultValue={source?.conversion?.numerator ?? '1'} /><Field label={`Conversion denominator ${index + 1}`} name={name('denominator')} inputMode="decimal" defaultValue={source?.conversion?.denominator ?? '1'} /></div>
     <div className="fields"><Field label={`Unit cost ${index + 1}`} name={name('cost')} inputMode="decimal" required={false} defaultValue={amount(source?.cost_unit_cents)} /><Field label={`Unit selling price ${index + 1}`} name={name('sell')} inputMode="decimal" defaultValue={amount(source?.unit_cents)} /></div>
     <div className="fields"><Field label={`Alternate group ${index + 1}`} name={name('group')} required={false} value={row.group} maxLength={100} onChange={(event: ChangeEvent<HTMLInputElement>) => setRows(current => current.map(item => item.key === row.key ? { ...item, group: event.target.value } : item))} /><Field label={`Alternate option ${index + 1}`} name={name('option')} required={false} value={row.option} maxLength={100} onChange={(event: ChangeEvent<HTMLInputElement>) => setRows(current => current.map(item => item.key === row.key ? { ...item, option: event.target.value } : item))} /></div>
     <button type="button" className="secondary" disabled={rows.length === 1} onClick={() => { setRows(current => current.filter(item => item.key !== row.key)); focusLine(Math.min(index, rows.length - 2)) }}>Remove line {index + 1}</button>
    </section>
   })}
   <button type="button" className="secondary" disabled={rows.length >= 100} onClick={() => { setRows(current => [...current, editLine()]); focusLine(rows.length) }}>Add estimate line</button>
   {!!groups.size && <section className="record"><h3>Choose alternates</h3><p>Lines in an alternate group are included only for the selected option. Other lines remain in the base scope.</p>{[...groups.entries()].map(([group, options], index) => <label key={group}>Selected option: {group}<select aria-label={`Selected option: ${group}`} name={`alternate-${index}`} defaultValue={quote?.alternate_selections?.[group] ?? ''}><option value="">No option included</option>{[...options].map(option => <option key={option} value={option}>{option}</option>)}</select></label>)}</section>}
   <label>Inclusions (one per line)<textarea aria-label="Inclusions (one per line)" name="inclusions" rows={3} defaultValue={quote?.inclusions?.join('\n') ?? ''} /></label>
   <label>Exclusions (one per line)<textarea aria-label="Exclusions (one per line)" name="exclusions" rows={3} defaultValue={quote?.exclusions?.join('\n') ?? ''} /></label>
   <label>Estimate notes<textarea aria-label="Estimate notes" name="estimate-notes" rows={3} defaultValue={quote?.notes ?? ''} /></label>
  </Form>
 </details>
}
