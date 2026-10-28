import { useEffect, useRef, useState } from 'react'
import type { Submittal, SubmittalView } from '../plinth/submittal-model'
import type { JobProps } from './job'
import { api, Badge, Field, Form } from './shared'

const disposition = (value: string) => value === 'revise_resubmit' ? 'Revise and resubmit' : value
export function Submittals({ job, refresh }: Pick<JobProps,'job'|'refresh'>) {
 const [data,setData] = useState<SubmittalView>(), [error,setError] = useState('')
 const registration=useRef<HTMLDetailsElement>(null)
 const root = `/jobs/${job.id}/submittals`
 const load = async () => { const result = await api(root); setData(result); setError('') }
 useEffect(() => { void load().catch(e => { setData(undefined); setError(e.message) }) }, [job.id,job.version])
 const mutate = async (path: string, body: Record<string,unknown>) => {
  try { await api(root+path,{expected_version:data?.version,...body}); await load(); await refresh() }
  catch(e) { await load(); await refresh(); throw e }
 }
 if (!data) return <p role={error?'alert':'status'}>{error||'Opening submittals…'}</p>
 return <section className="card" aria-label="Submittal register" id="submittals">
  <h2>Submittal register</h2><p>Review the exact vendor package before releasing its product and purchase commitment. A new cycle holds procurement until it is approved and selected.</p>
  {!data.register.length&&<p>No submittals registered.</p>}
  {data.register.map(row => <SubmittalRecord key={row.id} row={row} data={data} jobId={job.id} mutate={mutate}/>)}
  {data.manage&&<details ref={registration}><summary>Register a required submittal</summary>
   <SubmittalSubmission data={data} submit="Submit vendor package" action={async body=>{await mutate('',body);if(registration.current)registration.current.open=false}}/>
  </details>}
 </section>
}
type Mutate = (path:string, body:Record<string,unknown>)=>Promise<void>
function SubmittalRecord({row,data,jobId,mutate}:{row:Submittal;data:SubmittalView;jobId:string;mutate:Mutate}) {
 const current = row.cycles.at(-1)!, order = data.orders.find(o=>o.id===row.order_id)!, release = order.submittal_release
 const resubmission=useRef<HTMLDetailsElement>(null)
 return <article className="record" aria-label={row.title}>
  <h3>{row.title}</h3><p>Commitment: {order.description} · {order.supplier}</p>
  {row.cycles.map(cycle => <section key={cycle.id} aria-label={'Review cycle '+cycle.revision}>
   <h4>Review cycle {cycle.revision} · {cycle.product_reference}</h4>
   <Badge>{cycle.decision?disposition(cycle.decision.disposition):cycle.id===current.id?'Awaiting review':'Superseded submission'}</Badge>
   <p>Required {cycle.required_on} · Reviewer: {cycle.reviewer.name} · Submitted by {cycle.submitted_by.name}</p>
   <p>Specified scope: {cycle.specified_scope}</p>
   <p className={cycle.deviation?'notice':undefined}>{cycle.deviation?'Specified-scope deviation: '+cycle.deviation:'No declared scope deviation.'}</p>
   {cycle.attachments.map(file=><p key={file.id}><a href={`/api/plinth/jobs/${jobId}/submittals/files/${file.id}`}>Download original: {file.name}</a> · {file.size} bytes</p>)}
   {cycle.annotations.map(a=><p key={a.id}>{a.text} · {cycle.attachments.find(f=>f.id===a.file_id)?.name}, page {a.page} · {a.by.name}</p>)}
   {cycle.decision&&<p>Review comments: {cycle.decision.comment} · {cycle.decision.by.name}</p>}
   {cycle.id===current.id&&!cycle.decision&&cycle.reviewer.id===data.person_id&&<details><summary>Review this vendor version</summary>
    <Form submit="Add review annotation" action={async f=>mutate(`/${row.id}/annotate`,{cycle_id:cycle.id,file_id:f.get('file_id'),page:Number(f.get('page')),text:f.get('text')})}>
     <label>Original to annotate<select aria-label="Original to annotate" name="file_id">{cycle.attachments.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
     <Field label="Original page" name="page" type="number" min="1" defaultValue="1"/><Field label="Review annotation" name="text"/>
    </Form>
    <Form submit="Record review disposition" action={async f=>mutate(`/${row.id}/review`,{cycle_id:cycle.id,disposition:f.get('disposition'),comment:f.get('comment'),confirm:f.get('confirm')==='on'})}>
     <label>Disposition<select aria-label="Disposition" name="disposition"><option value="rejected">Rejected</option><option value="revise_resubmit">Revise and resubmit</option><option value="approved">Approved</option></select></label>
     <Field label="Review comments" name="comment"/><label><input name="confirm" type="checkbox" required/> I reviewed these exact originals and the specified-scope deviations.</label>
    </Form>
   </details>}
  </section>)}
  <p role="status">{release?.cycle_id===current.id&&current.decision?.disposition==='approved'?'Approved vendor version selected for this commitment. Procurement rechecks current authority and terms.':'Procurement held: select the current approved vendor version.'}</p>
  {data.manage&&current.decision?.disposition==='approved'&&<Form submit="Select approved version" action={async f=>mutate(`/${row.id}/release`,{cycle_id:current.id,order_id:row.order_id,product_reference:f.get('product_reference'),confirm:f.get('confirm')==='on'})}>
   <Field label="Exact approved product and version" name="product_reference" defaultValue={current.product_reference}/>
   <label><input name="confirm" type="checkbox" required/> Release only this exact product for this commitment.</label>
  </Form>}
  {data.manage&&<details ref={resubmission}><summary>Resubmit a new vendor version</summary><SubmittalSubmission data={data} row={row} submit="Resubmit vendor package" action={async body=>{await mutate(`/${row.id}/resubmit`,{cycle_id:current.id,...body});if(resubmission.current)resubmission.current.open=false}}/></details>}
  {(row.notices??[]).map(notice=><p key={notice.id}>Supplier notice · cycle {row.cycles.find(c=>c.id===notice.cycle_id)?.revision} · {notice.to}: {notice.label} · {notice.by.name}</p>)}
  {data.manage&&current.decision&&order.vendor_email&&!(row.notices??[]).some(n=>n.cycle_id===current.id&&!['refused','development'].includes(n.status))&&<details><summary>Notify supplier of this review</summary>
   <p>Send the current disposition, review comments, annotations and original vendor files to {order.vendor_email}. This notice does not release procurement.</p>
   <Form submit="Send supplier disposition" action={async f=>mutate(`/${row.id}/notify`,{cycle_id:current.id,product_reference:current.product_reference,to:order.vendor_email,confirm:f.get('confirm')==='on'})}>
    <label><input name="confirm" type="checkbox" required/> I authorize sharing this exact review and its originals with this supplier.</label>
   </Form>
  </details>}
  {data.manage&&!order.vendor_email&&<p>Add the supplier email when preparing the purchase order to send review dispositions.</p>}
 </article>
}
function SubmittalSubmission({data,row,submit,action}:{data:SubmittalView;row?:Submittal;submit:string;action:(body:Record<string,unknown>)=>Promise<void>}) {
 const [files,setFiles] = useState<File[]>([]), current=row?.cycles.at(-1)
 return <Form submit={submit} action={async f=>{
  const attachments=[]
  for(const file of files){const bytes=new Uint8Array(await file.arrayBuffer());let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);attachments.push({name:file.name,mime:file.type,base64:btoa(raw)})}
  await action({...(row?{}:{title:f.get('title'),order_id:f.get('order_id')}),product_reference:f.get('product_reference'),required_on:f.get('required_on'),specified_scope:f.get('specified_scope'),reviewer_id:f.get('reviewer_id'),deviates:f.get('deviates')==='on',deviation:f.get('deviation'),attachments})
 }}>
  {!row&&<><Field label="Submittal title" name="title"/><label>Draft commitment<select aria-label="Draft commitment" name="order_id" required><option value="">Choose a draft purchase order</option>{data.orders.filter(o=>o.status==='draft'&&!data.register.some(s=>s.order_id===o.id)).map(o=><option key={o.id} value={o.id}>{o.description} · {o.supplier}</option>)}</select></label></>}
  <Field label="Product and vendor version" name="product_reference"/>
  <Field label="Required review date" name="required_on" type="date" defaultValue={current?.required_on}/>
  <Field label="Specified scope" name="specified_scope" defaultValue={current?.specified_scope}/>
  <label>Designated reviewer<select aria-label="Designated reviewer" name="reviewer_id" required defaultValue={current?.reviewer.id??data.person_id}>{data.reviewers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  <label><input name="deviates" type="checkbox" defaultChecked={!!current?.deviation}/> Product deviates from specified scope</label>
  <Field label="Deviation details" name="deviation" required={false} defaultValue={current?.deviation}/>
  <label>Original vendor documents<input type="file" accept="application/pdf,image/png,image/jpeg" multiple required onChange={e=>setFiles(Array.from(e.target.files??[]))}/></label>
 </Form>
}
