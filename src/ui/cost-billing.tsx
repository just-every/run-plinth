import { useEffect, useState } from 'react'
import type { JobProps } from './job'
import type { CostBilling } from '../plinth/cost-billing'
import { Action, api, cents, Field, Form, money } from './shared'

/** Cost selection uses the existing Billing form and disclosure components. */
export function CostBillingForm({job,mutate}:Pick<JobProps,'job'|'mutate'>){
 const [review,setReview]=useState<{preview:CostBilling;input:Record<string,unknown>}>()
 const [sources,setSources]=useState<(import('../plinth/cost-model').CostEntry&{reference?:string;document_checksum?:string})[]>(),[error,setError]=useState('')
 useEffect(()=>{let current=true;setReview(undefined);api(`/jobs/${job.id}/invoices/cost-sources`).then(r=>{if(current){setSources(r.entries);setError('')}}).catch(e=>{if(current){setSources(undefined);setError(e.message)}});return ()=>{current=false}},[job.id,job.version])
 const prior=(job.invoices??[]).filter(i=>i.issued&&i.sources?.cost_billing),terms=prior[0]?.sources.cost_billing
 const consumed=new Set(prior.flatMap(i=>[...i.sources.cost_billing!.entries.map(e=>e.id),...i.sources.cost_billing!.excluded_entry_ids]))
 const entries=(sources??[]).filter(e=>!consumed.has(e.id)&&['bill','credit','time','expense','equipment','payroll'].includes(e.source_kind))
 const codes=(job.budgets?.at(-1)?.codes??[]).map(c=>c.cost_code)
 if(!sources)return <p role={error?'alert':'status'}>{error||'Loading approved cost sources…'}</p>
 return <section className="card cost-billing-form"><h2>Bill approved actual costs</h2><p>Select posted sources, review contractual fees and accepted human-reviewed tax, then prepare the exact batch. Issuing retains supporting evidence and consumes each source once.</p>
 <div onChange={()=>setReview(undefined)}><Form key={job.version} reset={false} submit="Preview cost billing" action={async f=>{
  const cost_billing={contract_reference:terms?.contract_reference??f.get('contract_reference'),fee_bps:terms?.fee_bps??0,cap_cents:terms?.cap_cents??cents(f.get('cap')),entry_ids:f.getAll('entry'),excluded_entry_ids:f.getAll('exclude'),...(terms?(terms.fee_categories?{fee_categories:terms.fee_categories}:{}):{fee_categories:codes.map(code=>({name:String(f.get('category-'+code)),cost_codes:[code],fee_bps:Number(f.get('fee-'+code))}))})}
  const input={kind:'cost_plus',description:f.get('description'),recipient_email:f.get('email'),due_on:f.get('due_on'),terms:f.get('terms'),cost_billing}
  const result=await api(`/jobs/${job.id}/invoices/preview`,{cost_billing,expected_version:job.version});setReview({preview:result.preview,input:{...input,cost_billing_review:JSON.stringify(result.preview)}})
 }}><div className="fields"><Field name="contract_reference" label="Reviewed agreement reference" defaultValue={terms?.contract_reference} readOnly={!!terms}/><Field name="cap" label="Cumulative gross cap (USD)" defaultValue={terms?String(terms.cap_cents/100):undefined} readOnly={!!terms}/><Field name="description" label="Cost invoice description"/><Field name="email" label="Cost billing recipient" type="email" defaultValue={job.client_email}/><Field name="due_on" label="Cost invoice due date" type="date"/><Field name="terms" label="Reviewed cost billing terms"/></div>
 {!terms&&codes.map(code=><div className="fields" key={code}><Field name={'category-'+code} label={'Fee category for '+code} defaultValue={'Contract fee '+code}/><Field name={'fee-'+code} label={'Fee basis points for '+code} type="number" min="0" max="100000" defaultValue="1000"/></div>)}
 {terms&&<p>Issued agreement fees and cap are fixed. Later costs and credits link earlier invoices.</p>}
 <h3>Available approved sources</h3>{entries.length?entries.map(e=><div className="record" key={e.id}><p>{e.reference} · {e.source_kind} · {e.cost_code} · {e.dated_on} · {money(e.amount_cents)}</p>{e.document_checksum&&<a href={`/api/plinth/jobs/${job.id}/costs/${['bill','credit'].includes(e.source_kind)?'bills':'sources'}/${e.source_id}/original`} target="_blank" rel="noreferrer">Open supporting original</a>}<div className="cost-source-choices"><label><input type="checkbox" name="entry" value={e.id} aria-label={'Bill source '+e.id}/>Bill this source</label><label><input type="checkbox" name="exclude" value={e.id} aria-label={'Permanently exclude source '+e.id}/>Exclude permanently</label></div></div>):<p>No unbilled posted sources.</p>}
 </Form></div>
 {review&&<section aria-label="Cost billing preview"><h3>Review cost billing</h3><p>{review.preview.contract_reference} · Human-reviewed accepted tax rate {review.preview.tax?.rate.percent}%. No provider verification.</p><dl className="reconciliation">{[['Selected costs',review.preview.cost_cents],['Contractual fees',review.preview.fee_cents],['Sales tax',review.preview.tax_cents??0],['Cap reduction',review.preview.cap_reduction_cents],['Issue total',review.preview.total_cents]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{money(value as number)}</dd></div>)}</dl><p>{review.preview.excluded_entry_ids.length} permanently excluded sources · {review.preview.supporting_sources.length} retained supporting records · {review.preview.prior_invoice_ids.length} linked earlier invoices.</p>{review.preview.fee_categories?.map(c=><p key={c.name}>{c.name} · {c.fee_bps} basis points · {c.cost_codes.join(', ')}</p>)}<Action className="primary" action={async()=>{await mutate('/invoices',review.input);setReview(undefined)}}>Prepare reviewed cost invoice</Action></section>}
 </section>
}
