import { useEffect, useState } from 'react'
import type { PricingRate } from '../plinth/pricing-model'
import type { JobProps } from './job'
import { Action, api, cents, Field, Form, money } from './shared'
import { PricingBreakdown } from './pricing-snapshot'

export function PricedChange({job, mutate}: Pick<JobProps, 'job' | 'mutate'>) {
 const [rates,setRates]=useState<PricingRate[]>([]),[error,setError]=useState(''),[preview,setPreview]=useState<any>(),[review,setReview]=useState<any>()
 useEffect(()=>{api('/pricing-rates').then(r=>setRates(r.rates)).catch(e=>setError(e.message))},[])
 useEffect(()=>setPreview(undefined),[job.version])
 return <details className="side-section"><summary>Prepare a priced change for SOV billing</summary><p>Use the estimate calculator for a charge or credit. Review tax before preparing the exact terms for the client; preparing it does not change the contract.</p>{error&&<p role="alert">{error}</p>}
  <Form reset={false} submit="Preview change pricing" action={async f=>{
   const input={description:f.get('description'),direction:f.get('direction'),basis:'sell',as_of:f.get('as_of'),lines:[{id:'change-scope',description:f.get('description'),quantity:'1',unit:'each',cost_code:f.get('cost_code'),phase:'Change order',category:'other',unit_cents:cents(f.get('base'))}],rules:[{scope:'project',overhead_percent:'0',method:'markup',percent:String(f.get('markup')),discount_percent:'0'}],tax:{rate_id:f.get('rate_id'),taxable_line_ids:f.get('taxable')==='on'?['change-scope']:[],exemption_reference:f.get('exemption')}}
   setPreview(undefined);const r=await mutate('/variation-pricing/preview',input);setReview(input);setPreview({...r.preview,job_version:job.version})
  }}><div onChange={()=>setPreview(undefined)}><Field label="Priced change scope" name="description"/><Field label="Change cost code" name="cost_code"/><label>Change direction<select name="direction"><option value="charge">Additional charge</option><option value="credit">Credit</option></select></label><Field label="Change base amount" name="base" inputMode="decimal"/><Field label="Change markup percent" name="markup" defaultValue="0" inputMode="decimal"/><label>Change reviewed tax rate<select required name="rate_id"><option value="">Choose reviewed rate</option>{rates.map(r=><option value={r.id} key={r.id}>{r.revisions.at(-1)!.jurisdiction} · {r.revisions.at(-1)!.percent}%</option>)}</select></label><Field label="Change tax selection date" name="as_of" type="date" defaultValue={new Date().toISOString().slice(0,10)}/><label><input type="checkbox" name="taxable" defaultChecked/>Change scope is taxable</label><Field label="Change exemption evidence" name="exemption" required={false}/></div></Form>
  {preview&&<section className="record"><h3>Exact proposed {preview.proposal.pricing_direction}</h3><p>{money(preview.proposal.amount_cents)}</p><PricingBreakdown pricing={preview.proposal.pricing}/><Action action={async()=>{if(preview.job_version!==job.version)throw new Error('Job changed; preview again');await mutate('/variation-pricing/apply',{...review,digest:preview.digest});setPreview(undefined)}}>Prepare priced change for client</Action></section>}
 </details>
}
