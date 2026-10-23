import { PricingBreakdown } from './pricing-snapshot'
import { useEffect, useState } from 'react'
import type { PricingRate, PricingRule, PricingSnapshot } from '../plinth/pricing-model'
import type { JobProps } from './job'
import { Action, api, Field, Form, money } from './shared'

type RuleEditor = { id: string; scope: PricingRule['scope'] }
const newRule = (): RuleEditor => ({ id: crypto.randomUUID(), scope: 'project' })

export function EstimatePricing({ job, mutate, rates: maintain = true }: Pick<JobProps, 'job' | 'mutate'> & { rates?: boolean }) {
 const [rates, setRates] = useState<PricingRate[]>([]), [error, setError] = useState(''), [rateId, setRateId] = useState(''), [editId, setEditId] = useState('')
 const [rules, setRules] = useState<RuleEditor[]>([newRule()]), [preview, setPreview] = useState<any>(), [review, setReview] = useState<Record<string, unknown>>()
 const current = job.quotes.at(-1), snapshot = (current as typeof current & { pricing?: PricingSnapshot })?.pricing
 const lines = (snapshot?.base_lines ?? current?.lines ?? []).filter(line => line.included !== false).map((line, index) => ({ ...line, id: line.id ?? `legacy-${index + 1}` }))
 const phases = [...new Set(lines.map(line => line.phase).filter((phase): phase is string => !!phase))]
 const selectedRate = rates.find(rate => rate.id === editId), selectedRevision = selectedRate?.revisions.at(-1)
 async function refresh() { const result = await api('/pricing-rates'); setRates(result.rates); setPreview(undefined) }
 useEffect(() => { refresh().catch(e => setError(e.message)) }, [])
 useEffect(() => { setPreview(undefined) }, [job.id, current?.id])
 return <details className="side-section"><summary>Overhead, markup, discounts and reviewed tax</summary>
  <p>Review scoped overhead, markup or target gross margin, then discounts and sales or use tax. Every stage rounds half-up to cents. Within each stage, line rules run before phase rules, then project rules; wider rules compound on the earlier result. Rounded scope totals are allocated to lines proportionally, with remaining cents assigned by largest remainder in line order.</p>
  {error && <p role="alert">{error}</p>}
  {maintain && <details><summary>Record a human-reviewed jurisdiction rate</summary>
   <label>Rate to revise<select aria-label="Rate to revise" value={editId} onChange={event => setEditId(event.target.value)}><option value="">New reviewed rate</option>{rates.map(rate => <option key={rate.id} value={rate.id}>{rate.revisions.at(-1)!.jurisdiction} · revision {rate.version}</option>)}</select></label>
   <Form key={`${editId}-${selectedRate?.version ?? 0}`} reset={false} submit={selectedRate ? 'Record reviewed rate revision' : 'Record reviewed rate'} action={async form => {
    await api('/pricing-rates' + (editId ? '/' + editId : ''), { expected_version: selectedRate?.version, jurisdiction: form.get('jurisdiction'), kind: form.get('kind'), percent: form.get('percent'), effective_on: form.get('effective_on'), reference: form.get('reference'), human_reviewed: form.get('human_reviewed') === 'on' })
    await refresh()
   }}>
    <Field label="Tax jurisdiction" name="jurisdiction" defaultValue={selectedRevision?.jurisdiction ?? ''} />
    <label>Tax kind<select name="kind" defaultValue={selectedRevision?.kind ?? 'sales'}><option value="sales">Sales tax</option><option value="use">Use tax</option></select></label>
    <div className="fields"><Field label="Tax percent" name="percent" inputMode="decimal" defaultValue={selectedRevision?.percent ?? ''} /><Field label="Effective date" name="effective_on" type="date" defaultValue={selectedRevision?.effective_on ?? new Date().toISOString().slice(0, 10)} /></div>
    <Field label="Reviewed rate source reference" name="reference" defaultValue={selectedRevision?.reference ?? ''} maxLength={2000} />
    <label><input name="human_reviewed" type="checkbox" required />I have reviewed the dated jurisdiction rate and source evidence.</label>
   </Form>
   {selectedRate && <ul>{selectedRate.revisions.map(revision => <li key={revision.version}>Revision {revision.version}: {revision.kind} {revision.percent}% · {revision.effective_on} · {revision.reference} · human reviewed by {revision.approved_by.name}</li>)}</ul>}
  </details>}
  {!current ? <p>Prepare an estimate before reviewing pricing.</p> : <>
   <Form reset={false} submit="Preview pricing and tax" action={async form => {
    const input = { quote_id: current.id, basis: form.get('basis'), as_of: form.get('as_of'), rules: rules.map(rule => ({ scope: rule.scope, ...(rule.scope === 'project' ? {} : { key: form.get(`${rule.id}-key`) }), overhead_percent: form.get(`${rule.id}-overhead`), method: form.get(`${rule.id}-method`), percent: form.get(`${rule.id}-percent`), discount_percent: form.get(`${rule.id}-discount`) })), tax: { rate_id: form.get('rate_id'), provider: 'manual', taxable_line_ids: form.getAll('taxable_line_ids'), exemption_reference: form.get('exemption_reference') } }
    setPreview(undefined); const result = await mutate('/pricing/preview', input); setReview(input); setPreview({ ...result.preview, job_version: job.version })
   }}>
    <div onChange={() => setPreview(undefined)}>
     <label>Pricing base<select name="basis" defaultValue="sell"><option value="sell">Original estimated selling lines</option><option value="cost">Recorded estimated costs</option></select></label>
     {rules.map((rule, index) => <section className="record" key={rule.id} aria-label={`Pricing rule ${index + 1}`}><h3>Pricing rule {index + 1}</h3>
      <label>Rule {index + 1} scope<select name={`${rule.id}-scope`} value={rule.scope} onChange={event => { const scope = event.target.value as PricingRule['scope']; setRules(currentRules => currentRules.map(item => item.id === rule.id ? { ...item, scope } : item)) }}><option value="project">Whole project</option><option value="phase">Phase group</option><option value="line">Estimate line</option></select></label>
      {rule.scope === 'line' && <label>Rule {index + 1} line<select name={`${rule.id}-key`}>{lines.map(line => <option key={line.id} value={line.id}>{line.description}</option>)}</select></label>}
      {rule.scope === 'phase' && <label>Rule {index + 1} phase<select name={`${rule.id}-key`}>{phases.map(phase => <option key={phase} value={phase}>{phase}</option>)}</select></label>}
      <Field label={`Rule ${index + 1} overhead percent`} name={`${rule.id}-overhead`} inputMode="decimal" defaultValue="0" />
      <label>Rule {index + 1} pricing method<select name={`${rule.id}-method`}><option value="markup">Markup on current base</option><option value="margin">Target gross margin on current base</option></select></label>
      <div className="fields"><Field label={`Rule ${index + 1} markup or margin percent`} name={`${rule.id}-percent`} inputMode="decimal" defaultValue="0" /><Field label={`Rule ${index + 1} discount percent`} name={`${rule.id}-discount`} inputMode="decimal" defaultValue="0" /></div>
      <button type="button" className="secondary" onClick={() => { setRules(currentRules => currentRules.filter(item => item.id !== rule.id)); setPreview(undefined) }}>Remove pricing rule {index + 1}</button>
     </section>)}
     <button type="button" className="secondary" disabled={rules.length >= 201} onClick={() => { setRules(currentRules => [...currentRules, newRule()]); setPreview(undefined) }}>Add scoped pricing rule</button>
     <h3>Review taxable and exempt scope</h3><p>Manual calculation uses a dated rate and exemption evidence reviewed by a person. Provider calculation is unavailable.</p>
     <label>Human-reviewed tax rate<select name="rate_id" value={rateId} required onChange={event => setRateId(event.target.value)}><option value="">Choose reviewed rate</option>{rates.map(rate => { const latest = rate.revisions.at(-1)!; return <option key={rate.id} value={rate.id}>{latest.jurisdiction} · {latest.kind} · {latest.percent}% · revision {rate.version}</option> })}</select></label>
     <Field label="Tax rate selection date" name="as_of" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
     <fieldset><legend>Taxable included lines</legend>{lines.map(line => <label key={line.id}><input name="taxable_line_ids" value={line.id} type="checkbox" defaultChecked />{line.description}</label>)}</fieldset>
     <Field label="Exemption evidence for unchecked lines" name="exemption_reference" required={false} maxLength={2000} />
    </div>
   </Form>
   {preview && <section className="record"><h3>Pricing impact · quote {current.revision}</h3><p>Previous {money(preview.previous_total_cents)} → proposed {money(preview.proposal.total_cents)} · change {money(preview.total_delta_cents)}</p>
    <PricingBreakdown pricing={preview.proposal.pricing} />
    <ul>{preview.proposal.lines.filter((line: any) => line.included !== false).map((line: any) => <li key={line.id}>{line.description}: final selling amount {money(line.total_cents)}</li>)}</ul>
    {preview.sold ? <p className="notice">Sold estimate: impact preview only. Use a change order for revised terms.</p> : <Action action={async () => { if (preview.job_version !== job.version) throw new Error('Job changed; preview pricing again'); await mutate('/pricing/apply', { ...review, digest: preview.digest }); setPreview(undefined) }}>Approve pricing as a new draft revision</Action>}
   </section>}
  </>}
 </details>
}
