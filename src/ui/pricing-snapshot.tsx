import type { PricingSnapshot } from '../plinth/pricing-model'
import { money } from './shared'
/** The same immutable calculation is readable in the review and after saving/reloading. */
export function PricingBreakdown({pricing}:{pricing:PricingSnapshot}) {
 return <><p>Basis: {pricing.basis === 'cost' ? 'Recorded estimated costs' : 'Original estimated selling lines'}</p>
 <ol>{pricing.stages.map((stage,index)=><li key={index}>{stage.kind} · {stage.scope}{stage.key?`: ${stage.key}`:''} · {stage.percent}% · {money(stage.base_cents)} {stage.adjustment_cents<0?'−':'+'} {money(Math.abs(stage.adjustment_cents))} = {money(stage.total_cents)}</li>)}</ol>
 <p>Taxable {money(pricing.tax.taxable_cents)} · exempt {money(pricing.tax.exempt_cents)} · tax {money(pricing.tax.tax_cents)}.</p>
 <p>{pricing.tax.rate.jurisdiction} · {pricing.tax.rate.kind} {pricing.tax.rate.percent}% · effective {pricing.tax.rate.effective_on} · revision {pricing.tax.rate_version} · human reviewed. Source: {pricing.tax.rate.reference}</p>
 {pricing.tax.exemption_reference&&<p>Exemption evidence: {pricing.tax.exemption_reference}</p>}</>
}
