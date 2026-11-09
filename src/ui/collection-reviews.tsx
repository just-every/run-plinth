import { useEffect, useState } from 'react'
import { api, Badge, dateTime, Field, Form, money } from './shared'
import type { CollectionReview, collectionBalances } from '../plinth/collection-reviews'
import type { FollowupAction } from '../plinth/followup-model'
type Review=CollectionReview&{stale:boolean;revoked:boolean;authority_current:boolean}
type Balances=ReturnType<typeof collectionBalances>
type Data={version:number;review_generation:number;owner_version:number;source_digest:string;current:Balances;reviews:Review[];boundary:string}
type Preview=Omit<Balances,'invoices'>&{review_id:string;as_of:string;boundary:string;invoices:(Balances['invoices'][number]&{actions:(FollowupAction&{amount_cents:number})[]})[]}
function Totals({value}:{value:Balances}){
 return <dl className="reconciliation"><div><dt>Collectible invoice residual</dt><dd>{money(value.collectible_cents)}</dd></div><div><dt>Held retainage</dt><dd>{money(value.held_retainage_cents)}</dd></div><div><dt>Unapplied remittance</dt><dd>{money(value.unapplied_remittance_cents)}</dd></div><div><dt>Unapplied deposit liability</dt><dd>{money(value.unapplied_deposit_liability_cents)}</dd></div><div><dt>Separate deposit requests due</dt><dd>{money(value.deposit_request_due_cents)}</dd></div></dl>
}
export function CollectionReviews({jobId,version,refresh}:{jobId:string;version:number;refresh:()=>Promise<void>}){
 const [data,setData]=useState<Data>(),[selected,setSelected]=useState(''),[preview,setPreview]=useState<Preview>(),[error,setError]=useState('')
 const root='/jobs/'+jobId+'/collection-reviews'
 async function load(){try{setData(await api(root));setError('')}catch(e){setError((e as Error).message)}}
 useEffect(()=>{setData(undefined);setPreview(undefined);void load()},[jobId,version])
 const review=data?.reviews.find(r=>r.id===selected)??data?.reviews.at(-1)
 return <section className="card" aria-label="Collection balance reviews"><h2>Collection balance reviews</h2><p>Owner-only review of existing invoice, bank and check records. Recorded coverage concerns the monetary leg; every collection case and receipt-delivery obligation remains unresolved.</p>
 {error&&<p role="alert">{error}</p>}
 <button type="button" className="secondary" onClick={()=>{setPreview(undefined);void load()}}>Reload collection sources</button>
 {!data&&!error&&<p role="status">Loading collection sources…</p>}
 {data&&<><h3>Current recorded balances</h3><Totals value={data.current}/>
 <details><summary>Review current sources</summary>
 <ul className="rows">{data.current.invoices.map(i=><li className="row" key={i.invoice_id}><div className="row-main"><strong>{i.number} · {i.kind}</strong><span>Collectible {money(i.collectible_cents)} · Held {money(i.held_retainage_cents)}</span><span>{i.reason}</span></div></li>)}</ul>
 <Form key={data.source_digest} submit="Save collection review" action={async f=>{const r=await api(root,{expected_version:data.version,review_generation:data.review_generation,owner_version:data.owner_version,source_digest:data.source_digest,confirm:f.get('confirm')==='on'});setSelected(r.record.id);setPreview(undefined);await refresh();await load()}}><label><input type="checkbox" name="confirm" required/>I reviewed these exact native sources. This authorizes no sending, payment or collection closure.</label></Form>
 </details>
 {data.reviews.length>0&&<><label>Collection review history<select aria-label="Collection review history" value={review?.id??''} onChange={e=>{setSelected(e.target.value);setPreview(undefined)}}>{[...data.reviews].reverse().map((r,i)=><option key={r.id} value={r.id}>Review {data.reviews.length-i} · {dateTime(r.reviewed_by.at)}</option>)}</select></label>
 {review&&<article className="record" aria-label="Saved collection review"><h3>Review {data.reviews.indexOf(review)+1}</h3><Badge>{review.revoked?'Review revoked':review.stale?'Sources changed':!review.authority_current?'Fresh owner review required':'Current native review'}</Badge><p>{review.reviewed_by.name} · {dateTime(review.reviewed_by.at)}</p><p>{review.boundary}</p><Totals value={review.balances}/>
 <details><summary>Exact reviewed invoice evidence</summary>{review.sources.invoices.map(i=><section key={i.id}><h4>{i.number} · {i.description}</h4><p>Original payable {money(i.issued!.payable_cents)} · Due {i.issued!.due_on}</p><p>Invoice identity <span style={{overflowWrap:'anywhere'}}>{i.id}</span></p><ul>{i.receipts.map(r=><li key={r.id}>{r.method} · {money(r.amount_cents)} · {r.received_on} · {r.reference}{r.reversal_of?' · Reversal of '+r.reversal_of:''}{r.remittance_id?' · Remittance '+r.remittance_id:''}</li>)}</ul><p>Write-offs {money((i.write_offs??[]).reduce((s,w)=>s+w.amount_cents,0))} · Deposit allocations {money(i.deposit_applications.reduce((s,a)=>s+a.amount_cents,0))}</p></section>)}<p style={{overflowWrap:'anywhere'}}>Source digest {review.source_digest}</p></details>
 {!review.stale&&!review.revoked&&review.authority_current&&<Form key={review.id} submit="Preview collection follow-up" reset={false} action={async f=>{setPreview(undefined);setPreview(await api(root+'/'+review.id+'/preview?as_of='+encodeURIComponent(String(f.get('as_of')))))}}><Field label="Collection preview instant" name="as_of" defaultValue={new Date().toISOString()}/></Form>}
 {!review.revoked&&<details><summary>Revoke this review</summary><Form submit="Revoke collection review" action={async f=>{await api(root+'/'+review.id+'/revoke',{expected_version:data.version,review_generation:data.review_generation,owner_version:data.owner_version,source_digest:data.source_digest,confirm:f.get('confirm')==='on',reason:f.get('reason')});setPreview(undefined);await refresh();await load()}}><Field label="Collection revocation reason" name="reason"/><label><input name="confirm" type="checkbox" required/>Revoke prospective use of this review; retain its history.</label></Form></details>}
 </article>}</>}
 {preview&&<section aria-label="Collection follow-up preview"><h3>Collection preview at {preview.as_of}</h3><p>{preview.boundary}</p>{preview.invoices.map(i=><article className="record" aria-label={'Collection invoice '+i.number} key={i.invoice_id}><h4>{i.number}</h4><p>Collectible residual {money(i.collectible_cents)} · Held retainage {money(i.held_retainage_cents)} · Native returns {money(i.native_returned_cents)}</p><p>{i.reason}</p><p>Collection case: unresolved · Receipt delivery: unresolved</p>{i.actions.length?i.actions.map(a=><p key={a.key}>{a.recipient_name} · {a.step} · {a.due_on} · {a.status==='eligible'?'Eligible preview':'Withheld'} · {a.reason} · Current residual {money(a.amount_cents)}</p>):<p>No collection sequence configured. Nothing sends.</p>}</article>)}</section>}
 </>}
 </section>
}
