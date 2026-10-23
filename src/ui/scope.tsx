import { Continuity } from './continuity'
import { Takeoff } from './takeoff'
import { Products, ProductSource } from './products'
import { AllowanceChangeSummary } from './allowance-changes'
import { QuoteAcceptance, BudgetComparison } from './quote-acceptance'
import { PricingBreakdown } from './pricing-snapshot'
import { EstimatePricing } from './estimate-pricing'
import { EstimateCatalog } from './estimate-catalog'
import { Badge, Action, cents, dateTime, day, Field, Form, money } from './shared'
import type { JobProps } from './job'
import { estimating } from './authority'
import { EstimateEditor } from './estimate-editor'
import { EstimateComparison, EstimateTerms } from './estimate-revisions'

export function Quotes({job,manager,role,mutate}: JobProps) {
  const estimator = estimating(role), accepted = job.quotes.some(q => q.status === 'accepted')
  return <div className="split"><section className="card"><div className="card-head"><h2>Quote revisions</h2><span className="muted">{job.quotes.length} {job.quotes.length === 1 ? 'revision' : 'revisions'}</span></div>
    {job.import_evidence && <p className="notice">Imported source acceptance is retained. Review and explicitly accept the native quote before work begins.</p>}
    {estimator && <><Takeoff job={job} mutate={mutate}/><EstimateComparison quotes={job.quotes} currency={job.currency} /><EstimateCatalog job={job} mutate={mutate} rates={manager} /><EstimatePricing job={job} mutate={mutate} rates={manager} /></>}
    {job.quotes.length === 0 && <p className="empty">No quote prepared yet.</p>}
    {[...job.quotes].reverse().map(q => <article className="record" key={q.id}><div className="record-head"><h3>Quote {q.revision}</h3><Badge>{q.status}</Badge></div>
      <table className="lines estimate-lines"><thead><tr><th scope="col">Scope</th><th scope="col">Qty × unit</th><th scope="col">Amount</th></tr></thead><tbody>{q.lines.map((l,i) => <tr key={i}><td>{l.description}{l.cost_code && <p className="muted">{l.cost_code} · {l.phase} · {l.category}</p>}{l.alternate_group && <p>{l.alternate_group}: {l.alternate_option} · {l.included === false ? 'Not selected' : 'Included'}</p>}{estimator && l.cost_unit_cents !== undefined && <p className="muted">Cost: {money(l.cost_unit_cents, job.currency)} per {l.rate_unit ?? l.unit} · line {money(l.cost_total_cents, job.currency)}</p>}</td><td>{l.quantity}{l.unit ? ` ${l.unit}` : ''}{(!q.selling_adjusted || estimator) && <>{q.selling_adjusted ? ' · Base rate ' : ' × '}{money(l.unit_cents, job.currency)}{l.rate_unit && <> / {l.rate_unit}</>}</>}{l.conversion && <p className="muted">Conversion {l.conversion.numerator} ÷ {l.conversion.denominator}</p>}</td><td>{money(l.total_cents, job.currency)}</td></tr>)}</tbody><tfoot><tr><th scope="row" colSpan={2}>Total selling price</th><td>{money(q.total_cents, job.currency)}</td></tr></tfoot></table>
      {estimator && <p>Included line cost: {q.cost_total_cents === undefined ? 'Not recorded for every included line' : money(q.cost_total_cents, job.currency)}</p>}
      {q.selling_adjusted && <p className="muted">Selling amounts include reviewed pricing adjustments and tax.</p>}
      {estimator && q.pricing && <details><summary>Pricing and tax snapshot · quote {q.revision}</summary><PricingBreakdown pricing={q.pricing} /></details>}
      <EstimateTerms quote={q} />{q.lines.filter(l=>l.included!==false&&l.product_source).map(l=><ProductSource key={l.id} source={l.product_source!} jobId={job.id} office={manager}/>)}
      {estimator && <p><a href={`/api/plinth/jobs/${job.id}/quotes/${q.id}/cost-codes.json`} download>Export cost-code JSON · quote {q.revision}</a> · <a href={`/api/plinth/jobs/${job.id}/quotes/${q.id}/cost-codes.csv`} download>Export cost-code CSV · quote {q.revision}</a></p>}
      {q.notes && <p className="muted">{q.notes}</p>}
      {q.acceptance && <p className="notice">Acceptance recorded from {q.acceptance.method}: {q.acceptance.evidence}<br />Recorded by {q.acceptance.recorded_by.name} · {dateTime(q.acceptance.recorded_by.at)}. External acceptance record; Plinth did not collect an electronic signature.</p>}
      {manager && !accepted && q.status === 'draft' && q.id === job.quotes.at(-1)?.id && <QuoteAcceptance job={job} quote={q} mutate={mutate} />}
    </article>)}{manager && <BudgetComparison job={job}/>}</section>
    {estimator && !accepted && <aside className="card side"><h2>Prepare a quote</h2><p className="card-lead">Create an immutable revision. Record acceptance only when you have the client’s agreement.</p><Form submit="Prepare quote revision" action={async f => mutate('/quotes',{lines:[{description:f.get('description'),quantity:1,unit_cents:cents(f.get('amount'))}],notes:f.get('notes') || undefined})}><Field label="Scope of work" name="description" /><Field label="Quote total (including sales tax if applicable)" name="amount" inputMode="decimal" placeholder="48000.00" /><label>Terms and inclusions<textarea name="notes" rows={4} /></label></Form>{manager && <Products job={job} mutate={mutate}/>}<EstimateEditor key={job.quotes.at(-1)?.id ?? 'new'} quote={job.quotes.at(-1)} mutate={mutate} /></aside>}</div>
}

export function Changes(props: JobProps) {
  const {job,manager,mutate} = props
  const approved = job.variations.filter(v => v.status === 'approved').reduce((sum, v) => sum + v.amount_cents, 0)
  return <div className="split"><section className="card"><div className="card-head"><h2>Change orders</h2><span className="muted">{money(approved, job.currency)} approved</span></div><p className="card-lead">Only an authorized client contact can approve a change order. The original client is {job.client_email}. The contract changes only when they do.</p>
    {manager && <Continuity {...props} />}
    {job.variations.length === 0 && <p className="empty">No change orders yet.</p>}
    <ol className="rows">{job.variations.map(v => <li className={`row${v.status === 'draft' ? ' is-waiting' : ''}`} key={v.id}><div className="row-main"><strong>{v.description}</strong><>{v.rfi_change&&<p className="notice">RFI change: {v.rfi_change.date_impact_days} calendar days · {v.rfi_change.task_ids.map(id=>job.schedules.find(t=>t.id===id)?.description??id).join(", ")}. Approval records the change; a builder must separately review and publish revised dates.</p>}</><AllowanceChangeSummary variation={v} currency={job.currency} canApprove={false} mutate={mutate}/><span className="muted">Prepared by {v.prepared_by.name} · {dateTime(v.prepared_by.at)}</span>{v.approved_by && <span className="muted">{v.carried_over ? <>Carried over {day(v.approved_by.at)} · {v.carried_over}</> : <>Approved by {v.approved_by.name} · {dateTime(v.approved_by.at)}</>}</span>}{!manager && v.status === 'draft' && <Action className="primary" action={() => mutate('/variations/'+v.id+'/approve')}>Approve this change order for {money(v.amount_cents, job.currency)}</Action>}</div><div className="row-end"><strong className="amount">{money(v.amount_cents, job.currency)}</strong><Badge status={v.status}>{v.status === 'draft' ? (manager ? 'Waiting on client' : 'Needs your approval') : v.status}</Badge></div></li>)}</ol></section>
    {manager && <aside className="card side"><h2>Prepare a change order</h2><p className="card-lead">The agreed contract changes only after the client approves these exact terms.</p><Form submit="Prepare change order for client" action={async f => mutate('/variations',{description:f.get('description'),amount_cents:cents(f.get('amount'))})}><label>Change and agreed scope<textarea name="description" required rows={4} /></label><Field label="Additional amount" name="amount" inputMode="decimal" /></Form></aside>}</div>
}
