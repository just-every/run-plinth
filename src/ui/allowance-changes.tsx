import { useEffect, useState } from 'react'
import type { Currency, Variation } from '../plinth/model'
import type { PricingRate } from '../plinth/pricing-model'
import type { SelectionRevision } from '../plinth/selection-model'
import type { JobProps } from './job'
import { Action, api, cents, Field, Form, money } from './shared'
import { PricingBreakdown } from './pricing-snapshot'

export function AllowanceChangeSummary({ variation, currency, canApprove, mutate }: { variation: Variation; currency?: Currency; canApprove: boolean; mutate: JobProps['mutate'] }) {
 const a = variation.allowance_change
 if (!a) return null
 const s = a.selection_snapshot
 return <section className="record"><h4>Allowance change · {variation.status}</h4>
  <p>Recorded choice: {s.option.name} · selection revision {s.revision}. Price {money(s.option.price_cents, currency)} less allowance {money(s.allowance_cents, currency)} = {money(a.economic_delta_cents, currency)}.</p>
  <p>Previously approved adjustment {money(a.prior_economic_delta_cents, currency)}. This change: {money(variation.amount_cents, currency)}.</p>
  <p>Reviewed schedule impact: {a.impacts.schedule_days} calendar days. {a.impacts.impact_reference}</p>
  <p className="muted">Client approval records these exact terms. Schedule dates and supplier orders require their own approval.</p>
  {canApprove && variation.status === 'draft' && <Action className="primary" action={() => mutate(`/variations/${variation.id}/approve`)}>Approve exact allowance change: {money(variation.amount_cents, currency)}</Action>}
 </section>
}

export function AllowanceChangeReview({ job, mutate, selectionId, revision }: Pick<JobProps, 'job' | 'mutate'> & { selectionId: string; revision: SelectionRevision }) {
 const [rates, setRates] = useState<PricingRate[]>([]), [error, setError] = useState('')
 const [preview, setPreview] = useState<any>(), [review, setReview] = useState<Record<string, unknown>>()
 useEffect(() => { api('/pricing-rates').then(r => setRates(r.rates)).catch(e => setError(e.message)) }, [])
 useEffect(() => setPreview(undefined), [job.version])
 const prior = job.variations.filter(v => v.status === 'approved' && v.allowance_change?.selection_id === selectionId).at(-1)?.allowance_change?.economic_delta_cents ?? 0
 const amount = revision.signature!.option.price_cents - revision.allowance_cents - prior
 if (!amount) return <p>This choice needs no further allowance charge or credit.</p>
 return <details className="side-section"><summary>Review allowance charge or credit</summary>
  <p>Exact incremental adjustment: {money(amount, job.currency)}. Review the final selling price, tax, procurement and schedule impacts before preparing the client proposal.</p>
  {error && <p role="alert">{error}</p>}
  <Form reset={false} submit="Preview allowance change" action={async form => {
   const freight=cents(form.get('freight')),code=revision.cost_code
   const lines=[{id:'allowance-scope',description:`${revision.room}: ${revision.category} allowance adjustment`,quantity:'1',unit:'each',cost_code:code,phase:'Allowance change',category:'material',unit_cents:cents(form.get('base')),...(String(form.get('internal_cost')??'').trim()?{cost_unit_cents:cents(form.get('internal_cost'))}:{})},...(freight?[{id:'allowance-freight',description:'Selection freight adjustment',quantity:'1',unit:'shipment',cost_code:code,phase:'Allowance change',category:'other',unit_cents:freight,...(String(form.get('freight_cost')??'').trim()?{cost_unit_cents:cents(form.get('freight_cost'))}:{})}]:[])]
   const input = { selection_id: selectionId, revision_id: revision.id, schedule_days: Number(form.get('days')), impact_reference: form.get('impact'), impacts_reviewed: form.get('reviewed') === 'on', basis: 'sell', as_of: form.get('as_of'), lines, rules: [{ scope: 'project', overhead_percent: String(form.get('overhead')), method: 'markup', percent: String(form.get('markup')), discount_percent: String(form.get('discount')) }], tax: { rate_id: form.get('rate_id'), provider: 'manual', taxable_line_ids: form.get('taxable') === 'on' ? lines.map(l=>l.id) : [], exemption_reference: form.get('exemption') } }
   setPreview(undefined); const result = await mutate('/allowance-changes/preview', input); setReview(input); setPreview({ ...result.preview, job_version: job.version })
  }}><div onChange={() => setPreview(undefined)}>
   <Field label="Allowance change base selling amount (USD)" name="base" inputMode="decimal" defaultValue={(Math.abs(amount) / 100).toFixed(2)} />
   <Field label="Allowance freight adjustment (USD)" name="freight" inputMode="decimal" defaultValue="0.00"/><Field label="Internal cost adjustment before freight (USD, optional)" name="internal_cost" inputMode="decimal" required={false}/><Field label="Internal freight cost adjustment (USD, optional)" name="freight_cost" inputMode="decimal" required={false}/>
   <div className="fields"><Field label="Allowance overhead percent" name="overhead" inputMode="decimal" defaultValue="0" /><Field label="Allowance markup percent" name="markup" inputMode="decimal" defaultValue="0" /><Field label="Allowance discount percent" name="discount" inputMode="decimal" defaultValue="0" /></div>
   <label>Allowance reviewed tax rate<select required name="rate_id"><option value="">Choose reviewed rate</option>{rates.map(rate => <option key={rate.id} value={rate.id}>{rate.revisions.at(-1)!.jurisdiction} · {rate.revisions.at(-1)!.percent}%</option>)}</select></label>
   <Field label="Allowance tax selection date" name="as_of" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
   <label><input name="taxable" type="checkbox" defaultChecked />Allowance adjustment is taxable</label>
   <Field label="Allowance exemption evidence" name="exemption" required={false} />
   <Field label="Reviewed schedule impact (calendar days)" name="days" type="number" min="-3650" max="3650" defaultValue="0" />
   <Field label="Price, procurement and schedule review reference" name="impact" maxLength={2000} />
   <label><input name="reviewed" type="checkbox" required />I reviewed the exact price, procurement and schedule impacts.</label>
  </div></Form>
  {preview && <section className="record"><h4>Proposed allowance {preview.proposal.pricing_direction}: {money(preview.proposal.amount_cents, job.currency)}</h4><PricingBreakdown pricing={preview.proposal.pricing} /><p>Reviewed schedule impact: {preview.proposal.allowance_change.impacts.schedule_days} calendar days. {preview.proposal.allowance_change.impacts.impact_reference}</p><Action action={async () => { if (preview.job_version !== job.version) throw new Error('Job changed; preview allowance change again'); await mutate('/allowance-changes/apply', { ...review, digest: preview.digest }); setPreview(undefined) }}>Prepare exact allowance change for client</Action></section>}
 </details>
}
