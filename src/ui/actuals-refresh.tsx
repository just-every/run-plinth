import { useEffect, useState } from 'react'
import { api, Badge, dateTime, Field, Form, money } from './shared'
import type { ActualsRefresh as Preview, RefreshSource } from '../plinth/actuals-refresh'
import type { costLedger } from '../plinth/cost-ledger'
import type { SovLine } from '../plinth/sov-model'
type State={version:number;source_digest:string;sources:RefreshSource[];ledger:ReturnType<typeof costLedger>;sov_lines:SovLine[];previews:(Preview&{stale:boolean;review_active:boolean})[]}
const amount=(value:number|null)=>value===null?'Unavailable':money(value)
export function ActualsRefresh({jobId,version}:{jobId:string;version:number}){
 const [data,setData]=useState<State>(),[error,setError]=useState(''),[selected,setSelected]=useState('')
 const root='/jobs/'+jobId+'/actuals-refresh'
 async function load(){try{setData(await api(root));setError('')}catch(e){setError((e as Error).message)}}
 useEffect(()=>{setData(undefined);void load()},[jobId,version])
 const preview=data?.previews.find(r=>r.id===selected)??data?.previews.at(-1)
 return <section className="card" aria-label="Actuals refresh"><h2>Actuals refresh</h2><p>Review native receipts and bills together before preparing the next draw. This private preview preserves approved completed work. It cannot approve, post, issue, send, pay or change dates.</p>
 {error&&<p role="alert">{error}<button type="button" onClick={()=>void load()}>Reload sources</button></p>}
 {!data&&!error&&<p role="status">Loading native sources…</p>}
 {data&&<>
 <button type="button" className="secondary" onClick={()=>void load()}>Reload sources</button>
 <details><summary>Review sources and prepare preview</summary><p>Every assumption and stored allocation needs fresh review. Blank assumptions remain unavailable. Receipt references without captured originals are labelled below.</p>
 <details><summary>Exact source revisions ({data.sources.length})</summary><ul className="rows">{data.sources.map(s=><li className="row" key={s.kind+s.id}><div className="row-main"><strong>{s.kind} · {s.id}</strong><span>{s.dated_on??'Source date unavailable'} · {s.review_state}</span><span style={{overflowWrap:'anywhere'}}>Revision {s.revision}</span><span style={{overflowWrap:'anywhere'}}>{s.checksums.length?'Original SHA-256 '+s.checksums.join(', '):'No original checksum captured'}</span></div></li>)}</ul></details>
 <Form key={data.source_digest} reset={false} submit="Save private refresh preview" action={async f=>{
  const codes=data.ledger.rows.map((r,i)=>{const names=['remaining_quantity','minutes_per_unit','labor_hour_cents','unbought_cents','risk_cents','reference'];if(names.some(k=>!String(f.get(i+'-'+k)??'').trim()))return null
   return {cost_code:r.cost_code,outstanding_commitment_cents:r.open_commitment_cents,...Object.fromEntries(names.map(k=>[k,['labor_hour_cents','unbought_cents','risk_cents'].includes(k)?Number(f.get(i+'-'+k)):String(f.get(i+'-'+k))]))}
  })
  const stored=data.sov_lines.map((l,i)=>({line_id:l.id,stored_cents:Number(f.get('stored-'+i)),order_ids:f.getAll('orders-'+i).map(String),evidence:f.get('evidence-'+i)}))
  const result=await api(root,{expected_version:data.version,source_digest:data.source_digest,operation_id:crypto.randomUUID(),confirm:f.get('confirm')==='on',as_of:f.get('as_of'),reference:f.get('reference'),...(codes.every(Boolean)?{codes}:{}),...(stored.length?{stored_allocations:stored}:{})})
  setSelected(result.record.id);await load()
 }}>
 <Field label="Refresh as of" name="as_of" type="date"/><Field label="Fresh review reference" name="reference"/>
 {data.ledger.rows.map((r,i)=><fieldset key={r.cost_code}><legend>Forecast assumptions · {r.cost_code}</legend><p>Posted actual {money(r.posted_actual_cents)} · Open commitment {money(r.open_commitment_cents)} · Received {money(r.received_cents)}</p><div className="fields">
 <Field label={'Remaining quantity '+r.cost_code} name={i+'-remaining_quantity'} required={false} inputMode="decimal"/>
 <Field label={'Minutes per unit '+r.cost_code} name={i+'-minutes_per_unit'} required={false} inputMode="decimal"/>
 <Field label={'Labor hourly cents '+r.cost_code} name={i+'-labor_hour_cents'} required={false} type="number" min="0"/>
 <Field label={'Unbought cents '+r.cost_code} name={i+'-unbought_cents'} required={false} type="number" min="0"/>
 <Field label={'Risk cents '+r.cost_code} name={i+'-risk_cents'} required={false} type="number" min="0"/>
 <Field label={'Assumption evidence '+r.cost_code} name={i+'-reference'} required={false}/></div></fieldset>)}
 {data.sov_lines.map((line,i)=><fieldset key={line.id}><legend>Stored allocation · {line.description}</legend><Field label={'Stored cents '+line.id} name={'stored-'+i} type="number" min="0" defaultValue="0"/><Field label={'Stored evidence '+line.id} name={'evidence-'+i}/>
 <p>Choose the issued POs supporting materials still stored. Shared receipts are allocated once.</p>{data.sources.filter(s=>s.kind==='order'&&s.review_state==='issued').map(s=><label key={s.id}><input type="checkbox" name={'orders-'+i} value={s.id}/>PO {s.id}</label>)}</fieldset>)}
 <label><input type="checkbox" name="confirm" required/>I freshly reviewed these exact sources, assumptions and stored allocations.</label>
 </Form></details>
 {data.previews.length>0&&<><label>Preview history<select value={preview?.id??''} onChange={e=>setSelected(e.target.value)}>{[...data.previews].reverse().map((r,i)=><option key={r.id} value={r.id}>{data.previews.length-i} · {r.reference}</option>)}</select></label>
 {preview&&<article className="record" aria-label="Refresh result"><h3>{preview.reference}</h3><Badge>{preview.stale?'Sources changed':!preview.review_active?'Fresh review required':'Reviewed native preview'}</Badge><p>{preview.as_of} · {preview.reviewed_by.name} · {dateTime(preview.reviewed_by.at)}</p><p>{preview.boundary}</p>
 <ul>{preview.unavailable.map((u,i)=><li key={i}>{u.scope}: {u.reason}</li>)}</ul>
 {preview.codes.map(r=><section key={r.cost_code} aria-label={'Refresh code '+r.cost_code}><h4>{r.cost_code}</h4><dl className="reconciliation"><div><dt>Posted actual</dt><dd>{money(r.actual_cents)}</dd></div><div><dt>Open commitment</dt><dd>{money(r.open_commitment_cents)}</dd></div><div><dt>Remaining cost</dt><dd>{amount(r.remaining_cents)}</dd></div><div><dt>Forecast margin</dt><dd>{amount(r.margin_cents)}</dd></div></dl>{r.delta&&<p>Change from prior preview: actual {money(r.delta.actual_cents)}, open commitment {money(r.delta.open_commitment_cents)}, remaining {amount(r.delta.remaining_cents)}, margin {amount(r.delta.margin_cents)}.</p>}</section>)}
 {preview.sov&&<section aria-label="Prospective billing"><h4>Prospective SOV and retainage</h4><p>Approved completed work {money(preview.sov.completed_cents)} · Stored {money(preview.sov.stored_cents)} · Prospective current {money(preview.sov.current_cents)}</p>{preview.sov.retainage?<p>Cumulative withheld {money(preview.sov.retainage.cumulative_withheld_cents)} · Current net {money(preview.sov.retainage.current_net_cents)}</p>:<p>Retainage unavailable: no approved contract terms.</p>}</section>}
 <details><summary>Unresolved source review</summary><ul>{preview.exceptions.items.filter(e=>e.status!=='cleared').map(e=><li key={e.id}>{e.kind} · {e.status} · Owner {e.owner_id} · Due {e.due_on}</li>)}{preview.exceptions.unassigned.map(e=><li key={e.key}>{e.kind}: {e.evidence} · Unassigned</li>)}</ul></details>
 </article>}</>}
 </>}
 </section>
}
