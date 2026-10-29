import { useState } from 'react'
import { api, Form, money } from './shared'
import type { reconcileRecovery } from '../plinth/recovery-inventory'

type Comparison=ReturnType<typeof reconcileRecovery>
export function RecoveryReconciliation(){
 const [result,setResult]=useState<Comparison>(),[source,setSource]=useState<File>()
 return <section aria-label="Recovery reconciliation"><details><summary>Backup recovery comparison</summary>
  <p>Download a confidential inventory before making your CLI archive. After restoring, compare that file with this installation. Comparison changes no records or permissions and reconnects no provider.</p>
  <p><a className="button" href="/api/plinth/recovery/manifest.json" download>Download recovery manifest</a></p>
  <Form submit="Compare recovery manifest" reset={false} action={async()=>{
   setResult(undefined)
   if(!source)throw new Error('Choose the source recovery manifest first.')
   if(source.size>15_000_000)throw new Error('The manifest must be at most 15 MB.')
   let manifest:unknown;try{manifest=JSON.parse(await source.text())}catch{throw new Error('Choose a valid JSON recovery manifest.')}
   setResult(await api('/recovery/reconcile',{manifest}))
  }}><label>Source recovery manifest<input type="file" accept="application/json,.json" required onChange={event=>{setSource(event.currentTarget.files?.[0]);setResult(undefined)}}/></label></Form>
  {result&&<div aria-live="polite" aria-label="Recovery comparison result">
   <h3>{result.matches?'Inventory matches':'Inventory differences found'}</h3><p>{result.notice}</p>
   <dl><dt>Missing records</dt><dd>{result.records.missing.length}</dd><dt>Extra records</dt><dd>{result.records.extra.length}</dd><dt>Changed records</dt><dd>{result.records.mismatched.length}</dd><dt>Missing originals</dt><dd>{result.files.missing.length}</dd><dt>Extra originals</dt><dd>{result.files.extra.length}</dd><dt>Changed originals</dt><dd>{result.files.mismatched.length}</dd></dl>
   {!result.coverage_match&&<p>The inventory coverage or exclusions differ. Compare the application version and manifest scope before relying on these results.</p>}
   {result.unverified_files.length>0&&<p role="alert">{result.unverified_files.length} originals failed their stored integrity metadata.</p>}
   <h3>Financial control totals</h3><p>{result.control_totals.match?'Control totals match':'Control totals differ'}. These are issued source facts and posted native cost entries, not an external accounting reconciliation or a receivable balance.</p>
   <div className="table-wrap"><table><thead><tr><th>Source</th><th>Currency</th><th>Issued invoices</th><th>Issued gross</th><th>Corrections</th><th>Net receipts</th><th>Deposit applications</th><th>Write-offs</th><th>Posted costs</th></tr></thead><tbody>{(['source','current'] as const).flatMap(origin=>result.control_totals[origin].map(row=><tr key={origin+row.currency}><td>{origin==='source'?'Supplied manifest':'This installation'}</td><td>{row.currency}</td><td>{row.issued_invoices}</td><td>{money(row.issued_gross_cents,row.currency)}</td><td>{money(row.corrections_cents,row.currency)}</td><td>{money(row.receipts_cents,row.currency)}</td><td>{money(row.deposit_applications_cents,row.currency)}</td><td>{money(row.write_offs_cents,row.currency)}</td><td>{money(row.posted_cost_cents,row.currency)}</td></tr>))}</tbody></table></div>
   {[['Records',result.records],['Originals',result.files]] .map(([label,changes])=><details key={String(label)}><summary>{String(label)} details</summary>{Object.entries(changes as Comparison['records']).map(([kind,identities])=><div key={kind}><h4>{kind}</h4>{identities.length?<ul>{identities.map(identity=><li key={identity} style={{overflowWrap:'anywhere'}}>{identity}</li>)}</ul>:<p>None</p>}</div>)}</details>)}
  </div>}
 </details></section>
}
