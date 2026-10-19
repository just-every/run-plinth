import { useState } from 'react'
import type { Quote } from '../plinth/model'
import { compareEstimates } from '../plinth/estimate-compare'
import { money } from './shared'

const value = (input: unknown) => input === undefined ? 'Not recorded' : typeof input === 'object' ? JSON.stringify(input) : String(input)
export function EstimateComparison({ quotes }: { quotes: Quote[] }) {
 const [beforeId, setBeforeId] = useState(''), [afterId, setAfterId] = useState('')
 if (quotes.length < 2) return null
 const before = quotes.find(quote => quote.id === beforeId) ?? quotes.at(-2)!, after = quotes.find(quote => quote.id === afterId) ?? quotes.at(-1)!, comparison = compareEstimates(before, after)
 return <details className="side-section"><summary>Compare estimate revisions</summary>
  <div className="fields"><label>Earlier estimate<select aria-label="Earlier estimate" value={before.id} onChange={event => setBeforeId(event.target.value)}>{quotes.map(quote => <option key={quote.id} value={quote.id}>Quote {quote.revision}</option>)}</select></label><label>Later estimate<select aria-label="Later estimate" value={after.id} onChange={event => setAfterId(event.target.value)}>{quotes.map(quote => <option key={quote.id} value={quote.id}>Quote {quote.revision}</option>)}</select></label></div>
  <p>Selling total: {money(comparison.before_total_cents)} → {money(comparison.after_total_cents)}. Selling change: {money(comparison.total_delta_cents)}. Cost change: {comparison.cost_delta_cents === null ? 'Not recorded for every included line' : money(comparison.cost_delta_cents)}.</p>
  <ol className="rows" aria-label="Changed estimate scope">{comparison.changes.map(change => <li className="row" key={change.id}><div className="row-main"><strong>{change.description} · {change.kind}</strong>{change.fields.map(field => <span key={field}>{field.replaceAll('_', ' ')}: {value(change.before?.[field])} → {value(change.after?.[field])}</span>)}</div></li>)}</ol>
  {!comparison.changes.length && <p>No line scope changed.</p>}
  <dl className="facts"><div><dt>Inclusions</dt><dd>{comparison.inclusions.before.join('; ') || 'None recorded'} → {comparison.inclusions.after.join('; ') || 'None recorded'}</dd></div><div><dt>Exclusions</dt><dd>{comparison.exclusions.before.join('; ') || 'None recorded'} → {comparison.exclusions.after.join('; ') || 'None recorded'}</dd></div><div><dt>Alternate choices</dt><dd>{JSON.stringify(comparison.alternate_selections.before)} → {JSON.stringify(comparison.alternate_selections.after)}</dd></div></dl>
 </details>
}
export function EstimateTerms({ quote }: { quote: Quote }) {
 return <>{!!quote.inclusions?.length && <div><strong>Inclusions</strong><ul>{quote.inclusions.map((term, index) => <li key={index}>{term}</li>)}</ul></div>}{!!quote.exclusions?.length && <div><strong>Exclusions</strong><ul>{quote.exclusions.map((term, index) => <li key={index}>{term}</li>)}</ul></div>}</>
}
